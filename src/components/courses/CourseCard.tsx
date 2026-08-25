"use client";

import type { Assignment } from "@/types/assignment";
import type { Course } from "@/types/course";
import { calculateOverallGrade } from "@/lib/utils/grades";

interface CourseCardProps {
  course: Course;
  assignments: Assignment[];
  onDelete: (id: string) => void;
  onEdit: (course: Course) => void;
}

export function CourseCard({ course, assignments, onDelete, onEdit }: CourseCardProps) {
  const total = assignments.length;
  const done = assignments.filter((a) => a.status === "completed").length;
  const overdue = assignments.filter(
    (a) => a.status !== "completed" && new Date(a.deadline) < new Date()
  ).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const grade = calculateOverallGrade(course);

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <div className="h-1" style={{ backgroundColor: course.color }} />
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <span
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ color: course.color, backgroundColor: `${course.color}20` }}
            >
              {course.code}
            </span>
            <p className="mt-1.5 text-sm font-medium text-text">{course.name}</p>
            {course.instructor && (
              <p className="text-xs text-text-faint">{course.instructor}</p>
            )}
          </div>
          <div className="text-right">
            <span className="text-lg font-semibold" style={{ color: course.color }}>
              {pct}%
            </span>
            {grade !== null && (
              <p className="text-[11px] text-text-faint">grade {grade.toFixed(0)}%</p>
            )}
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: course.color }}
          />
        </div>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-text-muted">
          <span>{total} total</span>
          <span className="text-green">{done} done</span>
          {overdue > 0 && <span className="text-red">{overdue} overdue</span>}
          <button
            onClick={() => onEdit(course)}
            className="ml-auto text-text-faint hover:text-text"
          >
            Edit
          </button>
        </div>
      </div>

      <button
        onClick={() => onDelete(course.id)}
        className="absolute right-2 top-2 text-text-faint opacity-0 transition-opacity hover:text-red group-hover:opacity-100"
        aria-label="Delete course"
      >
        ✕
      </button>
    </div>
  );
}
