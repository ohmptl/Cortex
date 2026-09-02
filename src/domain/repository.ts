/* eslint-disable prefer-const */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcademicItem,
  AcademicItemStatus,
  AcademicItemType,
  AcademicSearchResult,
  Course,
  CourseDetail,
  GradeCategory,
  GradeModel,
  GradeItem,
  Lecture,
  MoodleConnectionStatus,
  Note,
  ProviderCapability,
  SyncRun,
} from "@/domain/types";
import { calculateGrade,type CategoryRule,type ItemRule } from "./gradeCalculator.ts";

type Row = Record<string, unknown>;

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function mapCourse(row: Row): Course {
  return {
    id: stringValue(row.id),
    code: stringValue(row.effective_code ?? row.code),
    name: stringValue(row.effective_name ?? row.name),
    term: nullableString(row.effective_term ?? row.term),
    instructor: nullableString(row.effective_instructor ?? row.instructor),
    active: row.active !== false,
    color: stringValue(row.effective_color ?? row.color, "#b07b5c"),
    overrides: objectValue(row.overrides),
  };
}

function mapItem(row: Row): AcademicItem {
  return {
    id: stringValue(row.id),
    courseId: nullableString(row.course_id),
    providerModuleId: nullableString(row.provider_module_id),
    origin: row.origin === "provider" ? "provider" : "manual",
    type: stringValue(row.effective_item_type ?? row.item_type, "other") as AcademicItemType,
    title: stringValue(row.effective_title ?? row.title),
    description: nullableString(row.effective_description ?? row.description),
    startAt: nullableString(row.source_start_at),
    availableAt: nullableString(row.effective_available_at ?? row.source_available_at),
    dueAt: nullableString(row.effective_due_at ?? row.source_due_at),
    closeAt: nullableString(row.effective_close_at ?? row.source_close_at),
    endAt: nullableString(row.source_end_at),
    allDay: row.all_day === true,
    url: nullableString(row.effective_url ?? row.url),
    status: stringValue(row.status, "not_started") as AcademicItemStatus,
    completionState: nullableString(row.completion_state),
    submissionState: nullableString(row.submission_state),
    submittedAt: nullableString(row.submitted_at),
    completedAt: nullableString(row.completed_at),
    upstreamState: stringValue(row.upstream_state, "present") as AcademicItem["upstreamState"],
    overrides: objectValue(row.overrides),
  };
}

export class AcademicRepository {
  constructor(
    private readonly client: SupabaseClient,
    readonly ownerId: string,
  ) {}

  async listCourses(activeOnly = false): Promise<Course[]> {
    let query = this.client.from("effective_courses").select("*").eq("owner_id", this.ownerId).order("effective_code");
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    throwIfError(error);
    return ((data ?? []) as Row[]).map(mapCourse);
  }

  async getCourse(courseId: string): Promise<Course | null> {
    const { data, error } = await this.client.from("effective_courses").select("*")
      .eq("owner_id", this.ownerId).eq("id", courseId).maybeSingle();
    throwIfError(error);
    return data ? mapCourse(data as Row) : null;
  }

  async listAcademicItems(options: {
    courseId?: string;
    from?: string;
    to?: string;
    includeMissing?: boolean;
    limit?: number;
  } = {}): Promise<AcademicItem[]> {
    let query = this.client.from("effective_academic_items").select("*").eq("owner_id", this.ownerId);
    if (options.courseId) query = query.eq("course_id", options.courseId);
    if (options.from) query = query.gte("effective_due_at", options.from);
    if (options.to) query = query.lte("effective_due_at", options.to);
    if (!options.includeMissing) query = query.eq("upstream_state", "present");
    query = query.order("effective_due_at", { ascending: true, nullsFirst: false }).limit(options.limit ?? 250);
    const { data, error } = await query;
    throwIfError(error);
    const items = ((data ?? []) as Row[]).map(mapItem);
    const courses = await this.listCourses();
    const byId = new Map(courses.map((course) => [course.id, course]));
    return items.map((item) => ({ ...item, course: item.courseId ? byId.get(item.courseId) : undefined }));
  }

  async getAcademicItem(itemId: string): Promise<AcademicItem | null> {
    const { data, error } = await this.client.from("effective_academic_items").select("*")
      .eq("owner_id", this.ownerId).eq("id", itemId).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const item = mapItem(data as Row);
    return { ...item, course: item.courseId ? await this.getCourse(item.courseId) ?? undefined : undefined };
  }

