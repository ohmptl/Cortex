"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function MoodleActions({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/moodle/connect", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: form.get("url"), token: form.get("token") }),
    });
    const body = await response.json() as { error?: string; capabilityCount?: number };
    setBusy(false);
    setMessage(response.ok ? `Connected. ${body.capabilityCount ?? 0} functions are available.` : body.error ?? "Connection failed");
    if (response.ok) router.refresh();
  }

  async function syncNow() {
    setBusy(true); setMessage(null);
    const response = await fetch("/api/sync/now", { method: "POST" });
    const body = await response.json() as { error?: string; workerStarted?: boolean; remaining?: number | null; deadlinesRemaining?: number | null; deadlineFailures?: number; workerError?: string | null };
    setBusy(false);
    if (!response.ok) setMessage(body.error ?? "Unable to queue synchronization");
    else if (!body.workerStarted) setMessage(`Sync could not start${body.workerError ? `: ${body.workerError}` : ". Check the Edge Function deployment and service-role variable."}`);
    else if (body.deadlineFailures) setMessage("Some Moodle deadlines could not be refreshed. Check the recent synchronization result below.");
    else if (body.deadlinesRemaining) setMessage("Moodle is still responding. Deadline refresh will finish automatically shortly.");
    else if (body.remaining) setMessage("Course deadlines are up to date. Grades and resource details are finishing in the background.");
    else setMessage("Moodle courses, deadlines, and completion state are up to date.");
    if (response.ok) router.refresh();
  }

  async function disconnect() {
    setBusy(true); setMessage(null);
    const response = await fetch("/api/moodle/disconnect", { method: "DELETE" });
    setBusy(false);
    setMessage(response.ok ? "Moodle disconnected. Imported records remain available." : "Unable to disconnect Moodle");
    if (response.ok) router.refresh();
  }

  if (connected) return <div className="editorial-form"><div className="button-row"><button type="button" disabled={busy} onClick={syncNow}>Sync now <span>→</span></button><button type="button" disabled={busy} onClick={disconnect}>Disconnect</button></div>{message && <p className="status-line" aria-live="polite">{message}</p>}</div>;

  return (
    <form className="editorial-form" onSubmit={connect}>
      <label>Moodle base URL<input name="url" type="url" required placeholder="https://moodle.example.edu" /></label>
      <label>Web-service token<input name="token" type="password" required autoComplete="off" /></label>
      <p className="form-note">The token is verified server-side, encrypted at rest, and never returned to the browser or stored in synchronization logs.</p>
      <button type="submit" disabled={busy}>{busy ? "Verifying…" : "Connect Moodle"}<span>→</span></button>
      {message && <p className="status-line" aria-live="polite">{message}</p>}
    </form>
  );
}
