"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useAssignmentStore } from "@/store/assignmentStore";
import { useCourseStore } from "@/store/courseStore";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarPage() {
  const { assignments, loadAssignments } = useAssignmentStore();
  const { courses, loadCourses } = useCourseStore();
  const [month, setMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());

  useEffect(() => {
    loadAssignments();
    loadCourses();
  }, [loadAssignments, loadCourses]);

  const courseById = useMemo(
    () => new Map(courses.map((c) => [c.id, c])),
    [courses]
  );

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month));
    const end = endOfWeek(endOfMonth(month));
    return eachDayOfInterval({ start, end });
  }, [month]);

  const assignmentsByDay = useMemo(() => {
    const map = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const key = format(new Date(a.deadline), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [assignments]);

  const selectedAssignments =
    assignmentsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [];

  return (
    <div className="flex p-6">
      <div className="flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-text">{format(month, "MMMM yyyy")}</h1>
          <div className="flex gap-1">
            <button
              onClick={() => setMonth(subMonths(month, 1))}
              className="rounded-md px-2 py-1 text-sm text-text-muted hover:bg-bg-hover"
            >
              ←
            </button>
            <button
              onClick={() => setMonth(addMonths(month, 1))}
              className="rounded-md px-2 py-1 text-sm text-text-muted hover:bg-bg-hover"
            >
              →
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-faint">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayAssignments = assignmentsByDay.get(key) ?? [];
            const inMonth = isSameMonth(day, month);
            const selected = isSameDay(day, selectedDay);

            return (
              <button
                key={key}
                onClick={() => setSelectedDay(day)}
                className={`flex h-16 flex-col items-center rounded-md border p-1 text-left transition-colors ${
                  selected ? "border-accent-border bg-accent-glow" : "border-transparent hover:bg-bg-hover"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    isToday(day) ? "bg-accent text-white" : inMonth ? "text-text" : "text-text-faint"
                  }`}
                >
                  {format(day, "d")}
                </span>
                {dayAssignments.length > 0 && (
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ml-6 w-64 shrink-0 border-l border-border pl-6">
        <p className="text-sm font-medium text-text">{format(selectedDay, "EEEE, MMM d")}</p>
        <p className="mb-3 text-xs text-text-faint">{selectedAssignments.length} items</p>
        <div className="flex flex-col gap-2">
          {selectedAssignments.map((a) => {
            const course = a.courseId ? courseById.get(a.courseId) : undefined;
            return (
              <div key={a.id} className="rounded-md border border-border bg-bg-elevated p-2">
                <p className="truncate text-sm text-text">{a.title}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  {course && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ color: course.color, backgroundColor: `${course.color}20` }}
                    >
                      {course.code}
                    </span>
                  )}
                  <span className="text-[11px] text-text-faint">
                    {format(new Date(a.deadline), "h:mm a")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
