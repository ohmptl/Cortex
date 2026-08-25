import { create } from "zustand";

interface MoodleState {
  connected: boolean;
  url: string | null;
  username: string | null;
  lastSync: string | null;
  isLoading: boolean;
  error: string | null;

  checkStatus: () => Promise<void>;
  connect: (form: { url: string; username: string; token: string }) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useMoodleStore = create<MoodleState>((set) => ({
  connected: false,
  url: null,
  username: null,
  lastSync: null,
  isLoading: false,
  error: null,

  checkStatus: async () => {
    const res = await fetch("/api/moodle/status");
    const data = await res.json();
    set({
      connected: !!data.connected,
      url: data.url ?? null,
      username: data.username ?? null,
      lastSync: data.lastSync ?? null,
    });
  },

  connect: async (form) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/moodle/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect");
      set({ connected: true, url: data.url, username: data.username, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  disconnect: async () => {
    await fetch("/api/moodle/disconnect", { method: "DELETE" });
    set({ connected: false, url: null, username: null, lastSync: null });
  },
}));
