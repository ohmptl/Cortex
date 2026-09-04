import { createHash } from "node:crypto";
import { z } from "zod";
import { parseTranscript,segmentTranscript,transcriptPlainText } from "./transcripts.ts";

export const MAX_TRANSCRIPT_BYTES=10*1024*1024;
export const DEFAULT_PANOPTO_ORIGIN="https://ncsu.hosted.panopto.com";
const timestampWithZone=/^(?:\d{4}-\d{2}-\d{2})T(?:\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const ingestSchema=z.object({
  provider:z.literal("panopto"),
  courseId:z.string().uuid(),
  providerFolderId:z.string().trim().min(1).max(200),
  providerSessionId:z.string().trim().min(1).max(200),
  title:z.string().trim().min(1).max(500),
  recordedAt:z.string().regex(timestampWithZone).refine((value)=>Number.isFinite(Date.parse(value))),
  durationSeconds:z.number().int().positive().max(86400),
  providerUrl:z.string().url().max(2048),
  transcript:z.object({
    format:z.enum(["srt","webvtt"]),
    language:z.string().trim().min(1).max(35),
    contentHash:z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/),
    content:z.string().min(1),
  }).strict(),
}).strict();

export type PanoptoIngestPayload=z.infer<typeof ingestSchema>;

export class ConnectorPayloadError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="ConnectorPayloadError";}
}

export function validateProviderUrl(value:string,allowedOrigin=process.env.PANOPTO_PROVIDER_ORIGIN??DEFAULT_PANOPTO_ORIGIN):void {
  let url:URL,origin:URL;
  try { url=new URL(value);origin=new URL(allowedOrigin); } catch { throw new ConnectorPayloadError("INVALID_PROVIDER_URL"); }
  if (url.protocol!=="https:"||url.origin!==origin.origin||url.username||url.password)
    throw new ConnectorPayloadError("INVALID_PROVIDER_URL");
  const forbidden=/(?:token|auth|credential|password|signature|apikey|secret|jwt)/i;
  for (const key of url.searchParams.keys()) if (forbidden.test(key.replace(/[^a-z0-9]/gi,""))) throw new ConnectorPayloadError("INVALID_PROVIDER_URL");
}

export function validateIngestPayload(value:unknown,allowedOrigin?:string):PanoptoIngestPayload {
  const parsed=ingestSchema.safeParse(value);
  if (!parsed.success) throw new ConnectorPayloadError("INVALID_PAYLOAD");
  const payload=parsed.data;
  if (Buffer.byteLength(payload.transcript.content,"utf8")>MAX_TRANSCRIPT_BYTES)
    throw new ConnectorPayloadError("TRANSCRIPT_TOO_LARGE");
  validateProviderUrl(payload.providerUrl,allowedOrigin);
  const calculatedHash=createHash("sha256").update(payload.transcript.content,"utf8").digest("hex");
  if (calculatedHash!==payload.transcript.contentHash)
    throw new ConnectorPayloadError("TRANSCRIPT_HASH_MISMATCH");
  return payload;
}

export function prepareIngestPayload(value:unknown,allowedOrigin?:string) {
  const payload=validateIngestPayload(value,allowedOrigin);
  let cues;
  try { cues=parseTranscript(payload.transcript.content,payload.transcript.format); }
  catch { throw new ConnectorPayloadError("MALFORMED_TRANSCRIPT"); }
  return {payload,plainText:transcriptPlainText(cues),segments:segmentTranscript(cues)};
}
