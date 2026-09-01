import { ItemRow } from "@/components/academic/ItemRow";
import { requireAcademicRepository } from "@/domain/auth";
import type { AcademicItem } from "@/domain/types";
import { addCortexDays, formatCortexDate, startOfCortexDay } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const { repository } = await requireAcademicRepository();
  const now = new Date();
  const end = addCortexDays(now, 15);
  const items = await repository.listAcademicItems({ to: end.toISOString() });
  const dayStart = startOfCortexDay(now);
  const dayEnd = addCortexDays(now, 1);
  const incomplete = items.filter((item) => item.status !== "completed" && item.status !== "cancelled");
  const overdue = incomplete.filter((item) => item.dueAt && new Date(item.dueAt) < dayStart);
  const today = incomplete.filter((item) => item.dueAt && new Date(item.dueAt) >= dayStart && new Date(item.dueAt) < dayEnd);
  const upcoming = incomplete.filter((item) => item.dueAt && new Date(item.dueAt) >= dayEnd);

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Agenda / {formatCortexDate(now, { month: "long", day: "numeric" })}</p><h1>Today</h1></div>
        <p className="dek">The work that needs attention now, sourced from Cortex rather than inferred from a single Moodle module.</p>
      </header>
      <AgendaSection number="01" title="Overdue" items={overdue} />
      <AgendaSection number="02" title="Due today" items={today} />
      <AgendaSection number="03" title="Next fourteen days" items={upcoming} />
    </>
  );
}

function AgendaSection({ number, title, items }: { number: string; title: string; items: AcademicItem[] }) {
  return (
    <section className="section">
      <header className="section-heading"><span className="section-number">{number}</span><h2>{title}</h2><p>{items.length.toString().padStart(2, "0")} items</p></header>
      {items.length ? <div className="index-list">{items.map((item) => <ItemRow key={item.id} item={item} />)}</div> : <p className="empty-state">Nothing here.</p>}
    </section>
  );
}
