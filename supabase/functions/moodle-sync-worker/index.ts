import { adminClient, decryptCredential, emptyCounts, hasServiceRole, iso, moodleCall, sourceTarget, text, upsertRaw, type JsonObject, type SyncCounts } from "../_shared/moodle.ts";

const desiredGroups: Record<string, string[]> = {
  site: ["core_webservice_get_site_info"], courses: ["core_enrol_get_users_courses"],
  structure: ["core_course_get_contents", "core_course_get_course_module"],
  calendar: ["core_calendar_get_action_events_by_course", "core_calendar_get_action_events_by_timesort", "core_calendar_get_action_events_by_courses"],
  assignments: ["mod_assign_get_assignments", "mod_assign_get_submission_status"],
  quizzes: ["mod_quiz_get_quizzes_by_courses", "mod_quiz_get_user_attempts", "mod_quiz_get_user_best_grade"],
  completion: ["core_completion_get_activities_completion_status", "core_completion_get_course_completion_status"],
  gradebook: ["gradereport_user_get_grade_items", "core_grades_get_grades"],
  forums: ["mod_forum_get_forums_by_courses", "mod_forum_get_forum_discussions"],
  resources: ["mod_resource_get_resources_by_courses", "mod_folder_get_folders_by_courses", "mod_book_get_books_by_courses", "mod_page_get_pages_by_courses", "mod_url_get_urls_by_courses"],
};
const groupByName = new Map(Object.entries(desiredGroups).flatMap(([group, names]) => names.map((name) => [name, group])));

type Client = ReturnType<typeof adminClient>;
type Task = { id: string; owner_id: string; sync_run_id: string; connection_id: string; phase: string; scope_external_id: string | null };
type Context = Task & { client: Client; baseUrl: string; token: string; userId: string; allowed: Set<string>; optionalFailures: Array<{ capability: string; message: string }> };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown optional endpoint failure";
}

function optionalFailure(context: Context, counts: SyncCounts, capability: string, error: unknown) {
  counts.failed += 1;
  context.optionalFailures.push({ capability, message: errorText(error) });
}

async function markRawMissing(context: Context, counts: SyncCounts, objectTypes: string[], courseExternalId?: string) {
  let query = context.client.from("raw_source_records").select("id").eq("connection_id", context.connection_id)
    .in("object_type", objectTypes).neq("last_seen_run_id", context.sync_run_id).eq("upstream_state", "present");
  if (courseExternalId) query = query.eq("external_course_id", courseExternalId);
  const { data, error } = await query;
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length) {
    const { error: updateError } = await context.client.from("raw_source_records").update({
      upstream_state: "missing", missing_since: new Date().toISOString(),
    }).in("id", ids);
    if (updateError) throw updateError;
    counts.missing += ids.length;
  }
  return ids;
}

async function referenceTarget(client: Client, connectionId: string, objectType: string, externalId: string, column: string): Promise<string | null> {
  const { data } = await client.from("source_references").select(column).eq("connection_id", connectionId)
    .eq("object_type", objectType).eq("external_id", externalId).maybeSingle();
  const row = data as unknown as Record<string, unknown> | null;
  return row && typeof row[column] === "string" ? row[column] as string : null;
}

async function upsertCourse(context: Context, course: JsonObject, counts: SyncCounts): Promise<string> {
  const externalId = text(course.id);
  const rawId = await upsertRaw(context.client, {
    ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id,
    objectType: "course", externalId, externalCourseId: externalId, payload: course,
  }, counts);
  const existingId = await referenceTarget(context.client, context.connection_id, "course", externalId, "course_id");
  const values = {
    owner_id: context.owner_id, code: text(course.shortname ?? course.idnumber, `Moodle ${externalId}`),
    name: text(course.fullname ?? course.displayname ?? course.shortname, `Moodle course ${externalId}`),
    active: course.visible !== false && course.visible !== 0,
    source_created_at: iso(course.timecreated), source_updated_at: iso(course.timemodified),
  };
  const result = existingId
    ? await context.client.from("courses").update(values).eq("id", existingId).select("id").single()
    : await context.client.from("courses").insert(values).select("id").single();
  if (result.error) throw result.error;
  await sourceTarget(context.client, {
    ownerId: context.owner_id, connectionId: context.connection_id, objectType: "course", externalId,
    externalCourseId: externalId, rawId, targetColumn: "course_id", targetId: result.data.id,
  });
  return result.data.id;
}

