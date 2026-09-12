import type { SyncCounts } from "./engine.ts";
export function syncStepRows(
  task: {
    owner_id: string;
    sync_run_id: string;
    phase: string;
    scope_external_id: string | null;
  },
  counts: SyncCounts,
  failures: Array<{ capability: string; message: string; skipped?: boolean }>,
  error: string | null,
  started: string,
) {
  const base = {
    owner_id: task.owner_id,
    sync_run_id: task.sync_run_id,
    scope_type: task.scope_external_id ? "course" : "connection",
    scope_external_id: task.scope_external_id,
    inserted_count: 0,
    updated_count: 0,
    unchanged_count: 0,
    missing_count: 0,
    started_at: started,
    finished_at: new Date().toISOString(),
  };
  // Every object has the same keys: PostgREST bulk insert otherwise fills omitted
  // NOT NULL counters with null rather than each column's database default.
  return [
    {
      ...base,
      capability_name: task.phase,
      status: error ? "failed" : "succeeded",
      inserted_count: counts.inserted,
      updated_count: counts.updated,
      unchanged_count: counts.unchanged,
      missing_count: counts.missing,
      error_code: error ? "sync_phase_failed" : null,
      error_message: error,
    },
    ...failures.map((failure) => ({
      ...base,
      capability_name: failure.capability,
      status: failure.skipped ? "skipped" : "failed",
      error_code: failure.skipped
        ? "activity_unavailable"
        : "optional_endpoint_failed",
      error_message: failure.message,
    })),
  ];
}
