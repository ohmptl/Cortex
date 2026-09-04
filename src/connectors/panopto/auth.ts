import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractBearerToken,hashConnectorToken,PANOPTO_CONNECTOR_TYPE } from "./token";

export class ConnectorAuthError extends Error {
  readonly status:401|503;readonly code:"UNAUTHORIZED"|"CONNECTOR_AUTH_UNAVAILABLE";
  constructor(status:401|503,code:"UNAUTHORIZED"|"CONNECTOR_AUTH_UNAVAILABLE") {
    super(code);this.status=status;this.code=code;this.name="ConnectorAuthError";
  }
}

export async function authenticatePanoptoConnector(request:Request) {
  const token=extractBearerToken(request.headers.get("authorization"));
  if (!token) throw new ConnectorAuthError(401,"UNAUTHORIZED");
  const admin=createAdminClient();
  const {data,error}=await admin.from("connector_credentials")
    .update({last_used_at:new Date().toISOString()})
    .eq("connector_type",PANOPTO_CONNECTOR_TYPE)
    .eq("token_hash",hashConnectorToken(token)).is("revoked_at",null)
    .select("id,owner_id").maybeSingle();
  if (error) throw new ConnectorAuthError(503,"CONNECTOR_AUTH_UNAVAILABLE");
  if (!data) throw new ConnectorAuthError(401,"UNAUTHORIZED");
  return {admin,credentialId:data.id as string,ownerId:data.owner_id as string};
}
