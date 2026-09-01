import Link from "next/link";
import { requireAcademicRepository } from "@/domain/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { repository } = await requireAcademicRepository();
  const moodle = await repository.getMoodleStatus();
  return (
    <>
      <header className="page-header">
        <div><p className="eyebrow">System / Connections</p><h1>Settings</h1></div>
        <p className="dek">Provider connections, capability diagnostics, synchronization history, and remote access.</p>
      </header>
      <dl className="settings-index">
        <dt>Integrations</dt><dd><Link href="/settings/integrations/moodle"><span>Moodle</span><span>{moodle?.connected ? "Connected" : "Not connected"} →</span></Link></dd>
        <dt>Remote access</dt><dd><Link href="/settings/mcp"><span>Model Context Protocol</span><span>Endpoint details →</span></Link></dd>
        <dt>Lectures</dt><dd><span>Panopto integration is reserved for the later lecture phase.</span></dd>
      </dl>
    </>
  );
}
