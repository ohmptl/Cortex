"use client";

import { useState } from "react";
import type { AssignmentCategory, AssignmentFormData } from "@/types/assignment";
import type { Course } from "@/types/course";

const CATEGORIES: AssignmentCategory[] = [
  "assignment",
  "homework",
  "quiz",
  "exam",
  "project",
  "lab",
  "discussion",
  "event",
  "other",
];

export { CATEGORIES };

interface AssignmentFormProps {
  courses: Course[];
  onSubmit: (form: AssignmentFormData) => Promise<void>;
}

export function AssignmentForm({ courses, onSubmit }: AssignmentFormProps) {
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  const [deadline, setDeadline] = useState("");
  const [category, setCategory] = useState<AssignmentCategory>("assignment");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !deadline) return;

    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        courseId: courseId || null,
        deadline: new Date(deadline).toISOString(),
        status: "not_started",
        category,
      });
      setTitle("");
      setDeadline("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New assignment…"
        className="min-w-[160px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />
      <select
        value={courseId}
        onChange={(e) => setCourseId(e.target.value)}
        className="rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text outline-none"
      >
        <option value="">No course</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code}
          </option>
        ))}
      </select>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as AssignmentCategory)}
        className="rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text outline-none"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="datetime-local"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        className="rounded-md border border-border bg-bg-elevated px-2 py-2 text-sm text-text outline-none"
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        Add
      </button>
    </form>
  );
}
