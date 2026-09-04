import { createHash, randomBytes } from "node:crypto";

export const PANOPTO_CONNECTOR_TYPE = "panopto" as const;

export function generateConnectorToken(): string {
  return `ctx_panopto_${randomBytes(32).toString("base64url")}`;
}

export function hashConnectorToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function extractBearerToken(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = authorization.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}
