import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { AcademicService, createManualItemSchema } from "../domain/service.ts";
import type { AcademicRepository } from "../domain/repository.ts";

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

export function createCortexMcpServer(repository: AcademicRepository) {
  const service = new AcademicService(repository);
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
    title: "Get course", description: "Get a course with sections, modules, academic items, and gradebook.",
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
    title: "Search academic context", description: "Full-text search courses, academic items, modules, and Cortex notes.",
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
    title: "Add note", description: "Attach a Cortex-owned note to one course or academic item.",
    inputSchema: {
      targetType: z.enum(["course", "academic_item"]), targetId: uuid,
      body: z.string().trim().min(1).max(50_000),
    }, annotations: { ...safeWriteAnnotations, idempotentHint: false },
  }, async ({ targetType, targetId, body }) => result({ noteId: await repository.addNote(
    targetType === "course" ? { courseId: targetId } : { itemId: targetId }, body,
  ) }));

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
