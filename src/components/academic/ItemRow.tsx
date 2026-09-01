import Link from "next/link";
import type { AcademicItem } from "@/domain/types";

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function ItemRow({ item, showCourse = true }: { item: AcademicItem; showCourse?: boolean }) {
  return (
    <article className="index-row">
      <div className="row-meta">
        <span className="eyebrow">{item.type}</span>
        {item.dueAt ? <time dateTime={item.dueAt}>{dateFormatter.format(new Date(item.dueAt))}</time> : <span>No date</span>}
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
