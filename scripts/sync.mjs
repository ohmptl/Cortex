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
  const key = Buffer.from(base64Key.trim(), "base64");
  const [ivB64, tagB64, dataB64] = encrypted.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(
      "Decryption failed — check that the encryption key GitHub secret exactly matches the one set in Vercel"
    );
  }
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

function normalizeStr(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Matches an external course (Gradescope/Moodle) to an internally tracked one by
// code first (external short names often append section numbers), then by name.
function findInternalCourse(external, internalCourses) {
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

function normalizeCategoryStr(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Guesses which grade-weight category a Moodle grade item belongs to.
function categorizeGradeItem(title, categoryHint, gradeWeights) {
  const t = title.toLowerCase();
  if (categoryHint && gradeWeights.length > 0) {
    const hint = normalizeCategoryStr(categoryHint);
    const weightMatch = gradeWeights.find(
      (gw) => normalizeCategoryStr(gw.category) === hint || hint.includes(normalizeCategoryStr(gw.category))
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
async function updateCourseGrades(courseId, title, score, total, categoryHint) {
  const { data: course } = await supabase
    .from("courses")
    .select("graded_items, grade_weights")
    .eq("id", courseId)
    .single();
  if (!course) return;

  const gradedItems = Array.isArray(course.graded_items) ? [...course.graded_items] : [];
  const gradeWeights = Array.isArray(course.grade_weights) ? course.grade_weights : [];
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

  await supabase
    .from("integrations")
    .update({ syncing: true, last_attempt: new Date().toISOString() })
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "gradescope");

  try {
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
Return ONLY a JSON object: {"assignments": [{"id": "string", "title": "string", "due_date": "ISO 8601 string or null", "submitted": true or false}]}
Include all assignments, whether pending, submitted, or graded. Assume year ${new Date().getFullYear()} if missing from the date.
Set "submitted" to true if the assignment's status column shows it has already been turned in or graded (e.g. a score like "8/10", "Submitted", "Graded"). Set it to false if it shows "No Submission" or is otherwise not turned in.`;

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

      const internalCourse = findInternalCourse({ shortName: course.name, name: course.name }, internalCourses);

      for (const item of parsed) {
        if (!item.due_date) continue;
        const deadline = new Date(item.due_date);
        if (Number.isNaN(deadline.getTime())) continue;

        const existingByGsId = existingAssignments?.find(
          (a) => a.gradescope_id === String(item.id)
        );
        if (existingByGsId) {
          const patch = {};
          if (existingByGsId.title !== item.title) {
            patch.title = item.title;
          }
          if (new Date(existingByGsId.deadline).getTime() !== deadline.getTime()) {
            patch.deadline = deadline.toISOString();
          }
          // Never un-complete something the user already marked done manually.
          if (item.submitted && existingByGsId.status !== "completed") {
            patch.status = "completed";
            patch.completed_at = new Date().toISOString();
          }
          // A course added after this assignment was first synced — link it up now.
          if (!existingByGsId.course_id && internalCourse) {
            patch.course_id = internalCourse.id;
          }
          if (Object.keys(patch).length > 0) {
            await supabase.from("assignments").update(patch).eq("id", existingByGsId.id);
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
          status: item.submitted ? "completed" : "not_started",
          completed_at: item.submitted ? new Date().toISOString() : null,
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
  } finally {
    await supabase
      .from("integrations")
      .update({ syncing: false })
      .eq("owner_id", OWNER_USER_ID)
      .eq("service", "gradescope");
  }
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

  await supabase
    .from("integrations")
    .update({ syncing: true, last_attempt: new Date().toISOString() })
    .eq("owner_id", OWNER_USER_ID)
    .eq("service", "moodle");

  try {
    const token = decrypt(integration.encrypted_credential, MOODLE_ENCRYPTION_KEY);
    const { url } = integration;

    const siteInfo = await moodleRest(url, token, "core_webservice_get_site_info");
    const courses = await moodleRest(url, token, "core_enrol_get_users_courses", {
      userid: String(siteInfo.userid),
    });

    const courseIds = courses.map((c) => c.id);
    if (courseIds.length === 0) {
      console.log("[moodle] no enrolled courses");
      await supabase
        .from("integrations")
        .update({ last_sync: new Date().toISOString() })
        .eq("owner_id", OWNER_USER_ID)
        .eq("service", "moodle");
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

    // Pull actual grades for any Moodle course we can match to an internal one.
    for (const course of courses) {
      const internalCourse = findInternalCourse({ shortName: course.shortname, name: course.fullname }, internalCourses);
      if (!internalCourse) continue;

      try {
        const gradeData = await moodleRest(url, token, "gradereport_user_get_grade_items", {
          courseid: String(course.id),
          userid: String(siteInfo.userid),
        });
        const gradeItems = gradeData?.usergrades?.[0]?.gradeitems ?? [];

        const categoryMap = new Map();
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
          const rawScore = parseFloat(item.graderaw);
          if (Number.isNaN(rawScore)) continue;
          const maxScore = item.grademax && item.grademax > 0 ? item.grademax : 100;
          const categoryHint = item.categoryid ? categoryMap.get(item.categoryid) : undefined;
          await updateCourseGrades(internalCourse.id, item.itemname, rawScore, maxScore, categoryHint);
        }
      } catch (e) {
        console.warn(`[moodle] could not fetch grades for ${course.shortname}:`, e.message);
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

        // Ask Moodle for this user's own submission status (works for students,
        // unlike mod_assign_get_submissions which needs a teacher's viewgrades capability).
        let submitted = false;
        try {
          const submissionStatus = await moodleRest(url, token, "mod_assign_get_submission_status", {
            assignid: String(assignment.id),
            userid: String(siteInfo.userid),
          });
          if (
            submissionStatus?.lastattempt?.submission?.status === "submitted" ||
            submissionStatus?.lastattempt?.graded === true
          ) {
            submitted = true;
          }
        } catch (e) {
          console.warn(`[moodle] could not fetch submission status for assignment ${assignment.id}:`, e.message);
        }

        const existing = existingAssignments?.find(
          (a) => a.moodle_id === String(assignment.id)
        );
        if (existing) {
          const patch = {};
          if (existing.title !== assignment.name) {
            patch.title = assignment.name;
          }
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
          owner_id: OWNER_USER_ID,
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

    await supabase
      .from("integrations")
      .update({ last_sync: new Date().toISOString() })
      .eq("owner_id", OWNER_USER_ID)
      .eq("service", "moodle");

    console.log(`[moodle] synced ${synced} new assignment(s)`);
  } finally {
    await supabase
      .from("integrations")
      .update({ syncing: false })
      .eq("owner_id", OWNER_USER_ID)
      .eq("service", "moodle");
  }
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
