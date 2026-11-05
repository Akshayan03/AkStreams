import {useEffect,useState} from 'react';
import {ArrowLeft,ChevronRight,ExternalLink,Info,Play,Plus,RefreshCw,ShieldCheck,Tv,WifiOff} from 'lucide-react';
import type {Event,ProviderResult,Source,SourceResponse,WatchInfo} from '../types';
import {formatKickoff,timeAgo} from '../lib/time';
import {VideoPlayer} from './VideoPlayer';
import {AddSourceForm} from './SourceManager';
import {EventStatus,LIVE_LABEL,Logo,hasScore} from './ui';

const KIND_LABEL={hls:'HLS',youtube:'YouTube',external:'External'} as const;
const RESULT_LABEL:Record<ProviderResult['status'],string>={ok:'Searched',partial:'Partly searched',skipped:'Skipped','not-configured':'Not configured',error:'Error'};
const resultLabel=(r:ProviderResult)=>r.status==='ok'&&!r.count?'Searched · no match':RESULT_LABEL[r.status];

export function WatchView({eventId,initialEvent,liveEvent,resolution,sourcesError,sourcesLoading,onBack,onRefreshSources,onProviders,onOfficial}:{
  eventId:string;initialEvent:Event|null;liveEvent:Event|null;resolution:SourceResponse|null;sourcesError:string;sourcesLoading:boolean;
  onBack:()=>void;onRefreshSources:()=>void;onProviders:()=>void;onOfficial:()=>void;
}) {
  const event=liveEvent??resolution?.event??initialEvent;
  const [active,setActive]=useState<Source|null>(null);
  const [adding,setAdding]=useState(false);
  const sources=resolution?.sources??[];
  useEffect(()=>{ setActive(null);setAdding(false); },[eventId]);
  // If a refresh drops the active source, stop playing it.
  useEffect(()=>{ if(active&&resolution&&!resolution.sources.some(s=>s.id===active.id)) setActive(null); },[resolution,active]);
  const mine=sources.filter(s=>s.status==='playable'&&s.provenance==='owner');
  const official=sources.filter(s=>s.status==='playable'&&s.provenance==='official-feed');
  const matched=sources.filter(s=>s.status==='playable'&&!s.isTest&&s.provenance!=='owner'&&s.provenance!=='official-feed');
  const candidates=sources.filter(s=>s.status==='candidate');
  const tests=sources.filter(s=>s.isTest);
  const ordered=[...mine,...official,...matched,...tests,...candidates];
  const activeIndex=active?ordered.findIndex(s=>s.id===active.id):-1;
  const next=activeIndex>=0&&activeIndex<ordered.length-1?ordered[activeIndex+1]:null;
  const results=resolution?.providerResults??[];
  const nothingConfigured=results.length>0&&results.every(r=>r.status==='not-configured');
  const failed=results.filter(r=>r.status==='error');
  const eventLabel=event?`${event.home} vs ${event.away} · ${event.league}`:'';

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
          <div className="info-strip"><ShieldCheck size={16}/><span>AKStreams only lists official feeds and sources you configured. Each provider decides rights, sign-in and regional availability, and nothing is bypassed.</span></div>
          {resolution?.watch&&!event.isDemo&&<WhereToWatch watch={resolution.watch}/>}
        </div>
        <aside className="source-panel" aria-labelledby="sources-title">
          <div className="panel-title">
            <div><h3 id="sources-title">Sources</h3><p aria-live="polite">{sourcesLoading?'Searching configured providers…':resolution?`${sources.length} found · searched ${timeAgo(resolution.searchedAt)}`:''}</p></div>
            <button className="icon-button" onClick={onRefreshSources} disabled={sourcesLoading} aria-label="Search providers again" title="Search providers again"><RefreshCw size={17} className={sourcesLoading?'spinning':''}/></button>
          </div>
          {sourcesError&&<div className="alert" role="alert">{sourcesError}</div>}
          {sourcesLoading&&!resolution&&<div className="skeleton" style={{height:92}}/>}
          {!event.isDemo&&(adding
            ?<AddSourceForm eventId={event.id} eventLabel={eventLabel} onCancel={()=>setAdding(false)} onAdded={()=>{ setAdding(false); onRefreshSources(); }}/>
            :<button className="secondary-button add-source-button" onClick={()=>setAdding(true)}><Plus size={14}/> Add source for this game</button>)}
          <SourceGroup title="Added by you" note="You attached these to this game and confirmed you're authorized." list={mine} active={active} onPick={setActive}/>
          <SourceGroup title="Official free broadcasts" note="Official channel video whose title names both teams. Check the live/replay label." list={official} active={active} onPick={setActive}/>
          <SourceGroup title="Matched to this game" note="Both team names appear in the broadcast or playlist title. Not a guarantee it plays." list={matched} active={active} onPick={setActive}/>
          <SourceGroup title="Player test streams" note="Public sample video for checking playback. Not this game." list={tests} active={active} onPick={setActive}/>
          <SourceGroup title="Unconfirmed channels" note="A channel named like an announced broadcaster. The game is NOT confirmed on it." list={candidates} active={active} onPick={setActive}/>
          {resolution&&!sourcesLoading&&!sources.length&&<div className="no-source">
            <WifiOff size={26}/>
            <strong>{nothingConfigured?'No source providers configured':failed.length===results.length?'Source search failed':'No source found for this game'}</strong>
            <p>{nothingConfigured
              ?'AKStreams finds streams only through official feeds and providers you set up. None are configured yet, so nothing can be searched.'
              :failed.length===results.length?'Every provider failed, so it is unknown whether a source exists. Try again shortly.'
              :`The available providers were searched and none listed this game${failed.length?` (${failed.length} failed)`:''}. A scheduled game does not mean there is a free stream. See "Where to watch" for the official broadcasters.`}</p>
            <button className="link-button" onClick={onProviders}>{nothingConfigured?'Set up providers':'Provider status'} <ChevronRight size={14}/></button>
            <button className="link-button" onClick={onOfficial}>Official free broadcasts (FIBA) <ChevronRight size={14}/></button>
          </div>}
          {results.length>0&&<details className="provider-results" open={!sources.length}>
            <summary>How sources were searched</summary>
            <ul>{results.map(r=><li key={r.id}><span className={`result-dot result-${r.status}`} aria-hidden="true"/><div><strong>{r.name}</strong> · {resultLabel(r)}{r.count?` · ${r.count} result${r.count===1?'':'s'}`:''}{r.detail&&<small>{r.detail}</small>}</div></li>)}</ul>
          </details>}
        </aside>
      </div>
      {event.broadcasters.length>0&&!resolution?.watch&&<section className="broadcast-line"><h3>Announced broadcasters</h3><div>{event.broadcasters.map(b=><span className="broadcaster-chip" key={b}>{b}</span>)}</div><p className="muted">From the schedule listing. These are TV/streaming rights holders, not playable links.</p></section>}
    </>}
  </main>;
}

