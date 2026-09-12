import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptCredential } from "@/lib/crypto";
import { buildCapabilityDiagnostics } from "@/providers/moodle/capabilities";
import {
  normalizeMoodleUrl,
  verifyMoodleToken,
} from "@/providers/moodle/client";

const inputSchema = z
  .object({ url: z.url(), token: z.string().trim().min(1).max(4096) })
  .strict();

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "A valid Moodle URL and token are required" },
      { status: 400 },
    );
  const encryptionKey = process.env.MOODLE_ENCRYPTION_KEY;
  if (!encryptionKey)
    return NextResponse.json(
      { error: "Server credential encryption is not configured" },
      { status: 503 },
    );
  let baseUrl: string;
  try {
    baseUrl = normalizeMoodleUrl(parsed.data.url);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid Moodle URL" },
      { status: 400 },
    );
  }
  const verified = await verifyMoodleToken(baseUrl, parsed.data.token);
  if ("error" in verified)
    return NextResponse.json({ error: verified.error }, { status: 401 });
  const admin = createAdminClient();
  const diagnostics = buildCapabilityDiagnostics(verified.info);
  const encrypted = await encryptCredential(
    { token: parsed.data.token },
    encryptionKey,
  );
  const { data: connectionId, error: connectionError } = await admin.rpc(
    "connect_moodle",
    {
      p_owner: user.id,
      p_site: baseUrl,
      p_user: String(verified.info.userid),
      p_username: verified.info.username ?? null,
      p_display: verified.info.fullname ?? verified.info.sitename ?? null,
      p_encrypted: encrypted,
      p_capabilities: diagnostics,
    },
  );
  if (connectionError)
    return NextResponse.json(
      { error: connectionError.message },
      { status: 500 },
    );
  const { data: runId, error: syncError } = await admin.rpc(
    "enqueue_moodle_sync",
    { p_connection: connectionId, p_trigger: "manual" },
  );
  if (syncError)
    return NextResponse.json({ error: syncError.message }, { status: 500 });
  return NextResponse.json({
    runId,
    success: true,
    connectionId: connectionId,
    siteName: verified.info.sitename ?? null,
    capabilityCount: diagnostics.filter((item) => item.available).length,
  });
}