function functionNames(site: JsonObject): string[] {
  return Array.isArray(site.functions) ? [...new Set(site.functions.flatMap((entry: unknown) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && typeof (entry as JsonObject).name === "string") return [(entry as JsonObject).name as string];
    return [];
  }))] : [];
}

async function bootstrap(context: Context, counts: SyncCounts) {
  const site = await moodleCall<JsonObject>(context.baseUrl, context.token, "core_webservice_get_site_info");
  const rawId = await upsertRaw(context.client, {
    ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id,
    objectType: "site-info", externalId: text(site.userid, "current-user"), payload: site,
  }, counts);
  void rawId;
  const allowed = new Set(functionNames(site));
  const capabilityRows = new Map<string, JsonObject>();
  for (const name of allowed) capabilityRows.set(name, {
    owner_id: context.owner_id, connection_id: context.connection_id, capability_name: name,
    diagnostic_group: groupByName.get(name) ?? "other", desired: groupByName.has(name), available: true,
  });
  for (const [group, names] of Object.entries(desiredGroups)) for (const name of names) if (!capabilityRows.has(name)) capabilityRows.set(name, {
    owner_id: context.owner_id, connection_id: context.connection_id, capability_name: name,
    diagnostic_group: group, desired: true, available: false,
  });
  const { error: capError } = await context.client.from("provider_capabilities").upsert([...capabilityRows.values()], { onConflict: "connection_id,capability_name" });
  if (capError) throw capError;
  counts.skipped += [...capabilityRows.values()].filter((row) => row.desired && !row.available).length;
  await context.client.from("provider_connections").update({
    external_user_id: text(site.userid), external_username: text(site.username) || null,
    display_name: text(site.fullname ?? site.sitename) || null, last_capability_check_at: new Date().toISOString(), status: "active",
  }).eq("id", context.connection_id);
  if (!allowed.has("core_enrol_get_users_courses")) throw new Error("Required capability core_enrol_get_users_courses is unavailable");
  const courses = await moodleCall<JsonObject[]>(context.baseUrl, context.token, "core_enrol_get_users_courses", { userid: site.userid });
  for (const course of courses) await upsertCourse({ ...context, allowed, userId: text(site.userid) }, course, counts);
  const staleCourseRaw = await markRawMissing(context, counts, ["course"]);
  if (staleCourseRaw.length) {
    const { data: references } = await context.client.from("source_references").select("course_id").eq("connection_id", context.connection_id).eq("object_type", "course").in("raw_source_record_id", staleCourseRaw);
    const courseIds = (references ?? []).flatMap((row) => row.course_id ? [row.course_id] : []);
    if (courseIds.length) await context.client.from("courses").update({ active: false }).in("id", courseIds);
  }
  const tasks: JsonObject[] = [];
  for (const course of courses) {
    const courseId = text(course.id);
    if (allowed.has("core_course_get_contents")) tasks.push({ phase: "contents", scope_external_id: courseId });
    if (allowed.has("core_calendar_get_action_events_by_course") || allowed.has("core_calendar_get_action_events_by_timesort") || allowed.has("core_calendar_get_action_events_by_courses")) tasks.push({ phase: "events", scope_external_id: courseId });
    if (allowed.has("gradereport_user_get_grade_items")) tasks.push({ phase: "grades", scope_external_id: courseId });
  }
  if (tasks.length) {
    const { error } = await context.client.from("sync_tasks").upsert(tasks.map((task) => ({
      ...task, owner_id: context.owner_id, sync_run_id: context.sync_run_id, connection_id: context.connection_id,
    })), { onConflict: "sync_run_id,phase,scope_external_id" });
    if (error) throw error;
  }
}

