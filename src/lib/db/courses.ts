import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Course,
  CourseFormData,
  GradeWeight,
  GradedItem,
} from "@/types/course";

interface CourseRow {
  id: string;
  code: string;
  name: string;
  color: string;
  instructor: string | null;
  grade_weights: GradeWeight[];
  graded_items: GradedItem[];
  active: boolean;
  created_at: string;
}

function rowToCourse(row: CourseRow): Course {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    color: row.color,
    instructor: row.instructor,
    gradeWeights: row.grade_weights ?? [],
    gradedItems: row.graded_items ?? [],
    active: row.active,
    createdAt: row.created_at,
  };
}

export async function listCourses(supabase: SupabaseClient): Promise<Course[]> {
  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .order("code", { ascending: true });

  if (error) throw error;
  return (data as CourseRow[]).map(rowToCourse);
}

export async function createCourse(
  supabase: SupabaseClient,
  form: CourseFormData
): Promise<Course> {
  const { data, error } = await supabase
    .from("courses")
    .insert({
      code: form.code,
      name: form.name,
      color: form.color,
      instructor: form.instructor ?? null,
      grade_weights: form.gradeWeights ?? [],
      graded_items: form.gradedItems ?? [],
      active: form.active ?? true,
    })
    .select("*")
    .single();

  if (error) throw error;
  return rowToCourse(data as CourseRow);
}

export async function updateCourse(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<CourseFormData>
): Promise<Course> {
  const { data, error } = await supabase
    .from("courses")
    .update({
      ...(patch.code !== undefined && { code: patch.code }),
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.color !== undefined && { color: patch.color }),
      ...(patch.instructor !== undefined && { instructor: patch.instructor }),
      ...(patch.gradeWeights !== undefined && { grade_weights: patch.gradeWeights }),
      ...(patch.gradedItems !== undefined && { graded_items: patch.gradedItems }),
      ...(patch.active !== undefined && { active: patch.active }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return rowToCourse(data as CourseRow);
}

export async function deleteCourse(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throw error;
}
