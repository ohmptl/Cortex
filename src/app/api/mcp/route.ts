import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpRequest, allowedMcpOrigin, mcpResourceUrl } from "@/mcp/auth";
import { createCortexMcpServer } from "@/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("origin");
  if (origin) headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", "mcp-protocol-version");
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function unauthorized(request: Request, message: string): Response {
  const resourceMetadata = new URL("/.well-known/oauth-protected-resource/api/mcp", request.url).toString();
  return Response.json({ error: "unauthorized", error_description: message }, {
    status: 401,
    headers: { "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"` },
  });
}

export async function POST(request: Request) {
  if (!allowedMcpOrigin(request)) return Response.json({ error: "Origin is not allowed" }, { status: 403 });
  let identity;
  try { identity = await authenticateMcpRequest(request); }
  catch (error) { return unauthorized(request, error instanceof Error ? error.message : "Authentication failed"); }
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createCortexMcpServer(identity.repository);
  await server.connect(transport);
  const response = await transport.handleRequest(request, {
    authInfo: { token: identity.token, clientId: identity.clientId, scopes: identity.scopes, expiresAt: identity.expiresAt },
  });
  return withCors(response, request);
}

export async function GET() {
  return new Response("Cortex MCP is stateless and does not expose a standalone SSE stream.", { status: 405, headers: { allow: "POST, OPTIONS" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } });
}

export async function OPTIONS(request: Request) {
  if (!allowedMcpOrigin(request)) return new Response(null, { status: 403 });
  const origin = request.headers.get("origin") ?? "null";
  return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
    "access-control-max-age": "86400",
    vary: "Origin",
  } });
}

export function resourceUrlForTests(requestUrl: string) {
  return mcpResourceUrl(requestUrl);
}
