import { mcpResourceUrl } from "./auth";

export function protectedResourceMetadata(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return Response.json({ error: "Supabase OAuth is not configured" }, { status: 503 });
  return Response.json({
    resource: mcpResourceUrl(request.url),
    resource_name: "Cortex Academic Data",
    authorization_servers: [`${supabaseUrl.replace(/\/$/, "")}/auth/v1`],
    bearer_methods_supported: ["header"],
    scopes_supported: ["email", "openid", "profile"],
  }, { headers: { "cache-control": "public, max-age=300" } });
}
