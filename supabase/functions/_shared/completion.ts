type MoodleRecord = Record<string, unknown>;

function hasValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "-" && normalized !== "--" && normalized !== "null";
}

export function isMoodleActivityComplete(status: MoodleRecord): boolean {
  const state = Number(status.state ?? status.status);
  return state === 1 || state === 2 || status.complete === true || status.isoverallcomplete === true;
}

export function hasMoodleGradeResult(item: MoodleRecord): boolean {
  return hasValue(item.graderaw)
    || hasValue(item.gradeformatted)
    || hasValue(item.percentageformatted)
    || Number(item.gradedategraded ?? 0) > 0
    || Number(item.gradedatesubmitted ?? 0) > 0;
}
