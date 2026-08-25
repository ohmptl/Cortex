import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("integrations")
    .select("email, last_sync, syncing, token_expiry")
    .eq("owner_id", user.id)
    .eq("service", "gradescope")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    email: data.email,
    lastSync: data.last_sync,
    syncing: data.syncing,
    tokenExpiry: data.token_expiry,
  });
}
