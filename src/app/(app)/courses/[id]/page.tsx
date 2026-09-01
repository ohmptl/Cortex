import { notFound } from "next/navigation";
import { ItemRow } from "@/components/academic/ItemRow";
import { requireAcademicRepository } from "@/domain/auth";

export const dynamic = "force-dynamic";

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { repository } = await requireAcademicRepository();
  const detail = await repository.getCourseDetail(id);
  if (!detail) notFound();
  const categoryById = new Map(detail.categories.map((category) => [category.id, category]));
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">{detail.course.code}</p><h1>{detail.course.name}</h1></div>
        <p className="dek">Course structure, actionable work, resources, and authoritative gradebook context in one provenance-preserving record.</p>
      </header>
      <div className="detail-grid">
        <aside className="detail-rail"><dl>
          <div><dt>Term</dt><dd>{detail.course.term ?? "Not provided"}</dd></div>
          <div><dt>Instructor</dt><dd>{detail.course.instructor ?? "Not provided"}</dd></div>
          <div><dt>Status</dt><dd>{detail.course.active ? "Active" : "Archived"}</dd></div>
          <div><dt>Sections</dt><dd>{detail.sections.length}</dd></div>
          <div><dt>Modules</dt><dd>{detail.modules.length}</dd></div>
        </dl></aside>
        <div className="detail-content">
          <section><h2>Academic items</h2>{detail.items.length ? <div className="index-list">{detail.items.map((item) => <ItemRow key={item.id} item={item} showCourse={false} />)}</div> : <p className="empty-state">No academic items are linked yet.</p>}</section>
          <section><h2>Course structure</h2>{detail.sections.map((section) => <div key={section.id}><p className="eyebrow">{section.name}</p>{detail.modules.filter((module) => module.sectionId === section.id).map((module) => <div className="module-row" key={module.id}><span>{module.title}</span><span>{module.moduleType}</span></div>)}</div>)}</section>
          <section><h2>Gradebook</h2>{detail.grades.length ? detail.grades.map((grade) => <div className="grade-row" key={grade.id}><span>{grade.name}<br /><small>{grade.categoryId ? categoryById.get(grade.categoryId)?.name ?? "Unresolved category" : "No authoritative category"}</small></span><strong>{grade.score ?? "—"}{grade.maximumScore !== null ? ` / ${grade.maximumScore}` : ""}</strong></div>) : <p className="empty-state">No gradebook items are available.</p>}</section>
          <section><h2>Lectures</h2><p className="empty-state">Reserved for the later Panopto transcript and structured-context phase.</p></section>
        </div>
      </div>
    </>
  );
}
