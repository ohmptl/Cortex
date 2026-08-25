"use client";

import { useState } from "react";
import type { CourseFormData } from "@/types/course";
import { DEFAULT_COURSE_COLORS } from "@/types/course";

interface CourseFormProps {
  onSubmit: (form: CourseFormData) => Promise<void>;
}

export function CourseForm({ onSubmit }: CourseFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [instructor, setInstructor] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_COURSE_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || !name.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        code: code.trim(),
        name: name.trim(),
        color,
        instructor: instructor.trim() || null,
      });
      setCode("");
      setName("");
      setInstructor("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Code (e.g. CS 301)"
        className="w-36 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Course name"
        className="min-w-[160px] flex-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />
      <input
        value={instructor}
        onChange={(e) => setInstructor(e.target.value)}
        placeholder="Instructor (optional)"
        className="w-40 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />
      <div className="flex items-center gap-1">
        {DEFAULT_COURSE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="h-6 w-6 rounded-full"
            style={{
              backgroundColor: c,
              outline: color === c ? "2px solid var(--text)" : "none",
              outlineOffset: 2,
            }}
            aria-label={`Choose color ${c}`}
          />
        ))}
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        Add course
      </button>
    </form>
  );
}
