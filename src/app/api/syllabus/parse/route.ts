import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_COURSE_COLORS } from "@/types/course";

// Accepts a syllabus as plain text (client extracts text from the PDF) and
// asks Gemini to pull out the course info, then creates the course.
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
  const prompt = `Extract course information from this syllabus text.
Return ONLY a JSON object: {"code": "e.g. CS 301", "name": "course title", "instructor": "name or null"}.

Syllabus:
${text.slice(0, 50_000)}`;

  let parsed: { code?: string; name?: string; instructor?: string | null };
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

  const { data, error } = await supabase
    .from("courses")
    .insert({
      code: parsed.code,
      name: parsed.name,
      color,
      instructor: parsed.instructor ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ course: data });
}
