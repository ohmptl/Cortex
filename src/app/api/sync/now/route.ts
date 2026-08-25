import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncGradescopeNow } from "@/lib/sync/gradescopeSync";
import { syncMoodleNow } from "@/lib/sync/moodleSync";

// Runs the sync inline within the request instead of dispatching a GitHub
// Actions workflow, so a manual "Sync now" click gets an immediate result
// (GitHub Actions runner provisioning alone can take 10-60s+ before the job
// even starts). This always overrides any in-progress background sync.
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const gradescopeKey = process.env.GRADESCOPE_ENCRYPTION_KEY;
  const moodleKey = process.env.MOODLE_ENCRYPTION_KEY;
  if (!gradescopeKey || !moodleKey) {
    return NextResponse.json(
      { error: "Server missing GRADESCOPE_ENCRYPTION_KEY/MOODLE_ENCRYPTION_KEY" },
      { status: 500 }
    );
  }

  await supabase
    .from("integrations")
    .update({ syncing: true, last_attempt: new Date().toISOString() })
    .eq("owner_id", user.id);

  try {
    const [gradescope, moodle] = await Promise.all([
      syncGradescopeNow(supabase, user.id, gradescopeKey, process.env.GEMINI_API_KEY),
      syncMoodleNow(supabase, user.id, moodleKey),
    ]);

    const now = new Date().toISOString();
    if (gradescope.ran && !gradescope.error) {
      await supabase
        .from("integrations")
        .update({ last_sync: now })
        .eq("owner_id", user.id)
        .eq("service", "gradescope");
    }
    if (moodle.ran && !moodle.error) {
      await supabase
        .from("integrations")
        .update({ last_sync: now })
        .eq("owner_id", user.id)
        .eq("service", "moodle");
    }

    return NextResponse.json({ gradescope, moodle });
  } finally {
    await supabase
      .from("integrations")
      .update({ syncing: false })
      .eq("owner_id", user.id);
  }
}
