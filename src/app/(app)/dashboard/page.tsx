"use client";

import { useEffect, useMemo, useState } from "react";
import { useAssignmentStore } from "@/store/assignmentStore";
import { useCourseStore } from "@/store/courseStore";
import { AssignmentRow } from "@/components/assignments/AssignmentRow";
import { AssignmentEditModal } from "@/components/assignments/AssignmentEditModal";
import type { Assignment } from "@/types/assignment";

export default function DashboardPage() {
  const { assignments, loadAssignments, editAssignment, setCompleted, removeAssignment } =
    useAssignmentStore();
  const { courses, loadCourses } = useCourseStore();
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  useEffect(() => {
    loadAssignments();
    loadCourses();
  }, [loadAssignments, loadCourses]);

  const courseById = useMemo(
    () => new Map(courses.map((c) => [c.id, c])),
    [courses]
  );

  const { overdue, dueSoon, later, pending, completed } = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const active = assignments.filter((a) => a.status !== "completed");

    return {
      overdue: active.filter((a) => new Date(a.deadline) < now).length,
      dueSoon: active.filter((a) => {
        const d = new Date(a.deadline);
        return d >= now && d <= weekFromNow;
      }).length,
      later: active.filter((a) => new Date(a.deadline) > weekFromNow).length,
      pending: active.sort(
        (a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      ),
      completed: assignments.filter((a) => a.status === "completed"),
    };
  }, [assignments]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-text">{greeting}</h1>
      <p className="mt-1 text-sm text-text-muted">
        {overdue > 0 ? `${overdue} overdue — get on it!` : "You're all caught up! 🎉"}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <p className="text-2xl font-semibold text-red">{overdue}</p>
          <p className="text-xs text-text-muted">Overdue</p>
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <p className="text-2xl font-semibold text-yellow">{dueSoon}</p>
          <p className="text-xs text-text-muted">Due this week</p>
        </div>
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <p className="text-2xl font-semibold text-green">{later}</p>
          <p className="text-xs text-text-muted">Later</p>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
          Pending ({pending.length})
        </p>
        <div className="flex flex-col gap-1">
          {pending.length === 0 && (
            <p className="py-6 text-center text-sm text-text-faint">
              Nothing due this week 🎉
            </p>
          )}
          {pending.map((a) => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              course={a.courseId ? courseById.get(a.courseId) : undefined}
              onToggleComplete={setCompleted}
              onDelete={removeAssignment}
              onEdit={setEditingAssignment}
            />
          ))}
        </div>
      </div>

      {completed.length > 0 && (
        <div className="mt-6 opacity-65">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">
            Completed ({completed.length})
          </p>
          <div className="flex flex-col gap-1">
            {completed.map((a) => (
              <AssignmentRow
                key={a.id}
                assignment={a}
                course={a.courseId ? courseById.get(a.courseId) : undefined}
                onToggleComplete={setCompleted}
                onDelete={removeAssignment}
                onEdit={setEditingAssignment}
              />
            ))}
          </div>
        </div>
      )}

      <AssignmentEditModal
        assignment={editingAssignment}
        courses={courses}
        onClose={() => setEditingAssignment(null)}
        onSave={editAssignment}
        onDelete={removeAssignment}
      />
    </div>
  );
}
