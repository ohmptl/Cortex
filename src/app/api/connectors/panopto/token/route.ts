import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateConnectorToken,hashConnectorToken,PANOPTO_CONNECTOR_TYPE } from "@/connectors/panopto/token";

async function userId(){const client=await createClient();const{data:{user}}=await client.auth.getUser();return user?.id??null;}

export async function POST(){
  const ownerId=await userId();if(!ownerId)return NextResponse.json({error:"Authentication required"},{status:401});
  const admin=createAdminClient(),rawToken=generateConnectorToken();
  const {data,error}=await admin.rpc("rotate_connector_credential",{p_owner_id:ownerId,p_connector_type:PANOPTO_CONNECTOR_TYPE,p_token_hash:hashConnectorToken(rawToken)});
  if(error)return NextResponse.json({error:"Unable to create connector token"},{status:503});
  return NextResponse.json({token:rawToken,createdAt:data},{status:201,headers:{"cache-control":"no-store"}});
}

export async function DELETE(){
  const ownerId=await userId();if(!ownerId)return NextResponse.json({error:"Authentication required"},{status:401});
  const {error}=await createAdminClient().rpc("revoke_connector_credential",{p_owner_id:ownerId,p_connector_type:PANOPTO_CONNECTOR_TYPE});
  if(error)return NextResponse.json({error:"Unable to revoke connector token"},{status:503});
  return NextResponse.json({status:"revoked"});
}
