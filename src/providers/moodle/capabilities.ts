export const CAPABILITY_GROUPS = {
  site: ["core_webservice_get_site_info"],
  courses: ["core_enrol_get_users_courses"],
  structure: ["core_course_get_contents", "core_course_get_course_module"],
  calendar: [
    "core_calendar_get_action_events_by_timesort",
    "core_calendar_get_action_events_by_course",
    "core_calendar_get_action_events_by_courses",
    "core_calendar_get_calendar_events",
  ],
  assignments: ["mod_assign_get_assignments", "mod_assign_get_submission_status"],
  quizzes: ["mod_quiz_get_quizzes_by_courses", "mod_quiz_get_user_attempts", "mod_quiz_get_user_best_grade"],
  completion: ["core_completion_get_activities_completion_status", "core_completion_get_course_completion_status"],
  gradebook: ["gradereport_user_get_grade_items", "core_grades_get_grades"],
  forums: ["mod_forum_get_forums_by_courses", "mod_forum_get_forum_discussions"],
  resources: [
    "mod_resource_get_resources_by_courses", "mod_folder_get_folders_by_courses", "mod_book_get_books_by_courses",
    "mod_page_get_pages_by_courses", "mod_url_get_urls_by_courses",
  ],
} as const;

export type CapabilityGroup = keyof typeof CAPABILITY_GROUPS | "other";

const desired = new Set<string>(Object.values(CAPABILITY_GROUPS).flat());
const groupByFunction = new Map<string, CapabilityGroup>(
  Object.entries(CAPABILITY_GROUPS).flatMap(([group, functions]) =>
    functions.map((name) => [name, group as CapabilityGroup] as const),
  ),
);

export function capabilityGroup(name: string): CapabilityGroup {
  return groupByFunction.get(name) ?? "other";
}

export function isDesiredCapability(name: string): boolean {
  return desired.has(name);
}

export function extractFunctionAllowlist(siteInfo: unknown): string[] {
  if (!siteInfo || typeof siteInfo !== "object") return [];
  const functions = (siteInfo as { functions?: unknown }).functions;
  if (!Array.isArray(functions)) return [];
  return [...new Set(functions.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
      return [(entry as { name: string }).name];
    }
    return [];
  }))].sort();
}

export function buildCapabilityDiagnostics(siteInfo: unknown) {
  const allowlist = extractFunctionAllowlist(siteInfo);
  const available = new Set(allowlist);
  const discovered = allowlist.map((name) => ({
    name,
    group: capabilityGroup(name),
    desired: isDesiredCapability(name),
    available: true,
  }));
  const missingDesired = [...desired].filter((name) => !available.has(name)).map((name) => ({
    name,
    group: capabilityGroup(name),
    desired: true,
    available: false,
  }));
  return [...discovered, ...missingDesired].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