async function contents(context: Context, counts: SyncCounts) {
  const courseExternalId = context.scope_external_id!;
  const courseId = await referenceTarget(context.client, context.connection_id, "course", courseExternalId, "course_id");
  if (!courseId) throw new Error(`Course ${courseExternalId} has no Cortex identity`);
  const sections = await moodleCall<JsonObject[]>(context.baseUrl, context.token, "core_course_get_contents", { courseid: courseExternalId });
  for (const [sectionPosition, section] of sections.entries()) {
    const sectionExternalId = text(section.id ?? section.section, `${courseExternalId}:${sectionPosition}`);
    const rawId = await upsertRaw(context.client, {
      ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id,
      objectType: "course-section", externalId: sectionExternalId, externalCourseId: courseExternalId, payload: section,
    }, counts);
    const existingSection = await referenceTarget(context.client, context.connection_id, "course-section", sectionExternalId, "course_section_id");
    const sectionValues = {
      owner_id: context.owner_id, course_id: courseId, section_number: Number(section.section ?? sectionPosition),
      position: sectionPosition, name: text(section.name, `Section ${sectionPosition + 1}`), summary: text(section.summary) || null,
      visible: section.visible !== false && section.visible !== 0,
    };
    const sectionResult = existingSection
      ? await context.client.from("course_sections").update(sectionValues).eq("id", existingSection).select("id").single()
      : await context.client.from("course_sections").insert(sectionValues).select("id").single();
    if (sectionResult.error) throw sectionResult.error;
    await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "course-section", externalId: sectionExternalId, externalCourseId: courseExternalId, rawId, targetColumn: "course_section_id", targetId: sectionResult.data.id });
    const modules = Array.isArray(section.modules) ? section.modules as JsonObject[] : [];
    for (const [position, module] of modules.entries()) {
      const moduleExternalId = text(module.id, `${sectionExternalId}:${position}`);
      const moduleRawId = await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "course-module", externalId: moduleExternalId, externalCourseId: courseExternalId, payload: module }, counts);
      const existingModule = await referenceTarget(context.client, context.connection_id, "course-module", moduleExternalId, "course_module_id");
      const values = { owner_id: context.owner_id, course_id: courseId, section_id: sectionResult.data.id, module_type: text(module.modname, "other"), title: text(module.name, "Untitled module"), description: text(module.description) || null, url: text(module.url) || null, position, visible: module.visible !== false && module.visible !== 0, availability: module.availability ?? {}, completion_metadata: module.completiondata ?? {} };
      const result = existingModule ? await context.client.from("course_modules").update(values).eq("id", existingModule).select("id").single() : await context.client.from("course_modules").insert(values).select("id").single();
      if (result.error) throw result.error;
      await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "course-module", externalId: moduleExternalId, externalCourseId: courseExternalId, rawId: moduleRawId, targetColumn: "course_module_id", targetId: result.data.id });
    }
  }
  if (context.allowed.has("core_completion_get_activities_completion_status")) {
    try {
      const completion = await moodleCall<JsonObject>(context.baseUrl, context.token, "core_completion_get_activities_completion_status", { courseid: courseExternalId, userid: context.userId });
      await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "course-completion", externalId: courseExternalId, externalCourseId: courseExternalId, payload: completion }, counts);
      const statuses = Array.isArray(completion.statuses) ? completion.statuses as JsonObject[] : [];
      for (const status of statuses) {
        const moduleId = await referenceTarget(context.client, context.connection_id, "course-module", text(status.cmid), "course_module_id");
        if (!moduleId) continue;
        await context.client.from("course_modules").update({ completion_metadata: status }).eq("id", moduleId);
        const complete = status.state === 1 || status.state === 2 || status.complete === true;
        await context.client.from("academic_items").update({
          completion_state: text(status.state ?? status.status) || null,
          ...(complete ? { status: "completed", completed_at: iso(status.timecompleted) ?? new Date().toISOString() } : {}),
        }).eq("owner_id", context.owner_id).eq("module_id", moduleId);
      }
    } catch (error) { optionalFailure(context, counts, "core_completion_get_activities_completion_status", error); }
  }
  await markRawMissing(context, counts, ["course-section", "course-module"], courseExternalId);
}

