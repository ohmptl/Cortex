import { notFound } from "next/navigation";
import { ItemRow } from "@/components/academic/ItemRow";
import { GradeModelEditor } from "@/components/academic/GradeModelEditor";
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
        <p className="dek">Persistent student state and academic knowledge, with provider-owned course content retrieved live when requested.</p>
      </header>
      <div className="detail-grid">
        <aside className="detail-rail"><dl>
          <div><dt>Term</dt><dd>{detail.course.term ?? "Not provided"}</dd></div>
          <div><dt>Instructor</dt><dd>{detail.course.instructor ?? "Not provided"}</dd></div>
          <div><dt>Status</dt><dd>{detail.course.active ? "Active" : "Archived"}</dd></div>
          <div><dt>Lectures</dt><dd>{detail.lectures.length}</dd></div>
          <div><dt>Notes</dt><dd>{detail.notes.length}</dd></div>
        </dl></aside>
        <div className="detail-content">
          <section><h2>Academic items</h2>{detail.items.length ? <div className="index-list">{detail.items.map((item) => <ItemRow key={item.id} item={item} showCourse={false} />)}</div> : <p className="empty-state">No academic items are linked yet.</p>}</section>
          <section><h2>Gradebook</h2>{detail.grades.length ? detail.grades.map((grade) => <div className="grade-row" key={grade.id}><span>{grade.name}<br /><small>{grade.categoryId ? categoryById.get(grade.categoryId)?.name ?? "Unresolved category" : "No authoritative category"}</small></span><strong>{grade.score ?? "—"}{grade.maximumScore !== null ? ` / ${grade.maximumScore}` : ""}</strong></div>) : <p className="empty-state">No gradebook items are available.</p>}</section>
          <section><h2>Personal grade models</h2>{detail.gradeModels.length ? detail.gradeModels.map((model)=><div className="grade-row" key={model.id}><span>{model.name}</span><strong>{model.isDefault?"Default":"Saved"}</strong></div>):<p className="empty-state">No personal grade model has been saved. Provider truth remains unchanged.</p>}</section>
          <section><h2>Edit personal interpretation</h2><GradeModelEditor courseId={detail.course.id} categories={detail.categories} items={detail.grades}/></section>
          <section><h2>Lectures</h2>{detail.lectures.length?detail.lectures.map((lecture)=><div className="module-row" key={lecture.id}><span>{lecture.title}</span><span>{lecture.transcriptStatus}</span></div>):<p className="empty-state">No Panopto knowledge has been ingested for this course.</p>}</section>
          <section><h2>Notes</h2>{detail.notes.length?detail.notes.map((note)=><div className="module-row" key={note.id}><span>{note.body}</span><span>{note.createdBy}</span></div>):<p className="empty-state">No durable course notes.</p>}</section>
        </div>
      </div>
    </>
  );
}
