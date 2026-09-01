import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AcademicItem,
  AcademicItemStatus,
  AcademicItemType,
  AcademicSearchResult,
  Course,
  CourseDetail,
  CourseModule,
  CourseSection,
  GradeCategory,
  GradeItem,
  MoodleConnectionStatus,
  ProviderCapability,
  RawSourceRecord,
  SyncRun,
} from "@/domain/types";

type Row = Record<string, unknown>;

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function throwIfError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function mapCourse(row: Row): Course {
  return {
    id: stringValue(row.id),
    code: stringValue(row.effective_code ?? row.code),
    name: stringValue(row.effective_name ?? row.name),
    term: nullableString(row.effective_term ?? row.term),
    instructor: nullableString(row.effective_instructor ?? row.instructor),
    active: row.active !== false,
    color: stringValue(row.effective_color ?? row.color, "#b07b5c"),
    overrides: objectValue(row.overrides),
  };
}

function mapItem(row: Row): AcademicItem {
  return {
    id: stringValue(row.id),
    courseId: nullableString(row.course_id),
    moduleId: nullableString(row.module_id),
    origin: row.origin === "provider" ? "provider" : "manual",
    type: stringValue(row.effective_item_type ?? row.item_type, "other") as AcademicItemType,
    title: stringValue(row.effective_title ?? row.title),
    description: nullableString(row.effective_description ?? row.description),
    startAt: nullableString(row.source_start_at),
    availableAt: nullableString(row.effective_available_at ?? row.source_available_at),
    dueAt: nullableString(row.effective_due_at ?? row.source_due_at),
    closeAt: nullableString(row.effective_close_at ?? row.source_close_at),
    endAt: nullableString(row.source_end_at),
    allDay: row.all_day === true,
    url: nullableString(row.effective_url ?? row.url),
    status: stringValue(row.status, "not_started") as AcademicItemStatus,
    completionState: nullableString(row.completion_state),
    submissionState: nullableString(row.submission_state),
    submittedAt: nullableString(row.submitted_at),
    completedAt: nullableString(row.completed_at),
    upstreamState: stringValue(row.upstream_state, "present") as AcademicItem["upstreamState"],
    overrides: objectValue(row.overrides),
  };
}

export class AcademicRepository {
  constructor(
    private readonly client: SupabaseClient,
    readonly ownerId: string,
  ) {}

  async listCourses(activeOnly = false): Promise<Course[]> {
    let query = this.client.from("effective_courses").select("*").eq("owner_id", this.ownerId).order("effective_code");
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    throwIfError(error);
    return ((data ?? []) as Row[]).map(mapCourse);
  }

  async getCourse(courseId: string): Promise<Course | null> {
    const { data, error } = await this.client.from("effective_courses").select("*")
      .eq("owner_id", this.ownerId).eq("id", courseId).maybeSingle();
    throwIfError(error);
    return data ? mapCourse(data as Row) : null;
  }

  async listAcademicItems(options: {
    courseId?: string;
    from?: string;
    to?: string;
    includeMissing?: boolean;
    limit?: number;
  } = {}): Promise<AcademicItem[]> {
    let query = this.client.from("effective_academic_items").select("*").eq("owner_id", this.ownerId);
    if (options.courseId) query = query.eq("course_id", options.courseId);
    if (options.from) query = query.gte("effective_due_at", options.from);
    if (options.to) query = query.lte("effective_due_at", options.to);
    if (!options.includeMissing) query = query.eq("upstream_state", "present");
    query = query.order("effective_due_at", { ascending: true, nullsFirst: false }).limit(options.limit ?? 250);
    const { data, error } = await query;
    throwIfError(error);
    const items = ((data ?? []) as Row[]).map(mapItem);
    const courses = await this.listCourses();
    const byId = new Map(courses.map((course) => [course.id, course]));
    return items.map((item) => ({ ...item, course: item.courseId ? byId.get(item.courseId) : undefined }));
  }

  async getAcademicItem(itemId: string): Promise<AcademicItem | null> {
    const { data, error } = await this.client.from("effective_academic_items").select("*")
      .eq("owner_id", this.ownerId).eq("id", itemId).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const item = mapItem(data as Row);
    return { ...item, course: item.courseId ? await this.getCourse(item.courseId) ?? undefined : undefined };
  }

