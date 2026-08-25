import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loginToGradescope } from "@/lib/gradescope/client";
import { encrypt } from "@/lib/crypto";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const encryptionKey = process.env.GRADESCOPE_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json({ error: "Server missing GRADESCOPE_ENCRYPTION_KEY" }, { status: 500 });
  }

  const result = await loginToGradescope(email, password);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const encryptedCredential = encrypt(result.sessionToken, encryptionKey);

  const { error } = await supabase.from("integrations").upsert({
    owner_id: user.id,
    service: "gradescope",
    email,
    encrypted_credential: encryptedCredential,
    last_sync: null,
    token_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, email });
}
