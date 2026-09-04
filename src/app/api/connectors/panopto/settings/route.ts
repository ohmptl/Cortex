import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function mappingInput(value:unknown):{courseId:string;folderId:string;syncSince:string|null}|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const row=value as Record<string,unknown>,keys=Object.keys(row);
  if(keys.some((key)=>!["courseId","folderId","syncSince"].includes(key)))return null;
  const courseId=row.courseId,folderId=typeof row.folderId==="string"?row.folderId.trim():null,syncSince=row.syncSince;
  if(typeof courseId!=="string"||!uuid.test(courseId)||!folderId||folderId.length>200)return null;
  if(syncSince!==undefined&&syncSince!==null&&(typeof syncSince!=="string"||!/(?:Z|[+-]\d{2}:\d{2})$/.test(syncSince)||!Number.isFinite(Date.parse(syncSince))))return null;
  return {courseId,folderId,syncSince:typeof syncSince==="string"?syncSince:null};
}
async function userId(){const client=await createClient();const{data:{user}}=await client.auth.getUser();return user?.id??null;}

export async function GET(){
  const ownerId=await userId();if(!ownerId)return NextResponse.json({error:"Authentication required"},{status:401});
  const admin=createAdminClient();
  const [credential,mappings]=await Promise.all([
    admin.from("connector_credentials").select("created_at,last_used_at,last_ingest_at").eq("owner_id",ownerId).eq("connector_type","panopto").is("revoked_at",null).maybeSingle(),
    admin.from("course_provider_links").select("course_id,external_id,sync_since").eq("owner_id",ownerId).eq("provider","panopto").eq("link_type","folder"),
  ]);
  if(credential.error||mappings.error)return NextResponse.json({error:"Unable to load connector settings"},{status:503});
  return NextResponse.json({credential:credential.data,mappings:(mappings.data??[]).map((row)=>({courseId:row.course_id,folderId:row.external_id,syncSince:row.sync_since}))},{headers:{"cache-control":"no-store"}});
}

export async function PUT(request:Request){
  const ownerId=await userId();if(!ownerId)return NextResponse.json({error:"Authentication required"},{status:401});
  let json:unknown;try{json=await request.json();}catch{return NextResponse.json({error:"Invalid mapping"},{status:422});}
  const parsed=mappingInput(json);if(!parsed)return NextResponse.json({error:"Invalid mapping"},{status:422});
  const admin=createAdminClient(),{courseId,folderId,syncSince}=parsed;
  const {data:course,error:courseError}=await admin.from("courses").select("id").eq("owner_id",ownerId).eq("id",courseId).maybeSingle();
  if(courseError)return NextResponse.json({error:"Unable to verify course"},{status:503});
  if(!course)return NextResponse.json({error:"Course not found"},{status:404});
  const {data:existing,error:findError}=await admin.from("course_provider_links").select("id").eq("owner_id",ownerId).eq("course_id",courseId).eq("provider","panopto").maybeSingle();
  if(findError)return NextResponse.json({error:"Unable to save mapping"},{status:503});
  const values={owner_id:ownerId,course_id:courseId,connection_id:null,provider:"panopto",link_type:"folder",external_id:folderId,sync_since:syncSince??null};
  const result=existing?await admin.from("course_provider_links").update(values).eq("id",existing.id):await admin.from("course_provider_links").insert(values);
  if(result.error){const conflict=result.error.code==="23505";return NextResponse.json({error:conflict?"Folder is already mapped to another course":"Unable to save mapping"},{status:conflict?409:503});}
  return NextResponse.json({status:"saved"});
}

export async function DELETE(request:Request){
  const ownerId=await userId();if(!ownerId)return NextResponse.json({error:"Authentication required"},{status:401});
  const courseId=new URL(request.url).searchParams.get("courseId");
  if(!courseId||!uuid.test(courseId))return NextResponse.json({error:"Invalid course"},{status:422});
  const {error}=await createAdminClient().from("course_provider_links").delete().eq("owner_id",ownerId).eq("course_id",courseId).eq("provider","panopto");
  if(error)return NextResponse.json({error:"Unable to remove mapping"},{status:503});
  return NextResponse.json({status:"removed"});
}
