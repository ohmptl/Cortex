import { adminClient, hasServiceRole } from "../_shared/moodle.ts";

Deno.serve(async (request) => {
  if (!hasServiceRole(request)) return new Response("Unauthorized", { status: 401 });
  const client = adminClient();
  const { data: connections, error } = await client.from("provider_connections").select("id,owner_id")
    .eq("provider", "moodle").eq("status", "active");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const queued: string[] = [];
  for (const connection of connections ?? []) {
    const { data: recent } = await client.from("sync_runs").select("id,status,created_at").eq("connection_id", connection.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const tooRecent = recent && Date.now() - new Date(recent.created_at).getTime() < 15 * 60_000;
    if (recent?.status === "queued" || recent?.status === "running" || tooRecent) continue;
    const { data: run, error: runError } = await client.from("sync_runs").insert({
      owner_id: connection.owner_id, connection_id: connection.id, trigger_type: "scheduled",
    }).select("id").single();
    if (runError) continue;
    await client.from("sync_tasks").insert({ owner_id: connection.owner_id, sync_run_id: run.id, connection_id: connection.id, phase: "bootstrap" });
    queued.push(run.id);
  }
  return Response.json({ queued });
});
