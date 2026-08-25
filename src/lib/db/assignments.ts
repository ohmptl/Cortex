import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Assignment,
  AssignmentCategory,
  AssignmentFormData,
  AssignmentSource,
  AssignmentStatus,
} from "@/types/assignment";

// Shape of a row as it comes back from Postgres (snake_case)
interface AssignmentRow {
  id: string;
  course_id: string | null;
  title: string;
  deadline: string;
  status: AssignmentStatus;
  category: AssignmentCategory;
  tags: string[];
  notes: string | null;
  source: AssignmentSource;
  gradescope_id: string | null;
  gradescope_course_id: string | null;
  moodle_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function rowToAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    title: row.title,
    courseId: row.course_id,
    deadline: row.deadline,
    status: row.status,
    category: row.category,
    tags: row.tags ?? [],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    source: row.source,
    gradescopeId: row.gradescope_id,
    gradescopeCourseId: row.gradescope_course_id,
    moodleId: row.moodle_id,
  };
}

export async function listAssignments(
  supabase: SupabaseClient
): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from("assignments")
    .select("*")
    .order("deadline", { ascending: true });

  if (error) throw error;
  return (data as AssignmentRow[]).map(rowToAssignment);
}

export async function createAssignment(
  supabase: SupabaseClient,
  form: AssignmentFormData
): Promise<Assignment> {
  const { data, error } = await supabase
    .from("assignments")
    .insert({
      title: form.title,
      course_id: form.courseId,
      deadline: form.deadline,
      status: form.status,
      category: form.category,
      tags: form.tags ?? [],
      notes: form.notes ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return rowToAssignment(data as AssignmentRow);
}

export async function updateAssignment(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<AssignmentFormData>
): Promise<Assignment> {
  const { data, error } = await supabase
    .from("assignments")
    .update({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.courseId !== undefined && { course_id: patch.courseId }),
      ...(patch.deadline !== undefined && { deadline: patch.deadline }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.category !== undefined && { category: patch.category }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToAssignment(data as AssignmentRow);
}

// Marks an assignment done/undone, keeping completed_at in sync with status.
export async function setAssignmentCompleted(
  supabase: SupabaseClient,
  id: string,
  completed: boolean
): Promise<Assignment> {
  const { data, error } = await supabase
    .from("assignments")
    .update({
      status: completed ? "completed" : "not_started",
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToAssignment(data as AssignmentRow);
}

export async function deleteAssignment(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) throw error;
}
