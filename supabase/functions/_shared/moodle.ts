import { createClient } from "jsr:@supabase/supabase-js@2";

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

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
}

export function iso(value: unknown): string | null {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : 0;
  return number > 0 ? new Date(number * 1000).toISOString() : null;
}
