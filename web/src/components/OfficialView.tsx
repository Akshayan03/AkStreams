import {useCallback,useEffect,useState} from 'react';
import {ExternalLink,Play,RefreshCw,Trophy,X} from 'lucide-react';
import * as api from '../api';
import type {OfficialItem,OfficialResponse,Source} from '../types';
import {timeAgo} from '../lib/time';
import {VideoPlayer} from './VideoPlayer';
import {LiveStatusPill} from './ui';

const message=(e:unknown)=>e instanceof Error?e.message:String(e);
export function officialSource(item:OfficialItem):Source {
  const embeddable=item.embeddable!==false;
  return {id:item.id,provider:`${item.channelName} (official YouTube)`,origin:item.channelName,title:item.title,kind:embeddable?'youtube':'external',
    url:item.url,videoId:item.videoId,confidence:100,status:'playable',provenance:'official-feed',liveStatus:item.liveStatus,scheduledStart:item.scheduledStart,access:'free',
    reason:`Official ${item.owner} channel, found in its public feed. ${item.detail}.`};
}

export function OfficialView() {
  const [data,setData]=useState<OfficialResponse|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [playing,setPlaying]=useState<OfficialItem|null>(null);
  const load=useCallback((signal?:AbortSignal)=>{
    setLoading(true);
    api.official(signal).then(d=>{setData(d);setError('');}).catch(e=>{ if((e as Error).name!=='AbortError') setError(message(e)); }).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{ const c=new AbortController(); load(c.signal); return ()=>c.abort(); },[load]);
  const items=data?.items??[];
  const groups:[string,string,OfficialItem[]][]=[
    ['Live now','Verified as broadcasting right now',items.filter(i=>i.liveStatus==='live')],
    ['Upcoming','Scheduled official streams. The player shows a countdown until they start.',items.filter(i=>i.liveStatus==='upcoming')],
    ['Replays','Past broadcasts and full-length uploads. Not live.',items.filter(i=>i.liveStatus==='replay')],
    ['Status unverified','YouTube did not confirm the live status. Shown as found.',items.filter(i=>i.liveStatus==='unknown')],
  ];
  const playingIndex=playing?items.findIndex(i=>i.id===playing.id):-1;
  const next=playingIndex>=0?items.slice(playingIndex+1).find(i=>i.embeddable!==false&&i.liveStatus!=='highlights')??null:null;
  return <main className="main-content" id="main">
    <div className="section-intro with-action"><div><div className="eyebrow">NO ACCOUNT NEEDED</div><h1>Official free broadcasts</h1>
      <p>Free streams from FIBA's own YouTube channels ({data?.channels.map(c=>c.handle).join(', ')||'@FIBA, @FIBA3x3'}), found through their public feeds without an API key. Coverage is FIBA competitions only. NBA and European soccer games are not on these channels. Some videos may be blocked in your region by the channel.</p></div>
      <button className="icon-button" onClick={()=>load()} aria-label="Refresh official broadcasts" disabled={loading}><RefreshCw size={18} className={loading?'spinning':''}/></button></div>
    {error&&<div className="alert" role="alert">{error}</div>}
    {data?.errors.length?<div className="info-banner warn" role="status">Some official feeds failed: {data.errors.join(' ')}</div>:null}
    {data&&!data.enabled&&<div className="empty-state"><Trophy size={28}/><h3>Official feeds are turned off</h3><p>OFFICIAL_FEEDS=off is set on the server.</p></div>}
    {playing&&<div className="channel-player"><div className="channel-player-head"><strong>{playing.title}</strong><button className="icon-button" aria-label="Close player" onClick={()=>setPlaying(null)}><X size={16}/></button></div>
      <div className="video-box"><VideoPlayer source={officialSource(playing)} hasNext={Boolean(next)} onNext={()=>next&&setPlaying(next)}/></div>
      <p className="muted small-print">{playing.owner} · {playing.detail} · checked {data?timeAgo(data.checkedAt):''}</p></div>}
    {loading&&!data&&<div className="skeleton" style={{height:120}} aria-busy="true"/>}
    {data?.enabled&&!items.length&&!loading&&(data.errors.length>=data.channels.length
      ?<div className="empty-state" role="alert"><Trophy size={28}/><h3>Official feeds unavailable</h3><p>None of the official channel feeds could be read, so it is unknown whether anything is live. This is not the same as "nothing on".</p><button className="secondary-button" onClick={()=>load()}><RefreshCw size={15}/> Try again</button></div>
      :<div className="empty-state"><Trophy size={28}/><h3>No official broadcasts found right now</h3><p>The feeds were read, but they listed no live, upcoming or replay videos.</p></div>)}
    {groups.map(([title,note,list])=>list.length>0&&<section className="game-section" key={title} aria-label={title}>
      <div className="game-section-head"><h3>{title}</h3><span>{note}</span></div>
      <div className="official-grid">{list.map(item=><article key={item.id} className={`official-card ${playing?.id===item.id?'selected':''}`} data-live-status={item.liveStatus}>
        <div className="official-top"><span className="league-label">{item.channelName.toUpperCase()}</span><LiveStatusPill status={item.liveStatus} start={item.scheduledStart}/></div>
        <strong className="official-title">{item.title}</strong>
        <small className="muted">Free · {item.detail}{item.embeddable===false?' · embedding disabled by the channel':''}</small>
        <div className="channel-actions">
          {item.embeddable!==false&&<button className="secondary-button" onClick={()=>{setPlaying(item);scrollTo({top:0});}} aria-label={`Watch here: ${item.title}`}><Play size={14}/> Watch here</button>}
          <a className="secondary-button" href={item.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> YouTube</a>
        </div>
      </article>)}</div>
    </section>)}
    {data&&<p className="tz-note muted">Checked {timeAgo(data.checkedAt)}. "Live now" means YouTube's own metadata says the stream is broadcasting. A "LIVE" in a video title alone is not trusted. Being public on YouTube does not settle rights in every region.</p>}
  </main>;
}
