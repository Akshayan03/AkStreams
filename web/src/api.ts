import type {EventResponse,SourceResponse,Provider,Channel,Sport} from './types';
async function get<T>(url:string,signal?:AbortSignal):Promise<T> {
  const r=await fetch(url,{signal});
  if(!r.ok) { const data=await r.json().catch(()=>({}));throw new Error(data.error||`HTTP ${r.status}`); }
  return r.json() as Promise<T>;
}
export function events(date:string,sport:Sport,demo:boolean,signal?:AbortSignal) {
  const params=new URLSearchParams({date,sport,...(demo?{demo:'1'}:{})});
  return get<EventResponse>(`/api/events?${params}`,signal);
}
export function sources(eventId:string,refresh=false,signal?:AbortSignal) {
  return get<SourceResponse>(`/api/events/${encodeURIComponent(eventId)}/sources${refresh?'?refresh=1':''}`,signal);
}
export function providers(){return get<{providers:Provider[]}>('/api/providers');}
export function channels(){return get<{channels:Channel[]}>('/api/channels');}