  async getCourseDetail(courseId: string): Promise<CourseDetail | null> {
    const course = await this.getCourse(courseId);
    if (!course) return null;
    const [items, categoriesResult, gradesResult,lecturesResult,notesResult,modelsResult] = await Promise.all([
      this.listAcademicItems({ courseId, includeMissing: true }),
      this.client.from("grade_categories").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
      this.client.from("grade_items").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
      this.client.from("lectures").select("*").eq("owner_id",this.ownerId).eq("course_id",courseId).order("recorded_at",{ascending:false}),
      this.client.from("notes").select("*").eq("owner_id",this.ownerId).eq("course_id",courseId).is("archived_at",null).order("created_at",{ascending:false}),
      this.client.from("grade_models").select("*").eq("owner_id",this.ownerId).eq("course_id",courseId).is("archived_at",null).order("created_at"),
    ]);
    [categoriesResult.error, gradesResult.error,lecturesResult.error,notesResult.error,modelsResult.error].forEach(throwIfError);
    const categories: GradeCategory[] = ((categoriesResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), parentCategoryId: nullableString(row.parent_category_id),
      name: stringValue(row.name), aggregation:nullableString(row.aggregation),weight: nullableNumber(row.weight), minimumScore: nullableNumber(row.minimum_score),
      maximumScore: nullableNumber(row.maximum_score), position: numberValue(row.position),
    }));
    const grades: GradeItem[] = ((gradesResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), categoryId: nullableString(row.category_id),
      academicItemId: nullableString(row.academic_item_id), name: stringValue(row.name), score: nullableNumber(row.score),
      maximumScore: nullableNumber(row.maximum_score), percentage: nullableNumber(row.percentage),weight:nullableNumber(row.weight),
      feedback: nullableString(row.feedback), hidden: row.hidden === true, position: numberValue(row.position),
    }));
    const lectures=((lecturesResult.data??[]) as Row[]).map(mapLecture);
    const notes=((notesResult.data??[]) as Row[]).map(mapNote);
    const gradeModels=((modelsResult.data??[]) as Row[]).map(mapGradeModel);
    return { course, items, categories, grades,lectures,notes,gradeModels };
  }

  async getGradeItem(gradeItemId: string): Promise<GradeItem | null> {
    const { data, error } = await this.client.from("grade_items").select("*").eq("owner_id", this.ownerId).eq("id", gradeItemId).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const row = data as Row;
    return {
      id: stringValue(row.id), courseId: stringValue(row.course_id), categoryId: nullableString(row.category_id),
      academicItemId: nullableString(row.academic_item_id), name: stringValue(row.name), score: nullableNumber(row.score),
      maximumScore: nullableNumber(row.maximum_score), percentage: nullableNumber(row.percentage),weight:nullableNumber(row.weight),
      feedback: nullableString(row.feedback), hidden: row.hidden === true, position: numberValue(row.position),
    };
  }

  async getMoodleStatus(): Promise<MoodleConnectionStatus | null> {
    const { data, error } = await this.client.from("provider_connections").select("*")
      .eq("owner_id", this.ownerId).eq("provider", "moodle").order("created_at", { ascending: false }).limit(1).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const row = data as Row;
    return {
      id: stringValue(row.id), connected: row.status === "active", baseUrl: stringValue(row.base_url),
      username: nullableString(row.external_username), displayName: nullableString(row.display_name),
      lastCapabilityCheckAt: nullableString(row.last_capability_check_at),
    };
  }

  async listCapabilities(connectionId: string): Promise<ProviderCapability[]> {
    const { data, error } = await this.client.from("provider_capabilities").select("*")
      .eq("owner_id", this.ownerId).eq("connection_id", connectionId).order("diagnostic_group").order("capability_name");
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      name: stringValue(row.capability_name), group: stringValue(row.diagnostic_group),
      desired: row.desired === true, available: row.available === true, checkedAt: stringValue(row.checked_at),
    }));
  }

  async listSyncRuns(limit = 20): Promise<SyncRun[]> {
    const { data, error } = await this.client.from("sync_runs").select("*").eq("owner_id", this.ownerId)
      .order("created_at", { ascending: false }).limit(limit);
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), triggerType: stringValue(row.trigger_type) as SyncRun["triggerType"],
      status: stringValue(row.status) as SyncRun["status"], inserted: numberValue(row.inserted_count),
      updated: numberValue(row.updated_count), unchanged: numberValue(row.unchanged_count), missing: numberValue(row.missing_count),
      skipped: numberValue(row.skipped_count), failed: numberValue(row.failed_count), errorMessage: nullableString(row.error_message),
      createdAt: stringValue(row.created_at), finishedAt: nullableString(row.finished_at),
    }));
  }

  async createManualItem(input: {
    courseId?: string | null; title: string; type: AcademicItemType; dueAt?: string | null; description?: string | null; url?: string | null;
  }): Promise<AcademicItem> {
    const { data, error } = await this.client.from("academic_items").insert({
      owner_id: this.ownerId, course_id: input.courseId ?? null, origin: "manual", item_type: input.type,
      title: input.title, description: input.description ?? null, source_due_at: input.dueAt ?? null, url: input.url ?? null,
    }).select("*").single();
    throwIfError(error);
    return mapItem(data as Row);
  }

  async setItemOverride(itemId: string, fieldName: string, value: unknown): Promise<void> {
    const { error } = await this.client.from("field_overrides").upsert({
      owner_id: this.ownerId, academic_item_id: itemId, field_name: fieldName, value,
    }, { onConflict: "course_id,academic_item_id,field_name" });
    throwIfError(error);
  }

  async clearItemOverride(itemId: string, fieldName: string): Promise<void> {
    const { error } = await this.client.from("field_overrides").delete().eq("owner_id", this.ownerId)
      .eq("academic_item_id", itemId).eq("field_name", fieldName);
    throwIfError(error);
  }

  async markItemComplete(itemId: string, complete = true): Promise<void> {
    const { error } = await this.client.from("academic_items").update({
      status: complete ? "completed" : "not_started", completed_at: complete ? new Date().toISOString() : null,
    }).eq("owner_id", this.ownerId).eq("id", itemId);
    throwIfError(error);
  }

  async addNote(target: { courseId?: string; itemId?: string;lectureId?:string }, body: string,options:{createdBy?:"user"|"assistant"|"system";sourceType?:string;sourceId?:string;sourceUrl?:string;sourceTimestampSeconds?:number}={}): Promise<string> {
    const { data, error } = await this.client.from("notes").insert({
      owner_id: this.ownerId, course_id: target.courseId ?? null, academic_item_id: target.itemId ?? null,lecture_id:target.lectureId??null, body,
      created_by:options.createdBy??"user",source_type:options.sourceType??null,source_id:options.sourceId??null,source_url:options.sourceUrl??null,source_timestamp_seconds:options.sourceTimestampSeconds??null,
    }).select("id").single();
    throwIfError(error);
    return stringValue((data as Row).id);
  }

  async listNotes(options:{courseId?:string;itemId?:string;lectureId?:string;includeArchived?:boolean}={}):Promise<Note[]>{let query=this.client.from("notes").select("*").eq("owner_id",this.ownerId);if(options.courseId)query=query.eq("course_id",options.courseId);if(options.itemId)query=query.eq("academic_item_id",options.itemId);if(options.lectureId)query=query.eq("lecture_id",options.lectureId);if(!options.includeArchived)query=query.is("archived_at",null);const{data,error}=await query.order("created_at",{ascending:false});throwIfError(error);return((data??[]) as Row[]).map(mapNote);}
  async updateNote(noteId:string,body:string):Promise<void>{const{error}=await this.client.from("notes").update({body}).eq("owner_id",this.ownerId).eq("id",noteId);throwIfError(error);}
  async archiveNote(noteId:string,archived=true):Promise<void>{const{error}=await this.client.from("notes").update({archived_at:archived?new Date().toISOString():null}).eq("owner_id",this.ownerId).eq("id",noteId);throwIfError(error);}

  async listCourseLectures(courseId:string,from?:string,to?:string):Promise<Lecture[]>{let query=this.client.from("lectures").select("*").eq("owner_id",this.ownerId).eq("course_id",courseId);if(from)query=query.gte("recorded_at",from);if(to)query=query.lte("recorded_at",to);const{data,error}=await query.order("recorded_at",{ascending:false});throwIfError(error);return((data??[]) as Row[]).map(mapLecture);}
  async getLecture(lectureId:string){const{data,error}=await this.client.from("lectures").select("*").eq("owner_id",this.ownerId).eq("id",lectureId).maybeSingle();throwIfError(error);if(!data)return null;const{data:segments,error:segmentError}=await this.client.from("lecture_segments").select("text").eq("owner_id",this.ownerId).eq("lecture_id",lectureId).order("ordinal").limit(1);throwIfError(segmentError);return{...mapLecture(data as Row),preview:segments?.[0]?.text?.slice(0,500)??null};}
  async getLectureTranscript(lectureId:string,options:{fromOrdinal?:number;toOrdinal?:number;fromSeconds?:number;toSeconds?:number;limit?:number}={}){let query=this.client.from("lecture_segments").select("*").eq("owner_id",this.ownerId).eq("lecture_id",lectureId);if(options.fromOrdinal!==undefined)query=query.gte("ordinal",options.fromOrdinal);if(options.toOrdinal!==undefined)query=query.lte("ordinal",options.toOrdinal);if(options.fromSeconds!==undefined)query=query.gte("end_seconds",options.fromSeconds);if(options.toSeconds!==undefined)query=query.lte("start_seconds",options.toSeconds);const{data,error}=await query.order("ordinal").limit(Math.min(options.limit??20,100));throwIfError(error);return((data??[]) as Row[]).map((row)=>({id:stringValue(row.id),lectureId:stringValue(row.lecture_id),ordinal:numberValue(row.ordinal),startSeconds:nullableNumber(row.start_seconds),endSeconds:nullableNumber(row.end_seconds),text:stringValue(row.text)}));}
  async searchLectureTranscripts(input:{query:string;courseId?:string;lectureId?:string;from?:string;to?:string;limit?:number}){const{data,error}=await this.client.rpc("search_lecture_transcripts",{query_text:input.query,course_filter:input.courseId??null,lecture_filter:input.lectureId??null,from_date:input.from??null,to_date:input.to??null,result_limit:input.limit??8});throwIfError(error);return data??[];}

  async listGradeModels(courseId:string):Promise<GradeModel[]>{const{data,error}=await this.client.from("grade_models").select("*").eq("owner_id",this.ownerId).eq("course_id",courseId).is("archived_at",null).order("created_at");throwIfError(error);return((data??[]) as Row[]).map(mapGradeModel);}
  async upsertGradeModel(input:{id?:string;courseId:string;name:string;isDefault?:boolean;ungradedPolicy?:"exclude"|"zero";categoryRules?:CategoryRule[];itemRules?:ItemRule[]}){if(input.isDefault)await this.client.from("grade_models").update({is_default:false}).eq("owner_id",this.ownerId).eq("course_id",input.courseId);const payload={owner_id:this.ownerId,course_id:input.courseId,name:input.name,is_default:input.isDefault??false,ungraded_policy:input.ungradedPolicy??"exclude"};const result=input.id?await this.client.from("grade_models").update(payload).eq("owner_id",this.ownerId).eq("id",input.id).select("*").single():await this.client.from("grade_models").insert(payload).select("*").single();throwIfError(result.error);const model=mapGradeModel(result.data as Row);if(input.categoryRules){await this.client.from("grade_model_category_rules").delete().eq("owner_id",this.ownerId).eq("model_id",model.id);if(input.categoryRules.length)throwIfError((await this.client.from("grade_model_category_rules").insert(input.categoryRules.map((rule)=>({owner_id:this.ownerId,model_id:model.id,grade_category_id:rule.gradeCategoryId,excluded:rule.excluded,weight_override:rule.weightOverride})))).error);}if(input.itemRules){await this.client.from("grade_model_item_rules").delete().eq("owner_id",this.ownerId).eq("model_id",model.id);if(input.itemRules.length)throwIfError((await this.client.from("grade_model_item_rules").insert(input.itemRules.map((rule)=>({owner_id:this.ownerId,model_id:model.id,grade_item_id:rule.gradeItemId,excluded:rule.excluded,score_override:rule.scoreOverride,maximum_score_override:rule.maximumScoreOverride})))).error);}return model;}
  async archiveGradeModel(modelId:string){const{error}=await this.client.from("grade_models").update({archived_at:new Date().toISOString(),is_default:false}).eq("owner_id",this.ownerId).eq("id",modelId);throwIfError(error);}
  async calculateCourseGrade(courseId:string,modelId?:string,targetPercentage?:number){const detail=await this.getCourseDetail(courseId);if(!detail)throw new Error("Course not found");let model=modelId?detail.gradeModels.find((candidate)=>candidate.id===modelId):detail.gradeModels.find((candidate)=>candidate.isDefault);let categoryRules:CategoryRule[]=[],itemRules:ItemRule[]=[];if(model){const[categoryResult,itemResult]=await Promise.all([this.client.from("grade_model_category_rules").select("*").eq("owner_id",this.ownerId).eq("model_id",model.id),this.client.from("grade_model_item_rules").select("*").eq("owner_id",this.ownerId).eq("model_id",model.id)]);throwIfError(categoryResult.error);throwIfError(itemResult.error);categoryRules=((categoryResult.data??[]) as Row[]).map((row)=>({gradeCategoryId:stringValue(row.grade_category_id),excluded:row.excluded===true,weightOverride:nullableNumber(row.weight_override)}));itemRules=((itemResult.data??[]) as Row[]).map((row)=>({gradeItemId:stringValue(row.grade_item_id),excluded:row.excluded===true,scoreOverride:nullableNumber(row.score_override),maximumScoreOverride:nullableNumber(row.maximum_score_override)}));}return{course:detail.course,model:model??null,result:calculateGrade({categories:detail.categories,items:detail.grades,model,categoryRules,itemRules,targetPercentage})};}

  async addTag(itemId: string, name: string, color?: string): Promise<void> {
    const { data, error } = await this.client.from("tags").upsert(
      { owner_id: this.ownerId, name, color: color ?? null }, { onConflict: "owner_id,name" },
    ).select("id").single();
    throwIfError(error);
    const { error: linkError } = await this.client.from("academic_item_tags").upsert({
      owner_id: this.ownerId, academic_item_id: itemId, tag_id: stringValue((data as Row).id),
    });
    throwIfError(linkError);
  }

  async scheduleReview(itemId: string, dueAt: string, title?: string): Promise<AcademicItem> {
    const source = await this.getAcademicItem(itemId);
    if (!source) throw new Error("Academic item not found");
    const review = await this.createManualItem({
      courseId: source.courseId, title: title ?? `Review: ${source.title}`, type: "review", dueAt,
    });
    const { error } = await this.client.from("academic_item_relations").insert({
      owner_id: this.ownerId, source_item_id: review.id, target_item_id: itemId, relation_type: "review_of",
    });
    throwIfError(error);
    return review;
  }

  async triggerMoodleSync(trigger: "manual" | "mcp"): Promise<string> {
    const { data, error } = await this.client.rpc("request_moodle_sync", { requested_trigger: trigger });
    throwIfError(error);
    return stringValue(data);
  }

  async search(query: string, limit = 20): Promise<AcademicSearchResult[]> {
    const { data, error } = await this.client.rpc("search_academic_context", { query_text: query, result_limit: limit });
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      kind: stringValue(row.kind) as AcademicSearchResult["kind"], id: stringValue(row.id),
      courseId: nullableString(row.course_id), title: stringValue(row.title), excerpt: nullableString(row.excerpt),
      rank: numberValue(row.rank),
    }));
  }
}

