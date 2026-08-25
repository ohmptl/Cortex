import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import {
  createAssignment,
  deleteAssignment,
  listAssignments,
  setAssignmentCompleted,
  updateAssignment,
} from "@/lib/db/assignments";
import type { Assignment, AssignmentFormData } from "@/types/assignment";

interface AssignmentStore {
  assignments: Assignment[];
  isLoading: boolean;
  error: string | null;

  loadAssignments: () => Promise<void>;
  addAssignment: (form: AssignmentFormData) => Promise<void>;
  editAssignment: (id: string, patch: Partial<AssignmentFormData>) => Promise<void>;
  setCompleted: (id: string, completed: boolean) => Promise<void>;
  removeAssignment: (id: string) => Promise<void>;
}

export const useAssignmentStore = create<AssignmentStore>((set, get) => ({
  assignments: [],
  isLoading: false,
  error: null,

  loadAssignments: async () => {
    set({ isLoading: true, error: null });
    try {
      const assignments = await listAssignments(createClient());
      set({ assignments, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  addAssignment: async (form) => {
    const created = await createAssignment(createClient(), form);
    set({ assignments: [...get().assignments, created] });
  },

  editAssignment: async (id, patch) => {
    const updated = await updateAssignment(createClient(), id, patch);
    set({
      assignments: get().assignments.map((a) => (a.id === id ? updated : a)),
    });
  },

  setCompleted: async (id, completed) => {
    const updated = await setAssignmentCompleted(createClient(), id, completed);
    set({
      assignments: get().assignments.map((a) => (a.id === id ? updated : a)),
    });
  },

  removeAssignment: async (id) => {
    await deleteAssignment(createClient(), id);
    set({ assignments: get().assignments.filter((a) => a.id !== id) });
  },
}));
