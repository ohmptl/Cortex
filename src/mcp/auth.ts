import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { AcademicRepository } from "@/domain/repository";

interface OAuthClaims {
  aud?: string | string[];
  client_id?: string;
  scope?: string;
  exp?: number;
  sub?: string;
}

export interface McpIdentity {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  repository: AcademicRepository;
}

function decodeClaims(token: string): OAuthClaims {
  const segment = token.split(".")[1];
  if (!segment) throw new Error("Access token is not a JWT");
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as OAuthClaims;
}

function normalizeResource(value: string): string {
  return value.replace(/\/$/, "");
}

export function mcpResourceUrl(requestUrl?: string): string {
  if (process.env.MCP_RESOURCE_URL) return normalizeResource(process.env.MCP_RESOURCE_URL);
  if (requestUrl) return normalizeResource(new URL("/api/mcp", requestUrl).toString());
  return "http://localhost:3000/api/mcp";
}

export function allowedMcpOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const sameOrigin = new URL(request.url).origin;
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return origin === sameOrigin || configured.includes(origin);
}

export async function authenticateMcpRequest(request: Request): Promise<McpIdentity> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("A bearer access token is required");
  const token = authorization.slice(7).trim();
  const { data: { user }, error } = await createAdminClient().auth.getUser(token);
  if (error || !user) throw new Error("The access token is invalid or expired");
  const claims = decodeClaims(token);
  if (!claims.client_id) throw new Error("An OAuth-issued access token is required");
  const expectedAudience = mcpResourceUrl(request.url);
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.map(normalizeResource).includes(expectedAudience)) {
    throw new Error("The access token was not issued for this Cortex MCP resource");
  }
  const scopes = claims.scope?.split(/\s+/).filter(Boolean) ?? [];
  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    token, clientId: claims.client_id, scopes, expiresAt: claims.exp,
    repository: new AcademicRepository(client, user.id),
  };
}