function itemType(moduleName: string): string {
  return ({ assign: "assignment", quiz: "quiz", forum: "discussion", resource: "reading", folder: "reading", book: "reading", page: "reading", url: "reading" } as Record<string, string>)[moduleName] ?? (moduleName ? "other" : "event");
}

async function events(context: Context, counts: SyncCounts) {
  const courseExternalId = context.scope_external_id!;
  const courseId = await referenceTarget(context.client, context.connection_id, "course", courseExternalId, "course_id");
  if (!courseId) throw new Error(`Course ${courseExternalId} has no Cortex identity`);
  const events: JsonObject[] = [];
  let afterEventId = 0;
  for (let page = 0; page < 100; page += 1) {
    const byCourse = context.allowed.has("core_calendar_get_action_events_by_course");
    const byCourses = !byCourse && context.allowed.has("core_calendar_get_action_events_by_courses");
    const fn = byCourse ? "core_calendar_get_action_events_by_course" : byCourses ? "core_calendar_get_action_events_by_courses" : "core_calendar_get_action_events_by_timesort";
    const response = await moodleCall<JsonObject>(context.baseUrl, context.token, fn, {
      ...(byCourse ? { courseid: courseExternalId } : byCourses ? { courseids: [courseExternalId] } : {}), timesortfrom: Math.floor(Date.now() / 1000) - 30 * 86400,
      aftereventid: afterEventId, limitnum: 50,
    });
    const batch = (Array.isArray(response.events) ? response.events as JsonObject[] : [])
      .filter((event) => byCourse || byCourses || text(event.courseid) === courseExternalId);
    events.push(...batch);
    const unfiltered = Array.isArray(response.events) ? response.events as JsonObject[] : [];
    if (unfiltered.length < 50 || response.moreevents === false) break;
    const nextId = Number(unfiltered.at(-1)?.id ?? 0);
    if (!nextId || nextId === afterEventId) throw new Error("Moodle action-event pagination did not advance");
    afterEventId = nextId;
  }
  let assignments = new Map<string, JsonObject>();
  let quizzes = new Map<string, JsonObject>();
  if (context.allowed.has("mod_assign_get_assignments")) try {
    const response = await moodleCall<JsonObject>(context.baseUrl, context.token, "mod_assign_get_assignments", { courseids: [courseExternalId] });
    const rows = Array.isArray(response.courses) ? (response.courses as JsonObject[]).flatMap((course) => Array.isArray(course.assignments) ? course.assignments as JsonObject[] : []) : [];
    assignments = new Map(rows.map((row) => [text(row.id), row]));
  } catch (error) { optionalFailure(context, counts, "mod_assign_get_assignments", error); }
  if (context.allowed.has("mod_quiz_get_quizzes_by_courses")) try {
    const response = await moodleCall<JsonObject>(context.baseUrl, context.token, "mod_quiz_get_quizzes_by_courses", { courseids: [courseExternalId] });
    const rows = Array.isArray(response.quizzes) ? response.quizzes as JsonObject[] : [];
    quizzes = new Map(rows.map((row) => [text(row.id), row]));
  } catch (error) { optionalFailure(context, counts, "mod_quiz_get_quizzes_by_courses", error); }
  for (const event of events) {
    const eventExternalId = text(event.id);
    const moduleName = text(event.modulename).toLowerCase();
    const instance = text(event.instance);
    const itemExternalId = moduleName && instance ? `activity:${moduleName}:${instance}` : text(event.cmid) ? `course-module:${text(event.cmid)}` : `calendar-event:${eventExternalId}`;
    const enrichment = moduleName === "assign" ? assignments.get(instance) : moduleName === "quiz" ? quizzes.get(instance) : undefined;
    const rawId = await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "calendar-event", externalId: eventExternalId, externalCourseId: courseExternalId, payload: event }, counts);
    const existingItem = await referenceTarget(context.client, context.connection_id, "academic-item", itemExternalId, "academic_item_id");
    const moduleId = text(event.cmid) ? await referenceTarget(context.client, context.connection_id, "course-module", text(event.cmid), "course_module_id") : null;
    let submissionState: string | null = null;
    if (moduleName === "assign" && instance && context.allowed.has("mod_assign_get_submission_status")) try {
      const submission = await moodleCall<JsonObject>(context.baseUrl, context.token, "mod_assign_get_submission_status", { assignid: instance });
      await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "assignment-submission", externalId: instance, externalCourseId: courseExternalId, payload: submission }, counts);
      const lastAttempt = submission.lastattempt as JsonObject | undefined;
      const submissionDetails = lastAttempt?.submission as JsonObject | undefined;
      submissionState = text(submissionDetails?.status) || null;
    } catch (error) { optionalFailure(context, counts, "mod_assign_get_submission_status", error); }
    const values = { owner_id: context.owner_id, course_id: courseId, module_id: moduleId, origin: "provider", item_type: itemType(moduleName), title: text(enrichment?.name ?? event.name, "Untitled Moodle event"), description: text(enrichment?.intro ?? event.description) || null, source_start_at: iso(event.timestart), source_available_at: iso(enrichment?.allowsubmissionsfromdate ?? enrichment?.timeopen ?? event.timestart), source_due_at: iso(enrichment?.duedate ?? event.timesort ?? event.timestart), source_close_at: iso(enrichment?.cutoffdate ?? enrichment?.timeclose), url: text(event.url) || null, submission_state: submissionState, upstream_state: "present" };
    const result = existingItem ? await context.client.from("academic_items").update(values).eq("id", existingItem).select("id").single() : await context.client.from("academic_items").insert(values).select("id").single();
    if (result.error) throw result.error;
    await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "academic-item", externalId: itemExternalId, externalCourseId: courseExternalId, rawId, targetColumn: "academic_item_id", targetId: result.data.id });
    await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "calendar-event", externalId: eventExternalId, externalCourseId: courseExternalId, rawId, targetColumn: "academic_item_id", targetId: result.data.id });
  }
  const staleIds = await markRawMissing(context, counts, ["calendar-event"], courseExternalId);
  if (staleIds.length) {
    const { data: references } = await context.client.from("source_references").select("academic_item_id").eq("connection_id", context.connection_id).eq("object_type", "academic-item").in("raw_source_record_id", staleIds);
    const itemIds = (references ?? []).flatMap((row) => row.academic_item_id ? [row.academic_item_id] : []);
    if (itemIds.length) await context.client.from("academic_items").update({ upstream_state: "missing" }).in("id", itemIds);
  }
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

