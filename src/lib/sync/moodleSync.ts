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
    const courses = await moodleRest<{ id: number; fullname: string }[]>(
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

    const { data: internalCourses } = await supabase
      .from("courses")
      .select("id, code, name")
      .eq("owner_id", ownerId);
    const { data: existingAssignments } = await supabase
      .from("assignments")
      .select("*")
      .eq("owner_id", ownerId);

    let synced = 0;

    for (const course of assignData.courses ?? []) {
      const moodleCourse = courses.find((c) => c.id === course.id);
      const internalCourse = internalCourses?.find(
        (ic) => moodleCourse && ic.name.toLowerCase() === moodleCourse.fullname?.toLowerCase()
      );

      for (const assignment of course.assignments ?? []) {
        if (!assignment.duedate) continue;
        const deadline = new Date(assignment.duedate * 1000);

        const existing = existingAssignments?.find((a) => a.moodle_id === String(assignment.id));
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
          owner_id: ownerId,
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

    return { ran: true, synced };
  } catch (e) {
    return { ran: true, synced: 0, error: (e as Error).message };
  }
}
