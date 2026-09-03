export type MoodleAcademicRecord = Record<string, unknown>;

export interface MoodleModuleIdentity {
  cmid: string;
  moduleName: string;
  instance: string;
}

export interface MoodleItemObservation {
  courseContentsComplete: boolean;
  calendarComplete: boolean;
  assignmentsComplete: boolean;
  quizzesComplete: boolean;
  forumsComplete: boolean;
  moduleItemIds: ReadonlySet<string>;
  calendarItemIds: ReadonlySet<string>;
  assignmentItemIds: ReadonlySet<string>;
  quizItemIds: ReadonlySet<string>;
  forumItemIds: ReadonlySet<string>;
}

function value(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function activityItemId(moduleName: unknown, instance: unknown): string | null {
  const normalizedName = value(moduleName).trim().toLowerCase();
  const normalizedInstance = value(instance).trim();
  return normalizedName && normalizedInstance ? `activity:${normalizedName}:${normalizedInstance}` : null;
}

export function moduleIdentity(module: MoodleAcademicRecord): MoodleModuleIdentity {
  return {
    cmid: value(module.id ?? module.cmid).trim(),
    moduleName: value(module.modname ?? module.modulename).trim().toLowerCase(),
    instance: value(module.instance).trim(),
  };
}

export function moduleItemId(module: MoodleAcademicRecord): string | null {
  const identity = moduleIdentity(module);
  return activityItemId(identity.moduleName, identity.instance)
    ?? (identity.cmid ? `course-module:${identity.cmid}` : null);
}

export function calendarItemId(
  event: MoodleAcademicRecord,
  module?: MoodleAcademicRecord,
): string {
  const resolved = module ? moduleIdentity(module) : null;
  return activityItemId(
    resolved?.moduleName || event.modulename || event.activityname,
    resolved?.instance || event.instance,
  ) ?? (() => {
    const cmid = resolved?.cmid || value(event.cmid ?? event.contextinstanceid ?? event.activityid).trim();
    return cmid ? `course-module:${cmid}` : `calendar-event:${value(event.id).trim()}`;
  })();
}

export function forumItemId(forum: MoodleAcademicRecord): string | null {
  return activityItemId("forum", forum.id ?? forum.instance);
}

export function unixTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) return new Date(Number(value) * 1000).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

/**
 * Moodle deadline priority: activity-specific API, action calendar, completion
 * expected date, then the previously persisted deadline. The last case is
 * intentionally limited to activities such as forums whose module payload does
 * not reliably carry a deadline. Titles are never parsed.
 */
export function resolveMoodleDeadline(input: {
  activity?: MoodleAcademicRecord;
  event?: MoodleAcademicRecord;
  completion?: MoodleAcademicRecord;
  previousDueAt?: unknown;
  preservePrevious?: boolean;
}): string | null {
  return unixTimestamp(input.activity?.duedate ?? input.activity?.timeclose)
    ?? unixTimestamp(input.event?.timesort ?? input.event?.timestart)
    ?? unixTimestamp(input.completion?.completionexpected ?? input.completion?.timeexpected)
    ?? (input.preservePrevious ? unixTimestamp(input.previousDueAt) : null);
}

function hasPrefix(id: string, prefix: string): boolean {
  return id.startsWith(prefix);
}

/** Returns only IDs owned by a complete authoritative source that disappeared. */
export function missingMoodleItemIds(
  existingProviderItemIds: Iterable<string>,
  observation: MoodleItemObservation,
): string[] {
  const present = new Set<string>([
    ...observation.moduleItemIds,
    ...observation.calendarItemIds,
    ...observation.assignmentItemIds,
    ...observation.quizItemIds,
    ...observation.forumItemIds,
  ]);

  return [...existingProviderItemIds].filter((id) => {
    if (present.has(id)) return false;
    if (id.startsWith("calendar-event:")) return observation.calendarComplete;
    if (observation.courseContentsComplete && (id.startsWith("activity:") || id.startsWith("course-module:"))) return true;
    if (hasPrefix(id, "activity:assign:")) return observation.assignmentsComplete;
    if (hasPrefix(id, "activity:quiz:")) return observation.quizzesComplete;
    if (hasPrefix(id, "activity:forum:")) return observation.forumsComplete;
    return false;
  });
}
