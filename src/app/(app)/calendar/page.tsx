import Link from "next/link";
import { ItemRow } from "@/components/academic/ItemRow";
import { requireAcademicRepository } from "@/domain/auth";
import type { AcademicItem } from "@/domain/types";

export const dynamic = "force-dynamic";

function monthBounds(value?: string) {
  const candidate = value && /^\d{4}-\d{2}$/.test(value) ? new Date(`${value}-01T00:00:00`) : new Date();
  const start = new Date(candidate.getFullYear(), candidate.getMonth(), 1);
  const end = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 1);
  return { start, end };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month } = await searchParams;
  const { start, end } = monthBounds(month);
  const { repository } = await requireAcademicRepository();
  const items = await repository.listAcademicItems({ from: start.toISOString(), to: end.toISOString() });
  const groups = new Map<string, AcademicItem[]>();
  for (const item of items) if (item.dueAt) {
    const key = item.dueAt.slice(0, 10);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const previous = new Date(start.getFullYear(), start.getMonth() - 1, 1).toISOString().slice(0, 7);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1).toISOString().slice(0, 7);

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Calendar / Monthly index</p><h1>{start.toLocaleDateString("en-US", { month: "long" })}</h1></div>
        <div><p className="dek">A chronological view of effective dates, including deliberate Cortex overrides.</p><div className="button-row"><Link className="primary-action" href={`/calendar?month=${previous}`}>← Previous</Link><Link className="primary-action" href={`/calendar?month=${next}`}>Next →</Link></div></div>
      </header>
      <section className="section">
        <header className="section-heading"><span className="section-number">01</span><h2>{start.getFullYear()}</h2><p>{items.length.toString().padStart(2, "0")} dated items</p></header>
        {groups.size ? [...groups].map(([date, dayItems]) => {
          const current = new Date(`${date}T12:00:00`);
          return <div className="calendar-group" key={date}><time className="calendar-date" dateTime={date}><strong>{current.getDate()}</strong>{current.toLocaleDateString("en-US", { weekday: "short" })}</time><div className="calendar-items">{dayItems.map((item) => <ItemRow key={item.id} item={item} />)}</div></div>;
        }) : <p className="empty-state">No dated academic items this month.</p>}
      </section>
    </>
  );
}
