import { actionEvents } from "./calendar.ts";
import { getForumParticipation } from "./forum-participation.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { text } from "../_shared/moodle-values.ts";
type JsonObject = Record<string, unknown>;
export type SyncCounts = {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  skipped: number;
  failed: number;
};
export type MoodleCall = <T>(
  baseUrl: string,
  token: string,
  fn: string,
  params?: JsonObject,
) => Promise<T>;
const iso = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};
export class StatePage extends Error {
  written: string[];
  constructor(written: string[]) {
    super("State page checkpoint");
    this.written = written;
  }
}

import {
  hasMoodleGradeResult,
  moodleCompletion,
} from "../_shared/completion.ts";
import {
  activityItemId,
  calendarItemId,
  forumItemId,
  missingMoodleItemIds,
  moduleItemId,
  resolveMoodleDeadline,
  unixTimestamp,
} from "../_shared/moodle-academic.ts";

const desired: Record<string, string[]> = {
  site: ["core_webservice_get_site_info"],
  courses: ["core_enrol_get_users_courses"],
  state: [
    "core_course_get_contents",
    "core_calendar_get_action_events_by_course",
    "mod_assign_get_assignments",
    "mod_assign_get_submission_status",
    "mod_quiz_get_quizzes_by_courses",
    "mod_quiz_get_user_attempts",
    "mod_forum_get_forums_by_courses",
    "mod_forum_get_forum_discussions",
    "mod_forum_get_discussion_posts",
    "core_completion_get_activities_completion_status",
  ],
  grades: ["gradereport_user_get_grade_items"],
  live: [],
};
type Client = SupabaseClient;
type Task = {
  cursor?: { written?: string[] };
  id: string;
  owner_id: string;
  sync_run_id: string;
  connection_id: string;
  phase: string;
  scope_external_id: string | null;
};
export type Ctx = Task & {
  call: MoodleCall;
  client: Client;
  baseUrl: string;
  token: string;
  userId: string;
  allowed: Set<string>;
  optional: Array<{ capability: string; message: string; skipped?: boolean }>;
};
const number = (value: unknown) => {
  if (value === null || value === undefined || value === "" || value === "-")
    return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const kind = (name: string) =>
  (
    ({ assign: "assignment", quiz: "quiz", forum: "discussion" }) as Record<
      string,
      string
    >
  )[name] ?? "event";
const fnNames = (site: JsonObject) =>
  Array.isArray(site.functions)
    ? [
        ...new Set(
          site.functions.flatMap((entry: unknown) =>
            typeof entry === "string"
              ? [entry]
              : entry && typeof entry === "object"
                ? [text((entry as JsonObject).name)].filter(Boolean)
                : [],
          ),
        ),
      ]
    : [];
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function optional(
  ctx: Ctx,
  counts: SyncCounts,
  capability: string,
  error: unknown,
) {
  counts.failed++;
  ctx.optional.push({
    capability,
    message: (error instanceof Error
      ? error.message
      : "Optional provider call failed"
    )
      .split(ctx.token)
      .join("[REDACTED]"),
  });
}
async function localCourse(ctx: Ctx, externalId: string) {
  const { data, error } = await ctx.client
    .from("course_provider_links")
    .select("course_id")
    .eq("connection_id", ctx.connection_id)
    .eq("link_type", "course")
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw error;
  return data?.course_id as string | undefined;
}

export async function bootstrap(ctx: Ctx, counts: SyncCounts) {
  const site = await ctx.call<JsonObject>(
    ctx.baseUrl,
    ctx.token,
    "core_webservice_get_site_info",
  );
  if (text(site.userid) !== ctx.userId)
    throw new Error("Moodle token account changed; reconnect explicitly");
  const allowed = new Set(fnNames(site));
  const capabilities = Object.entries(desired).flatMap(([group, names]) =>
    names.map((name) => ({
      owner_id: ctx.owner_id,
      connection_id: ctx.connection_id,
      capability_name: name,
      diagnostic_group: group,
      desired: true,
      available: allowed.has(name),
      checked_at: new Date().toISOString(),
    })),
  );
  check(
    await ctx.client
      .from("provider_capabilities")
      .upsert(capabilities, { onConflict: "connection_id,capability_name" }),
  );
  if (!allowed.has("core_enrol_get_users_courses"))
    throw new Error(
      "Required capability core_enrol_get_users_courses is unavailable",
    );
  const courses = await ctx.call<JsonObject[]>(
    ctx.baseUrl,
    ctx.token,
    "core_enrol_get_users_courses",
    { userid: site.userid },
  );
  if (!Array.isArray(courses))
    throw new Error("Invalid Moodle course snapshot");
  const active: string[] = [];
  for (const course of courses) {
    const externalId = text(course.id);
    const { data, error } = await ctx.client.rpc("reconcile_moodle_course", {
      p_connection: ctx.connection_id,
      p_external: externalId,
      p_code: text(course.shortname ?? course.idnumber, `Moodle ${externalId}`),
      p_name: text(
        course.fullname ?? course.displayname ?? course.shortname,
        `Moodle course ${externalId}`,
      ),
      p_active: course.visible !== false && course.visible !== 0,
    });
    if (error) throw error;
    active.push(data);
    counts.updated++;
  }
  const { data: links, error } = await ctx.client
    .from("course_provider_links")
    .select("course_id")
    .eq("connection_id", ctx.connection_id)
    .eq("provider", "moodle");
  if (error) throw error;
  const stale = (links ?? [])
    .map((row) => row.course_id)
    .filter((id) => !active.includes(id));
  if (stale.length) {
    check(
      await ctx.client
        .from("courses")
        .update({ active: false })
        .in("id", stale),
    );
    check(
      await ctx.client
        .from("academic_items")
        .update({ upstream_state: "missing" })
        .eq("provider_connection_id", ctx.connection_id)
        .eq("origin", "provider")
        .in("course_id", stale),
    );
  }
  const tasks = courses.flatMap((course) => [
    { phase: "events", scope_external_id: text(course.id) },
    ...(allowed.has("gradereport_user_get_grade_items")
      ? [{ phase: "grades", scope_external_id: text(course.id) }]
      : []),
  ]);
  if (tasks.length)
    check(
      await ctx.client.from("sync_tasks").upsert(
        tasks.map((row) => ({
          ...row,
          owner_id: ctx.owner_id,
          sync_run_id: ctx.sync_run_id,
          connection_id: ctx.connection_id,
        })),
        {
          onConflict: "sync_run_id,phase,scope_external_id",
          ignoreDuplicates: true,
        },
      ),
    );
}
function check(result: { error: unknown }) {
  if (result.error) throw result.error;
}

type Module = {
  id: string;
  name: string;
  instance: string;
  url: string | null;
  completion: JsonObject;
  row: JsonObject;
};
export async function state(ctx: Ctx, counts: SyncCounts) {
  const pageStarted = Date.now();
  const previouslyWritten = new Set(ctx.cursor?.written ?? []);
  let pageWrites = 0;
  const providerCourseId = ctx.scope_external_id!,
    courseId = await localCourse(ctx, providerCourseId);
  if (!courseId)
    throw new Error(`Course ${providerCourseId} has no Cortex identity`);
  const modules = new Map<string, Module>(),
    modulesByActivity = new Map<string, Module>();
  let courseContentsComplete = false,
    assignmentsComplete = false,
    quizzesComplete = false,
    forumsComplete = false,
    calendarComplete = false;
  if (ctx.allowed.has("core_course_get_contents")) {
    const sections = await ctx.call<JsonObject[]>(
      ctx.baseUrl,
      ctx.token,
      "core_course_get_contents",
      { courseid: providerCourseId },
    );
    if (!Array.isArray(sections))
      throw new Error("Invalid course contents snapshot");
    if (sections.some((section) => !Array.isArray(section.modules)))
      throw new Error("Incomplete course contents snapshot");
    courseContentsComplete = true;
    for (const section of sections)
      for (const row of Array.isArray(section.modules)
        ? (section.modules as JsonObject[])
        : []) {
        const id = text(row.id),
          name = text(row.modname).toLowerCase(),
          instance = text(row.instance),
          module = {
            id,
            name,
            instance,
            url: text(row.url) || null,
            completion:
              row.completiondata && typeof row.completiondata === "object"
                ? (row.completiondata as JsonObject)
                : {},
            row,
          };
        modules.set(id, module);
        const itemId = activityItemId(name, instance);
        if (itemId) modulesByActivity.set(itemId, module);
      }
  }
  if (ctx.allowed.has("core_completion_get_activities_completion_status"))
    try {
      const result = await ctx.call<JsonObject>(
        ctx.baseUrl,
        ctx.token,
        "core_completion_get_activities_completion_status",
        { courseid: providerCourseId, userid: ctx.userId },
      );
      for (const status of Array.isArray(result.statuses)
        ? (result.statuses as JsonObject[])
        : []) {
        const module = modules.get(text(status.cmid));
        if (module) module.completion = { ...module.completion, ...status };
      }
    } catch (error) {
      optional(
        ctx,
        counts,
        "core_completion_get_activities_completion_status",
        error,
      );
    }

  let assignments: JsonObject[] = [],
    quizzes: JsonObject[] = [],
    forums: JsonObject[] = [],
    events: JsonObject[] = [];
  if (ctx.allowed.has("mod_assign_get_assignments"))
    try {
      const result = await ctx.call<JsonObject>(
        ctx.baseUrl,
        ctx.token,
        "mod_assign_get_assignments",
        { courseids: [providerCourseId] },
      );
      assignments = (
        Array.isArray(result.courses) ? (result.courses as JsonObject[]) : []
      ).flatMap((course) =>
        Array.isArray(course.assignments)
          ? (course.assignments as JsonObject[])
          : [],
      );
      assignmentsComplete =
        Array.isArray(result.courses) &&
        !(Array.isArray(result.warnings) && result.warnings.length);
    } catch (error) {
      optional(ctx, counts, "mod_assign_get_assignments", error);
    }
  if (ctx.allowed.has("mod_quiz_get_quizzes_by_courses"))
    try {
      const result = await ctx.call<JsonObject>(
        ctx.baseUrl,
        ctx.token,
        "mod_quiz_get_quizzes_by_courses",
        { courseids: [providerCourseId] },
      );
      quizzes = Array.isArray(result.quizzes)
        ? (result.quizzes as JsonObject[])
        : [];
      quizzesComplete =
        Array.isArray(result.quizzes) &&
        !(Array.isArray(result.warnings) && result.warnings.length);
    } catch (error) {
      optional(ctx, counts, "mod_quiz_get_quizzes_by_courses", error);
    }
  if (ctx.allowed.has("mod_forum_get_forums_by_courses"))
    try {
      forums = await ctx.call<JsonObject[]>(
        ctx.baseUrl,
        ctx.token,
        "mod_forum_get_forums_by_courses",
        { courseids: [providerCourseId] },
      );
      if (!Array.isArray(forums)) throw new Error("Invalid forums snapshot");
      forumsComplete = true;
    } catch (error) {
      optional(ctx, counts, "mod_forum_get_forums_by_courses", error);
    }
  if (ctx.allowed.has("core_calendar_get_action_events_by_course"))
    try {
      events = await actionEvents(ctx);
      calendarComplete = false;
    } catch (error) {
      optional(ctx, counts, "core_calendar_get_action_events_by_course", error);
    }

  if (
    !courseContentsComplete &&
    !assignmentsComplete &&
    !quizzesComplete &&
    !forumsComplete
  )
    throw new Error("No complete authoritative academic scope available");

  const eventModule = (event: JsonObject) => {
    let cmid = text(event.cmid ?? event.contextinstanceid ?? event.activityid);
    if (!cmid && event.url)
      try {
        cmid = new URL(text(event.url)).searchParams.get("id") ?? "";
      } catch {}
    return modules.get(cmid);
  };
  const eventsByItem = new Map<string, JsonObject>();
  for (const event of events) {
    const module = eventModule(event),
      itemId = calendarItemId(event, module?.row);
    const previous = eventsByItem.get(itemId),
      previousAt = unixTimestamp(previous?.timesort ?? previous?.timestart),
      nextAt = unixTimestamp(event.timesort ?? event.timestart);
    if (!previous || (nextAt && (!previousAt || nextAt < previousAt)))
      eventsByItem.set(itemId, event);
  }
  const forumByInstance = new Map(
    forums.map((row) => [text(row.id ?? row.instance), row]),
  );
  const written = new Set<string>();

  async function write(
    moduleName: string,
    instance: string,
    row: JsonObject,
    event?: JsonObject,
    explicitModule?: Module,
  ) {
    const normalizedName = moduleName.toLowerCase();
    let cmid = text(
      row.cmid ??
        row.coursemodule ??
        event?.cmid ??
        event?.contextinstanceid ??
        event?.activityid,
    );
    if (!cmid && event?.url)
      try {
        cmid = new URL(text(event.url)).searchParams.get("id") ?? "";
      } catch {}
    const module =
      explicitModule ??
      modules.get(cmid) ??
      modulesByActivity.get(activityItemId(normalizedName, instance) ?? "");
    if (!cmid) cmid = module?.id ?? "";
    const providerItemId =
      activityItemId(normalizedName, instance) ??
      calendarItemId(event ?? {}, module?.row);
    if (previouslyWritten.has(providerItemId)) {
      written.add(providerItemId);
      return;
    }
    if (
      pageWrites >= 30 ||
      (pageWrites > 0 && Date.now() - pageStarted > 25000)
    )
      throw new StatePage([...previouslyWritten, ...written]);
    const { data: existingId, error: identityError } = await ctx.client.rpc(
      "reconcile_moodle_item",
      {
        p_connection: ctx.connection_id,
        p_course: courseId,
        p_external_course: providerCourseId,
        p_identity: providerItemId,
        p_module: cmid || null,
        p_url: module?.url || text(event?.url) || null,
        p_aliases: [
          ...(cmid ? [`course-module:${cmid}`] : []),
          ...(event?.id ? [`calendar-event:${text(event.id)}`] : []),
        ],
      },
    );
    if (identityError) throw identityError;
    const lookup = existingId
      ? await ctx.client
          .from("academic_items")
          .select(
            "id,source_due_at,status,completed_at,completion_state,submission_state,submitted_at",
          )
          .eq("id", existingId)
          .single()
      : { data: null, error: null };
    check(lookup);
    const existing = lookup.data;
    let submissionDetails: JsonObject | null = null,
      attempts: JsonObject[] | undefined;
    const inaccessible =
      module?.row.uservisible === false ||
      module?.completion.uservisible === false;
    if (inaccessible && ["assign", "quiz"].includes(normalizedName)) {
      counts.skipped++;
      ctx.optional.push({
        capability:
          normalizedName === "assign"
            ? "mod_assign_get_submission_status"
            : "mod_quiz_get_user_attempts",
        message: `${providerItemId}: Moodle reports uservisible=false; private student-state lookup skipped`,
        skipped: true,
      });
    }
    if (
      !inaccessible &&
      normalizedName === "assign" &&
      ctx.allowed.has("mod_assign_get_submission_status")
    )
      try {
        const result = await ctx.call<JsonObject>(
          ctx.baseUrl,
          ctx.token,
          "mod_assign_get_submission_status",
          { assignid: instance, userid: ctx.userId },
        );
        const last = result.lastattempt as JsonObject | undefined;
        submissionDetails =
          ((last?.submission ?? last?.teamsubmission) as JsonObject) ?? null;
      } catch (error) {
        optional(ctx, counts, "mod_assign_get_submission_status", error);
      }
    if (
      !inaccessible &&
      normalizedName === "quiz" &&
      ctx.allowed.has("mod_quiz_get_user_attempts") &&
      moodleCompletion({
        module: module
          ? { ...module.row, completiondata: module.completion }
          : undefined,
      }) === null
    )
      try {
        const result = await ctx.call<JsonObject>(
          ctx.baseUrl,
          ctx.token,
          "mod_quiz_get_user_attempts",
          {
            quizid: instance,
            userid: ctx.userId,
            status: "all",
            includepreviews: false,
          },
        );
        if (
          !Array.isArray(result.attempts) ||
          (Array.isArray(result.warnings) && result.warnings.length)
        )
          throw new Error("Incomplete quiz attempt response");
        attempts = result.attempts as JsonObject[];
      } catch (error) {
        optional(ctx, counts, "mod_quiz_get_user_attempts", error);
      }
    const primaryCompletion = moodleCompletion({
      module: module
        ? { ...module.row, completiondata: module.completion }
        : undefined,
      submission: submissionDetails,
      attempts,
    });
    let completed = primaryCompletion;
    const isForum = normalizedName === "forum";
    let forumParticipation = null;
    if (isForum && completed === null && inaccessible) {
      counts.skipped++;
      ctx.optional.push({
        capability: "mod_forum_participation",
        message: `${providerItemId}: Moodle reports uservisible=false; participation lookup skipped`,
        skipped: true,
      });
    } else if (isForum && completed === null)
      try {
        forumParticipation = await getForumParticipation({
          call: ctx.call,
          baseUrl: ctx.baseUrl,
          token: ctx.token,
          forum: row,
          forumId: instance,
          userId: ctx.userId,
          capabilities: ctx.allowed,
        });
        if (forumParticipation) completed = forumParticipation.completed;
      } catch (error) {
        optional(
          ctx,
          counts,
          "mod_forum_participation",
          new Error(
            `${providerItemId}: ${error instanceof Error ? error.message : "Forum participation lookup failed"}`,
          ),
        );
      }
    // Once Moodle has established forum completion, loss of tracking or visibility
    // is not evidence that the student's participation disappeared.
    const preserveForumCompletion =
      isForum &&
      primaryCompletion === null &&
      forumParticipation?.completed !== true &&
      existing?.status === "completed";
    if (preserveForumCompletion) completed = true;
    const submission = forumParticipation?.completed
        ? "submitted"
        : text(submissionDetails?.status) || null,
      submittedAt =
        forumParticipation?.submittedAt ?? iso(submissionDetails?.timemodified);
    const dueAt = resolveMoodleDeadline({
      activity: row,
      event,
      completion: module?.completion,
      previousDueAt: existing?.source_due_at,
      preservePrevious:
        isForum ||
        (!Object.hasOwn(row, "duedate") && !Object.hasOwn(row, "timeclose")),
    });
    const values = {
      owner_id: ctx.owner_id,
      course_id: courseId,
      origin: "provider",
      item_type: kind(normalizedName),
      title: text(
        row.name ?? module?.row.name ?? event?.name,
        "Untitled Moodle item",
      ),
      description:
        text(row.intro ?? module?.row.description ?? event?.description) ||
        null,
      source_start_at: iso(event?.timestart),
      source_available_at: iso(row.allowsubmissionsfromdate ?? row.timeopen),
      source_due_at: dueAt,
      source_close_at: iso(row.cutoffdate ?? row.timeclose),
      url: module?.url || text(event?.url) || null,
      submission_state: preserveForumCompletion
        ? existing?.submission_state
        : submission,
      submitted_at: preserveForumCompletion
        ? existing?.submitted_at
        : submission === "submitted"
          ? submittedAt
          : null,
      completion_state: forumParticipation?.completed
        ? "forum:participated"
        : preserveForumCompletion
          ? existing?.completion_state
          : attempts
            ? completed
              ? "attempt:finished"
              : "attempt:incomplete"
            : module
              ? text(module.completion.state ?? module.completion.status) ||
                null
              : null,
      upstream_state: "present",
      provider_connection_id: ctx.connection_id,
      provider: "moodle",
      provider_course_id: providerCourseId,
      provider_module_id: cmid || null,
      provider_instance_id: instance || null,
      provider_item_id: providerItemId,
      provider_url: module?.url || text(event?.url) || null,
      ...(completed
        ? {
            status: "completed",
            completed_at:
              submittedAt ??
              iso(module?.completion.timecompleted) ??
              iso(
                attempts?.find(
                  (attempt) =>
                    !attempt.preview &&
                    ["finished", "submitted"].includes(text(attempt.state)),
                )?.timefinish,
              ) ??
              existing?.completed_at ??
              new Date().toISOString(),
          }
        : completed === false
          ? { status: "not_started", completed_at: null }
          : {}),
    };
    const result = existing
      ? await ctx.client
          .from("academic_items")
          .update(values)
          .eq("id", existing.id)
          .select("id")
          .single()
      : await ctx.client
          .from("academic_items")
          .insert(values)
          .select("id")
          .single();
    if (result.error) throw result.error;
    const contentHash = await digest({
      title: values.title,
      item_type: values.item_type,
      available_at: values.source_available_at,
      due_at: values.source_due_at,
      close_at: values.source_close_at,
      completion_state: values.completion_state,
      submission_state: values.submission_state,
    });
    check(
      await ctx.client.from("academic_item_source_history").upsert(
        {
          owner_id: ctx.owner_id,
          academic_item_id: result.data.id,
          title: values.title,
          item_type: values.item_type,
          available_at: values.source_available_at,
          due_at: values.source_due_at,
          close_at: values.source_close_at,
          completion_state: values.completion_state,
          submission_state: values.submission_state,
          content_hash: contentHash,
        },
        { onConflict: "academic_item_id,content_hash" },
      ),
    );
    written.add(providerItemId);
    pageWrites++;
    existing ? counts.updated++ : counts.inserted++;
  }

  for (const row of assignments) {
    const id = activityItemId("assign", row.id)!;
    await write("assign", text(row.id), row, eventsByItem.get(id));
  }
  for (const row of quizzes) {
    const id = activityItemId("quiz", row.id)!;
    await write("quiz", text(row.id), row, eventsByItem.get(id));
  }
  for (const module of modules.values())
    if (
      module.instance &&
      (["assign", "quiz", "forum"].includes(module.name) ||
        Object.keys(module.completion).length)
    ) {
      const id = activityItemId(module.name, module.instance)!;
      if (!written.has(id))
        await write(
          module.name,
          module.instance,
          module.name === "forum"
            ? (forumByInstance.get(module.instance) ?? module.row)
            : module.row,
          eventsByItem.get(id),
          module,
        );
    }
  for (const forum of forums) {
    const id = forumItemId(forum);
    if (id && !written.has(id))
      await write(
        "forum",
        text(forum.id ?? forum.instance),
        forum,
        eventsByItem.get(id),
      );
  }
  for (const event of events) {
    const module = eventModule(event),
      id = calendarItemId(event, module?.row);
    if (!written.has(id))
      await write(
        module?.name ?? text(event.modulename).toLowerCase(),
        module?.instance ?? text(event.instance),
        {},
        event,
        module,
      );
  }

  const moduleItemIds = new Set(
      [...modules.values()]
        .map((module) => moduleItemId(module.row))
        .filter((id): id is string => Boolean(id)),
    ),
    calendarItemIds = new Set(
      events.map((event) => calendarItemId(event, eventModule(event)?.row)),
    ),
    assignmentItemIds = new Set(
      assignments
        .map((row) => activityItemId("assign", row.id)!)
        .filter(Boolean),
    ),
    quizItemIds = new Set(
      quizzes.map((row) => activityItemId("quiz", row.id)!).filter(Boolean),
    ),
    forumItemIds = new Set(
      forums.map(forumItemId).filter((id): id is string => Boolean(id)),
    ),
    presentIds = new Set([
      ...moduleItemIds,
      ...calendarItemIds,
      ...assignmentItemIds,
      ...quizItemIds,
      ...forumItemIds,
    ]);
  if (presentIds.size)
    check(
      await ctx.client
        .from("academic_items")
        .update({ upstream_state: "present" })
        .eq("owner_id", ctx.owner_id)
        .eq("provider_connection_id", ctx.connection_id)
        .eq("provider_course_id", providerCourseId)
        .is("merged_into_id", null)
        .in("provider_item_id", [...presentIds]),
    );
  const { data: existingItems, error: existingError } = await ctx.client
    .from("academic_items")
    .select("provider_item_id,provider_module_id,upstream_state")
    .is("merged_into_id", null)
    .eq("owner_id", ctx.owner_id)
    .eq("provider_connection_id", ctx.connection_id)
    .eq("provider_course_id", providerCourseId)
    .eq("origin", "provider");
  if (existingError) throw existingError;
  const missingIds = missingMoodleItemIds(
    (existingItems ?? [])
      .map((row) => text(row.provider_item_id))
      .filter(Boolean),
    {
      courseContentsComplete,
      calendarComplete,
      assignmentsComplete,
      quizzesComplete,
      forumsComplete,
      moduleItemIds,
      calendarItemIds,
      assignmentItemIds,
      quizItemIds,
      forumItemIds,
    },
  );
  if (missingIds.length) {
    const { error } = await ctx.client
      .from("academic_items")
      .update({ upstream_state: "missing" })
      .eq("owner_id", ctx.owner_id)
      .eq("provider_connection_id", ctx.connection_id)
      .eq("provider_course_id", providerCourseId)
      .in("provider_item_id", missingIds);
    if (error) throw error;
    counts.missing += (existingItems ?? []).filter(
      (row) =>
        row.upstream_state !== "missing" &&
        missingIds.includes(text(row.provider_item_id)),
    ).length;
  }
}

export async function grades(ctx: Ctx, counts: SyncCounts) {
  const providerCourseId = ctx.scope_external_id!,
    courseId = await localCourse(ctx, providerCourseId);
  if (!courseId)
    throw new Error(`Course ${providerCourseId} has no Cortex identity`);
  const report = await ctx.call<JsonObject>(
      ctx.baseUrl,
      ctx.token,
      "gradereport_user_get_grade_items",
      { courseid: providerCourseId, userid: ctx.userId },
    ),
    users = Array.isArray(report.usergrades)
      ? (report.usergrades as JsonObject[])
      : [],
    items = users.flatMap((row) =>
      Array.isArray(row.gradeitems) ? (row.gradeitems as JsonObject[]) : [],
    ),
    categories = new Map<string, string>();
  for (const [position, row] of items
    .filter((item) => text(item.itemtype) === "category")
    .entries()) {
    const externalId = text(row.id ?? row.sortorder),
      values = {
        owner_id: ctx.owner_id,
        course_id: courseId,
        name: text(row.itemname, "Grade category"),
        aggregation: text(row.aggregation) || null,
        weight: number(row.weightformatted),
        minimum_score: number(row.grademin),
        maximum_score: number(row.grademax),
        position,
        provider_connection_id: ctx.connection_id,
        provider: "moodle",
        provider_course_id: providerCourseId,
        provider_category_id: externalId,
      },
      { data: existing } = await gradeIdentity(
        ctx,
        courseId,
        providerCourseId,
        externalId,
        true,
      ),
      result = existing
        ? await ctx.client
            .from("grade_categories")
            .update(values)
            .eq("id", existing.id)
            .select("id")
            .single()
        : await ctx.client
            .from("grade_categories")
            .insert(values)
            .select("id")
            .single();
    if (result.error) throw result.error;
    categories.set(externalId, result.data.id);
  }
  for (const [position, row] of items
    .filter((item) => text(item.itemtype) !== "category")
    .entries()) {
    const externalId = text(row.id ?? row.sortorder),
      module = text(row.itemmodule),
      instance = text(row.iteminstance),
      { data: academic } =
        module && instance
          ? await ctx.client
              .from("academic_items")
              .select("id,status,completed_at")
              .eq("provider_connection_id", ctx.connection_id)
              .eq("provider_item_id", `activity:${module}:${instance}`)
              .maybeSingle()
          : { data: null },
      values = {
        owner_id: ctx.owner_id,
        course_id: courseId,
        category_id:
          categories.get(text(row.categoryid ?? row.parentid)) ?? null,
        academic_item_id: academic?.id ?? null,
        name: text(row.itemname, "Grade item"),
        item_type: text(row.itemtype) || null,
        module_type: module || null,
        module_instance_id: instance || null,
        item_number: number(row.itemnumber),
        score: number(row.graderaw ?? row.gradeformatted),
        minimum_score: number(row.grademin),
        maximum_score: number(row.grademax),
        percentage: number(row.percentageformatted),
        weight: number(row.weightformatted),
        feedback: text(row.feedback) || null,
        hidden: row.hidden === true || row.hidden === 1,
        position,
        graded_at: iso(row.gradedatesubmitted ?? row.gradedategraded),
        provider_connection_id: ctx.connection_id,
        provider: "moodle",
        provider_course_id: providerCourseId,
        provider_item_id: externalId,
      },
      { data: existing } = await gradeIdentity(
        ctx,
        courseId,
        providerCourseId,
        externalId,
        false,
      ),
      result = existing
        ? await ctx.client
            .from("grade_items")
            .update(values)
            .eq("id", existing.id)
            .select("id")
            .single()
        : await ctx.client
            .from("grade_items")
            .insert(values)
            .select("id")
            .single();
    if (result.error) throw result.error;
    if (module === "forum" && academic?.id && hasMoodleGradeResult(row)) {
      const completedAt =
        values.graded_at ?? academic.completed_at ?? new Date().toISOString();
      check(
        await ctx.client
          .from("academic_items")
          .update({
            status: "completed",
            completion_state: "grade:posted",
            submission_state: "graded",
            completed_at: completedAt,
            submitted_at: completedAt,
          })
          .eq("id", academic.id),
      );
    }
    const contentHash = await digest({
      score: values.score,
      minimum: values.minimum_score,
      maximum: values.maximum_score,
      percentage: values.percentage,
      weight: values.weight,
      graded_at: values.graded_at,
    });
    check(
      await ctx.client.from("grade_item_source_history").upsert(
        {
          owner_id: ctx.owner_id,
          grade_item_id: result.data.id,
          score: values.score,
          minimum_score: values.minimum_score,
          maximum_score: values.maximum_score,
          percentage: values.percentage,
          weight: values.weight,
          graded_at: values.graded_at,
          content_hash: contentHash,
        },
        { onConflict: "grade_item_id,content_hash" },
      ),
    );
    existing ? counts.updated++ : counts.inserted++;
  }
}

async function gradeIdentity(
  ctx: Ctx,
  course: string,
  externalCourse: string,
  external: string,
  category: boolean,
) {
  const { data, error } = await ctx.client.rpc("reconcile_moodle_grade", {
    p_connection: ctx.connection_id,
    p_course: course,
    p_external_course: externalCourse,
    p_external: external,
    p_category: category,
  });
  if (error) throw error;
  return { data: data ? { id: data } : null };
}
