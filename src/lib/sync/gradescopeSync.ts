import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { decrypt } from "@/lib/crypto";

const GRADESCOPE_BASE_URL = "https://www.gradescope.com";

function titleSimilarity(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  let matches = 0;
  for (const char of shorter) if (longer.includes(char)) matches++;
  return matches / longer.length;
}

export interface GradescopeSyncResult {
  ran: boolean;
  synced: number;
  conflicts: number;
  error?: string;
}

// Same logic as scripts/sync.mjs's syncGradescope(), but scoped to a single
// user's own session client (RLS-authorized) for the instant "Sync now" path.
export async function syncGradescopeNow(
  supabase: SupabaseClient,
  ownerId: string,
  encryptionKey: string,
  geminiApiKey: string | undefined
): Promise<GradescopeSyncResult> {
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("service", "gradescope")
    .maybeSingle();

  if (!integration) {
    return { ran: false, synced: 0, conflicts: 0 };
  }

  try {
    const sessionToken = decrypt(integration.encrypted_credential, encryptionKey);
    const cookie = `_gradescope_session=${sessionToken}`;

    const accountRes = await fetch(`${GRADESCOPE_BASE_URL}/account`, { headers: { Cookie: cookie } });
    if (accountRes.status !== 200) {
      return { ran: true, synced: 0, conflicts: 0, error: "Gradescope session expired — reconnect in Settings" };
    }
    const accountHtml = await accountRes.text();

    const courseMatches = [...accountHtml.matchAll(/href="\/courses\/(\d+)"[^>]*>\s*<h4[^>]*>([^<]+)/g)];
    const courses = courseMatches.map((m) => ({ id: m[1], name: m[2].trim() }));

    const { data: internalCourses } = await supabase
      .from("courses")
      .select("id, code, name")
      .eq("owner_id", ownerId);

    const { data: existingAssignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("owner_id", ownerId);

    const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;
    let synced = 0;
    let conflicts = 0;

    for (const course of courses) {
      if (!ai) continue;

      const courseRes = await fetch(`${GRADESCOPE_BASE_URL}/courses/${course.id}`, {
        headers: { Cookie: cookie },
      });
      const courseHtml = await courseRes.text();
      const cleanHtml = courseHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .slice(0, 100_000);

      const prompt = `Extract assignments from this Gradescope course page HTML.
Return ONLY a JSON object: {"assignments": [{"id": "string", "title": "string", "due_date": "ISO 8601 string or null"}]}
Include all assignments, whether pending, submitted, or graded. Assume year ${new Date().getFullYear()} if missing from the date.`;

      let parsed: { id: string; title: string; due_date: string | null }[] = [];
      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.7-flash",
          contents: `${prompt}\n\n${cleanHtml}`,
        });
        const text = response.text ?? "";
        const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
        parsed = match ? JSON.parse(match[1]).assignments ?? [] : [];
      } catch {
        continue;
      }

      const internalCourse = internalCourses?.find(
        (ic) =>
          ic.code.toLowerCase().replace(/\s/g, "") === course.name.toLowerCase().replace(/\s/g, "") ||
          course.name.toLowerCase().includes(ic.name.toLowerCase())
      );

      for (const item of parsed) {
        if (!item.due_date) continue;
        const deadline = new Date(item.due_date);
        if (Number.isNaN(deadline.getTime())) continue;

        const existingByGsId = existingAssignments?.find((a) => a.gradescope_id === String(item.id));
        if (existingByGsId) {
          if (new Date(existingByGsId.deadline).getTime() !== deadline.getTime()) {
            await supabase
              .from("assignments")
              .update({ deadline: deadline.toISOString() })
              .eq("id", existingByGsId.id);
          }
          continue;
        }

        if (deadline.getTime() < Date.now()) continue;

        const similarManual = existingAssignments?.find(
          (a) =>
            a.source === "manual" &&
            titleSimilarity(a.title, item.title) > 0.8 &&
            Math.abs(new Date(a.deadline).getTime() - deadline.getTime()) < 48 * 60 * 60 * 1000
        );

        if (similarManual) {
          await supabase.from("conflicts").insert({
            owner_id: ownerId,
            manual_assignment_id: similarManual.id,
            source: "gradescope",
            source_title: item.title,
            source_deadline: deadline.toISOString(),
            source_course_id: course.id,
            source_course_name: course.name,
            source_data: item,
          });
          conflicts++;
          continue;
        }

        await supabase.from("assignments").insert({
          owner_id: ownerId,
          title: item.title,
          course_id: internalCourse?.id ?? null,
          deadline: deadline.toISOString(),
          status: "not_started",
          category: "assignment",
          source: "gradescope",
          gradescope_id: String(item.id),
          gradescope_course_id: course.id,
          notes: `Imported from Gradescope (${course.name})`,
        });
        synced++;
      }
    }

    return { ran: true, synced, conflicts };
  } catch (e) {
    return { ran: true, synced: 0, conflicts: 0, error: (e as Error).message };
  }
}
