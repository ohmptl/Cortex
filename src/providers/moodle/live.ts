import { createHash } from "node:crypto";
import { createAdminClient } from "../../lib/supabase/admin.ts";
import { decryptCredential } from "../../lib/crypto.ts";
import { extractDocumentText, paginateText } from "../../lib/document-extraction.ts";
import { MAX_COURSE_FILE_BYTES } from "../../lib/file-limits.ts";
import { liveResultCache } from "../cache.ts";
import { ProviderError } from "../errors.ts";
import { MoodleClient } from "./client.ts";

type Row = Record<string, unknown>;
export interface MoodleFile { fileRef: string; filename: string; mimeType: string | null; size: number | null; modifiedAt: string | null; moduleId: string; moduleTitle: string; providerUrl: string | null }
export interface MoodleModule { providerId: string; sectionId: string; sectionTitle: string; title: string; type: string; visible: boolean; availability: unknown; completion: unknown; url: string | null; files: MoodleFile[] }

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function num(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try { const url = new URL(value); ["token","wstoken","access_token"].forEach((key) => url.searchParams.delete(key)); return url.toString(); }
  catch { return null; }
}
export function readableHtml(value: unknown): string {
  return text(value).replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>/gi,"\n\n")
    .replace(/<li[^>]*>/gi,"- ").replace(/<[^>]+>/g,"").replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\n{3,}/g,"\n\n").trim();
}
function dateFromEpoch(value: unknown): string | null { const n=num(value); return n && n > 0 ? new Date(n * 1000).toISOString() : null; }
function fileIdentity(moduleId: string, row: Row): string {
  return createHash("sha256").update([moduleId,text(row.filepath),text(row.filename),text(row.contenthash),text(row.fileurl)].join("\0")).digest("base64url");
}

async function resolve(ownerId: string, courseId: string) {
  const admin = createAdminClient();
  const { data: link, error } = await admin.from("course_provider_links").select("connection_id,external_id,provider_connections(base_url,status)")
    .eq("owner_id", ownerId).eq("course_id", courseId).eq("provider", "moodle").eq("link_type", "course").maybeSingle();
  if (error) throw new ProviderError("PROVIDER_UNAVAILABLE", "Unable to resolve the course provider mapping");
  if (!link) throw new ProviderError("PROVIDER_MAPPING_MISSING", "Course is not linked to Moodle");
  const connection = link.provider_connections as unknown as { base_url: string; status: string } | null;
  if (!connection || connection.status !== "active") throw new ProviderError("PROVIDER_UNAVAILABLE", "Moodle connection is not active");
  const { data: credential } = await admin.from("provider_credentials").select("encrypted_payload").eq("owner_id",ownerId).eq("connection_id",link.connection_id).maybeSingle();
  const key = process.env.MOODLE_ENCRYPTION_KEY;
  if (!credential || !key) throw new ProviderError("PROVIDER_AUTH_INVALID", "Moodle credentials are unavailable");
  const payload = await decryptCredential<{ token?: string }>(credential.encrypted_payload,key);
  if (!payload.token) throw new ProviderError("PROVIDER_AUTH_INVALID", "Moodle credential is invalid");
  return { connectionId: link.connection_id as string, providerCourseId: link.external_id as string, client: new MoodleClient(connection.base_url,payload.token) };
}

type MoodleCourseResolver = (ownerId: string, courseId: string) => ReturnType<typeof resolve>;

export function normalizeContents(contents: unknown[]): MoodleModule[] {
  const modules: MoodleModule[] = [];
  for (const sectionValue of contents) {
    const section = sectionValue as Row;
    const sectionId = text(section.id);
    const sectionTitle = text(section.name);
    for (const moduleValue of Array.isArray(section.modules) ? section.modules : []) {
      const activity = moduleValue as Row;
      const moduleId = text(activity.id);
      const moduleTitle = text(activity.name);
      const files: MoodleFile[] = (Array.isArray(activity.contents) ? activity.contents : []).map((value) => {
        const row = value as Row;
        return { fileRef: fileIdentity(moduleId,row), filename:text(row.filename), mimeType:text(row.mimetype)||null,
          size:num(row.filesize), modifiedAt:dateFromEpoch(row.timemodified), moduleId, moduleTitle, providerUrl:safeUrl(row.fileurl) };
      }).filter((file) => file.filename && file.providerUrl);
      modules.push({ providerId:moduleId, sectionId, sectionTitle, title:moduleTitle, type:text(activity.modname)||"other",
        visible:activity.visible !== 0 && activity.uservisible !== false, availability:activity.availability ?? null,
        completion:activity.completiondata ?? activity.completion ?? null, url:safeUrl(activity.url), files });
    }
  }
  return modules;
}

