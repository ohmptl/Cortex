const GRADESCOPE_BASE_URL = "https://www.gradescope.com";

function extractCookie(setCookieHeaders: string[], name: string): string | null {
  for (const header of setCookieHeaders) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function extractAuthenticityToken(html: string): string | null {
  const match = html.match(/name="authenticity_token"\s+value="([^"]+)"/);
  return match ? match[1] : null;
}

// Logs into Gradescope with email/password and returns the session cookie
// value to store (encrypted) for later use by the sync script.
export async function loginToGradescope(
  email: string,
  password: string
): Promise<{ sessionToken: string } | { error: string }> {
  const loginPageRes = await fetch(`${GRADESCOPE_BASE_URL}/login`);
  const loginPageHtml = await loginPageRes.text();
  const authenticityToken = extractAuthenticityToken(loginPageHtml);

  if (!authenticityToken) {
    return { error: "Could not load Gradescope login page" };
  }

  const initialCookies = extractSetCookies(loginPageRes.headers);
  const gsSession = extractCookie(initialCookies, "_gradescope_session");

  const body = new URLSearchParams({
    utf8: "✓",
    authenticity_token: authenticityToken,
    "session[email]": email,
    "session[password]": password,
    "session[remember_me]": "0",
    commit: "Log In",
    "session[remember_me_sso]": "0",
  });

  const loginRes = await fetch(`${GRADESCOPE_BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: gsSession ? `_gradescope_session=${gsSession}` : "",
    },
    body: body.toString(),
    redirect: "manual",
  });

  // A successful login redirects (302) to the dashboard; a failed one re-renders the form (200).
  if (loginRes.status !== 302 && loginRes.status !== 303) {
    return { error: "Invalid Gradescope email or password" };
  }

  const finalCookies = extractSetCookies(loginRes.headers);
  const sessionToken = extractCookie(finalCookies, "_gradescope_session");

  if (!sessionToken) {
    return { error: "Login succeeded but no session cookie was returned" };
  }

  return { sessionToken };
}

export async function verifyGradescopeSession(sessionToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRADESCOPE_BASE_URL}/account`, {
      headers: { Cookie: `_gradescope_session=${sessionToken}` },
      redirect: "manual",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

// `fetch`'s Headers only exposes one Set-Cookie via .get(); getSetCookie() is
// the standard way to read all of them (supported in Node 22+/undici).
function extractSetCookies(headers: Headers): string[] {
  if (typeof (headers as { getSetCookie?: () => string[] }).getSetCookie === "function") {
    return (headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}