async function grades(context: Context, counts: SyncCounts) {
  const courseExternalId = context.scope_external_id!;
  const courseId = await referenceTarget(context.client, context.connection_id, "course", courseExternalId, "course_id");
  if (!courseId) throw new Error(`Course ${courseExternalId} has no Cortex identity`);
  const report = await moodleCall<JsonObject>(context.baseUrl, context.token, "gradereport_user_get_grade_items", { courseid: courseExternalId, userid: context.userId });
  await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "gradebook", externalId: courseExternalId, externalCourseId: courseExternalId, payload: report }, counts);
  const userGrades = Array.isArray(report.usergrades) ? report.usergrades as JsonObject[] : [];
  const items = userGrades.flatMap((row) => Array.isArray(row.gradeitems) ? row.gradeitems as JsonObject[] : []);
  const categories = items.filter((item) => text(item.itemtype) === "category");
  for (const [position, category] of categories.entries()) {
    const externalId = text(category.id ?? category.sortorder);
    const rawId = await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "grade-category", externalId, externalCourseId: courseExternalId, payload: category }, counts);
    const existing = await referenceTarget(context.client, context.connection_id, "grade-category", externalId, "grade_category_id");
    const values = { owner_id: context.owner_id, course_id: courseId, name: text(category.itemname, "Grade category"), aggregation: text(category.aggregation) || null, weight: numeric(category.weightformatted), minimum_score: numeric(category.grademin), maximum_score: numeric(category.grademax), position };
    const result = existing ? await context.client.from("grade_categories").update(values).eq("id", existing).select("id").single() : await context.client.from("grade_categories").insert(values).select("id").single();
    if (result.error) throw result.error;
    await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "grade-category", externalId, externalCourseId: courseExternalId, rawId, targetColumn: "grade_category_id", targetId: result.data.id });
  }
  for (const category of categories) {
    const externalId = text(category.id ?? category.sortorder);
    const parentExternalId = text(category.parentid);
    if (!parentExternalId) continue;
    const categoryId = await referenceTarget(context.client, context.connection_id, "grade-category", externalId, "grade_category_id");
    const parentId = await referenceTarget(context.client, context.connection_id, "grade-category", parentExternalId, "grade_category_id");
    if (categoryId && parentId) await context.client.from("grade_categories").update({ parent_category_id: parentId }).eq("id", categoryId);
  }
  for (const [position, item] of items.filter((item) => text(item.itemtype) !== "category").entries()) {
    const externalId = text(item.id ?? item.sortorder);
    const rawId = await upsertRaw(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, runId: context.sync_run_id, objectType: "grade-item", externalId, externalCourseId: courseExternalId, payload: item }, counts);
    const existing = await referenceTarget(context.client, context.connection_id, "grade-item", externalId, "grade_item_id");
    const categoryExternalId = text(item.categoryid ?? item.parentid);
    const categoryId = categoryExternalId ? await referenceTarget(context.client, context.connection_id, "grade-category", categoryExternalId, "grade_category_id") : null;
    const moduleName = text(item.itemmodule);
    const instance = text(item.iteminstance);
    const academicItemId = moduleName && instance ? await referenceTarget(context.client, context.connection_id, "academic-item", `activity:${moduleName}:${instance}`, "academic_item_id") : null;
    const values = { owner_id: context.owner_id, course_id: courseId, category_id: categoryId, academic_item_id: academicItemId, name: text(item.itemname, "Grade item"), item_type: text(item.itemtype) || null, module_type: moduleName || null, module_instance_id: instance || null, item_number: numeric(item.itemnumber), score: numeric(item.graderaw ?? item.gradeformatted), minimum_score: numeric(item.grademin), maximum_score: numeric(item.grademax), percentage: numeric(item.percentageformatted), weight: numeric(item.weightformatted), feedback: text(item.feedback) || null, hidden: item.hidden === true || item.hidden === 1, position, graded_at: iso(item.gradedatesubmitted ?? item.gradedategraded) };
    const result = existing ? await context.client.from("grade_items").update(values).eq("id", existing).select("id").single() : await context.client.from("grade_items").insert(values).select("id").single();
    if (result.error) throw result.error;
    await sourceTarget(context.client, { ownerId: context.owner_id, connectionId: context.connection_id, objectType: "grade-item", externalId, externalCourseId: courseExternalId, rawId, targetColumn: "grade_item_id", targetId: result.data.id });
  }
  await markRawMissing(context, counts, ["grade-category", "grade-item"], courseExternalId);
}

