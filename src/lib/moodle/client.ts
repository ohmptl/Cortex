function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function restCall<T>(
  url: string,
  token: string,
  wsfunction: string,
  params: Record<string, string> = {}
): Promise<T> {
  const query = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  });

  const res = await fetch(`${normalizeUrl(url)}/webservice/rest/server.php?${query.toString()}`);
  const data = await res.json();

  if (data?.exception) {
    throw new Error(data.message || data.exception);
  }

  return data as T;
}

// Exchanges a username/password for a persistent web service token, the way
// the Moodle mobile app does (requires the site to enable that service).
export async function obtainMoodleToken(
  url: string,
  username: string,
  password: string
): Promise<{ token: string } | { error: string }> {
  const query = new URLSearchParams({
    username,
    password,
    service: "moodle_mobile_app",
  });

  const res = await fetch(`${normalizeUrl(url)}/login/token.php?${query.toString()}`);
  const data = await res.json();

  if (data?.error) {
    return { error: data.error };
  }
  if (!data?.token) {
    return { error: "Moodle did not return a token" };
  }

  return { token: data.token };
}

export async function verifyMoodleToken(
  url: string,
  token: string
): Promise<{ userId: number; siteName: string } | { error: string }> {
  try {
    const info = await restCall<{ userid: number; sitename: string }>(
      url,
      token,
      "core_webservice_get_site_info"
    );
    return { userId: info.userid, siteName: info.sitename };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
