const SECRET_KEY = /(token|authorization|cookie|secret|password|wstoken|sesskey|signature|credential)/i;
const SECRET_QUERY_KEY = /^(wstoken|token|access_token|authorization|signature|sig|key|secret|sesskey)$/i;

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeMoodlePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMoodlePayload);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : sanitizeMoodlePayload(child),
    ]));
  }
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return sanitizeUrl(value);
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(sanitizeMoodlePayload(value))));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
