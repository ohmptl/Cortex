export const ACADEMIC_ITEM_TYPES = [
  "assignment",
  "quiz",
  "exam",
  "lab",
  "project",
  "discussion",
  "reading",
  "lecture",
  "review",
  "event",
  "other",
] as const;

export type AcademicItemType = (typeof ACADEMIC_ITEM_TYPES)[number];
export type AcademicItemStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "submitted"
  | "graded"
  | "cancelled";

export interface Course {
  id: string;
  code: string;
  name: string;
  term: string | null;
  instructor: string | null;
  active: boolean;
  color: string;
  overrides: Record<string, unknown>;
}

export interface AcademicItem {
  id: string;
  courseId: string | null;
  providerModuleId: string | null;
  origin: "manual" | "provider";
  type: AcademicItemType;
  title: string;
  description: string | null;
  startAt: string | null;
  availableAt: string | null;
  dueAt: string | null;
  closeAt: string | null;
  endAt: string | null;
  allDay: boolean;
  url: string | null;
  status: AcademicItemStatus;
  completionState: string | null;
  submissionState: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  upstreamState: "present" | "missing" | "deleted";
  overrides: Record<string, unknown>;
  course?: Course;
}

export interface GradeCategory {
  id: string;
  courseId: string;
  parentCategoryId: string | null;
  name: string;
  aggregation: string | null;
  weight: number | null;
  minimumScore: number | null;
  maximumScore: number | null;
  position: number;
}

export interface GradeItem {
  id: string;
  courseId: string;
  categoryId: string | null;
  academicItemId: string | null;
  name: string;
  score: number | null;
  maximumScore: number | null;
  percentage: number | null;
  weight: number | null;
  feedback: string | null;
  hidden: boolean;
  position: number;
}

export interface SyncRun {
  id: string;
  triggerType: "scheduled" | "manual" | "mcp";
  status: "queued" | "running" | "partial" | "succeeded" | "failed" | "cancelled" | "timed_out";
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  skipped: number;
  failed: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ProviderCapability {
  name: string;
  group: string;
  desired: boolean;
  available: boolean;
  checkedAt: string;
}

export interface MoodleConnectionStatus {
  id: string;
  connected: boolean;
  baseUrl: string;
  username: string | null;
  displayName: string | null;
  lastCapabilityCheckAt: string | null;
}

export interface CourseDetail {
  course: Course;
  items: AcademicItem[];
  categories: GradeCategory[];
  grades: GradeItem[];
  lectures: Lecture[];
  notes: Note[];
  gradeModels: GradeModel[];
}

export interface AcademicSearchResult {
  kind: "course" | "item" | "note" | "lecture_segment";
  id: string;
  courseId: string | null;
  title: string;
  excerpt: string | null;
  rank: number;
}

export interface Lecture { id:string; courseId:string; title:string; recordedAt:string|null; durationSeconds:number|null; instructor:string|null; providerUrl:string|null; transcriptStatus:"pending"|"available"|"unavailable"|"error"; transcriptLanguage:string|null }
export interface TranscriptSegment { id:string; lectureId:string; ordinal:number; startSeconds:number|null; endSeconds:number|null; text:string }
export interface Note { id:string; courseId:string|null; academicItemId:string|null; lectureId:string|null; body:string; createdBy:"user"|"assistant"|"system"; sourceType:string|null; sourceId:string|null; sourceUrl:string|null; sourceTimestampSeconds:number|null; archivedAt:string|null; createdAt:string; updatedAt:string }
export interface GradeModel { id:string; courseId:string; name:string; isDefault:boolean; ungradedPolicy:"exclude"|"zero"; archivedAt:string|null }
