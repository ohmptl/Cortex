"use client";

import { useEffect, useState } from "react";
import { useCourseStore } from "@/store/courseStore";
import { useAssignmentStore } from "@/store/assignmentStore";
import { CourseForm } from "@/components/courses/CourseForm";
import { CourseCard } from "@/components/courses/CourseCard";
import { SyllabusImport } from "@/components/courses/SyllabusImport";
import { CourseEditModal } from "@/components/courses/CourseEditModal";
import type { Course } from "@/types/course";

export default function CoursesPage() {
  const { courses, loadCourses, addCourse, removeCourse, pushCourse } = useCourseStore();
  const { assignments, loadAssignments } = useAssignmentStore();
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  useEffect(() => {
    loadCourses();
    loadAssignments();
  }, [loadCourses, loadAssignments]);

  // Keep the modal's course in sync with store updates (e.g. after saving a grade)
  const liveEditingCourse = editingCourse
    ? courses.find((c) => c.id === editingCourse.id) ?? null
    : null;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-text">Courses</h1>
      <p className="mt-1 text-sm text-text-muted">{courses.length} courses</p>

      <div className="my-4 flex flex-col gap-3">
        <CourseForm onSubmit={addCourse} />
        <SyllabusImport onImported={pushCourse} onAssignmentsImported={loadAssignments} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            assignments={assignments.filter((a) => a.courseId === course.id)}
            onDelete={removeCourse}
            onEdit={setEditingCourse}
          />
        ))}
      </div>

      <CourseEditModal course={liveEditingCourse} onClose={() => setEditingCourse(null)} />
    </div>
  );
}
