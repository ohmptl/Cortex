import { adminClient, hasServiceRole } from "../_shared/moodle.ts";
import { MOODLE_SYNC_VERSION } from "../_shared/moodle-values.ts";

Deno.serve(async (request) => {
  if (!hasServiceRole(request))
    return new Response("Unauthorized", { status: 401 });
  if (request.method === "GET")
    return Response.json({ dispatchVersion: MOODLE_SYNC_VERSION });
  const client = adminClient();
  const recovered = await client.rpc("recover_moodle_sync");
  if (recovered.error)
    return Response.json({ error: recovered.error.message }, { status: 500 });
  const { data: connections, error } = await client
    .from("provider_connections")
    .select("id")
    .eq("provider", "moodle")
    .eq("status", "active");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const queued: string[] = [],
    failures = [];
  for (const connection of connections ?? []) {
    const { data, error } = await client.rpc("enqueue_moodle_sync", {
      p_connection: connection.id,
      p_trigger: "scheduled",
    });
    if (error)
      failures.push({ connectionId: connection.id, error: error.message });
    else if (data) queued.push(data);
  }
  return Response.json(
    { dispatchVersion: MOODLE_SYNC_VERSION, queued, failures },
    { status: failures.length ? 500 : 200 },
  );
});