function mapLecture(row:Row):Lecture{return{id:stringValue(row.id),courseId:stringValue(row.course_id),title:stringValue(row.title),recordedAt:nullableString(row.recorded_at),durationSeconds:nullableNumber(row.duration_seconds),instructor:nullableString(row.instructor),providerUrl:nullableString(row.provider_url),transcriptStatus:stringValue(row.transcript_status,"pending") as Lecture["transcriptStatus"],transcriptLanguage:nullableString(row.transcript_language)};}
function mapNote(row:Row):Note{return{id:stringValue(row.id),courseId:nullableString(row.course_id),academicItemId:nullableString(row.academic_item_id),lectureId:nullableString(row.lecture_id),body:stringValue(row.body),createdBy:stringValue(row.created_by,"user") as Note["createdBy"],sourceType:nullableString(row.source_type),sourceId:nullableString(row.source_id),sourceUrl:nullableString(row.source_url),sourceTimestampSeconds:nullableNumber(row.source_timestamp_seconds),archivedAt:nullableString(row.archived_at),createdAt:stringValue(row.created_at),updatedAt:stringValue(row.updated_at)};}
function mapGradeModel(row:Row):GradeModel{return{id:stringValue(row.id),courseId:stringValue(row.course_id),name:stringValue(row.name),isDefault:row.is_default===true,ungradedPolicy:stringValue(row.ungraded_policy,"exclude") as GradeModel["ungradedPolicy"],archivedAt:nullableString(row.archived_at)};}
