import { PanoptoActions } from "@/components/settings/PanoptoActions";
import { requireAcademicRepository } from "@/domain/auth";

export const dynamic="force-dynamic";

export default async function PanoptoConnectorSettingsPage(){
  const {repository}=await requireAcademicRepository();
  const courses=await repository.listCourses(true);
  return <>
    <header className="page-header">
      <div><p className="eyebrow">Settings / Integrations</p><h1>Panopto Connector</h1></div>
      <p className="dek">Configure the trusted external worker and map each Cortex course to one Panopto folder. Cortex never receives Panopto credentials.</p>
    </header>
    <div className="detail-grid">
      <aside className="detail-rail"><dl>
        <div><dt>Direction</dt><dd>Inbound push</dd></div>
        <div><dt>Acquisition</dt><dd>External worker</dd></div>
        <div><dt>Storage</dt><dd>Cortex / Supabase</dd></div>
      </dl></aside>
      <div className="detail-content"><section><h2>Machine access</h2><PanoptoActions courses={courses}/></section></div>
    </div>
  </>;
}
