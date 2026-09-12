type MoodleRecord = Record<string, unknown>;

function hasValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "-" && normalized !== "--" && normalized !== "null";
}

export function isMoodleActivityComplete(status: MoodleRecord): boolean {
  const state = Number(status.state ?? status.status);
  return state === 1 || state === 2 || state === 3 || status.complete === true || status.isoverallcomplete === true;
}

export function hasMoodleGradeResult(item: MoodleRecord): boolean {
  return hasValue(item.graderaw)
    || hasValue(item.gradeformatted)
    || hasValue(item.percentageformatted)
    || Number(item.gradedategraded ?? 0) > 0
    || Number(item.gradedatesubmitted ?? 0) > 0;
}

/** Unknown is distinct from incomplete. A grade alone is never completion evidence. */
export function moodleCompletion(input: {
  module?: MoodleRecord;
  submission?: MoodleRecord | null;
  attempts?: MoodleRecord[];
}): boolean | null {
  const module = input.module ?? {};
  const completion = module.completiondata as MoodleRecord | undefined;
  // hascompletion=false and completion=0 describe disabled tracking, not an incomplete activity.
  if (completion && completion.hascompletion !== false && module.completion !== 0 && (
    completion.state !== undefined || completion.status !== undefined ||
    completion.isoverallcomplete !== undefined || completion.complete !== undefined
  )) {
    if (isMoodleActivityComplete(completion)) return true;
    // An explicit submission finishes an assignment even if a teacher has yet to grade it.
    if (input.submission?.status === "submitted") return true;
    return false;
  }
  if (input.submission) {
    if (input.submission.status === "submitted") return true;
    if (["new", "draft", "reopened"].includes(String(input.submission.status))) return false;
  }
  if (input.attempts) {
    return input.attempts.some((attempt) => !attempt.preview && ["finished", "submitted"].includes(String(attempt.state)));
  }
  return null;
}
