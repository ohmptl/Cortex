"use client";

import { formatDeadline } from "@/lib/utils/deadline";
import type { Assignment } from "@/types/assignment";
import type { Course } from "@/types/course";

const COLOR_VARS: Record<string, string> = {
  red: "var(--red)",
  yellow: "var(--yellow)",
  green: "var(--green)",
  gray: "var(--text-faint)",
};

interface AssignmentRowProps {
  assignment: Assignment;
  course: Course | undefined;
  onToggleComplete: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (assignment: Assignment) => void;
}

export function AssignmentRow({
  assignment,
  course,
  onToggleComplete,
  onDelete,
  onEdit,
}: AssignmentRowProps) {
  const completed = assignment.status === "completed";
  const { primary, secondary, color } = formatDeadline(assignment.deadline, completed);
  const accent = COLOR_VARS[color];

  return (
    <div
      className="group flex items-center gap-3 rounded-md border-l-2 px-3 py-2 hover:bg-bg-hover"
      style={{ borderLeftColor: accent }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />

      <div className="min-w-0 flex-1 cursor-pointer" onClick={() => onEdit(assignment)}>
        <p
          className={`truncate text-sm font-medium ${
            completed ? "text-text-faint line-through" : "text-text"
          }`}
        >
          {assignment.title}
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          {course && (
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ color: course.color, backgroundColor: `${course.color}20` }}
            >
              {course.code}
            </span>
          )}
          <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[11px] text-text-muted">
            {assignment.category}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right font-mono" style={{ minWidth: 90 }}>
        <p className="text-xs" style={{ color: accent }}>
          {primary}
        </p>
        <p className="text-[11px] text-text-faint">{secondary}</p>
      </div>

      <button
        onClick={() => onToggleComplete(assignment.id, !completed)}
        className="h-5 w-5 shrink-0 rounded-full border transition-colors"
        style={{
          borderColor: completed ? "var(--green)" : "var(--border-strong)",
          backgroundColor: completed ? "var(--green)" : "transparent",
        }}
        aria-label={completed ? "Mark as not started" : "Mark as completed"}
      />

      <button
        onClick={() => onDelete(assignment.id)}
        className="shrink-0 text-text-faint opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
        aria-label="Delete assignment"
      >
        ✕
      </button>
    </div>
  );
}
