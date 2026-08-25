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
