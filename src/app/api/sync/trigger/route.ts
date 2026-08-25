import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Debounce for the automatic on-visit trigger. Manual syncs go through
// /api/sync/now instead and don't touch this route at all.
const STALE_AFTER_MS = 5 * 60 * 1000;
// If something crashed mid-sync and never cleared `syncing`, don't let that
// lock out future auto-triggers forever.
const SYNC_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: integrations, error } = await supabase
    .from("integrations")
    .select("service, last_attempt, syncing")
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!integrations || integrations.length === 0) {
    return NextResponse.json({ triggered: false, reason: "no integrations connected" });
  }

  const now = Date.now();

  const alreadySyncing = integrations.some(
    (i) =>
      i.syncing &&
      i.last_attempt &&
      now - new Date(i.last_attempt).getTime() < SYNC_LOCK_TIMEOUT_MS
  );
  if (alreadySyncing) {
    return NextResponse.json({ triggered: false, reason: "sync already in progress" });
  }

  const isStale = integrations.some(
    (i) => !i.last_attempt || now - new Date(i.last_attempt).getTime() > STALE_AFTER_MS
  );
  if (!isStale) {
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

  // Mark as in-progress immediately — the workflow itself will flip `syncing`
  // back to false (and set last_sync) once it actually finishes.
  await supabase
    .from("integrations")
    .update({ syncing: true, last_attempt: new Date().toISOString() })
    .eq("owner_id", user.id);

  return NextResponse.json({ triggered: true });
}
