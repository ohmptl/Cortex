"use client";

import { useState } from "react";
import type { Course } from "@/types/course";

interface SyllabusImportProps {
  onImported: (course: Course) => void;
}

export function SyllabusImport({ onImported }: SyllabusImportProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/syllabus/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse syllabus");
      onImported(data.course);
      setText("");
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text"
      >
        + Add from syllabus
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-bg-elevated p-3">
      <p className="mb-2 text-xs text-text-muted">
        Paste the syllabus text — Gemini will pull out the course code, name, and instructor.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="Paste syllabus text here…"
        className="w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />
      {error && <p className="mt-1 text-xs text-red">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {loading ? "Parsing…" : "Import course"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-1.5 text-xs text-text-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
