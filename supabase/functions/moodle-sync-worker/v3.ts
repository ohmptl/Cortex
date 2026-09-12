import { syncStepRows } from "./steps.ts";
import {
  adminClient,
  decryptCredential,
  emptyCounts,
  hasServiceRole,
  moodleCall,
} from "../_shared/moodle.ts";
import { MOODLE_SYNC_VERSION } from "../_shared/moodle-values.ts";
import { bootstrap, state, grades, StatePage, type Ctx } from "./engine.ts";

type Task = Omit<
  Ctx,
  "client" | "call" | "baseUrl" | "token" | "userId" | "allowed" | "optional"
>;
function check(result: { error: unknown }) {
  if (result.error) throw result.error;
}
async function process(
  client: ReturnType<typeof adminClient>,
  workerToken: string,
  task: Task,
) {
  const deadline = Date.now() + 85000;
  const started = new Date().toISOString(),
    counts = emptyCounts(),
    failures: Ctx["optional"] = [];
  check(
    await client
      .from("sync_runs")
      .update({
        status: "running",
        started_at: started,
        heartbeat_at: started,
        worker_version: MOODLE_SYNC_VERSION,
      })
      .eq("id", task.sync_run_id)
      .eq("status", "queued"),
  );
  let credentialToken = "";
  let message: string | null = null,
    page: string[] | null = null;
  try {
    const [connectionResult, credentialResult, capabilityResult] =
      await Promise.all([
        client
          .from("provider_connections")
          .select("base_url,external_user_id,status")
          .eq("id", task.connection_id)
          .single(),
        client
          .from("provider_credentials")
          .select("encrypted_payload")
          .eq("connection_id", task.connection_id)
          .single(),
        client
          .from("provider_capabilities")
          .select("capability_name")
          .eq("connection_id", task.connection_id)
          .eq("available", true),
      ]);
    [connectionResult, credentialResult, capabilityResult].forEach(check);
    const connection = connectionResult.data!,
      credential = credentialResult.data!;
    if (connection.status !== "active")
      throw new Error("Moodle connection is disabled");
    const { token } = await decryptCredential(credential.encrypted_payload);
    credentialToken = token;
    const ctx: Ctx = {
      ...task,
      client,
      call: (url, token, fn, params) =>
        moodleCall(url, token, fn, params, deadline),
      baseUrl: connection.base_url,
      token,
      userId: connection.external_user_id ?? "",
      allowed: new Set(
        (capabilityResult.data ?? []).map((row) => row.capability_name),
      ),
      optional: failures,
    };
    if (task.phase === "bootstrap") await bootstrap(ctx, counts);
    else if (task.phase === "events" || task.phase === "contents")
      await state(ctx, counts);
    else if (task.phase === "grades") await grades(ctx, counts);
    else throw new Error(`Unknown phase ${task.phase}`);
  } catch (error) {
    if (error instanceof StatePage) page = error.written;
    else {
      message =
        error instanceof Error
          ? error.message
          : ((error as { message?: string })?.message ?? "Sync failed");
      if (credentialToken)
        message = message.split(credentialToken).join("[REDACTED]");
      counts.failed++;
    }
  }
  check(
    await client
      .from("sync_run_steps")
      .insert(syncStepRows(task, counts, failures, message, started)),
  );
  check(
    await client.rpc("settle_moodle_task", {
      p_task_id: task.id,
      p_worker_token: workerToken,
      p_status: page ? "queued" : message ? "failed" : "succeeded",
      p_counts: counts,
      p_cursor: page ? { written: page } : {},
      p_error: message,
      p_version: MOODLE_SYNC_VERSION,
    }),
  );
  return {
    task: task.id,
    run: task.sync_run_id,
    phase: task.phase,
    counts,
    error: message,
    checkpoint: Boolean(page),
  };
}

Deno.serve(async (request) => {
  if (!hasServiceRole(request))
    return new Response("Unauthorized", { status: 401 });
  if (request.method === "GET")
    return Response.json({ workerVersion: MOODLE_SYNC_VERSION });
  const client = adminClient(),
    token = crypto.randomUUID(),
    results = [];
  const body = await request.json().catch(() => ({}));
  const runId =
    typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId)
      ? body.runId
      : null;
  try {
    check(await client.rpc("recover_moodle_sync"));
    const { data, error } = await client.rpc("claim_sync_tasks_for_run", {
      worker_token: token,
      requested_run_id: runId,
      task_limit: 3,
      deadline_tasks_only: false,
    });
    if (error) throw error;
    // One bounded batch: no unattended promises after the Edge response.
    const settled = await Promise.allSettled(
      ((data ?? []) as Task[]).map((task) => process(client, token, task)),
    );
    for (const [index, result] of settled.entries()) {
      if (result.status === "fulfilled") results.push(result.value);
      else {
        const message =
          result.reason instanceof Error
            ? result.reason.message
            : ((result.reason as { message?: string })?.message ??
              "Task settlement failed");
        // Even a diagnostic-write failure must release the task or leave a
        // concrete error explaining why lease recovery is required.
        const fallback = await client.rpc("settle_moodle_task", {
          p_task_id: data![index].id,
          p_worker_token: token,
          p_status: "failed",
          p_counts: { ...emptyCounts(), failed: 1 },
          p_cursor: {},
          p_error: message,
          p_version: MOODLE_SYNC_VERSION,
        });
        results.push({
          task: data![index].id,
          error: message,
          settlementError: fallback.error?.message ?? null,
        });
      }
    }
    const { count, error: pendingError } = await client
      .from("sync_tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"])
      .match(runId ? { sync_run_id: runId } : {});
    if (pendingError) throw pendingError;
    const { count: deadlineCount, error: deadlineError } = await client
      .from("sync_tasks")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"])
      .in("phase", ["bootstrap", "contents", "events"])
      .match(runId ? { sync_run_id: runId } : {});
    if (deadlineError) throw deadlineError;
    return Response.json(
      {
        workerVersion: MOODLE_SYNC_VERSION,
        processed: results.length,
        remaining: count ?? 0,
        deadlinesRemaining: deadlineCount ?? 0,
        deadlineFailures: results.filter(
          (result) =>
            result.error ||
            ("phase" in result &&
              result.phase !== "grades" &&
              result.counts.failed > 0),
        ).length,
        results,
      },
      { status: results.some((result) => result.error) ? 500 : 200 },
    );
  } catch (error) {
    return Response.json(
      {
        workerVersion: MOODLE_SYNC_VERSION,
        error:
          error instanceof Error
            ? error.message
            : ((error as { message?: string })?.message ?? "Worker failed"),
        results,
      },
      { status: 500 },
    );
  }
});
