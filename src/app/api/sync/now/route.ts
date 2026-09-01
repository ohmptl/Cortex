import { NextResponse } from "next/server";
import { requireAcademicRepository } from "@/domain/auth";

export const maxDuration = 60;

export async function POST() {
  try {
    const { repository } = await requireAcademicRepository();
    const runId = await repository.triggerMoodleSync("manual");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    let workerStarted = false;
    if (serviceKey && supabaseUrl) {
      const response = await fetch(`${supabaseUrl}/functions/v1/moodle-sync-worker`, {
        method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ runId }), signal: AbortSignal.timeout(55_000), cache: "no-store",
      });
      workerStarted = response.ok;
    }
    return NextResponse.json({ runId, workerStarted });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue Moodle synchronization" }, { status: 400 });
  }
}