  async getCourseDetail(courseId: string): Promise<CourseDetail | null> {
    const course = await this.getCourse(courseId);
    if (!course) return null;
    const [sectionsResult, modulesResult, items, categoriesResult, gradesResult] = await Promise.all([
      this.client.from("course_sections").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
      this.client.from("course_modules").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
      this.listAcademicItems({ courseId, includeMissing: true }),
      this.client.from("grade_categories").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
      this.client.from("grade_items").select("*").eq("owner_id", this.ownerId).eq("course_id", courseId).order("position"),
    ]);
    [sectionsResult.error, modulesResult.error, categoriesResult.error, gradesResult.error].forEach(throwIfError);

    const sections: CourseSection[] = ((sectionsResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), number: nullableNumber(row.section_number),
      position: numberValue(row.position), name: stringValue(row.name), summary: nullableString(row.summary), visible: row.visible !== false,
    }));
    const modules: CourseModule[] = ((modulesResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), sectionId: nullableString(row.section_id),
      moduleType: stringValue(row.module_type), title: stringValue(row.title), description: nullableString(row.description),
      url: nullableString(row.url), position: numberValue(row.position), visible: row.visible !== false,
    }));
    const categories: GradeCategory[] = ((categoriesResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), parentCategoryId: nullableString(row.parent_category_id),
      name: stringValue(row.name), weight: nullableNumber(row.weight), minimumScore: nullableNumber(row.minimum_score),
      maximumScore: nullableNumber(row.maximum_score), position: numberValue(row.position),
    }));
    const grades: GradeItem[] = ((gradesResult.data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), courseId: stringValue(row.course_id), categoryId: nullableString(row.category_id),
      academicItemId: nullableString(row.academic_item_id), name: stringValue(row.name), score: nullableNumber(row.score),
      maximumScore: nullableNumber(row.maximum_score), percentage: nullableNumber(row.percentage),
      feedback: nullableString(row.feedback), hidden: row.hidden === true, position: numberValue(row.position),
    }));
    return { course, sections, modules, items, categories, grades };
  }

  async getGradeItem(gradeItemId: string): Promise<GradeItem | null> {
    const { data, error } = await this.client.from("grade_items").select("*").eq("owner_id", this.ownerId).eq("id", gradeItemId).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const row = data as Row;
    return {
      id: stringValue(row.id), courseId: stringValue(row.course_id), categoryId: nullableString(row.category_id),
      academicItemId: nullableString(row.academic_item_id), name: stringValue(row.name), score: nullableNumber(row.score),
      maximumScore: nullableNumber(row.maximum_score), percentage: nullableNumber(row.percentage),
      feedback: nullableString(row.feedback), hidden: row.hidden === true, position: numberValue(row.position),
    };
  }

  async getMoodleStatus(): Promise<MoodleConnectionStatus | null> {
    const { data, error } = await this.client.from("provider_connections").select("*")
      .eq("owner_id", this.ownerId).eq("provider", "moodle").order("created_at", { ascending: false }).limit(1).maybeSingle();
    throwIfError(error);
    if (!data) return null;
    const row = data as Row;
    return {
      id: stringValue(row.id), connected: row.status === "active", baseUrl: stringValue(row.base_url),
      username: nullableString(row.external_username), displayName: nullableString(row.display_name),
      lastCapabilityCheckAt: nullableString(row.last_capability_check_at),
    };
  }

  async listCapabilities(connectionId: string): Promise<ProviderCapability[]> {
    const { data, error } = await this.client.from("provider_capabilities").select("*")
      .eq("owner_id", this.ownerId).eq("connection_id", connectionId).order("diagnostic_group").order("capability_name");
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      name: stringValue(row.capability_name), group: stringValue(row.diagnostic_group),
      desired: row.desired === true, available: row.available === true, checkedAt: stringValue(row.checked_at),
    }));
  }

  async listSyncRuns(limit = 20): Promise<SyncRun[]> {
    const { data, error } = await this.client.from("sync_runs").select("*").eq("owner_id", this.ownerId)
      .order("created_at", { ascending: false }).limit(limit);
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), triggerType: stringValue(row.trigger_type) as SyncRun["triggerType"],
      status: stringValue(row.status) as SyncRun["status"], inserted: numberValue(row.inserted_count),
      updated: numberValue(row.updated_count), unchanged: numberValue(row.unchanged_count), missing: numberValue(row.missing_count),
      skipped: numberValue(row.skipped_count), failed: numberValue(row.failed_count), errorMessage: nullableString(row.error_message),
      createdAt: stringValue(row.created_at), finishedAt: nullableString(row.finished_at),
    }));
  }

  async listRawSourceRecords(connectionId: string, limit = 100): Promise<RawSourceRecord[]> {
    const { data, error } = await this.client.from("raw_source_records").select("id,object_type,external_id,external_course_id,upstream_state,fetched_at,payload")
      .eq("owner_id", this.ownerId).eq("connection_id", connectionId).order("fetched_at", { ascending: false }).limit(Math.min(limit, 250));
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      id: stringValue(row.id), objectType: stringValue(row.object_type), externalId: stringValue(row.external_id),
      externalCourseId: nullableString(row.external_course_id), upstreamState: stringValue(row.upstream_state) as RawSourceRecord["upstreamState"],
      fetchedAt: stringValue(row.fetched_at), payload: row.payload,
    }));
  }

  async createManualItem(input: {
    courseId?: string | null; title: string; type: AcademicItemType; dueAt?: string | null; description?: string | null; url?: string | null;
  }): Promise<AcademicItem> {
    const { data, error } = await this.client.from("academic_items").insert({
      owner_id: this.ownerId, course_id: input.courseId ?? null, origin: "manual", item_type: input.type,
      title: input.title, description: input.description ?? null, source_due_at: input.dueAt ?? null, url: input.url ?? null,
    }).select("*").single();
    throwIfError(error);
    return mapItem(data as Row);
  }

  async setItemOverride(itemId: string, fieldName: string, value: unknown): Promise<void> {
    const { error } = await this.client.from("field_overrides").upsert({
      owner_id: this.ownerId, academic_item_id: itemId, field_name: fieldName, value,
    }, { onConflict: "course_id,academic_item_id,field_name" });
    throwIfError(error);
  }

  async clearItemOverride(itemId: string, fieldName: string): Promise<void> {
    const { error } = await this.client.from("field_overrides").delete().eq("owner_id", this.ownerId)
      .eq("academic_item_id", itemId).eq("field_name", fieldName);
    throwIfError(error);
  }

  async markItemComplete(itemId: string, complete = true): Promise<void> {
    const { error } = await this.client.from("academic_items").update({
      status: complete ? "completed" : "not_started", completed_at: complete ? new Date().toISOString() : null,
    }).eq("owner_id", this.ownerId).eq("id", itemId);
    throwIfError(error);
  }

  async addNote(target: { courseId?: string; itemId?: string }, body: string): Promise<string> {
    const { data, error } = await this.client.from("notes").insert({
      owner_id: this.ownerId, course_id: target.courseId ?? null, academic_item_id: target.itemId ?? null, body,
    }).select("id").single();
    throwIfError(error);
    return stringValue((data as Row).id);
  }

  async addTag(itemId: string, name: string, color?: string): Promise<void> {
    const { data, error } = await this.client.from("tags").upsert(
      { owner_id: this.ownerId, name, color: color ?? null }, { onConflict: "owner_id,name" },
    ).select("id").single();
    throwIfError(error);
    const { error: linkError } = await this.client.from("academic_item_tags").upsert({
      owner_id: this.ownerId, academic_item_id: itemId, tag_id: stringValue((data as Row).id),
    });
    throwIfError(linkError);
  }

  async scheduleReview(itemId: string, dueAt: string, title?: string): Promise<AcademicItem> {
    const source = await this.getAcademicItem(itemId);
    if (!source) throw new Error("Academic item not found");
    const review = await this.createManualItem({
      courseId: source.courseId, title: title ?? `Review: ${source.title}`, type: "review", dueAt,
    });
    const { error } = await this.client.from("academic_item_relations").insert({
      owner_id: this.ownerId, source_item_id: review.id, target_item_id: itemId, relation_type: "review_of",
    });
    throwIfError(error);
    return review;
  }

  async triggerMoodleSync(trigger: "manual" | "mcp"): Promise<string> {
    const { data, error } = await this.client.rpc("request_moodle_sync", { requested_trigger: trigger });
    throwIfError(error);
    return stringValue(data);
  }

  async search(query: string, limit = 20): Promise<AcademicSearchResult[]> {
    const { data, error } = await this.client.rpc("search_academic_context", { query_text: query, result_limit: limit });
    throwIfError(error);
    return ((data ?? []) as Row[]).map((row) => ({
      kind: stringValue(row.kind) as AcademicSearchResult["kind"], id: stringValue(row.id),
      courseId: nullableString(row.course_id), title: stringValue(row.title), excerpt: nullableString(row.excerpt),
      rank: numberValue(row.rank),
    }));
  }
}
