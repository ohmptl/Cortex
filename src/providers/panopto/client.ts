import { ProviderError } from "../errors.ts";

export interface PanoptoToken { accessToken:string; refreshToken?:string; expiresAt?:number; tokenType?:string }
export interface PanoptoSession { Id:string; Name?:string; StartTime?:string; Duration?:number; Folder?:string; CreatedBy?:{DisplayName?:string}; Urls?:{ViewerUrl?:string}; LastModified?:string }

export class PanoptoClient {
  readonly baseUrl:string;
  private token:PanoptoToken;private readonly timeoutMs:number;
  constructor(baseUrl:string,token:PanoptoToken,timeoutMs=20_000){
    const url=new URL(baseUrl);if(url.protocol!=="https:"&&url.hostname!=="localhost")throw new Error("Panopto URL must use HTTPS");
    url.pathname=url.pathname.replace(/\/$/,"");url.search="";url.hash="";this.baseUrl=url.toString().replace(/\/$/,"");this.token=token;this.timeoutMs=timeoutMs;
  }
  private async request(path:string,init:RequestInit={},accept="application/json"){
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{const response=await fetch(`${this.baseUrl}${path}`,{...init,headers:{accept,authorization:`Bearer ${this.token.accessToken}`,...init.headers},signal:controller.signal,cache:"no-store"});
      if(response.status===401)throw new ProviderError("PROVIDER_AUTH_INVALID","Panopto authentication is invalid");
      if(response.status===403)throw new ProviderError("PROVIDER_ACCESS_DENIED","Panopto denied access to this object");
      if(response.status===404)throw new ProviderError("PROVIDER_FUNCTION_UNAVAILABLE","Panopto capability is unavailable");
      if(response.status===429||response.status>=500)throw new ProviderError("PROVIDER_UNAVAILABLE",`Panopto returned HTTP ${response.status}`,true);
      if(!response.ok)throw new ProviderError("PROVIDER_RESPONSE_INVALID",`Panopto returned HTTP ${response.status}`);return response;
    }catch(error){if(error instanceof ProviderError)throw error;if(error instanceof Error&&error.name==="AbortError")throw new ProviderError("PROVIDER_TIMEOUT","Panopto request timed out",true);throw new ProviderError("PROVIDER_UNAVAILABLE","Unable to reach Panopto",true);}finally{clearTimeout(timeout);}
  }
  async folders(parentId="00000000-0000-0000-0000-000000000000",pageNumber=0){return (await this.request(`/Panopto/api/v1/folders/${encodeURIComponent(parentId)}/children?pageNumber=${pageNumber}`)).json() as Promise<{Results?:Array<Record<string,unknown>>}>;}
  async sessions(folderId:string,pageNumber=0){return (await this.request(`/Panopto/api/v1/folders/${encodeURIComponent(folderId)}/sessions?pageNumber=${pageNumber}&sortField=CreatedDate&sortOrder=Desc`)).json() as Promise<{Results?:PanoptoSession[]}>;}
  async session(id:string){return (await this.request(`/Panopto/api/v1/sessions/${encodeURIComponent(id)}`)).json() as Promise<PanoptoSession>;}
  async officialTranscript(id:string){const response=await this.request(`/Panopto/api/v1/sessions/${encodeURIComponent(id)}/captions`,{},"text/vtt, application/x-subrip, text/plain");return{body:await response.text(),contentType:response.headers.get("content-type")??"text/plain"};}
  async legacySrt(id:string){
    const login=await this.request("/Panopto/api/v1/auth/legacyLogin");const cookie=login.headers.get("set-cookie")?.match(/\.ASPXAUTH=([^;]+)/)?.[1];
    if(!cookie)throw new ProviderError("PROVIDER_FUNCTION_UNAVAILABLE","Panopto legacy caption capability is unavailable");
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{const response=await fetch(`${this.baseUrl}/Panopto/Pages/Transcription/GenerateSRT.ashx?id=${encodeURIComponent(id)}&language=English_USA`,{headers:{cookie:`.ASPXAUTH=${cookie}`,accept:"application/x-subrip,text/plain"},signal:controller.signal,cache:"no-store",redirect:"error"});
      if(response.status===401||response.status===403)throw new ProviderError("PROVIDER_ACCESS_DENIED","Panopto denied transcript access");if(!response.ok)throw new ProviderError("PROVIDER_FUNCTION_UNAVAILABLE","Panopto legacy caption capability is unavailable");return{body:await response.text(),contentType:response.headers.get("content-type")??"application/x-subrip"};
    }finally{clearTimeout(timeout);}
  }
}

export async function exchangeAuthorizationCode(baseUrl:string,code:string,redirectUri:string){return tokenRequest(baseUrl,{grant_type:"authorization_code",code,redirect_uri:redirectUri});}
export async function refreshPanoptoToken(baseUrl:string,refreshToken:string){return tokenRequest(baseUrl,{grant_type:"refresh_token",refresh_token:refreshToken});}
async function tokenRequest(baseUrl:string,params:Record<string,string>):Promise<PanoptoToken>{
  const clientId=process.env.PANOPTO_CLIENT_ID,secret=process.env.PANOPTO_CLIENT_SECRET;if(!clientId||!secret)throw new ProviderError("PROVIDER_AUTH_INVALID","Panopto OAuth client is not configured");
  const response=await fetch(`${baseUrl.replace(/\/$/,"")}/Panopto/oauth2/connect/token`,{method:"POST",headers:{authorization:`Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,"content-type":"application/x-www-form-urlencoded",accept:"application/json"},body:new URLSearchParams(params),cache:"no-store"});
  if(!response.ok)throw new ProviderError("PROVIDER_AUTH_INVALID","Panopto OAuth token exchange failed");const data=await response.json() as Record<string,unknown>;if(typeof data.access_token!=="string")throw new ProviderError("PROVIDER_RESPONSE_INVALID","Panopto OAuth response is invalid");return{accessToken:data.access_token,refreshToken:typeof data.refresh_token==="string"?data.refresh_token:undefined,expiresAt:Date.now()+Number(data.expires_in??3600)*1000,tokenType:typeof data.token_type==="string"?data.token_type:undefined};
}
