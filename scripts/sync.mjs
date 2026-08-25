#!/usr/bin/env node
// Gradescope + Moodle sync — run via GitHub Actions (workflow_dispatch),
// triggered by the webapp's /api/sync/trigger route. Single-user: reads
// credentials from the `integrations` table for OWNER_USER_ID and writes
// synced assignments back with the Supabase service-role key (bypasses RLS).

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OWNER_USER_ID,
  GRADESCOPE_ENCRYPTION_KEY,
  MOODLE_ENCRYPTION_KEY,
  GEMINI_API_KEY,
} = process.env;

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

requireEnv("NEXT_PUBLIC_SUPABASE_URL", NEXT_PUBLIC_SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
requireEnv("OWNER_USER_ID", OWNER_USER_ID);

const supabase = createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function decrypt(encrypted, base64Key) {
  const key = Buffer.from(base64Key, "base64");
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function titleSimilarity(a, b) {
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

// ─────────────────────────────────────────────────────────────────────────
// Gradescope
// ─────────────────────────────────────────────────────────────────────────

const GRADESCOPE_BASE_URL = "https://www.gradescope.com";

async function syncGradescope() {
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "gradescope")
    .maybeSingle();

  if (!integration) {
    console.log("[gradescope] not connected, skipping");
    return;
  }

  const sessionToken = decrypt(integration.encrypted_credential, GRADESCOPE_ENCRYPTION_KEY);
  const cookie = `_gradescope_session=${sessionToken}`;

  const accountRes = await fetch(`${GRADESCOPE_BASE_URL}/account`, { headers: { Cookie: cookie } });
  if (accountRes.status !== 200) {
    console.warn("[gradescope] session expired or invalid, skipping");
    return;
  }
  const accountHtml = await accountRes.text();

  const courseMatches = [...accountHtml.matchAll(/href="\/courses\/(\d+)"[^>]*>\s*<h4[^>]*>([^<]+)/g)];
  const courses = courseMatches.map((m) => ({ id: m[1], name: m[2].trim() }));
  console.log(`[gradescope] found ${courses.length} course(s)`);

  const { data: internalCourses } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("owner_id", OWNER_USER_ID);

  const { data: existingAssignments } = await supabase
    .from("assignments")
    .select("*")
    .eq("owner_id", OWNER_USER_ID);

  const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
  let synced = 0;
  let conflicts = 0;

  for (const course of courses) {
    const courseRes = await fetch(`${GRADESCOPE_BASE_URL}/courses/${course.id}`, {
      headers: { Cookie: cookie },
    });
    const courseHtml = await courseRes.text();

    if (!ai) {
      console.log(`[gradescope] no GEMINI_API_KEY set, skipping assignment parsing for ${course.name}`);
      continue;
    }

    const cleanHtml = courseHtml
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .slice(0, 100_000);

    const prompt = `Extract assignments from this Gradescope course page HTML.
Return ONLY a JSON object: {"assignments": [{"id": "string", "title": "string", "due_date": "ISO 8601 string or null"}]}
Include all assignments, whether pending, submitted, or graded. Assume year ${new Date().getFullYear()} if missing from the date.`;

    let parsed = [];
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents: `${prompt}\n\n${cleanHtml}`,
      });
      const text = response.text ?? "";
      const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
      parsed = match ? JSON.parse(match[1]).assignments ?? [] : [];
    } catch (e) {
      console.error(`[gradescope] AI parse failed for ${course.name}:`, e.message);
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

      const existingByGsId = existingAssignments?.find(
        (a) => a.gradescope_id === String(item.id)
      );
      if (existingByGsId) {
        if (new Date(existingByGsId.deadline).getTime() !== deadline.getTime()) {
          await supabase
            .from("assignments")
            .update({ deadline: deadline.toISOString() })
            .eq("id", existingByGsId.id);
        }
        continue;
      }

      // Skip past-due assignments we've never seen before — nothing to act on.
      if (deadline.getTime() < Date.now()) continue;

      const similarManual = existingAssignments?.find(
        (a) =>
          a.source === "manual" &&
          titleSimilarity(a.title, item.title) > 0.8 &&
          Math.abs(new Date(a.deadline).getTime() - deadline.getTime()) < 48 * 60 * 60 * 1000
      );

      if (similarManual) {
        await supabase.from("conflicts").insert({
          owner_id: OWNER_USER_ID,
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
        owner_id: OWNER_USER_ID,
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

  await supabase
    .from("integrations")
    .update({ last_sync: new Date().toISOString() })
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "gradescope");

  console.log(`[gradescope] synced ${synced} new assignment(s), ${conflicts} conflict(s)`);
}

// ─────────────────────────────────────────────────────────────────────────
// Moodle
// ─────────────────────────────────────────────────────────────────────────

async function moodleRest(url, token, wsfunction, params = {}) {
  const query = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: "json", ...params });
  const res = await fetch(`${url.replace(/\/$/, "")}/webservice/rest/server.php?${query}`);
  const data = await res.json();
  if (data?.exception) throw new Error(data.message || data.exception);
  return data;
}

async function syncMoodle() {
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "moodle")
    .maybeSingle();

  if (!integration) {
    console.log("[moodle] not connected, skipping");
    return;
  }

  const token = decrypt(integration.encrypted_credential, MOODLE_ENCRYPTION_KEY);
  const { url } = integration;

  const siteInfo = await moodleRest(url, token, "core_webservice_get_site_info");
  const courses = await moodleRest(url, token, "core_enrol_get_users_courses", {
    userid: String(siteInfo.userid),
  });

  const courseIds = courses.map((c) => c.id);
  if (courseIds.length === 0) {
    console.log("[moodle] no enrolled courses");
    return;
  }

  const assignParams = {};
  courseIds.forEach((id, i) => (assignParams[`courseids[${i}]`] = String(id)));
  const assignData = await moodleRest(url, token, "mod_assign_get_assignments", assignParams);

  const { data: internalCourses } = await supabase
    .from("courses")
    .select("id, code, name")
    .eq("owner_id", OWNER_USER_ID);
  const { data: existingAssignments } = await supabase
    .from("assignments")
    .select("*")
    .eq("owner_id", OWNER_USER_ID);

  let synced = 0;

  for (const course of assignData.courses ?? []) {
    const moodleCourse = courses.find((c) => c.id === course.id);
    const internalCourse = internalCourses?.find(
      (ic) => moodleCourse && ic.name.toLowerCase() === moodleCourse.fullname?.toLowerCase()
    );

    for (const assignment of course.assignments ?? []) {
      if (!assignment.duedate) continue;
      const deadline = new Date(assignment.duedate * 1000);

      const existing = existingAssignments?.find(
        (a) => a.moodle_id === String(assignment.id)
      );
      if (existing) {
        if (new Date(existing.deadline).getTime() !== deadline.getTime()) {
          await supabase
            .from("assignments")
            .update({ deadline: deadline.toISOString() })
            .eq("id", existing.id);
        }
        continue;
      }

      await supabase.from("assignments").insert({
        owner_id: OWNER_USER_ID,
        title: assignment.name,
        course_id: internalCourse?.id ?? null,
        deadline: deadline.toISOString(),
        status: "not_started",
        category: "assignment",
        source: "moodle",
        moodle_id: String(assignment.id),
        notes: moodleCourse ? `Imported from Moodle (${moodleCourse.fullname})` : "Imported from Moodle",
      });
      synced++;
    }
  }

  await supabase
    .from("integrations")
    .update({ last_sync: new Date().toISOString() })
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "moodle");

  console.log(`[moodle] synced ${synced} new assignment(s)`);
}

async function main() {
  console.log("Starting sync…");
  await Promise.allSettled([syncGradescope(), syncMoodle()]).then((results) => {
    for (const r of results) {
      if (r.status === "rejected") console.error("Sync error:", r.reason);
    }
  });
  console.log("Sync complete.");
}

main().catch((e) => {
  console.error("Fatal sync error:", e);
  process.exit(1);
});
