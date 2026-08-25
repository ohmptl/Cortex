import { create } from "zustand";

interface GradescopeState {
  connected: boolean;
  email: string | null;
  lastSync: string | null;
  syncing: boolean;
  isLoading: boolean;
  error: string | null;

  checkStatus: () => Promise<void>;
  connect: (email: string, password: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useGradescopeStore = create<GradescopeState>((set) => ({
  connected: false,
  email: null,
  lastSync: null,
  syncing: false,
  isLoading: false,
  error: null,

  checkStatus: async () => {
    const res = await fetch("/api/gradescope/status");
    const data = await res.json();
    set({
      connected: !!data.connected,
      email: data.email ?? null,
      lastSync: data.lastSync ?? null,
      syncing: !!data.syncing,
    });
  },

  connect: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/gradescope/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to connect");
      set({ connected: true, email: data.email, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  disconnect: async () => {
    await fetch("/api/gradescope/disconnect", { method: "DELETE" });
    set({ connected: false, email: null, lastSync: null });
  },
}));
