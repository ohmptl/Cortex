import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { AcademicService, createManualItemSchema } from "../domain/service.ts";
import type { AcademicRepository } from "../domain/repository.ts";
import { ProviderError } from "../providers/errors.ts";
import { MoodleLiveService } from "../providers/moodle/live.ts";

const uuid = z.string().uuid();
const dateTime = z.string().datetime({ offset: true });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const safeWriteAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
  };
}

export async function providerResult(operation: () => Promise<unknown>) {
  try {
    return result(await operation());
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const value = { error: { code: error.code, message: error.message, retryable: error.retryable } };
    return { ...result(value), isError: true };
  }
}

export function createCortexMcpServer(repository: AcademicRepository) {
  const service = new AcademicService(repository);
  const moodle = new MoodleLiveService(repository.ownerId);
  const server = new McpServer({ name: "cortex-academic", version: "2.0.0" });

  server.registerTool("get_today", {
    title: "Get today's agenda", description: "Return incomplete academic work due today using effective Cortex dates.",
    annotations: readAnnotations,
  }, async () => result(await service.getToday()));

  server.registerTool("get_upcoming", {
    title: "Get upcoming work", description: "Return upcoming academic work across courses.",
    inputSchema: { days: z.number().int().min(1).max(365).default(14) }, annotations: readAnnotations,
  }, async ({ days }) => result(await service.getUpcoming(days)));

  server.registerTool("list_courses", {
    title: "List courses", description: "List Cortex courses created from authoritative provider identities.",
    inputSchema: { activeOnly: z.boolean().default(false) }, annotations: readAnnotations,
  }, async ({ activeOnly }) => result(await repository.listCourses(activeOnly)));

  server.registerTool("get_course", {
    title: "Get course", description: "Get persistent Cortex student state, gradebook, notes, and lectures for a course.",
    inputSchema: { courseId: uuid }, annotations: readAnnotations,
  }, async ({ courseId }) => {
    const course = await repository.getCourseDetail(courseId);
    if (!course) throw new Error("Course not found");
    return result(course);
  });

  server.registerTool("list_academic_items", {
    title: "List academic items", description: "Query normalized academic items by course and effective date range.",
    inputSchema: {
      courseId: uuid.optional(), from: dateTime.optional(), to: dateTime.optional(),
      includeMissing: z.boolean().default(false), limit: z.number().int().min(1).max(250).default(100),
    }, annotations: readAnnotations,
  }, async (input) => result(await repository.listAcademicItems(input)));

  server.registerTool("get_academic_item", {
    title: "Get academic item", description: "Get one item with effective values and source override metadata.",
    inputSchema: { itemId: uuid }, annotations: readAnnotations,
  }, async ({ itemId }) => {
    const item = await repository.getAcademicItem(itemId);
    if (!item) throw new Error("Academic item not found");
    return result(item);
  });

  server.registerTool("get_calendar_range", {
    title: "Get calendar range", description: "Return academic items whose effective due date falls within an inclusive range.",
    inputSchema: { from: dateTime, to: dateTime }, annotations: readAnnotations,
  }, async ({ from, to }) => result(await service.getCalendarRange(from, to)));

  server.registerTool("get_course_gradebook", {
    title: "Get course gradebook", description: "Return authoritative relational grade categories and items for a course.",
    inputSchema: { courseId: uuid }, annotations: readAnnotations,
  }, async ({ courseId }) => {
    const detail = await repository.getCourseDetail(courseId);
    if (!detail) throw new Error("Course not found");
    return result({ course: detail.course, categories: detail.categories, items: detail.grades });
  });

  server.registerTool("get_grade_item", {
    title: "Get grade item", description: "Return one normalized grade item and its authoritative links.",
    inputSchema: { gradeItemId: uuid }, annotations: readAnnotations,
  }, async ({ gradeItemId }) => {
    const grade = await repository.getGradeItem(gradeItemId);
    if (!grade) throw new Error("Grade item not found");
    return result(grade);
  });

  server.registerTool("search_academic_context", {
    title: "Search academic context", description: "Full-text search persistent courses, academic items, notes, and lecture knowledge.",
    inputSchema: { query: z.string().trim().min(2).max(500), limit: z.number().int().min(1).max(100).default(20) },
    annotations: readAnnotations,
  }, async ({ query, limit }) => result(await repository.search(query, limit)));

  server.registerTool("create_manual_item", {
    title: "Create manual item", description: "Create a Cortex-owned academic item without modifying provider data.",
    inputSchema: createManualItemSchema, annotations: { ...safeWriteAnnotations, idempotentHint: false },
  }, async (input) => result(await service.createManualItem(input)));

  server.registerTool("update_item_override", {
    title: "Update item override", description: "Override a user-controlled effective field while preserving the imported source value.",
    inputSchema: z.object({
      itemId: uuid,
      field: z.enum(["title", "description", "item_type", "due_at", "available_at", "close_at", "url"]),
      value: z.union([z.string(), z.null()]),
    }).strict(), annotations: safeWriteAnnotations,
  }, async (input) => result(await service.updateItemOverride(input)));

  server.registerTool("clear_item_override", {
    title: "Clear item override", description: "Remove one Cortex override so the effective value returns to provider truth.",
    inputSchema: {
      itemId: uuid, field: z.enum(["title", "description", "item_type", "due_at", "available_at", "close_at", "url"]),
    }, annotations: safeWriteAnnotations,
  }, async (input) => result(await service.clearItemOverride(input)));

  server.registerTool("mark_item_complete", {
    title: "Mark item complete", description: "Set or clear Cortex completion state for an academic item.",
    inputSchema: { itemId: uuid, complete: z.boolean().default(true) }, annotations: safeWriteAnnotations,
  }, async ({ itemId, complete }) => {
    await repository.markItemComplete(itemId, complete);
    return result(await repository.getAcademicItem(itemId));
  });

  server.registerTool("add_note", {
    title: "Add note", description: "Attach an explicit durable note to a course, academic item, or lecture.",
    inputSchema: {
      targetType: z.enum(["course", "academic_item","lecture"]), targetId: uuid,
      body: z.string().trim().min(1).max(50_000),
      createdBy:z.enum(["user","assistant","system"]).default("user"),sourceType:z.string().max(100).optional(),sourceId:z.string().max(500).optional(),sourceUrl:z.string().url().optional(),sourceTimestampSeconds:z.number().nonnegative().optional(),
    }, annotations: { ...safeWriteAnnotations, idempotentHint: false },
  }, async ({ targetType, targetId, body,...options }) => result({ noteId: await repository.addNote(
    targetType === "course" ? { courseId: targetId } : targetType==="lecture"?{lectureId:targetId}:{ itemId: targetId }, body,options,
  ) }));

  server.registerTool("list_notes",{title:"List notes",description:"List active durable Cortex notes for a course, item, or lecture.",inputSchema:{courseId:uuid.optional(),itemId:uuid.optional(),lectureId:uuid.optional(),includeArchived:z.boolean().default(false)},annotations:readAnnotations},async(input)=>result(await repository.listNotes(input)));
  server.registerTool("update_note",{title:"Update note",description:"Update the body of a user-manageable Cortex note.",inputSchema:{noteId:uuid,body:z.string().trim().min(1).max(50_000)},annotations:safeWriteAnnotations},async({noteId,body})=>{await repository.updateNote(noteId,body);return result({noteId,updated:true});});
  server.registerTool("archive_note",{title:"Archive note",description:"Archive or restore a Cortex note without hard deletion.",inputSchema:{noteId:uuid,archived:z.boolean().default(true)},annotations:safeWriteAnnotations},async({noteId,archived})=>{await repository.archiveNote(noteId,archived);return result({noteId,archived});});

  server.registerTool("get_course_announcements",{title:"Get live course announcements",description:"Retrieve current announcements live from Moodle for a Cortex course UUID.",inputSchema:{courseId:uuid,limit:z.number().int().min(1).max(50).default(10)},annotations:{...readAnnotations,openWorldHint:true}},async({courseId,limit})=>result(await moodle.getCourseAnnouncements(courseId,limit)));
  server.registerTool("get_course_modules",{title:"Get live course modules",description:"Retrieve current Moodle section and activity metadata without persisting it.",inputSchema:{courseId:uuid},annotations:{...readAnnotations,openWorldHint:true}},async({courseId})=>result(await moodle.getCourseModules(courseId)));
  server.registerTool("get_course_resources",{title:"Get live course resources",description:"Retrieve current Moodle files, folders, pages, books, and URLs.",inputSchema:{courseId:uuid},annotations:{...readAnnotations,openWorldHint:true}},async({courseId})=>result(await moodle.getCourseResources(courseId)));
  server.registerTool("get_course_files",{title:"Get live course files",description:"Discover current Moodle file metadata and safe opaque file references.",inputSchema:{courseId:uuid},annotations:{...readAnnotations,openWorldHint:true}},async({courseId})=>result((await moodle.getCourseFiles(courseId)).map((file)=>({fileRef:file.fileRef,filename:file.filename,mimeType:file.mimeType,size:file.size,modifiedAt:file.modifiedAt,moduleId:file.moduleId,moduleTitle:file.moduleTitle}))));
  server.registerTool("read_course_file",{title:"Read course file",description:"Securely download and extract a Moodle file through Cortex without exposing credentials or persisting the file.",inputSchema:{courseId:uuid,fileRef:z.string().min(20).max(200),offset:z.number().int().nonnegative().default(0),maxCharacters:z.number().int().min(1).max(100_000).default(30_000)},annotations:{...readAnnotations,openWorldHint:true}},async({courseId,fileRef,offset,maxCharacters})=>providerResult(()=>moodle.readCourseFile(courseId,fileRef,offset,maxCharacters)));

  server.registerTool("list_course_lectures",{title:"List course lectures",description:"List persisted Panopto lecture metadata for a Cortex course.",inputSchema:{courseId:uuid,from:dateTime.optional(),to:dateTime.optional()},annotations:readAnnotations},async({courseId,from,to})=>result(await repository.listCourseLectures(courseId,from,to)));
  server.registerTool("get_lecture",{title:"Get lecture",description:"Get lecture metadata, transcript status, and a bounded preview.",inputSchema:{lectureId:uuid},annotations:readAnnotations},async({lectureId})=>result(await repository.getLecture(lectureId)));
  server.registerTool("get_lecture_transcript",{title:"Get lecture transcript segments",description:"Retrieve a bounded ordinal or timestamp range of transcript segments.",inputSchema:{lectureId:uuid,fromOrdinal:z.number().int().nonnegative().optional(),toOrdinal:z.number().int().nonnegative().optional(),fromSeconds:z.number().nonnegative().optional(),toSeconds:z.number().nonnegative().optional(),limit:z.number().int().min(1).max(100).default(20)},annotations:readAnnotations},async({lectureId,...options})=>result(await repository.getLectureTranscript(lectureId,options)));
  server.registerTool("search_lecture_transcripts",{title:"Search lecture transcripts",description:"Search persistent timestamped lecture knowledge with cited neighboring context.",inputSchema:{query:z.string().trim().min(2).max(500),courseId:uuid.optional(),lectureId:uuid.optional(),from:dateTime.optional(),to:dateTime.optional(),limit:z.number().int().min(1).max(25).default(8)},annotations:readAnnotations},async(input)=>result(await repository.searchLectureTranscripts(input)));

  const categoryRule=z.object({gradeCategoryId:uuid,excluded:z.boolean().default(false),weightOverride:z.number().nonnegative().nullable().default(null)});
  const itemRule=z.object({gradeItemId:uuid,excluded:z.boolean().default(false),scoreOverride:z.number().nullable().default(null),maximumScoreOverride:z.number().positive().nullable().default(null)});
  server.registerTool("list_grade_models",{title:"List personal grade models",description:"List Cortex-owned grade interpretations without changing provider grade truth.",inputSchema:{courseId:uuid},annotations:readAnnotations},async({courseId})=>result(await repository.listGradeModels(courseId)));
  server.registerTool("get_grade_model",{title:"Get personal grade model",description:"Return a saved personal grade model and its current calculation.",inputSchema:{courseId:uuid,modelId:uuid},annotations:readAnnotations},async({courseId,modelId})=>result(await repository.calculateCourseGrade(courseId,modelId)));
  server.registerTool("upsert_grade_model",{title:"Save personal grade model",description:"Create or update a separate personal grade model with category and item rules.",inputSchema:{id:uuid.optional(),courseId:uuid,name:z.string().trim().min(1).max(200),isDefault:z.boolean().default(false),ungradedPolicy:z.enum(["exclude","zero"]).default("exclude"),categoryRules:z.array(categoryRule).max(500).default([]),itemRules:z.array(itemRule).max(1000).default([])},annotations:safeWriteAnnotations},async(input)=>result(await repository.upsertGradeModel(input)));
  server.registerTool("archive_grade_model",{title:"Archive personal grade model",description:"Archive a Cortex grade model without modifying Moodle grades.",inputSchema:{modelId:uuid},annotations:safeWriteAnnotations},async({modelId})=>{await repository.archiveGradeModel(modelId);return result({modelId,archived:true});});
  server.registerTool("calculate_course_grade",{title:"Calculate personal course grade",description:"Calculate current and target grades from immutable provider truth plus an optional personal model.",inputSchema:{courseId:uuid,modelId:uuid.optional(),targetPercentage:z.number().min(0).max(100).optional()},annotations:readAnnotations},async({courseId,modelId,targetPercentage})=>result(await repository.calculateCourseGrade(courseId,modelId,targetPercentage)));

  server.registerTool("add_tag", {
    title: "Add tag", description: "Create or reuse a Cortex tag and attach it to an academic item.",
    inputSchema: { itemId: uuid, name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() },
    annotations: safeWriteAnnotations,
  }, async ({ itemId, name, color }) => {
    await repository.addTag(itemId, name, color);
    return result({ itemId, tag: name });
  });

  server.registerTool("schedule_review", {
    title: "Schedule review", description: "Create a dated Cortex review item linked to an existing academic item.",
    inputSchema: { itemId: uuid, dueAt: dateTime, title: z.string().trim().min(1).max(300).optional() },
    annotations: { ...safeWriteAnnotations, idempotentHint: false },
  }, async ({ itemId, dueAt, title }) => result(await repository.scheduleReview(itemId, dueAt, title)));

  server.registerTool("trigger_moodle_sync", {
    title: "Trigger Moodle sync", description: "Queue an observable Moodle synchronization run. The tool cannot mutate raw source truth.",
    annotations: safeWriteAnnotations,
  }, async () => result({ runId: await repository.triggerMoodleSync("mcp"), status: "queued" }));

  return server;
}
