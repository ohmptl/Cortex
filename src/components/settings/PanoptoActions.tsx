"use client";

import { useEffect,useState,type FormEvent } from "react";
import type { Course } from "@/domain/types";

interface Mapping {courseId:string;folderId:string;syncSince:string|null}
interface Credential {created_at:string;last_used_at:string|null;last_ingest_at:string|null}
interface SettingsResponse {credential?:Credential|null;mappings?:Mapping[];error?:string}

async function fetchSettings(signal?:AbortSignal) {
  const response=await fetch("/api/connectors/panopto/settings",{cache:"no-store",signal});
  const body=await response.json() as SettingsResponse;
  if(!response.ok)throw new Error(body.error??"Unable to load connector settings");
  return body;
}

export function PanoptoActions({courses}:{courses:Course[]}) {
  const [credential,setCredential]=useState<Credential|null>(null);
  const [mappings,setMappings]=useState<Mapping[]>([]);
  const [rawToken,setRawToken]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const activeCourses=courses.filter((course)=>course.active);
  async function load(){const body=await fetchSettings();setCredential(body.credential??null);setMappings(body.mappings??[]);}
  useEffect(()=>{
    const controller=new AbortController();
    fetchSettings(controller.signal).then((body)=>{setCredential(body.credential??null);setMappings(body.mappings??[]);}).catch((error:unknown)=>{if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:"Unable to load connector settings");});
    return()=>controller.abort();
  },[]);
  async function generate(){setBusy(true);setMessage(null);try{const response=await fetch("/api/connectors/panopto/token",{method:"POST"}),body=await response.json() as {token?:string;error?:string};if(!response.ok||!body.token)throw new Error(body.error??"Token generation failed");setRawToken(body.token);await load();setMessage("Copy this token now. Cortex will not show it again.");}catch(error){setMessage(error instanceof Error?error.message:"Token generation failed");}finally{setBusy(false);}}
  async function revoke(){setBusy(true);setMessage(null);try{const response=await fetch("/api/connectors/panopto/token",{method:"DELETE"}),body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"Token revocation failed");setRawToken(null);await load();setMessage("Connector token revoked.");}catch(error){setMessage(error instanceof Error?error.message:"Token revocation failed");}finally{setBusy(false);}}
  async function saveMapping(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setMessage(null);try{const form=new FormData(event.currentTarget),date=String(form.get("syncSince")??"");const response=await fetch("/api/connectors/panopto/settings",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({courseId:form.get("courseId"),folderId:form.get("folderId"),syncSince:date?`${date}T00:00:00.000Z`:null})}),body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"Mapping failed");await load();setMessage("Panopto folder mapping saved.");}catch(error){setMessage(error instanceof Error?error.message:"Mapping failed");}finally{setBusy(false);}}
  async function removeMapping(courseId:string){setBusy(true);setMessage(null);try{const response=await fetch(`/api/connectors/panopto/settings?courseId=${encodeURIComponent(courseId)}`,{method:"DELETE"}),body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error??"Unable to remove mapping");await load();setMessage("Panopto folder mapping removed.");}catch(error){setMessage(error instanceof Error?error.message:"Unable to remove mapping");}finally{setBusy(false);}}
  return <div className="editorial-form">
    <div className="diagnostic-row"><strong>Panopto Connector</strong><span>{credential?"Active":"Not configured"}</span></div>
    {credential&&<p className="form-note">Created {new Date(credential.created_at).toLocaleString()} · Last contacted {credential.last_used_at?new Date(credential.last_used_at).toLocaleString():"never"} · Last ingest {credential.last_ingest_at?new Date(credential.last_ingest_at).toLocaleString():"never"}</p>}
    {rawToken&&<label>Connector token — shown once<input readOnly value={rawToken} onFocus={(event)=>event.currentTarget.select()}/><button type="button" onClick={()=>navigator.clipboard.writeText(rawToken)}>Copy token</button></label>}
    <div className="button-row"><button type="button" disabled={busy} onClick={generate}>{credential?"Rotate Connector Token":"Generate Connector Token"}</button>{credential&&<button type="button" disabled={busy} onClick={revoke}>Revoke Connector Token</button>}</div>
    <p className="form-note">The external worker uses this machine token for manifest and ingest requests. Cortex stores only its SHA-256 hash.</p>
    {activeCourses.map((course)=>{const mapping=mappings.find((item)=>item.courseId===course.id);return <form onSubmit={saveMapping} key={`${course.id}:${mapping?.folderId??"new"}`}>
      <input type="hidden" name="courseId" value={course.id}/><strong>{course.code} — {course.name}</strong>
      <label>Panopto Folder ID<input name="folderId" defaultValue={mapping?.folderId??""} maxLength={200} required/></label>
      <label>Sync since (optional)<input name="syncSince" type="date" defaultValue={mapping?.syncSince?.slice(0,10)??""}/></label>
      <div className="button-row"><button disabled={busy} type="submit">{mapping?"Update mapping":"Add mapping"}</button>{mapping&&<button disabled={busy} type="button" onClick={()=>removeMapping(course.id)}>Remove mapping</button>}</div>
    </form>;})}
    {!activeCourses.length&&<p className="form-note">No active Cortex courses are available to map.</p>}{message&&<p className="status-line">{message}</p>}
  </div>;
}
