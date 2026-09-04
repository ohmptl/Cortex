import { NextResponse } from "next/server";
import { authenticatePanoptoConnector,ConnectorAuthError } from "@/connectors/panopto/auth";
import { ConnectorPayloadError,prepareIngestPayload,validateIngestPayload } from "@/connectors/panopto/contract";

export async function POST(request:Request) {
  try {
    const {admin,credentialId,ownerId}=await authenticatePanoptoConnector(request);
    let body:unknown;
    try { body=await request.json(); } catch { return NextResponse.json({error:"INVALID_PAYLOAD"},{status:422}); }
    const payload=validateIngestPayload(body);

    const {data:course,error:courseError}=await admin.from("courses").select("id,owner_id").eq("id",payload.courseId).maybeSingle();
    if (courseError) return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
    if (!course) return NextResponse.json({error:"COURSE_NOT_FOUND"},{status:404});
    if (course.owner_id!==ownerId) return NextResponse.json({error:"COURSE_FORBIDDEN"},{status:403});
    const {data:mapping,error:mappingError}=await admin.from("course_provider_links").select("id,external_id")
      .eq("owner_id",ownerId).eq("course_id",payload.courseId).eq("provider","panopto")
      .eq("link_type","folder").maybeSingle();
    if (mappingError) return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
    if (!mapping||mapping.external_id!==payload.providerFolderId)
      return NextResponse.json({error:"PANOPTO_MAPPING_MISMATCH"},{status:403});

    const {data:existing,error:existingError}=await admin.from("lectures")
      .select("id")
      .eq("owner_id",ownerId).eq("provider","panopto").eq("provider_session_id",payload.providerSessionId).maybeSingle();
    if(existingError)return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
    const transcriptResult=existing?await admin.from("lecture_transcripts").select("content_hash").eq("owner_id",ownerId).eq("lecture_id",existing.id).maybeSingle():{data:null,error:null};
    if(transcriptResult.error)return NextResponse.json({error:"DATABASE_UNAVAILABLE"},{status:503});
    const transcript=transcriptResult.data;
    const knownTranscript=transcript?.content_hash===payload.transcript.contentHash;
    const prepared=knownTranscript?null:prepareIngestPayload(payload);

    const {data,error}=await admin.rpc("ingest_panopto_lecture",{
      p_owner_id:ownerId,p_course_id:payload.courseId,p_provider_folder_id:payload.providerFolderId,
      p_provider_session_id:payload.providerSessionId,p_title:payload.title,p_recorded_at:payload.recordedAt,
      p_duration_seconds:payload.durationSeconds,p_provider_url:payload.providerUrl,
      p_transcript_format:payload.transcript.format,p_transcript_language:payload.transcript.language,
      p_content_hash:payload.transcript.contentHash,p_raw_content:payload.transcript.content,
      p_plain_text:prepared?.plainText??null,p_segments:prepared?.segments.map((segment)=>({
        segment_key:segment.segmentKey,ordinal:segment.ordinal,start_seconds:segment.startSeconds,
        end_seconds:segment.endSeconds,text:segment.text,
      }))??null,
    });
    if (error) return NextResponse.json({error:"INGESTION_UNAVAILABLE"},{status:503});
    const result=Array.isArray(data)?data[0]:data;
    const status=result?.status;
    if (status!=="created"&&status!=="updated"&&status!=="unchanged")
      return NextResponse.json({error:"INTERNAL_ERROR"},{status:500});
    await admin.from("connector_credentials").update({last_ingest_at:new Date().toISOString()}).eq("id",credentialId);
    return NextResponse.json({status},{status:status==="created"?201:200});
  } catch (error) {
    if (error instanceof ConnectorAuthError) return NextResponse.json({error:error.code},{status:error.status});
    if (error instanceof ConnectorPayloadError) return NextResponse.json({error:error.code},{status:422});
    return NextResponse.json({error:"INTERNAL_ERROR"},{status:500});
  }
}
