/** Shared by live reads, snapshot projection and the Edge worker. Never stringify objects as IDs. */
export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

export function normalizeMoodleUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) throw new Error("Moodle URL must use HTTPS");
  if (url.username || url.password) throw new Error("Moodle URL must not contain credentials");
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/+$/, "");
}

export const MOODLE_SYNC_VERSION = "2026-09-12.1";
