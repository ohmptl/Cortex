"use client";

import { useCallback, useState } from "react";

interface SyncNowResult {
  ran: boolean;
  synced: number;
  conflicts?: number;
  error?: string;
}

// Drives a "Sync now" button: runs the sync inline (via /api/sync/now) and
// waits for the real result — no polling needed since it's synchronous.
// Overrides any background (GitHub Actions) sync that might be in progress.
export function useSyncNow(
  service: "gradescope" | "moodle",
  checkStatus: () => Promise<void>
) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const triggerSync = useCallback(async () => {
    if (isSyncing) return;

    setIsSyncing(true);
    setMessage("Syncing…");

    try {
      const res = await fetch("/api/sync/now", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage(data.error || "Failed to sync");
        return;
      }

      const result: SyncNowResult | undefined = data[service];
      if (!result) {
        setMessage("Sync finished");
      } else if (result.error) {
        setMessage(result.error);
      } else if (service === "gradescope") {
        setMessage(`Synced ${result.synced} new, ${result.conflicts ?? 0} conflict(s)`);
      } else {
        setMessage(`Synced ${result.synced} new assignment(s)`);
      }
    } catch {
      setMessage("Failed to reach the server");
    } finally {
      setIsSyncing(false);
      await checkStatus();
    }
  }, [isSyncing, service, checkStatus]);

  return { isSyncing, message, triggerSync };
}
