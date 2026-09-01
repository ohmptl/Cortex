import { requireAcademicRepository } from "@/domain/auth";

export const dynamic = "force-dynamic";

export default async function MoodleRawRecordsPage() {
  const { repository } = await requireAcademicRepository();
  const connection = await repository.getMoodleStatus();
  const records = connection ? await repository.listRawSourceRecords(connection.id) : [];
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Moodle / Provenance</p><h1>Raw index</h1></div><p className="dek">Sanitized source records are retained for traceability. Credential-shaped fields are removed before persistence.</p></header>
      <section className="section"><header className="section-heading"><span className="section-number">01</span><h2>Recent records</h2><p>{records.length.toString().padStart(2, "0")} shown</p></header>
        {records.map((record) => <details className="module-row" key={record.id}><summary>{record.objectType} / {record.externalId} <span>{record.upstreamState}</span></summary><pre>{JSON.stringify(record.payload, null, 2)}</pre></details>)}
        {!records.length && <p className="empty-state">No raw records are available.</p>}
      </section>
    </>
  );
}
