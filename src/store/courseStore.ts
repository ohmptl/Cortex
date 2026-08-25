import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import {
  createCourse,
  deleteCourse,
  listCourses,
  updateCourse,
} from "@/lib/db/courses";
import type { Course, CourseFormData } from "@/types/course";

interface CourseStore {
  courses: Course[];
  isLoading: boolean;
  error: string | null;

  loadCourses: () => Promise<void>;
  addCourse: (form: CourseFormData) => Promise<void>;
  pushCourse: (course: Course) => void;
  editCourse: (id: string, patch: Partial<CourseFormData>) => Promise<void>;
  removeCourse: (id: string) => Promise<void>;
}

export const useCourseStore = create<CourseStore>((set, get) => ({
  courses: [],
  isLoading: false,
  error: null,

  loadCourses: async () => {
    set({ isLoading: true, error: null });
    try {
      const courses = await listCourses(createClient());
      set({ courses, isLoading: false });
    } catch (e) {
      set({ error: (e as Error).message, isLoading: false });
    }
  },

  addCourse: async (form) => {
    const created = await createCourse(createClient(), form);
    set({ courses: [...get().courses, created] });
  },

  pushCourse: (course) => {
    set({ courses: [...get().courses, course] });
  },

  editCourse: async (id, patch) => {
    const updated = await updateCourse(createClient(), id, patch);
    set({ courses: get().courses.map((c) => (c.id === id ? updated : c)) });
  },

  removeCourse: async (id) => {
    await deleteCourse(createClient(), id);
    set({ courses: get().courses.filter((c) => c.id !== id) });
  },
}));
