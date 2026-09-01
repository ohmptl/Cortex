import { mcpResourceUrl } from "@/mcp/auth";

export const dynamic = "force-dynamic";

export default function McpSettingsPage() {
  const endpoint = mcpResourceUrl();
  return (
    <>
      <header className="page-header"><div><p className="eyebrow">Settings / Remote access</p><h1>MCP</h1></div><p className="dek">A client-agnostic Streamable HTTP endpoint over the same normalized Cortex domain used by this interface.</p></header>
      <div className="detail-grid"><aside className="detail-rail"><dl><div><dt>Transport</dt><dd>Streamable HTTP</dd></div><div><dt>Auth</dt><dd>Supabase OAuth 2.1 + PKCE</dd></div><div><dt>Endpoint</dt><dd>{endpoint}</dd></div></dl></aside>
      <div className="detail-content"><section><h2>Access boundary</h2><p className="dek">Read tools expose effective academic data. Write tools create Cortex-owned records or explicit overrides; raw Moodle records remain immutable to clients.</p></section><section><h2>Deployment requirement</h2><p className="dek">Enable Supabase OAuth Server, dynamic client registration, asymmetric signing, the <code>/oauth/consent</code> authorization path, and an access-token hook that sets <code>aud</code> to this endpoint.</p></section></div></div>
    </>
  );
}
