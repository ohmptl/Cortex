import Link from "next/link";
import { ItemRow } from "@/components/academic/ItemRow";
import { requireAcademicRepository } from "@/domain/auth";
import type { AcademicItem } from "@/domain/types";
import { cortexDateKey, cortexDateTimeToUtc, parseCortexMonth, shiftMonthKey } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { month: requestedMonth } = await searchParams;
  const { year, month } = parseCortexMonth(requestedMonth);
  const start = cortexDateTimeToUtc(year, month, 1);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const end = cortexDateTimeToUtc(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 1);
  const { repository } = await requireAcademicRepository();
  const items = await repository.listAcademicItems({ from: start.toISOString(), to: end.toISOString() });
  const groups = new Map<string, AcademicItem[]>();
  for (const item of items) if (item.dueAt) {
    const key = cortexDateKey(item.dueAt);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const previous = shiftMonthKey(year, month, -1);
  const next = shiftMonthKey(year, month, 1);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 15)));

  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Calendar / Monthly index</p><h1>{monthLabel}</h1></div>
        <div><p className="dek">A chronological view of effective dates, including deliberate Cortex overrides.</p><div className="button-row"><Link className="primary-action" href={`/calendar?month=${previous}`}>← Previous</Link><Link className="primary-action" href={`/calendar?month=${next}`}>Next →</Link></div></div>
      </header>
      <section className="section">
        <header className="section-heading"><span className="section-number">01</span><h2>{year}</h2><p>{items.length.toString().padStart(2, "0")} dated items</p></header>
        {groups.size ? [...groups].map(([date, dayItems]) => {
          const current = new Date(`${date}T12:00:00Z`);
          return <div className="calendar-group" key={date}><time className="calendar-date" dateTime={date}><strong>{current.getUTCDate()}</strong>{current.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</time><div className="calendar-items">{dayItems.map((item) => <ItemRow key={item.id} item={item} />)}</div></div>;
        }) : <p className="empty-state">No dated academic items this month.</p>}
      </section>
    </>
  );
}
