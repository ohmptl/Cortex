import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type JsonObject = Record<string, unknown>;
export type SyncCounts = { inserted: number; updated: number; unchanged: number; missing: number; skipped: number; failed: number };

export const emptyCounts = (): SyncCounts => ({ inserted: 0, updated: 0, unchanged: 0, missing: 0, skipped: 0, failed: 0 });

export function hasServiceRole(request: Request): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const payloadPart = authorization.slice(7).split(".")[1];
  if (!payloadPart) return false;
  try {
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

export async function decryptCredential(encrypted: string): Promise<{ token: string }> {
  const envelope = JSON.parse(encrypted) as { version: number; iv: string; ciphertext: string };
  if (envelope.version !== 1) throw new Error("Unsupported credential format");
  const keyBytes = decodeBase64(Deno.env.get("MOODLE_ENCRYPTION_KEY")!.trim());
  if (keyBytes.length !== 32) throw new Error("MOODLE_ENCRYPTION_KEY must decode to 32 bytes");
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer, "AES-GCM", false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(envelope.iv) }, key, decodeBase64(envelope.ciphertext));
  const payload = JSON.parse(new TextDecoder().decode(clear)) as { token?: string };
  if (!payload.token) throw new Error("Credential does not contain a Moodle token");
  return { token: payload.token };
}

function append(body: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) return value.forEach((child, index) => append(body, `${key}[${index}]`, child));
  if (typeof value === "object") return Object.entries(value as JsonObject).forEach(([child, item]) => append(body, `${key}[${child}]`, item));
  body.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}

export async function moodleCall<T>(baseUrl: string, token: string, fn: string, params: JsonObject = {}): Promise<T> {
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: "json" });
  Object.entries(params).forEach(([key, value]) => append(body, key, value));
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/webservice/rest/server.php`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const error = new Error(`Moodle HTTP ${response.status}`);
        if (response.status < 500 || attempt === 2) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        if (data && typeof data === "object" && data.exception) throw new Error(`${data.errorcode ?? data.exception}: ${data.message ?? "Moodle error"}`);
        return data as T;
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("Moodle transport failure");
      if (/Moodle HTTP [1-4]\d\d/.test(normalized.message) || /:\s/.test(normalized.message) || attempt === 2) throw normalized;
      lastError = normalized;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt + Math.floor(Math.random() * 150)));
  }
  throw lastError ?? new Error("Moodle request failed");
}

const secret = /(token|authorization|cookie|secret|password|wstoken|sesskey|signature|credential)/i;
const secretQuery = /^(token|access_token|wstoken|sesskey|signature|sig|key|secret|authorization)$/i;

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (secretQuery.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonObject).map(([key, child]) => [key, secret.test(key) ? "[redacted]" : sanitize(child)]));
  return typeof value === "string" ? sanitizeUrl(value) : value;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

export async function hashPayload(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(sanitize(value)))));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function upsertRaw(client: SupabaseClient, args: {
  ownerId: string; connectionId: string; runId: string; objectType: string; externalId: string;
  externalCourseId?: string | null; payload: unknown;
}, counts: SyncCounts): Promise<string> {
  const payload = sanitize(args.payload);
  const contentHash = await hashPayload(payload);
  const { data: existing } = await client.from("raw_source_records").select("id,content_hash")
    .eq("connection_id", args.connectionId).eq("object_type", args.objectType).eq("external_id", args.externalId).maybeSingle();
  const now = new Date().toISOString();
  const { data, error } = await client.from("raw_source_records").upsert({
    owner_id: args.ownerId, connection_id: args.connectionId, provider: "moodle", object_type: args.objectType,
    external_id: args.externalId, external_course_id: args.externalCourseId ?? null, payload, content_hash: contentHash,
    upstream_state: "present", last_seen_at: now, fetched_at: now, last_seen_run_id: args.runId,
    missing_since: null, deleted_at: null,
  }, { onConflict: "connection_id,object_type,external_id" }).select("id").single();
  if (error) throw error;
  if (!existing) counts.inserted += 1;
  else if (existing.content_hash === contentHash) counts.unchanged += 1;
  else counts.updated += 1;
  if (!existing || existing.content_hash !== contentHash) {
    const { error: versionError } = await client.from("raw_source_record_versions").upsert({
      owner_id: args.ownerId, raw_source_record_id: data.id, sync_run_id: args.runId, content_hash: contentHash, payload,
    }, { onConflict: "raw_source_record_id,content_hash" });
    if (versionError) throw versionError;
  }
  return data.id as string;
}

export async function sourceTarget(client: SupabaseClient, args: {
  ownerId: string; connectionId: string; objectType: string; externalId: string; externalCourseId?: string | null;
  rawId: string; targetColumn: string; targetId: string;
}) {
  const row: JsonObject = {
    owner_id: args.ownerId, connection_id: args.connectionId, provider: "moodle", object_type: args.objectType,
    external_id: args.externalId, external_course_id: args.externalCourseId ?? null, raw_source_record_id: args.rawId,
    relationship_kind: "authoritative", [args.targetColumn]: args.targetId,
  };
  const { error } = await client.from("source_references").upsert(row, { onConflict: "connection_id,object_type,external_id" });
  if (error) throw error;
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

export function iso(value: unknown): string | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  return number > 0 ? new Date(number * 1000).toISOString() : null;
}
