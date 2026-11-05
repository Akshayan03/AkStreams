import type {EventResponse,SourceResponse,Provider,ChannelResponse,Sport,Event,OfficialResponse,CustomList,CustomSource} from './types';

export class ApiError extends Error {
  constructor(message:string, public status:number, public offline=false){ super(message); }
}
async function get<T>(url:string,signal?:AbortSignal,init:RequestInit={}):Promise<T> {
  let r:Response;
  try { r=await fetch(url,{signal,...init,headers:{accept:'application/json',...(init.body?{'content-type':'application/json'}:{})}}); }
  catch(e) {
    if((e as Error).name==='AbortError') throw e;
    throw new ApiError(navigator.onLine?'Cannot reach the AKStreams server. Is it still running?':'You appear to be offline.',0,true);
  }
  if(!r.ok) { const data=await r.json().catch(()=>({}));throw new ApiError(data.error||`Request failed (HTTP ${r.status})`,r.status); }
  if(r.status===204) return undefined as T;
  return r.json() as Promise<T>;
}
export function events(date:string,sport:Sport,demo:boolean,tz:string,signal?:AbortSignal) {
  const params=new URLSearchParams({date,sport,tz,...(demo?{demo:'1'}:{})});
  return get<EventResponse>(`/api/events?${params}`,signal);
}
export function event(eventId:string,signal?:AbortSignal) {
  return get<{event:Event;fetchedAt:string}>(`/api/events/${encodeURIComponent(eventId)}`,signal);
}
export function sources(eventId:string,refresh=false,signal?:AbortSignal) {
  return get<SourceResponse>(`/api/events/${encodeURIComponent(eventId)}/sources${refresh?'?refresh=1':''}`,signal);
}
export function providers(signal?:AbortSignal){return get<{providers:Provider[];demoStreams:boolean}>('/api/providers',signal);}
export function channels(signal?:AbortSignal){return get<ChannelResponse>('/api/channels',signal);}
export function health(signal?:AbortSignal){return get<{ok:boolean;time:string}>('/health',signal);}
export function official(signal?:AbortSignal){return get<OfficialResponse>('/api/official',signal);}
export function customSources(signal?:AbortSignal){return get<CustomList>('/api/custom-sources',signal);}
export type NewSource={url:string;label?:string;eventId?:string|null;eventLabel?:string;authorized:boolean};
export function addSource(body:NewSource){return get<{source:CustomSource}>('/api/custom-sources',undefined,{method:'POST',body:JSON.stringify(body)});}
export function updateSource(id:string,patch:{enabled?:boolean;label?:string;eventId?:string|null}){return get<{source:CustomSource}>(`/api/custom-sources/${id}`,undefined,{method:'PATCH',body:JSON.stringify(patch)});}
export function removeSource(id:string){return get<void>(`/api/custom-sources/${id}`,undefined,{method:'DELETE'});}