Deno.serve(async (request) => {
  if (!hasServiceRole(request)) return new Response("Unauthorized", { status: 401 });
  const client = adminClient();
  const workerToken = crypto.randomUUID();
  const { data: tasks, error: claimError } = await client.rpc("claim_sync_tasks", { worker_token: workerToken, task_limit: 1 });
  if (claimError) return Response.json({ error: claimError.message }, { status: 500 });
  if (!tasks?.length) return Response.json({ processed: 0 });
  const task = tasks[0] as Task;
  await client.from("sync_runs").update({ status: "running", started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() }).eq("id", task.sync_run_id).eq("status", "queued");
  const { data: connection } = await client.from("provider_connections").select("base_url,external_user_id").eq("id", task.connection_id).single();
  const { data: credential } = await client.from("provider_credentials").select("encrypted_payload").eq("connection_id", task.connection_id).single();
  const { data: capabilities } = await client.from("provider_capabilities").select("capability_name").eq("connection_id", task.connection_id).eq("available", true);
  const counts = emptyCounts();
  const optionalFailures: Array<{ capability: string; message: string }> = [];
  let errorMessage: string | null = null;
  try {
    if (!connection || !credential) throw new Error("Moodle connection credential is unavailable");
    const { token } = await decryptCredential(credential.encrypted_payload);
    const context: Context = { ...task, client, baseUrl: connection.base_url, token, userId: connection.external_user_id ?? "", allowed: new Set((capabilities ?? []).map((row) => row.capability_name)), optionalFailures };
    if (task.phase === "bootstrap") await bootstrap(context, counts);
    else if (task.phase === "contents") await contents(context, counts);
    else if (task.phase === "events") await events(context, counts);
    else if (task.phase === "grades") await grades(context, counts);
    else throw new Error(`Unknown sync phase ${task.phase}`);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown synchronization error";
    counts.failed += 1;
  }
  await client.from("sync_run_steps").insert({ owner_id: task.owner_id, sync_run_id: task.sync_run_id, capability_name: task.phase, scope_type: task.scope_external_id ? "course" : "connection", scope_external_id: task.scope_external_id, status: errorMessage ? "failed" : "succeeded", inserted_count: counts.inserted, updated_count: counts.updated, unchanged_count: counts.unchanged, missing_count: counts.missing, error_code: errorMessage ? "sync_phase_failed" : null, error_message: errorMessage, started_at: new Date().toISOString(), finished_at: new Date().toISOString() });
  if (optionalFailures.length) await client.from("sync_run_steps").insert(optionalFailures.map((failure) => ({
    owner_id: task.owner_id, sync_run_id: task.sync_run_id, capability_name: failure.capability,
    scope_type: task.scope_external_id ? "course" : "connection", scope_external_id: task.scope_external_id,
    status: "failed", error_code: "optional_endpoint_failed", error_message: failure.message,
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
  })));
  const mandatory = task.phase === "bootstrap" && Boolean(errorMessage);
  const { error: finishError } = await client.rpc("finish_sync_task", {
    p_task_id: task.id, p_worker_token: workerToken, p_final_status: errorMessage ? "failed" : "succeeded",
    p_inserted_delta: counts.inserted, p_updated_delta: counts.updated, p_unchanged_delta: counts.unchanged,
    p_missing_delta: counts.missing, p_skipped_delta: counts.skipped, p_failed_delta: counts.failed,
    p_error_code: errorMessage ? "sync_phase_failed" : null, p_error_message: errorMessage, p_mandatory_failure: mandatory,
  });
  if (finishError) return Response.json({ error: finishError.message }, { status: 500 });
  return Response.json({ processed: 1, task: task.id, phase: task.phase, counts, error: errorMessage });
});