export class MoodleLiveService {
  private readonly ownerId:string;
  private readonly resolveCourse:MoodleCourseResolver;
  constructor(ownerId: string, resolveCourse: MoodleCourseResolver = resolve) {this.ownerId=ownerId;this.resolveCourse=resolveCourse;}

  async getCourseModules(courseId: string): Promise<MoodleModule[]> {
    const provider = await this.resolveCourse(this.ownerId,courseId);
    const key = `${this.ownerId}:${provider.connectionId}:${courseId}:modules`;
    const cached = liveResultCache.get<MoodleModule[]>(key); if (cached) return cached;
    return liveResultCache.set(key,normalizeContents(await provider.client.courseContents(provider.providerCourseId)));
  }

  async getCourseResources(courseId: string) {
    const modules = await this.getCourseModules(courseId);
    return modules.filter((module) => ["resource","folder","page","book","url","label"].includes(module.type))
      .map((module) => ({ ...module, resourceKind: module.type === "resource" && module.files.length ? "file" : module.type }));
  }

  async getCourseFiles(courseId: string): Promise<MoodleFile[]> { return (await this.getCourseModules(courseId)).flatMap((module) => module.files); }

  async getCourseAnnouncements(courseId: string, limit = 10) {
    const provider = await this.resolveCourse(this.ownerId,courseId); const bounded=Math.max(1,Math.min(limit,50));
    const key=`${this.ownerId}:${provider.connectionId}:${courseId}:announcements:${bounded}`;
    const cached=liveResultCache.get<unknown>(key); if(cached) return cached;
    const forums=await provider.client.forums(provider.providerCourseId);
    const news=(forums as Row[]).find((forum)=>text(forum.type).toLowerCase()==="news");
    if(!news) return liveResultCache.set(key,{ total:0,returned:0,truncated:false,announcements:[] });
    const response=await provider.client.forumDiscussions(text(news.id),50);
    const raw=Array.isArray(response.discussions)?response.discussions as Row[]:[];
    const announcements=raw.map((row)=>({ providerId:text(row.discussion||row.id),title:text(row.name||row.subject),
      author:text(row.userfullname||row.author?.toString())||null,createdAt:dateFromEpoch(row.created||row.timecreated),
      modifiedAt:dateFromEpoch(row.modified||row.timemodified),content:readableHtml(row.message),url:safeUrl(row.url),
      attachments:(Array.isArray(row.attachments)?row.attachments:[]).map((v)=>{const f=v as Row;return{filename:text(f.filename),mimeType:text(f.mimetype)||null,size:num(f.filesize),modifiedAt:dateFromEpoch(f.timemodified)};}),
      inlineFiles:(Array.isArray(row.messageinlinefiles)?row.messageinlinefiles:[]).map((v)=>{const f=v as Row;return{filename:text(f.filename),mimeType:text(f.mimetype)||null,size:num(f.filesize)};}) }))
      .sort((a,b)=>String(b.modifiedAt??b.createdAt??"").localeCompare(String(a.modifiedAt??a.createdAt??"")));
    const total=num(response.total)??announcements.length;
    return liveResultCache.set(key,{total,returned:Math.min(bounded,announcements.length),truncated:total>bounded||announcements.length>bounded,announcements:announcements.slice(0,bounded)});
  }

  async readCourseFile(courseId:string,fileRef:string,offset=0,maxChars=30_000){
    const provider=await this.resolveCourse(this.ownerId,courseId);
    const files=normalizeContents(await provider.client.courseContents(provider.providerCourseId)).flatMap((module)=>module.files);
    const file=files.find((candidate)=>candidate.fileRef===fileRef);
    if(!file?.providerUrl) throw new ProviderError("FILE_REFERENCE_INVALID","File reference is not valid for this course");
    if(file.size!==null&&file.size>MAX_COURSE_FILE_BYTES) throw new ProviderError("FILE_TOO_LARGE",`File exceeds the ${MAX_COURSE_FILE_BYTES} byte limit`);
    const downloaded=await provider.client.downloadFile(file.providerUrl);
    const extracted=await extractDocumentText(downloaded.bytes,file.mimeType??downloaded.contentType,file.filename);
    return { file:{...file,providerUrl:undefined},contentType:extracted.contentType,...paginateText(extracted.text,offset,maxChars) };
  }
}
