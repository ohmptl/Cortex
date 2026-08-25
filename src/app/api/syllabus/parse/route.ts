import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COURSE_COLORS } from "@/types/course";
import type { AssignmentCategory } from "@/types/assignment";

// Accepts a syllabus as plain text (client extracts text from the PDF) and
// asks Gemini to pull out the course info, grading criteria, and any dated
// assignments/exams, then creates the course (and assignments) directly.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server missing GEMINI_API_KEY" }, { status: 500 });
  }

  const { text } = await request.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "Syllabus text is required" }, { status: 400 });
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `You are a syllabus parser. Extract the following information from this syllabus text.

Return ONLY a JSON object with:
- code: string | null (e.g. "CS 301")
- name: string | null (course title)
- instructor: string | null
- gradeWeights: { category: string, weight: number }[] | null
  - weight is a percentage number (e.g. 20 for 20%)
- assignments: { title: string, date: string, type: string }[] | null
  - extract any exams, midterms, quizzes, or major assignments with specific dates
  - date must be an ISO 8601 date string (estimate year if needed based on the likely current semester)
  - type is one of: "exam", "quiz", "assignment", "project", "other"

IMPORTANT: Return ONLY valid JSON, no markdown.

Syllabus:
${text.slice(0, 50_000)}`;

  let parsed: {
    code?: string;
    name?: string;
    instructor?: string | null;
    gradeWeights?: { category: string; weight: number }[] | null;
    assignments?: { title: string; date: string; type: string }[] | null;
  };
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
    });
    const responseText = response.text ?? "";
    const match = responseText.match(/```json\s*([\s\S]*?)```/) ?? responseText.match(/(\{[\s\S]*\})/);
    parsed = match ? JSON.parse(match[1]) : {};
  } catch (e) {
    return NextResponse.json({ error: `Failed to parse syllabus: ${(e as Error).message}` }, { status: 502 });
  }

  if (!parsed.code || !parsed.name) {
    return NextResponse.json({ error: "Could not extract course code/name from syllabus" }, { status: 422 });
  }

  const color = DEFAULT_COURSE_COLORS[Math.floor(Math.random() * DEFAULT_COURSE_COLORS.length)];

  const { data: course, error } = await supabase
    .from("courses")
    .insert({
      code: parsed.code,
      name: parsed.name,
      color,
      instructor: parsed.instructor ?? null,
      grade_weights: parsed.gradeWeights ?? [],
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let assignmentsAdded = 0;
  for (const item of parsed.assignments ?? []) {
    const deadline = new Date(item.date);
    if (!item.title || Number.isNaN(deadline.getTime())) continue;

    const typeLower = (item.type ?? "").toLowerCase();
    let category: AssignmentCategory = "assignment";
    if (typeLower.includes("exam")) category = "exam";
    else if (typeLower.includes("quiz")) category = "quiz";
    else if (typeLower.includes("project")) category = "project";

    const { error: assignError } = await supabase.from("assignments").insert({
      owner_id: user.id,
      title: item.title,
      course_id: course.id,
      deadline: deadline.toISOString(),
      status: "not_started",
      category,
      source: "manual",
      notes: `Imported from syllabus (${course.code})`,
    });
    if (!assignError) assignmentsAdded++;
  }

  return NextResponse.json({ course, assignmentsAdded });
}

