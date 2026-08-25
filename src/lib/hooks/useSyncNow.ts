"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 20; // ~80s before giving up and assuming it's still running

// Drives a "Sync now" button: triggers the GitHub Actions sync workflow, then
// polls the integration's status until last_sync changes (or times out).
export function useSyncNow(lastSync: string | null, checkStatus: () => Promise<void>) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const syncedFromRef = useRef<string | null>(null);
  const pollsRef = useRef(0);

  const triggerSync = useCallback(async () => {
    if (isSyncing) return; // don't queue up duplicate triggers from repeated clicks

    setMessage("Syncing…");
    syncedFromRef.current = lastSync;
    pollsRef.current = 0;

    try {
      const res = await fetch("/api/sync/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        setMessage(data.error || "Failed to start sync");
        return;
      }

      setIsSyncing(true);
    } catch {
      setMessage("Failed to reach the server");
    }
  }, [isSyncing, lastSync]);

  // Poll status while syncing, and stop once last_sync moves past when we started.
  useEffect(() => {
    if (!isSyncing) return;

    const interval = setInterval(async () => {
      pollsRef.current += 1;
      await checkStatus();

      if (pollsRef.current >= MAX_POLLS) {
        setIsSyncing(false);
        setMessage("Still running in the background — check back shortly");
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isSyncing, checkStatus]);

  useEffect(() => {
    if (isSyncing && lastSync && lastSync !== syncedFromRef.current) {
      setIsSyncing(false);
      setMessage("Synced just now");
    }
  }, [lastSync, isSyncing]);

  return { isSyncing, message, triggerSync };
}
