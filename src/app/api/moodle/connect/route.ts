import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyMoodleToken } from "@/lib/moodle/client";
import { encrypt } from "@/lib/crypto";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { url, username, token } = await request.json();
  if (!url || !username || !token) {
    return NextResponse.json(
      { error: "URL, username, and token are required" },
      { status: 400 }
    );
  }

  const encryptionKey = process.env.MOODLE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json({ error: "Server missing MOODLE_ENCRYPTION_KEY" }, { status: 500 });
  }

  const verified = await verifyMoodleToken(url, token);
  if ("error" in verified) {
    return NextResponse.json({ error: verified.error }, { status: 401 });
  }

  const encryptedCredential = encrypt(token, encryptionKey);

  const { error } = await supabase.from("integrations").upsert({
    owner_id: user.id,
    service: "moodle",
    url,
    username,
    encrypted_credential: encryptedCredential,
    last_sync: null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, url, username });
}
