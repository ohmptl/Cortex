import { createHash } from "node:crypto";

export type TranscriptFormat = "srt" | "webvtt";
export interface CaptionCue { ordinal:number; startSeconds:number; endSeconds:number; text:string }
export interface TranscriptSegment { segmentKey:string; ordinal:number; startSeconds:number; endSeconds:number; text:string }

const TIMING = /^((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/;

function decodeEntities(value: string): string {
  const named: Record<string,string> = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code:string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2),16) : Number.parseInt(code.slice(1),10);
    return Number.isFinite(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function cleanCaptionText(value:string):string {
  return decodeEntities(value.replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
}

function seconds(value:string):number {
  const parts=value.replace(",",".").split(":").map(Number);
  const minutes=parts.at(-2),secondsPart=parts.at(-1);
  if(minutes===undefined||secondsPart===undefined||minutes>=60||secondsPart>=60)throw new Error("MALFORMED_TRANSCRIPT");
  const result=parts.length===3 ? parts[0]*3600+parts[1]*60+parts[2] : parts[0]*60+parts[1];
  if (!Number.isFinite(result)) throw new Error("MALFORMED_TRANSCRIPT");
  return result;
}

export function parseTranscript(source:string,format:TranscriptFormat):CaptionCue[] {
  const normalized=source.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n").trim();
  if (!normalized) throw new Error("MALFORMED_TRANSCRIPT");
  if (format==="webvtt"&&!/^WEBVTT(?:\s|$)/.test(normalized)) throw new Error("MALFORMED_TRANSCRIPT");
  if (format==="srt"&&/^WEBVTT(?:\s|$)/.test(normalized)) throw new Error("MALFORMED_TRANSCRIPT");
  const body=format==="webvtt"?normalized.replace(/^WEBVTT[^\n]*(?:\n|$)/,""):normalized;
  const cues:CaptionCue[]=[];
  for (const block of body.split(/\n{2,}/)) {
    const lines=block.split("\n").map((line)=>line.trim()).filter(Boolean);
    if (!lines.length || /^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const timingIndex=lines.findIndex((line)=>line.includes("-->"));
    if (timingIndex<0) throw new Error("MALFORMED_TRANSCRIPT");
    const match=lines[timingIndex].match(TIMING);
    if (!match) throw new Error("MALFORMED_TRANSCRIPT");
    const startSeconds=seconds(match[1]),endSeconds=seconds(match[2]);
    const text=cleanCaptionText(lines.slice(timingIndex+1).join(" "));
    if (!text||endSeconds<startSeconds||(cues.length>0&&startSeconds<cues.at(-1)!.startSeconds)) throw new Error("MALFORMED_TRANSCRIPT");
    cues.push({ordinal:cues.length,startSeconds,endSeconds,text});
  }
  if (!cues.length) throw new Error("MALFORMED_TRANSCRIPT");
  return cues;
}

export function segmentTranscript(cues:CaptionCue[],target=2000,max=2500,gapBoundarySeconds=60):TranscriptSegment[] {
  if (!cues.length) return [];
  const groups:CaptionCue[][]=[];let current:CaptionCue[]=[];let length=0;
  for (const cue of cues) {
    const prior=current.at(-1);const gap=prior?cue.startSeconds-prior.endSeconds:0;
    const wouldExceed=current.length>0&&length+cue.text.length+1>max&&length>=target*.6;
    const naturalBoundary=current.length>0&&gap>=gapBoundarySeconds&&length>=target*.35;
    if (wouldExceed||naturalBoundary) { groups.push(current);current=[];length=0; }
    current.push(cue);length+=cue.text.length+(current.length>1?1:0);
  }
  if (current.length) groups.push(current);
  return groups.map((group,ordinal)=>{
    const text=group.map((cue)=>cue.text).join(" ");
    const startSeconds=group[0].startSeconds,endSeconds=group.at(-1)!.endSeconds;
    const digest=createHash("sha256").update(`${startSeconds}:${endSeconds}:${text}`,"utf8").digest("hex").slice(0,16);
    return {segmentKey:`${ordinal}:${startSeconds.toFixed(3)}:${endSeconds.toFixed(3)}:${digest}`,ordinal,startSeconds,endSeconds,text};
  });
}

export function transcriptPlainText(cues:CaptionCue[]):string {
  return cues.map((cue)=>cue.text).join("\n");
}
