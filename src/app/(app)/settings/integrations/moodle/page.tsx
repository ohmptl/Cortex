import Link from "next/link";
import { MoodleActions } from "@/components/settings/MoodleActions";
import { requireAcademicRepository } from "@/domain/auth";
import { formatCortexDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MoodleSettingsPage() {
  const { repository } = await requireAcademicRepository();
  const connection = await repository.getMoodleStatus();
  const [capabilities, runs] = connection ? await Promise.all([repository.listCapabilities(connection.id), repository.listSyncRuns(20)]) : [[], []];
  const groups = new Map<string, typeof capabilities>();
  for (const capability of capabilities) groups.set(capability.group, [...(groups.get(capability.group) ?? []), capability]);
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">Settings / Integrations</p><h1>Moodle</h1></div>
        <p className="dek">Moodle is authoritative for imported course structure. The live token allowlist controls every optional ingestion phase.</p>
      </header>
      <div className="detail-grid">
        <aside className="detail-rail"><dl>
          <div><dt>Status</dt><dd>{connection?.connected ? "Connected" : "Not connected"}</dd></div>
          <div><dt>Instance</dt><dd>{connection?.baseUrl ?? "—"}</dd></div>
          <div><dt>User</dt><dd>{connection?.username ?? "—"}</dd></div>
          <div><dt>Checked</dt><dd>{connection?.lastCapabilityCheckAt ? formatCortexDateTime(connection.lastCapabilityCheckAt) : "Never"}</dd></div>
        </dl></aside>
        <div className="detail-content">
          <section><h2>Connection</h2><MoodleActions connected={connection?.connected ?? false} /></section>
          {connection && <section><h2>Capability matrix</h2><div className="diagnostic-groups">{[...groups].map(([group, entries]) => <div className="diagnostic-group" key={group}><h3>{group}</h3>{entries.map((entry) => <div className="diagnostic-row" key={entry.name}><span>{entry.name}</span><i className={`status-dot ${entry.available ? "available" : ""}`} aria-label={entry.available ? "Available" : "Unavailable"} /></div>)}</div>)}</div></section>}
          {connection && <section><h2>Recent synchronization</h2>{runs.length ? runs.map((run) => <div className="sync-summary" key={run.id}><strong>{run.status}</strong><span>{run.triggerType}</span><span>{run.inserted} in / {run.updated} up / {run.failed} failed</span><time dateTime={run.createdAt}>{formatCortexDateTime(run.createdAt)}</time></div>) : <p className="empty-state">No synchronization runs yet.</p>}</section>}
          {connection && <section><h2>Raw provenance</h2><p className="dek">Inspect sanitized source records retained by Cortex.</p><Link className="primary-action" href="/settings/integrations/moodle/raw">Open raw record index <span>→</span></Link></section>}
        </div>
      </div>
    </>
  );
}
