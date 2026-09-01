import Link from "next/link";
import type { AcademicItem } from "@/domain/types";
import { formatCortexDateTime } from "@/lib/time";

export function ItemRow({ item, showCourse = true }: { item: AcademicItem; showCourse?: boolean }) {
  return (
    <article className="index-row">
      <div className="row-meta">
        <span className="eyebrow">{item.type}</span>
        {item.dueAt ? <time dateTime={item.dueAt}>{formatCortexDateTime(item.dueAt)}</time> : <span>No date</span>}
      </div>
      <div className="row-main">
        <h3>{item.url ? <Link href={item.url}>{item.title}</Link> : item.title}</h3>
        <p>{showCourse ? item.course?.code ?? "Independent" : item.status.replaceAll("_", " ")}</p>
      </div>
      <div className="row-tail">
        {Object.keys(item.overrides).length > 0 && <span className="provenance-mark">Overridden</span>}
        <span aria-hidden="true">→</span>
      </div>
    </article>
  );
}
