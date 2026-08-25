"use client";

import { useEffect, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAssignmentStore } from "@/store/assignmentStore";
import { useCourseStore } from "@/store/courseStore";

export default function StatisticsPage() {
  const { assignments, loadAssignments } = useAssignmentStore();
  const { courses, loadCourses } = useCourseStore();

  useEffect(() => {
    loadAssignments();
    loadCourses();
  }, [loadAssignments, loadCourses]);

  const stats = useMemo(() => {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const total = assignments.length;
    const completed = assignments.filter((a) => a.status === "completed").length;
    const overdue = assignments.filter(
      (a) => a.status !== "completed" && new Date(a.deadline) < now
    ).length;
    const dueThisWeek = assignments.filter(
      (a) =>
        a.status !== "completed" &&
        new Date(a.deadline) >= now &&
        new Date(a.deadline) <= weekFromNow
    ).length;
    const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { total, completed, overdue, dueThisWeek, completionRate };
  }, [assignments]);

  const courseWorkload = useMemo(
    () =>
      courses.map((c) => {
        const items = assignments.filter((a) => a.courseId === c.id);
        return {
          code: c.code,
          total: items.length,
          done: items.filter((a) => a.status === "completed").length,
          color: c.color,
        };
      }),
    [assignments, courses]
  );

  const categoryBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([category, count]) => ({ category, count }));
  }, [assignments]);

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-text">Statistics</h1>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Completed" value={stats.completed} colorClass="text-green" />
        <StatCard label="Overdue" value={stats.overdue} colorClass="text-red" />
        <StatCard label="Due this week" value={stats.dueThisWeek} colorClass="text-yellow" />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-bg-elevated p-4">
        <p className="mb-1 text-sm font-medium text-text">Completion rate</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${stats.completionRate}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-text-muted">{stats.completionRate}%</p>
      </div>

      {courseWorkload.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-bg-elevated p-4">
          <p className="mb-3 text-sm font-medium text-text">Course workload</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={courseWorkload}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="code" stroke="var(--text-faint)" fontSize={11} />
                <YAxis stroke="var(--text-faint)" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" fill="var(--green)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {categoryBreakdown.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categoryBreakdown.map(({ category, count }) => (
            <div
              key={category}
              className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs"
            >
              <span className="capitalize text-text-muted">{category}</span>{" "}
              <span className="font-semibold text-text">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  colorClass = "text-text",
}: {
  label: string;
  value: number;
  colorClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-elevated p-3">
      <p className={`text-2xl font-semibold ${colorClass}`}>{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  );
}
