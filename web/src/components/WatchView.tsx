import {useEffect,useState} from 'react';
import {ArrowLeft,ChevronRight,Info,Play,RefreshCw,ShieldCheck,WifiOff} from 'lucide-react';
import type {Event,ProviderResult,Source,SourceResponse} from '../types';
import {formatKickoff,timeAgo} from '../lib/time';
import {VideoPlayer} from './VideoPlayer';
import {EventStatus,Logo,hasScore} from './ui';

const KIND_LABEL={hls:'HLS',youtube:'YouTube',external:'External'} as const;
const RESULT_LABEL:Record<ProviderResult['status'],string>={ok:'Searched',partial:'Partly searched',skipped:'Skipped','not-configured':'Not configured',error:'Error'};

export function WatchView({eventId,initialEvent,liveEvent,resolution,sourcesError,sourcesLoading,onBack,onRefreshSources,onProviders}:{
  eventId:string;initialEvent:Event|null;liveEvent:Event|null;resolution:SourceResponse|null;sourcesError:string;sourcesLoading:boolean;
  onBack:()=>void;onRefreshSources:()=>void;onProviders:()=>void;
}) {
  const event=liveEvent??resolution?.event??initialEvent;
  const [active,setActive]=useState<Source|null>(null);
  const sources=resolution?.sources??[];
  useEffect(()=>{ setActive(null); },[eventId]);
  // If a refresh drops the active source, stop playing it.
  useEffect(()=>{ if(active&&resolution&&!resolution.sources.some(s=>s.id===active.id)) setActive(null); },[resolution,active]);
  const matched=sources.filter(s=>s.status==='playable'&&!s.isTest);
  const candidates=sources.filter(s=>s.status==='candidate');
  const tests=sources.filter(s=>s.isTest);
  const ordered=[...matched,...tests,...candidates];
  const activeIndex=active?ordered.findIndex(s=>s.id===active.id):-1;
  const next=activeIndex>=0&&activeIndex<ordered.length-1?ordered[activeIndex+1]:null;
  const results=resolution?.providerResults??[];
  const nothingConfigured=results.length>0&&results.every(r=>r.status==='not-configured');

  useEffect(()=>{ if(event) document.title=`${event.home} vs ${event.away} · AKStreams`; return ()=>{document.title='AKStreams · Live Sports';}; },[event]);

  return <main className="main-content" id="main">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16}/> Back to matches</button>
    {!event&&!sourcesError&&<div className="skeleton" style={{height:120}} aria-busy="true"/>}
    {!event&&sourcesError&&<div className="empty-state" role="alert"><WifiOff size={30}/><h3>Couldn't open this game</h3><p>{sourcesError}</p><div className="error-actions"><button className="secondary-button" onClick={onRefreshSources}><RefreshCw size={15}/> Try again</button><button className="secondary-button" onClick={onBack}>Back to matches</button></div></div>}
    {event&&<>
      <div className="watch-headline">
        <div>
          <div className="eyebrow">{event.sport==='soccer'?'SOCCER':'BASKETBALL'} · {event.league.toUpperCase()}{event.isDemo?' · DEMO FIXTURE':''}</div>
          <h1 className="watch-title"><span className="team"><Logo name={event.home} url={event.homeLogo}/>{event.home}</span>
            {hasScore(event)?<span className="watch-score" aria-label={`Score ${event.homeScore} to ${event.awayScore}`}>{event.homeScore}<small>:</small>{event.awayScore}</span>:<span className="versus">vs</span>}
            <span className="team"><Logo name={event.away} url={event.awayLogo}/>{event.away}</span></h1>
          <p className="muted">{formatKickoff(event.kickoff)}{event.venue?` · ${event.venue}`:''}{event.status==='live'&&!event.isDemo?' · score refreshes every 30s':''}</p>
        </div>
        <EventStatus event={event}/>
      </div>
      <div className="watch-layout">
        <div className="player-column">
          <div className="video-box"><VideoPlayer source={active} hasNext={Boolean(next)} onNext={()=>next&&setActive(next)}/></div>
          {active&&<div className={`source-explainer ${active.status==='candidate'||active.isTest?'warn':''}`}>
            <Info size={16}/><div><strong>{active.title}</strong><div>{active.reason}</div><small>Provider: {active.provider}{active.origin&&active.origin!==active.provider?` · ${active.origin}`:''} · {KIND_LABEL[active.kind]} · match confidence {active.confidence}%</small></div>
          </div>}
          <div className="info-strip"><ShieldCheck size={16}/><span>AKStreams only indexes sources you configured. Rights, sign-in and regional availability are decided by each provider; nothing is bypassed.</span></div>
        </div>
        <aside className="source-panel" aria-labelledby="sources-title">
          <div className="panel-title">
            <div><h3 id="sources-title">Sources</h3><p aria-live="polite">{sourcesLoading?'Searching configured providers…':resolution?`${sources.length} found · searched ${timeAgo(resolution.searchedAt)}`:''}</p></div>
            <button className="icon-button" onClick={onRefreshSources} disabled={sourcesLoading} aria-label="Search providers again" title="Search providers again"><RefreshCw size={17} className={sourcesLoading?'spinning':''}/></button>
          </div>
          {sourcesError&&<div className="alert" role="alert">{sourcesError}</div>}
          {sourcesLoading&&!resolution&&<div className="skeleton" style={{height:92}}/>}
          <SourceGroup title="Matched to this game" note="Both team names appear in the broadcast or playlist title. Not a guarantee it plays." list={matched} active={active} onPick={setActive}/>
          <SourceGroup title="Player test streams" note="Public sample video for checking playback. Not this game." list={tests} active={active} onPick={setActive}/>
          <SourceGroup title="Unconfirmed channels" note="A channel named like an announced broadcaster. The game is NOT confirmed on it." list={candidates} active={active} onPick={setActive}/>
          {resolution&&!sourcesLoading&&!sources.length&&<div className="no-source">
            <WifiOff size={26}/>
            <strong>{nothingConfigured?'No source providers configured':'No source found for this game'}</strong>
            <p>{nothingConfigured
              ?'AKStreams finds streams only through providers you set up (official YouTube channels or authorized playlists). None are configured yet, so nothing can be searched.'
              :'The configured providers were searched and none listed this game. A scheduled game does not mean a stream you can access exists.'}</p>
            <button className="link-button" onClick={onProviders}>{nothingConfigured?'Set up providers':'Provider status'} <ChevronRight size={14}/></button>
          </div>}
          {results.length>0&&<details className="provider-results" open={!sources.length}>
            <summary>How sources were searched</summary>
            <ul>{results.map(r=><li key={r.id}><span className={`result-dot result-${r.status}`} aria-hidden="true"/><div><strong>{r.name}</strong> · {RESULT_LABEL[r.status]}{r.count?` · ${r.count} result${r.count===1?'':'s'}`:''}{r.detail&&<small>{r.detail}</small>}</div></li>)}</ul>
          </details>}
        </aside>
      </div>
      {event.broadcasters.length>0&&<section className="broadcast-line"><h3>Announced broadcasters</h3><div>{event.broadcasters.map(b=><span className="broadcaster-chip" key={b}>{b}</span>)}</div><p className="muted">From the schedule listing. These are TV/streaming rights holders, not playable links.</p></section>}
    </>}
  </main>;
}

function SourceGroup({title,note,list,active,onPick}:{title:string;note:string;list:Source[];active:Source|null;onPick:(s:Source)=>void}) {
  if(!list.length)return null;
  return <div className="source-group">
    <div className="source-group-head"><strong>{title}</strong><small>{note}</small></div>
    {list.map(s=><button key={s.id} className={`source-item ${active?.id===s.id?'selected':''} ${s.status==='candidate'?'is-candidate':''}`} aria-pressed={active?.id===s.id} onClick={()=>onPick(s)}>
      <span className="source-play"><Play size={16}/></span>
      <span className="source-text"><strong>{s.title}</strong><small>{s.provider} · {KIND_LABEL[s.kind]}{s.status==='candidate'?' · unconfirmed':''}</small></span>
      <span className="source-activate"><ChevronRight size={16}/></span>
    </button>)}
  </div>;
}
