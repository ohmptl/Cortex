import { NextResponse } from "next/server";
import { authenticatePanoptoConnector,ConnectorAuthError } from "@/connectors/panopto/auth";

export const dynamic="force-dynamic";

export async function GET(request:Request) {
  try {
    const {admin,ownerId}=await authenticatePanoptoConnector(request);
    const {data,error}=await admin.from("course_provider_links")
      .select("course_id,external_id,sync_since,courses!inner(active)")
      .eq("owner_id",ownerId).eq("provider","panopto").eq("link_type","folder")
      .eq("courses.active",true).order("created_at");
    if (error) return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
    return NextResponse.json({courses:(data??[]).map((row)=>({
      courseId:row.course_id,panoptoFolderId:row.external_id,
      ...(row.sync_since?{syncSince:row.sync_since}:{}),
    }))},{headers:{"cache-control":"no-store"}});
  } catch (error) {
    if (error instanceof ConnectorAuthError) return NextResponse.json({error:error.code},{status:error.status});
    return NextResponse.json({error:"INTERNAL_ERROR"},{status:500});
  }
}
