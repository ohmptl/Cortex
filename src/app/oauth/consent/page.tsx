import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId) return <main className="login-page"><section className="login-panel"><p className="form-error">The OAuth authorization request is missing its identifier.</p></section></main>;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return <main className="login-page"><section className="login-panel"><p className="form-error">{error?.message ?? "Invalid OAuth authorization request"}</p></section></main>;
  const details = data as unknown as { authorization_id?: string; redirect_url?: string; client?: { name?: string; client_name?: string; redirect_uris?: string[] }; scope?: string };
  if (!details.authorization_id && details.redirect_url) redirect(details.redirect_url);
  const clientName = details.client?.name ?? details.client?.client_name ?? "An MCP client";
  const scopes = (details.scope ?? "email").split(/\s+/).filter(Boolean);
  return (
    <main className="login-page"><section className="login-panel">
      <p className="eyebrow">Remote access request</p><h1>Authorize<span>.</span></h1>
      <p className="dek"><strong>{clientName}</strong> is requesting access to your Cortex academic data and safe Cortex-owned write tools.</p>
      <div className="section"><header className="section-heading"><span className="section-number">01</span><h2>Requested identity scopes</h2></header>{scopes.map((scope) => <div className="module-row" key={scope}><span>{scope}</span><span>Supabase OAuth</span></div>)}</div>
      <p className="form-note">Imported Moodle truth cannot be changed or deleted through MCP. Deadline changes become explicit Cortex overrides.</p>
      <form className="editorial-form" action="/api/oauth/decision" method="post">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <div className="button-row"><button name="decision" value="approve" type="submit">Approve access <span>→</span></button><button name="decision" value="deny" type="submit">Deny</button></div>
      </form>
    </section></main>
  );
}
