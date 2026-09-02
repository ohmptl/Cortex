import { ProviderError, redactSecrets } from "../errors.ts";

export class MoodleApiError extends ProviderError {
  constructor(message: string, code: string, retryable = false) {
    const normalized = code === "timeout" ? "PROVIDER_TIMEOUT"
      : code === "invalidtoken" ? "PROVIDER_AUTH_INVALID"
      : code === "accessexception" || code === "nopermissions" ? "PROVIDER_ACCESS_DENIED"
      : code === "invalidrecord" || code === "invalidparameter" ? "PROVIDER_RESPONSE_INVALID"
      : code === "network_error" || code.startsWith("http_5") ? "PROVIDER_UNAVAILABLE"
      : code === "invalidfunction" || code === "servicenotavailable" ? "PROVIDER_FUNCTION_UNAVAILABLE"
      : "PROVIDER_UNAVAILABLE";
    super(normalized, redactSecrets(message), retryable);
    this.name = "MoodleApiError";
  }
}

export interface MoodleSiteInfo {
  userid: number;
  username?: string;
  fullname?: string;
  sitename?: string;
  functions?: Array<{ name: string; version?: string } | string>;
  [key: string]: unknown;
}

export function normalizeMoodleUrl(url: string): string {
  const parsed = new URL(url.trim());
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error("Moodle URL must use HTTPS");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function appendParameter(body: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => appendParameter(body, `${key}[${index}]`, child));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => appendParameter(body, `${key}[${childKey}]`, child));
    return;
  }
  body.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}

export class MoodleClient {
  readonly baseUrl: string;
  private readonly token:string;private readonly timeoutMs:number;

  constructor(baseUrl: string, token: string, timeoutMs = 20_000) {
    this.baseUrl = normalizeMoodleUrl(baseUrl);
    this.token=token;this.timeoutMs=timeoutMs;
    if (!token.trim()) throw new Error("Moodle token is required");
  }

  async call<T>(wsfunction: string, params: Record<string, unknown> = {}, retries = 2): Promise<T> {
    const body = new URLSearchParams({
      wstoken: this.token,
      wsfunction,
      moodlewsrestformat: "json",
    });
    Object.entries(params).forEach(([key, value]) => appendParameter(body, key, value));

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/webservice/rest/server.php`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          if (response.status >= 500 && attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 100));
            continue;
          }
          throw new MoodleApiError(`Moodle returned HTTP ${response.status}`, `http_${response.status}`, response.status >= 500);
        }
        const data: unknown = await response.json();
        if (data && typeof data === "object" && "exception" in data) {
          const fault = data as { errorcode?: string; message?: string; exception?: string };
          throw new MoodleApiError(fault.message ?? fault.exception ?? "Moodle request failed", fault.errorcode ?? "moodle_exception");
        }
        return data as T;
      } catch (error) {
        if (error instanceof MoodleApiError) throw error;
        if (attempt >= retries) {
          const message = error instanceof Error && error.name === "AbortError" ? "Moodle request timed out" : "Moodle request failed";
          throw new MoodleApiError(message, error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error", true);
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt + Math.random() * 100));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  siteInfo() {
    return this.call<MoodleSiteInfo>("core_webservice_get_site_info");
  }

  enrolledCourses(userId: number) {
    return this.call<unknown[]>("core_enrol_get_users_courses", { userid: userId });
  }

  courseContents(courseId: string) {
    return this.call<unknown[]>("core_course_get_contents", { courseid: courseId });
  }

  forums(courseId: string) {
    return this.call<unknown[]>("mod_forum_get_forums_by_courses", { courseids: [courseId] });
  }

  forumDiscussions(forumId: string, perPage = 50) {
    return this.call<Record<string, unknown>>("mod_forum_get_forum_discussions", { forumid: forumId, sortorder: -1, page: 0, perpage: Math.max(1,Math.min(perPage,50)) });
  }

  async downloadFile(fileUrl: string, maxBytes = 25 * 1024 * 1024): Promise<{ bytes: Uint8Array; contentType: string }> {
    const url = new URL(fileUrl);
    const base = new URL(this.baseUrl);
    if (url.origin !== base.origin || !url.pathname.includes("pluginfile.php")) {
      throw new ProviderError("FILE_REFERENCE_INVALID", "Moodle file URL is outside the configured provider");
    }
    url.searchParams.set("token", this.token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store", redirect: "error" });
      if (!response.ok) throw new MoodleApiError(`Moodle file request returned HTTP ${response.status}`, `http_${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new ProviderError("FILE_TOO_LARGE", `File exceeds the ${maxBytes} byte limit`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new ProviderError("FILE_TOO_LARGE", `File exceeds the ${maxBytes} byte limit`);
      return { bytes, contentType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new ProviderError("PROVIDER_TIMEOUT", "Moodle file request timed out", true);
      throw new ProviderError("PROVIDER_UNAVAILABLE", "Unable to retrieve the Moodle file", true);
    } finally { clearTimeout(timeout); }
  }

  actionEventsByTimesort(afterEventId = 0, limit = 50) {
    return this.call<Record<string, unknown>>("core_calendar_get_action_events_by_timesort", {
      timesortfrom: Math.floor(Date.now() / 1000) - 30 * 86400,
      aftereventid: afterEventId,
      limitnum: Math.min(50, Math.max(1, limit)),
    });
  }
}

export async function verifyMoodleToken(url: string, token: string) {
  try {
    const info = await new MoodleClient(url, token).siteInfo();
    return { info } as const;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to verify Moodle token" } as const;
  }
}
