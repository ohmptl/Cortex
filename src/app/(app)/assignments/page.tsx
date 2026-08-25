"use client";

import { useEffect, useMemo, useState } from "react";
import { useAssignmentStore } from "@/store/assignmentStore";
import { useCourseStore } from "@/store/courseStore";
import { AssignmentForm } from "@/components/assignments/AssignmentForm";
import { AssignmentRow } from "@/components/assignments/AssignmentRow";

type Filter = "active" | "week" | "overdue" | "completed";

export default function AssignmentsPage() {
  const { assignments, loadAssignments, addAssignment, setCompleted, removeAssignment } =
    useAssignmentStore();
  const { courses, loadCourses } = useCourseStore();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("active");

  useEffect(() => {
    loadAssignments();
    loadCourses();
  }, [loadAssignments, loadCourses]);

  const courseById = useMemo(
    () => new Map(courses.map((c) => [c.id, c])),
    [courses]
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return assignments
      .filter((a) => a.title.toLowerCase().includes(search.toLowerCase()))
      .filter((a) => {
        const due = new Date(a.deadline);
        switch (filter) {
          case "completed":
            return a.status === "completed";
          case "overdue":
            return a.status !== "completed" && due < now;
          case "week":
            return a.status !== "completed" && due <= weekFromNow;
          case "active":
          default:
            return a.status !== "completed";
        }
      })
      .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  }, [assignments, search, filter]);

  const activeCount = assignments.filter((a) => a.status !== "completed").length;
  const completedCount = assignments.length - activeCount;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Assignments</h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {activeCount} active · {completedCount} completed
          </p>
        </div>
      </div>

      <div className="mb-4">
        <AssignmentForm courses={courses} onSubmit={addAssignment} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text outline-none focus:border-accent-border"
        />
        {(["active", "week", "overdue", "completed"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              filter === f
                ? "bg-accent text-white"
                : "bg-bg-elevated text-text-muted hover:text-text"
            }`}
          >
            {f === "week" ? "This week" : f}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-text-faint">Nothing here 🎉</p>
        )}
        {filtered.map((a) => (
          <AssignmentRow
            key={a.id}
            assignment={a}
            course={a.courseId ? courseById.get(a.courseId) : undefined}
            onToggleComplete={setCompleted}
            onDelete={removeAssignment}
          />
        ))}
      </div>
    </div>
  );
}