function SourceGroup({title,note,list,active,onPick}:{title:string;note:string;list:Source[];active:Source|null;onPick:(s:Source)=>void}) {
  if(!list.length)return null;
  return <div className="source-group">
    <div className="source-group-head"><strong>{title}</strong><small>{note}</small></div>
    {list.map(s=><button key={s.id} className={`source-item ${active?.id===s.id?'selected':''} ${s.status==='candidate'?'is-candidate':''}`} aria-pressed={active?.id===s.id} onClick={()=>onPick(s)}>
      <span className="source-play"><Play size={16}/></span>
      <span className="source-text"><strong>{s.title}</strong><small>{s.provider} · {KIND_LABEL[s.kind]}{s.liveStatus&&s.liveStatus!=='unknown'?` · ${LIVE_LABEL[s.liveStatus]}`:''}{s.access==='free'?' · free':''}{s.status==='candidate'?' · unconfirmed':''}</small></span>
      <span className="source-activate"><ChevronRight size={16}/></span>
    </button>)}
  </div>;
}

function WhereToWatch({watch}:{watch:WatchInfo}) {
  if(!watch.routes.length&&!watch.league) return <section className="where-to-watch" aria-labelledby="wtw-title"><h3 id="wtw-title"><Tv size={16}/> Where to watch</h3>
    <p className="muted">The schedule listing names no broadcaster for this game.</p></section>;
  return <section className="where-to-watch" aria-labelledby="wtw-title">
    <h3 id="wtw-title"><Tv size={16}/> Where to watch (official broadcasters)</h3>
    <p className="muted">{watch.caveat}</p>
    <ul>{watch.routes.map(r=><li key={r.name} className="wtw-route">
      <div><strong>{r.name}</strong>{r.service&&r.service!==r.name?<span className="muted"> ({r.service})</span>:null}
        <small>{[r.type,r.market&&`${r.market} market`,r.region&&`listed for ${r.region}`].filter(Boolean).join(' · ')}</small>
        <small className="warn-text">{r.accessNote}{r.regionNote?` · ${r.regionNote}`:''}{r.note?` · ${r.note}`:''}</small></div>
      {r.url?<a className="secondary-button" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${r.service||r.name} official site`}>Official site <ExternalLink size={13}/></a>:<span className="muted small-print">No link</span>}
    </li>)}
    {watch.league&&<li className="wtw-route"><div><strong>{watch.league.label}</strong><small>League service · subscription</small><small className="warn-text">{watch.league.note}</small></div>
      <a className="secondary-button" href={watch.league.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${watch.league.label}`}>Official site <ExternalLink size={13}/></a></li>}
    </ul>
  </section>;
}
