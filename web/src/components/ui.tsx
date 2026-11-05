import {useState} from 'react';
import type {ReactNode} from 'react';
import type {Event} from '../types';
import {formatTime} from '../lib/time';

export function Logo({name,url}:{name:string;url:string}) {
  const [failed,setFailed]=useState(false);
  return url&&!failed
    ? <img className="club-logo" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>
    : <span className="club-placeholder" aria-hidden="true">{name.slice(0,2).toUpperCase()}</span>;
}
export function Pill({children,tone}:{children:ReactNode;tone?:'live'|'muted'|'warn'|'ok'}) {
  return <span className={`status-pill ${tone?`pill-${tone}`:''}`}>{children}</span>;
}
export function EventStatus({event}:{event:Event}) {
  if(event.isDemo&&event.status!=='live') return <Pill tone="muted">DEMO · {event.status==='final'?'FINAL':formatTime(event.kickoff)}</Pill>;
  switch(event.status) {
    case 'live': return <Pill tone="live"><span className="live-dot" aria-hidden="true"/>LIVE{event.clock&&!event.isDemo?` · ${event.clock}`:event.isDemo?' · DEMO':''}</Pill>;
    case 'final': return <Pill tone="muted">FINAL</Pill>;
    case 'postponed': return <Pill tone="warn">POSTPONED</Pill>;
    case 'canceled': return <Pill tone="warn">CANCELED</Pill>;
    default: return <Pill>{formatTime(event.kickoff)}</Pill>;
  }
}
export const compactName=(s:string)=>s.replace(/(Football Club|Basketball Club)/gi,'').trim();
export const hasScore=(e:Event)=>(e.status==='live'||e.status==='final')&&e.homeScore!==null&&e.awayScore!==null;
