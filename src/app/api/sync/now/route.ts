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
    let processed = 0;
    let remaining: number | null = null;
    let workerError: string | null = null;
    if (serviceKey && supabaseUrl) {
      const response = await fetch(`${supabaseUrl}/functions/v1/moodle-sync-worker`, {
        method: "POST", headers: { authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
        body: JSON.stringify({ runId }), signal: AbortSignal.timeout(55_000), cache: "no-store",
      });
      workerStarted = response.ok;
      const result = await response.json().catch(() => null) as { processed?: number; remaining?: number; error?: string } | null;
      processed = result?.processed ?? 0;
      remaining = result?.remaining ?? null;
      workerError = result?.error ?? (response.ok ? null : `Worker returned HTTP ${response.status}`);
    }
    return NextResponse.json({ runId, workerStarted, processed, remaining, workerError });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to queue Moodle synchronization" }, { status: 400 });
  }
}
