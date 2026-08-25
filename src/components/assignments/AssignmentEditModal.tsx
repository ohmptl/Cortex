"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { CATEGORIES } from "@/components/assignments/AssignmentForm";
import type { Assignment, AssignmentCategory, AssignmentStatus } from "@/types/assignment";
import type { Course } from "@/types/course";

interface AssignmentEditModalProps {
  assignment: Assignment | null;
  courses: Course[];
  onClose: () => void;
  onSave: (id: string, patch: {
    title: string;
    courseId: string | null;
    deadline: string;
    category: AssignmentCategory;
    status: AssignmentStatus;
    notes: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => void;
}

// yyyy-MM-ddTHH:mm in local time, the format <input type="datetime-local"> expects
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssignmentEditModal({
  assignment,
  courses,
  onClose,
  onSave,
  onDelete,
}: AssignmentEditModalProps) {
  return (
    <Modal open={!!assignment} onClose={onClose} title="Edit assignment">
      {assignment && (
        // key forces a remount (fresh initial state) whenever a different assignment is edited
        <AssignmentEditForm
          key={assignment.id}
          assignment={assignment}
          courses={courses}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Modal>
  );
}

function AssignmentEditForm({
  assignment,
  courses,
  onClose,
  onSave,
  onDelete,
}: {
  assignment: Assignment;
  courses: Course[];
  onClose: () => void;
  onSave: AssignmentEditModalProps["onSave"];
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(assignment.title);
  const [courseId, setCourseId] = useState(assignment.courseId ?? "");
  const [deadline, setDeadline] = useState(toLocalInputValue(assignment.deadline));
  const [category, setCategory] = useState<AssignmentCategory>(assignment.category);
  const [status, setStatus] = useState<AssignmentStatus>(assignment.status);
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim() || !deadline) return;
    setSaving(true);
    try {
      await onSave(assignment.id, {
        title: title.trim(),
        courseId: courseId || null,
        deadline: new Date(deadline).toISOString(),
        category,
        status,
        notes: notes || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />

      <div className="flex gap-2">
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="flex-1 rounded-md border border-border bg-bg px-2 py-2 text-sm text-text outline-none"
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
          className="flex-1 rounded-md border border-border bg-bg px-2 py-2 text-sm text-text outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="flex-1 rounded-md border border-border bg-bg px-2 py-2 text-sm text-text outline-none"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
          className="rounded-md border border-border bg-bg px-2 py-2 text-sm text-text outline-none"
        >
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Notes"
        className="resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-accent-border"
      />

      <div className="mt-1 flex items-center justify-between">
        <button
          onClick={() => {
            onDelete(assignment.id);
            onClose();
          }}
          className="text-xs text-text-faint hover:text-red"
        >
          Delete assignment
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-text-muted">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
