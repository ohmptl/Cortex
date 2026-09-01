import Link from "next/link";
import { requireAcademicRepository } from "@/domain/auth";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const { repository } = await requireAcademicRepository();
  const courses = await repository.listCourses();
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Academic structure</p><h1>Courses</h1></div>
        <p className="dek">Moodle creates and maintains this index through stable course identities. No manual matching is required.</p>
      </header>
      {courses.length ? <div className="course-index">{courses.map((course, index) => (
        <Link href={`/courses/${course.id}`} className="course-entry" key={course.id}>
          <span className="eyebrow">{(index + 1).toString().padStart(2, "0")} / {course.code}</span>
          <h2>{course.name}</h2>
          <p>{course.instructor ?? "Instructor not provided by Moodle"}</p>
          <footer><span>{course.term ?? "Term unavailable"}</span><span>{course.active ? "Active" : "Archived"} →</span></footer>
        </Link>
      ))}</div> : <p className="empty-state">Connect Moodle and run synchronization to populate courses.</p>}
    </>
  );
}
