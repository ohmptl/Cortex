import type { AcademicItemType } from "@/domain/types";
import { contentHash, sanitizeMoodlePayload } from "./sanitize.ts";
import {
  activityItemId,
  calendarItemId,
  forumItemId,
  moduleItemId,
  resolveMoodleDeadline,
} from "../../../supabase/functions/_shared/moodle-academic.ts";
import { isMoodleActivityComplete } from "../../../supabase/functions/_shared/completion.ts";

type MoodleObject = Record<string, unknown>;

export interface ProjectionCourse {
  id: string;
  externalId: string;
  code: string;
  name: string;
  active: boolean;
}

export interface ProjectionItem {
  id: string;
  externalId: string;
  externalCourseId: string;
  rawExternalId: string;
  moduleExternalId: string | null;
  type: AcademicItemType;
  title: string;
  description: string | null;
  sourceDueAt: string | null;
  sourceAvailableAt: string | null;
  sourceCloseAt: string | null;
  url: string | null;
  status?: "not_started" | "completed";
  completionState?: string | null;
  upstreamState: "present" | "missing";
  overrides: Record<string, unknown>;
}

export interface ProjectionGradeCategory {
  id: string;
  externalId: string;
  externalCourseId: string;
  parentExternalId: string | null;
  name: string;
}

export interface ProjectionGradeItem {
  id: string;
  externalId: string;
  externalCourseId: string;
  categoryExternalId: string | null;
  name: string;
  score: number | null;
  maximumScore: number | null;
  percentage: number | null;
}

export interface ProjectionRawRecord {
  objectType: string;
  externalId: string;
  externalCourseId: string | null;
  payload: unknown;
  contentHash: string;
  upstreamState: "present" | "missing";
  versions: Array<{ contentHash: string; payload: unknown }>;
}

export interface MoodleProjectionState {
  courses: Record<string, ProjectionCourse>;
  items: Record<string, ProjectionItem>;
  gradeCategories: Record<string, ProjectionGradeCategory>;
  gradeItems: Record<string, ProjectionGradeItem>;
  raw: Record<string, ProjectionRawRecord>;
}

export interface MoodleSnapshot {
  courses: MoodleObject[];
  courseContents?: Array<{ courseId: string; sections: MoodleObject[] }>;
  events?: MoodleObject[];
  assignments?: MoodleObject[];
  quizzes?: MoodleObject[];
  forums?: MoodleObject[];
  gradeItems?: Array<{ courseId: string; items: MoodleObject[] }>;
  completeScopes?: Array<"courses" | "contents" | "events" | "grades">;
  unsupportedCapabilities?: string[];
  failures?: Array<{ capability: string; message: string }>;
}

export interface SyncCounters {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  skipped: number;
  failed: number;
}

export function emptyProjectionState(): MoodleProjectionState {
  return { courses: {}, items: {}, gradeCategories: {}, gradeItems: {}, raw: {} };
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value === "number" && value > 0) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

function externalId(record: MoodleObject, fallback: string): string {
  return text(record.id ?? record.cmid ?? record.instance ?? record.idnumber, fallback);
}

function stableId(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}

export function moodleModuleType(moduleName: unknown): AcademicItemType {
  switch (text(moduleName).toLowerCase()) {
    case "assign": return "assignment";
    case "quiz": return "quiz";
    case "forum": return "discussion";
    case "resource":
    case "folder":
    case "book":
    case "page":
    case "url": return "reading";
    default: return "other";
  }
}

