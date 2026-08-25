import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";

async function moodleRest<T>(
  url: string,
  token: string,
  wsfunction: string,
  params: Record<string, string> = {}
): Promise<T> {
  const query = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: "json", ...params });
  const res = await fetch(`${url.replace(/\/$/, "")}/webservice/rest/server.php?${query}`);
  const data = await res.json();
  if (data?.exception) throw new Error(data.message || data.exception);
  return data as T;
}

export interface MoodleSyncResult {
  ran: boolean;
  synced: number;
  error?: string;
}

function normalizeStr(str: string | null | undefined): string {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface InternalCourseRef {
  id: string;
  code: string;
  name: string;
  gradeWeights?: unknown;
}

// Matches an external course (Gradescope/Moodle) to an internally tracked one by
// code first (external short names often append section numbers), then by name.
function findInternalCourse(
  external: { shortName?: string | null; name: string },
  internalCourses: InternalCourseRef[] | null | undefined
): InternalCourseRef | null {
  const codeClean = normalizeStr(external.shortName);
  for (const internal of internalCourses ?? []) {
    const intCodeClean = normalizeStr(internal.code);
    if (codeClean && intCodeClean && (codeClean.includes(intCodeClean) || intCodeClean.includes(codeClean))) {
      return internal;
    }
  }
  const nameClean = normalizeStr(external.name);
  for (const internal of internalCourses ?? []) {
    if (nameClean && nameClean === normalizeStr(internal.name)) return internal;
  }
  return null;
}

interface GradeWeightRef {
  category: string;
  weight: number;
}

interface GradedItemRef {
  id: string;
  category: string;
  name: string;
  score: number;
  total: number;
}

function categorizeGradeItem(title: string, categoryHint: string | undefined, gradeWeights: GradeWeightRef[]): string {
  const t = title.toLowerCase();
  if (categoryHint && gradeWeights.length > 0) {
    const hint = normalizeStr(categoryHint);
    const weightMatch = gradeWeights.find(
      (gw) => normalizeStr(gw.category) === hint || hint.includes(normalizeStr(gw.category))
    );
    if (weightMatch) return weightMatch.category;
  }
  if (gradeWeights.length > 0) {
    const match = gradeWeights.find((gw) => {
      const c = gw.category.toLowerCase();
      if (t.includes(c)) return true;
      if (c === "quizzes" && t.includes("quiz")) return true;
      if (c === "tests" && t.includes("test")) return true;
      if (c === "exams" && (t.includes("exam") || t.includes("midterm") || t.includes("final"))) return true;
      if (c === "assignments" && (t.includes("assignment") || t.includes("hw") || t.includes("homework"))) return true;
      if (c === "homework" && (t.includes("hw") || t.includes("assignment"))) return true;
      if (c === "labs" && t.includes("lab")) return true;
      if (c === "projects" && t.includes("project")) return true;
      if ((c === "attendance" || c === "participation") && (t.includes("attendance") || t.includes("participation")))
        return true;
      if (c.endsWith("s") && t.includes(c.slice(0, -1))) return true;
      return false;
    });
    if (match) return match.category;
    if (categoryHint) return categoryHint;
    if (t.includes("attendance") || t.includes("participation")) return "Attendance";
    if (t.includes("quiz")) return "Quizzes";
    if (t.includes("exam")) return "Exams";
    if (t.includes("project")) return "Projects";
    if (t.includes("lab")) return "Labs";
    return gradeWeights[0].category;
  }
  if (categoryHint) return categoryHint;
  if (t.includes("attendance") || t.includes("participation")) return "Attendance";
  if (t.includes("quiz")) return "Quizzes";
  return "Imported";
}

// Upserts a single Moodle grade item into a course's gradedItems, matched by name.
async function updateCourseGrades(
  supabase: SupabaseClient,
  courseId: string,
  title: string,
  score: number,
  total: number,
  categoryHint: string | undefined
): Promise<void> {
  const { data: course } = await supabase
    .from("courses")
    .select("graded_items, grade_weights")
    .eq("id", courseId)
    .single();
  if (!course) return;

  const gradedItems: GradedItemRef[] = Array.isArray(course.graded_items) ? [...course.graded_items] : [];
  const gradeWeights: GradeWeightRef[] = Array.isArray(course.grade_weights) ? course.grade_weights : [];
  const existingIndex = gradedItems.findIndex((i) => i.name === title);

  let changed = false;
  if (existingIndex >= 0) {
    if (gradedItems[existingIndex].score !== score || gradedItems[existingIndex].total !== total) {
      gradedItems[existingIndex] = { ...gradedItems[existingIndex], score, total };
      changed = true;
    }
  } else {
    gradedItems.push({
      id: Math.random().toString(36).slice(2, 9),
      category: categorizeGradeItem(title, categoryHint, gradeWeights),
      name: title,
      score,
      total,
    });
    changed = true;
  }

  if (changed) {
    await supabase.from("courses").update({ graded_items: gradedItems }).eq("id", courseId);
  }
}

// Same logic as scripts/sync.mjs's syncMoodle(), scoped to the user's own
// session client for the instant "Sync now" path.
export async function syncMoodleNow(
  supabase: SupabaseClient,
  ownerId: string,
  encryptionKey: string
): Promise<MoodleSyncResult> {
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("service", "moodle")
    .maybeSingle();

  if (!integration) {
    return { ran: false, synced: 0 };
  }

  try {
    const token = decrypt(integration.encrypted_credential, encryptionKey);
    const url = integration.url as string;

    const siteInfo = await moodleRest<{ userid: number }>(url, token, "core_webservice_get_site_info");
    const courses = await moodleRest<{ id: number; fullname: string; shortname: string }[]>(
      url,
      token,
      "core_enrol_get_users_courses",
      { userid: String(siteInfo.userid) }
    );

    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) {
      return { ran: true, synced: 0 };
    }

    const assignParams: Record<string, string> = {};
    courseIds.forEach((id, i) => (assignParams[`courseids[${i}]`] = String(id)));
    const assignData = await moodleRest<{
      courses: { id: number; assignments: { id: number; name: string; duedate: number }[] }[];
    }>(url, token, "mod_assign_get_assignments", assignParams);

    // Figure out which assignments this user has already submitted, so we can
    // auto-complete them even if the user forgot to check them off in Cortex.
    const allAssignmentIds = assignData.courses.flatMap((c) => c.assignments.map((a) => a.id));
    const submittedIds = new Set<number>();
    if (allAssignmentIds.length > 0) {
      const submissionParams: Record<string, string> = {};
      allAssignmentIds.forEach((id, i) => (submissionParams[`assignmentids[${i}]`] = String(id)));
      try {
        const submissionData = await moodleRest<{
          assignments: { assignmentid: number; submissions: { userid: number; status: string }[] }[];
        }>(url, token, "mod_assign_get_submissions", submissionParams);
        for (const a of submissionData.assignments ?? []) {
          for (const s of a.submissions ?? []) {
            if (s.userid === siteInfo.userid && s.status === "submitted") {
              submittedIds.add(a.assignmentid);
            }
          }
        }
      } catch {
        // Non-fatal — just means we won't auto-complete submitted assignments this run.
      }
    }

    const { data: internalCourses } = await supabase
      .from("courses")
      .select("id, code, name")
      .eq("owner_id", ownerId);
    const { data: existingAssignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("owner_id", ownerId);

    // Pull actual grades for any Moodle course we can match to an internal one.
    for (const course of courses) {
      const internalCourse = findInternalCourse({ shortName: course.shortname, name: course.fullname }, internalCourses);
      if (!internalCourse) continue;

      try {
        const gradeData = await moodleRest<{
          usergrades?: {
            gradeitems?: {
              itemtype: string;
              itemname: string;
              iteminstance?: number;
              categoryid?: number;
              graderaw: number | null;
              grademax?: number;
              gradeformatted?: string;
            }[];
          }[];
        }>(url, token, "gradereport_user_get_grade_items", {
          courseid: String(course.id),
          userid: String(siteInfo.userid),
        });
        const gradeItems = gradeData?.usergrades?.[0]?.gradeitems ?? [];

        const categoryMap = new Map<number, string>();
        for (const item of gradeItems) {
          if (item.itemtype === "category" && item.iteminstance) {
            const name = item.itemname ? item.itemname.replace(/ total$/i, "").trim() : "";
            if (name && name !== "Course") categoryMap.set(item.iteminstance, name);
          }
        }

        for (const item of gradeItems) {
          if (item.itemtype === "category" || item.itemtype === "course") continue;
          const hasRawGrade = item.graderaw !== null && item.graderaw !== undefined;
          if (!hasRawGrade || item.gradeformatted === "-") continue;
          const rawScore = Number(item.graderaw);
          if (Number.isNaN(rawScore)) continue;
          const maxScore = item.grademax && item.grademax > 0 ? item.grademax : 100;
          const categoryHint = item.categoryid ? categoryMap.get(item.categoryid) : undefined;
          await updateCourseGrades(supabase, internalCourse.id, item.itemname, rawScore, maxScore, categoryHint);
        }
      } catch {
        // Non-fatal — just means grades won't refresh for this course this run.
      }
    }

    let synced = 0;

    for (const course of assignData.courses ?? []) {
      const moodleCourse = courses.find((c) => c.id === course.id);
      const internalCourse = moodleCourse
        ? findInternalCourse({ shortName: moodleCourse.shortname, name: moodleCourse.fullname }, internalCourses)
        : null;

      for (const assignment of course.assignments ?? []) {
        if (!assignment.duedate) continue;
        const deadline = new Date(assignment.duedate * 1000);
        const submitted = submittedIds.has(assignment.id);

        const existing = existingAssignments?.find((a) => a.moodle_id === String(assignment.id));
        if (existing) {
          const patch: Record<string, unknown> = {};
          if (new Date(existing.deadline).getTime() !== deadline.getTime()) {
            patch.deadline = deadline.toISOString();
          }
          // Never un-complete something the user already marked done manually.
          if (submitted && existing.status !== "completed") {
            patch.status = "completed";
            patch.completed_at = new Date().toISOString();
          }
          // A course added after this assignment was first synced — link it up now.
          if (!existing.course_id && internalCourse) {
            patch.course_id = internalCourse.id;
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from("assignments").update(patch).eq("id", existing.id);
          }
          continue;
        }

        await supabase.from("assignments").insert({
          owner_id: ownerId,
          title: assignment.name,
          course_id: internalCourse?.id ?? null,
          deadline: deadline.toISOString(),
          status: submitted ? "completed" : "not_started",
          completed_at: submitted ? new Date().toISOString() : null,
          category: "assignment",
          source: "moodle",
          moodle_id: String(assignment.id),
          notes: moodleCourse ? `Imported from Moodle (${moodleCourse.fullname})` : "Imported from Moodle",
        });
        synced++;
      }
    }

    return { ran: true, synced };
  } catch (e) {
    return { ran: true, synced: 0, error: (e as Error).message };
  }
}
