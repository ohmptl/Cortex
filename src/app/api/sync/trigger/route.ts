import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const STALE_AFTER_MS = 15 * 60 * 1000; // don't re-trigger more than every 15 minutes

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let force = false;
  try {
    const body = await request.json();
    force = !!body?.force;
  } catch {
    // no body — treat as a non-forced (auto, on-visit) trigger
  }

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("service, last_sync")
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ triggered: false, reason: "no integrations connected" });
  }

  const now = Date.now();
  const isStale = integrations.some(
    (i) => !i.last_sync || now - new Date(i.last_sync).getTime() > STALE_AFTER_MS
  );

  if (!force && !isStale) {
    return NextResponse.json({ triggered: false, reason: "recently synced" });
  }

  const pat = process.env.GITHUB_SYNC_PAT;
  const repo = process.env.GITHUB_SYNC_REPO;
  if (!pat || !repo) {
    return NextResponse.json(
      { error: "Server missing GITHUB_SYNC_PAT/GITHUB_SYNC_REPO" },
      { status: 500 }
    );
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/sync.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text();
    return NextResponse.json(
      { error: `GitHub dispatch failed: ${dispatchRes.status} ${text}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ triggered: true });
}