function equalSource(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyEntity<T>(
  collection: Record<string, T>, key: string, value: T, counters: SyncCounters,
): void {
  const previous = collection[key];
  if (!previous) {
    collection[key] = value;
    counters.inserted += 1;
  } else if (equalSource(previous, value)) {
    counters.unchanged += 1;
  } else {
    collection[key] = value;
    counters.updated += 1;
  }
}

async function applyRaw(
  state: MoodleProjectionState,
  objectType: string,
  id: string,
  courseId: string | null,
  payload: unknown,
  counters: SyncCounters,
): Promise<void> {
  const key = `${objectType}:${id}`;
  const sanitized = sanitizeMoodlePayload(payload);
  const hash = await contentHash(sanitized);
  const previous = state.raw[key];
  const versions = previous?.versions ?? [];
  if (!versions.some((version) => version.contentHash === hash)) versions.push({ contentHash: hash, payload: sanitized });
  const next: ProjectionRawRecord = {
    objectType, externalId: id, externalCourseId: courseId, payload: sanitized,
    contentHash: hash, upstreamState: "present", versions,
  };
  applyEntity(state.raw, key, next, counters);
}

function cloneState(state: MoodleProjectionState): MoodleProjectionState {
  return structuredClone(state);
}

export async function projectMoodleSnapshot(
  previous: MoodleProjectionState,
  snapshot: MoodleSnapshot,
): Promise<{ state: MoodleProjectionState; counters: SyncCounters; diagnostics: string[] }> {
  const state = cloneState(previous);
  const counters: SyncCounters = {
    inserted: 0, updated: 0, unchanged: 0, missing: 0,
    skipped: snapshot.unsupportedCapabilities?.length ?? 0,
    failed: snapshot.failures?.length ?? 0,
  };
  const diagnostics = [
    ...(snapshot.unsupportedCapabilities ?? []).map((name) => `${name}: unsupported`),
    ...(snapshot.failures ?? []).map(({ capability, message }) => `${capability}: ${message}`),
  ];

  const seenCourses = new Set<string>();
  for (const course of snapshot.courses) {
    const id = externalId(course, "unknown");
    seenCourses.add(id);
    await applyRaw(state, "course", id, id, course, counters);
    const next: ProjectionCourse = {
      id: state.courses[id]?.id ?? stableId("course", id), externalId: id,
      code: text(course.shortname ?? course.idnumber, `Moodle ${id}`),
      name: text(course.fullname ?? course.displayname ?? course.shortname, `Moodle course ${id}`),
      active: course.visible !== 0 && course.visible !== false,
    };
    applyEntity(state.courses, id, next, counters);
  }

  if (snapshot.completeScopes?.includes("courses")) {
    for (const [id, course] of Object.entries(state.courses)) {
      if (!seenCourses.has(id) && course.active) {
        state.courses[id] = { ...course, active: false };
        counters.missing += 1;
      }
    }
  }

  const modulesByCourseAndId = new Map<string, MoodleObject>();
  const modulesByCourseAndActivity = new Map<string, MoodleObject>();
  const forumModules = new Map<string, { courseId: string; module: MoodleObject }>();
  const seenItems = new Set<string>();
  for (const content of snapshot.courseContents ?? []) {
    for (const section of content.sections) {
      const sectionId = externalId(section, text(section.section, "unknown"));
      await applyRaw(state, "course-section", sectionId, content.courseId, section, counters);
      const modules = Array.isArray(section.modules) ? section.modules as MoodleObject[] : [];
      for (const courseModule of modules) {
        const moduleId = externalId(courseModule, "unknown");
        modulesByCourseAndId.set(`${content.courseId}:${moduleId}`, courseModule);
        const itemId = moduleItemId(courseModule);
        if (itemId) {
          seenItems.add(itemId);
          modulesByCourseAndActivity.set(`${content.courseId}:${itemId}`, courseModule);
          if (itemId.startsWith("activity:forum:")) forumModules.set(itemId, { courseId: content.courseId, module: courseModule });
        }
        await applyRaw(state, "course-module", moduleId, content.courseId, courseModule, counters);
      }
    }
  }

  const assignments = new Map((snapshot.assignments ?? []).map((item) => [text(item.id), item]));
  const quizzes = new Map((snapshot.quizzes ?? []).map((item) => [text(item.id), item]));
  const forums = new Map((snapshot.forums ?? []).map((item) => [text(item.id ?? item.instance), item]));
  for (const id of assignments.keys()) seenItems.add(activityItemId("assign", id)!);
  for (const id of quizzes.keys()) seenItems.add(activityItemId("quiz", id)!);
  for (const forum of forums.values()) {
    const id = forumItemId(forum);
    if (id) seenItems.add(id);
  }

  const eventsByItem = new Map<string, MoodleObject>();
  for (const event of snapshot.events ?? []) {
    const courseId = text(event.courseid);
    const cmid = text(event.cmid ?? event.contextinstanceid ?? event.activityid);
    const courseModule = modulesByCourseAndId.get(`${courseId}:${cmid}`);
    const identity = calendarItemId(event, courseModule);
    const prior = eventsByItem.get(identity);
    const priorTime = timestamp(prior?.timesort ?? prior?.timestart);
    const nextTime = timestamp(event.timesort ?? event.timestart);
    if (!prior || (nextTime && (!priorTime || nextTime < priorTime))) eventsByItem.set(identity, event);
  }

  // Forums are first-class academic items. Their course-module identity is the
  // canonical identity also used by calendar events, so the two sources merge.
  const forumIdentities = new Set([...forumModules.keys(), ...[...forums.values()].map((forum) => forumItemId(forum)).filter((id): id is string => Boolean(id))]);
  for (const identity of forumIdentities) {
    const instanceId = identity.slice("activity:forum:".length);
    const moduleRecord = forumModules.get(identity);
    const forum = forums.get(instanceId) ?? {};
    const courseId = text(forum.course) || moduleRecord?.courseId || "";
    const cmid = text(forum.cmid) || text(moduleRecord?.module.id);
    const courseModule = modulesByCourseAndId.get(`${courseId}:${cmid}`)
      ?? modulesByCourseAndActivity.get(`${courseId}:${identity}`)
      ?? moduleRecord?.module;
    const event = eventsByItem.get(identity);
    if (forums.has(instanceId)) await applyRaw(state, "forum", instanceId, courseId || null, forum, counters);
    const previousItem = state.items[identity];
    const completion = courseModule?.completiondata && typeof courseModule.completiondata === "object"
      ? courseModule.completiondata as MoodleObject
      : courseModule?.completion && typeof courseModule.completion === "object"
        ? courseModule.completion as MoodleObject
        : {};
    const hasCompletion = completion.state !== undefined || completion.status !== undefined
      || completion.complete !== undefined || completion.isoverallcomplete !== undefined;
    const completed = isMoodleActivityComplete(completion);
    const next: ProjectionItem = {
      id: previousItem?.id ?? stableId("item", identity),
      externalId: identity,
      externalCourseId: courseId,
      rawExternalId: externalId(event ?? forum, instanceId),
      moduleExternalId: cmid || text(courseModule?.id) || null,
      type: "discussion",
      title: text(forum.name ?? courseModule?.name ?? event?.name, "Untitled Moodle forum"),
      description: text(forum.intro ?? courseModule?.description ?? event?.description) || null,
      sourceDueAt: resolveMoodleDeadline({ activity: forum, event, completion, previousDueAt: previousItem?.sourceDueAt, preservePrevious: true }),
      sourceAvailableAt: timestamp(forum.timeopen ?? event?.timestart) ?? previousItem?.sourceAvailableAt ?? null,
      sourceCloseAt: timestamp(forum.cutoffdate ?? forum.timeclose) ?? previousItem?.sourceCloseAt ?? null,
      url: text(courseModule?.url ?? event?.url) || null,
      status: completed ? "completed" : hasCompletion ? "not_started" : previousItem?.status ?? "not_started",
      completionState: text(completion.state ?? completion.status) || previousItem?.completionState || null,
      upstreamState: "present",
      overrides: previousItem?.overrides ?? {},
    };
    applyEntity(state.items, identity, next, counters);
  }

  for (const event of snapshot.events ?? []) {
    const eventId = externalId(event, "unknown");
    const courseId = text(event.courseid);
    const cmid = text(event.cmid ?? event.contextinstanceid ?? event.activityid);
    const courseModule = modulesByCourseAndId.get(`${courseId}:${cmid}`);
    const identity = calendarItemId(event, courseModule);
    seenItems.add(identity);
    await applyRaw(state, "calendar-event", eventId, courseId || null, event, counters);

    const moduleName = text(courseModule?.modname ?? event.modulename ?? event.activityname).toLowerCase();
    const instanceId = text(courseModule?.instance ?? event.instance);
    const enrichment = moduleName === "assign" ? assignments.get(instanceId) : moduleName === "quiz" ? quizzes.get(instanceId) : undefined;
    if (moduleName === "forum") continue;
    const previousItem = state.items[identity];
    const completion = courseModule?.completiondata && typeof courseModule.completiondata === "object"
      ? courseModule.completiondata as MoodleObject
      : {};
    const completed = isMoodleActivityComplete(completion);
    const next: ProjectionItem = {
      id: previousItem?.id ?? stableId("item", identity),
      externalId: identity,
      externalCourseId: courseId,
      rawExternalId: eventId,
      moduleExternalId: cmid || null,
      type: moduleName ? moodleModuleType(moduleName) : "event",
      title: text(enrichment?.name ?? courseModule?.name ?? event.name, "Untitled Moodle event"),
      description: text(enrichment?.intro ?? event.description ?? courseModule?.description) || null,
      sourceDueAt: resolveMoodleDeadline({ activity: enrichment, event, completion, previousDueAt: previousItem?.sourceDueAt }),
      sourceAvailableAt: timestamp(enrichment?.allowsubmissionsfromdate ?? enrichment?.timeopen ?? event.timestart),
      sourceCloseAt: timestamp(enrichment?.cutoffdate ?? enrichment?.timeclose),
      url: text(event.url ?? courseModule?.url) || null,
      status: completed ? "completed" : previousItem?.status,
      completionState: text(completion.state ?? completion.status) || previousItem?.completionState || null,
      upstreamState: "present",
      overrides: previousItem?.overrides ?? {},
    };
    applyEntity(state.items, identity, next, counters);
  }

  if (snapshot.completeScopes?.includes("events") || snapshot.completeScopes?.includes("contents")) {
    for (const [id, item] of Object.entries(state.items)) {
      const ownedByCompleteSource = id.startsWith("calendar-event:")
        ? snapshot.completeScopes?.includes("events")
        : snapshot.completeScopes?.includes("contents");
      if (ownedByCompleteSource && !seenItems.has(id) && item.upstreamState === "present") {
        state.items[id] = { ...item, upstreamState: "missing" };
        counters.missing += 1;
      }
    }
  }

  for (const report of snapshot.gradeItems ?? []) {
    const categories = report.items.filter((item) => text(item.itemtype) === "category");
    for (const category of categories) {
      const id = externalId(category, text(category.sortorder, "unknown"));
      await applyRaw(state, "grade-category", id, report.courseId, category, counters);
      applyEntity(state.gradeCategories, `${report.courseId}:${id}`, {
        id: state.gradeCategories[`${report.courseId}:${id}`]?.id ?? stableId("grade-category", `${report.courseId}:${id}`),
        externalId: id, externalCourseId: report.courseId,
        parentExternalId: text(category.parentid) || null,
        name: text(category.itemname, "Grade category"),
      }, counters);
    }
    for (const grade of report.items.filter((item) => text(item.itemtype) !== "category")) {
      const id = externalId(grade, text(grade.sortorder, "unknown"));
      await applyRaw(state, "grade-item", id, report.courseId, grade, counters);
      applyEntity(state.gradeItems, `${report.courseId}:${id}`, {
        id: state.gradeItems[`${report.courseId}:${id}`]?.id ?? stableId("grade-item", `${report.courseId}:${id}`),
        externalId: id, externalCourseId: report.courseId,
        categoryExternalId: text(grade.categoryid ?? grade.parentid) || null,
        name: text(grade.itemname, "Grade item"), score: numberOrNull(grade.graderaw ?? grade.gradeformatted),
        maximumScore: numberOrNull(grade.grademax), percentage: numberOrNull(grade.percentageformatted),
      }, counters);
    }
  }

  return { state, counters, diagnostics };
}
