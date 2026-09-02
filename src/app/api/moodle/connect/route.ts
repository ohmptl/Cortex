import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptCredential } from "@/lib/crypto";
import { buildCapabilityDiagnostics } from "@/providers/moodle/capabilities";
import { normalizeMoodleUrl, verifyMoodleToken } from "@/providers/moodle/client";

const inputSchema = z.object({ url: z.url(), token: z.string().trim().min(1).max(4096) }).strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A valid Moodle URL and token are required" }, { status: 400 });
  const encryptionKey = process.env.MOODLE_ENCRYPTION_KEY;
  if (!encryptionKey) return NextResponse.json({ error: "Server credential encryption is not configured" }, { status: 503 });
  let baseUrl: string;
  try { baseUrl = normalizeMoodleUrl(parsed.data.url); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Moodle URL" }, { status: 400 }); }
  const verified = await verifyMoodleToken(baseUrl, parsed.data.token);
  if ("error" in verified) return NextResponse.json({ error: verified.error }, { status: 401 });
  const admin = createAdminClient();
  const { data: connection, error: connectionError } = await admin.from("provider_connections").upsert({
    owner_id: user.id, provider: "moodle", instance_key: baseUrl.toLowerCase(), base_url: baseUrl,
    external_user_id: String(verified.info.userid), external_username: verified.info.username ?? null,
    display_name: verified.info.fullname ?? verified.info.sitename ?? null, status: "active",
    last_capability_check_at: new Date().toISOString(),
  }, { onConflict: "owner_id,provider,instance_key" }).select("id").single();
  if (connectionError) return NextResponse.json({ error: connectionError.message }, { status: 500 });
  const encrypted = await encryptCredential({ token: parsed.data.token }, encryptionKey);
  const { error: credentialError } = await admin.from("provider_credentials").upsert({
    connection_id: connection.id, owner_id: user.id, encrypted_payload: encrypted,
    encryption_format: "aes-256-gcm-json-v1", key_version: 1,
  });
  if (credentialError) return NextResponse.json({ error: credentialError.message }, { status: 500 });
  const diagnostics = buildCapabilityDiagnostics(verified.info);
  const { error: capabilityError } = await admin.from("provider_capabilities").upsert(diagnostics.map((capability) => ({
    owner_id: user.id, connection_id: connection.id, capability_name: capability.name,
    diagnostic_group: capability.group, desired: capability.desired, available: capability.available,
  })), { onConflict: "connection_id,capability_name" });
  if (capabilityError) return NextResponse.json({ error: capabilityError.message }, { status: 500 });
  return NextResponse.json({ success: true, connectionId: connection.id, siteName: verified.info.sitename ?? null, capabilityCount: diagnostics.filter((item) => item.available).length });
}
