import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {Activity,Compass,Link2,Menu,Radio,Settings2,Trophy,X} from 'lucide-react';
import * as api from './api';
import {ApiError} from './api';
import {useOnline,useRefreshingTask} from './hooks';
import {parseRoute,routeSearch} from './lib/route';
import type {Route} from './lib/route';
import {scheduleInterval} from './lib/poll';
import {today,viewerTimeZone} from './lib/time';
import {GamesView} from './components/GamesView';
import type {Board} from './components/GamesView';
import {WatchView} from './components/WatchView';
import {ChannelsView,ProvidersView} from './components/SetupViews';
import {OfficialView} from './components/OfficialView';
import {MySourcesView} from './components/SourceManager';
import type {ChannelResponse,Event,Provider,SourceResponse,Sport} from './types';

const message=(e:unknown)=>e instanceof Error?e.message:String(e);
const isAbort=(e:unknown)=>(e as Error)?.name==='AbortError';
const startsSoon=(e:Event)=>e.status==='scheduled'&&new Date(e.kickoff).getTime()-Date.now()<15*60_000;

export default function App(){
  const tz=useMemo(viewerTimeZone,[]);
  const [route,setRoute]=useState<Route>(()=>parseRoute(location.search));
  const todayDate=today(tz);
  const date=route.date??todayDate;
  const online=useOnline();
  const [serverDown,setServerDown]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const [,setTick]=useState(0);
  useEffect(()=>{ const t=setInterval(()=>setTick(x=>x+1),15_000); return ()=>clearInterval(t); },[]);

  useEffect(()=>{
    const onPop=()=>setRoute(parseRoute(location.search));
    addEventListener('popstate',onPop);
    return ()=>removeEventListener('popstate',onPop);
  },[]);
  const routeRef=useRef(route);
  routeRef.current=route;
  const navigate=useCallback((patch:Partial<Route>,replace=false)=>{
    const next={...routeRef.current,...patch};
    routeRef.current=next;
    const search=routeSearch(next,today(tz));
    history[replace?'replaceState':'pushState']({akstreams:true},'',search||location.pathname);
    setRoute(next);
    setMobileNav(false);
  },[tz]);
  const noteResult=useCallback((e?:unknown)=>{ setServerDown(Boolean(e instanceof ApiError&&e.offline&&navigator.onLine)); },[]);

  // ---------- schedule board ----------
  const gamesActive=route.view==='games'&&!route.event;
  const dataKey=`${date}|${route.sport}|${route.demo?1:0}|${tz}`;
  const [board,setBoard]=useState<Board>({key:'',data:null,error:'',updatedAt:null});
  const [boardNonce,setBoardNonce]=useState(0);
  const [boardBusy,setBoardBusy]=useState(false);
  const anyLive=board.key===dataKey&&Boolean(board.data?.events.some(e=>e.status==='live'));
  const soon=board.key===dataKey&&Boolean(board.data?.events.some(startsSoon));
  const boardPoll=gamesActive&&!route.demo&&board.key===dataKey?scheduleInterval({anyLive,isToday:date===todayDate,startsSoon:soon}):null;
  useRefreshingTask(async signal=>{
    if(!gamesActive)return;
    const key=dataKey;
    setBoardBusy(true);
    try {
      const data=await api.events(date,route.sport,route.demo,tz,signal);
      setBoard({key,data,error:'',updatedAt:new Date().toISOString()});noteResult();
    } catch(e) {
      if(isAbort(e))throw e;
      noteResult(e);
      setBoard(prev=>({key,data:prev.key===key?prev.data:null,error:message(e),updatedAt:prev.key===key?prev.updatedAt:null}));
      throw e;
    } finally { if(!signal.aborted) setBoardBusy(false); }
  },boardPoll,gamesActive?`${dataKey}|${boardNonce}`:'inactive');
  const boardLoading=gamesActive&&board.key!==dataKey;

  // ---------- watch page ----------
  const eventId=route.event;
  const [openedEvent,setOpenedEvent]=useState<Event|null>(null);
  const [resolution,setResolution]=useState<SourceResponse|null>(null);
  const [sourcesError,setSourcesError]=useState('');
  const [sourcesLoading,setSourcesLoading]=useState(false);
  const [sourceNonce,setSourceNonce]=useState(0);
  const [liveEvent,setLiveEvent]=useState<Event|null>(null);
  const resolvedFor=useRef<string|null>(null);
  useEffect(()=>{ if(resolvedFor.current!==eventId){ setResolution(null);setLiveEvent(null);setSourcesError(''); } },[eventId]);
  const watchedEvent=liveEvent??resolution?.event??null;
  const watchLive=Boolean(watchedEvent&&!watchedEvent.isDemo&&(watchedEvent.status==='live'||startsSoon(watchedEvent)));
  useRefreshingTask(async signal=>{
    if(!eventId)return;
    setSourcesLoading(true);setSourcesError('');
    try {
      const data=await api.sources(eventId,sourceNonce>0,signal);
      resolvedFor.current=eventId;setResolution(data);noteResult();
    } catch(e) { if(isAbort(e))throw e; noteResult(e); setSourcesError(message(e)); throw e; }
    finally { if(!signal.aborted) setSourcesLoading(false); }
  },watchLive?3*60_000:null,eventId?`src|${eventId}|${sourceNonce}`:'inactive');
  useRefreshingTask(async signal=>{
    if(!eventId||!resolution)return;
    try { const {event}=await api.event(eventId,signal); setLiveEvent(event); noteResult(); }
    catch(e) { if(!isAbort(e)) noteResult(e); throw e; }
  },watchLive?30_000:null,eventId?`ev|${eventId}`:'inactive');

  // ---------- providers & channels ----------
  const [providers,setProviders]=useState<Provider[]>([]);
  const [demoStreams,setDemoStreams]=useState(false);
  const [providersError,setProvidersError]=useState('');
  const [providersLoading,setProvidersLoading]=useState(false);
  const loadProviders=useCallback((signal?:AbortSignal)=>{
    setProvidersLoading(true);
    api.providers(signal).then(d=>{setProviders(d.providers);setDemoStreams(d.demoStreams);setProvidersError('');noteResult();})
      .catch(e=>{ if(!isAbort(e)){ setProvidersError(message(e)); noteResult(e);} }).finally(()=>setProvidersLoading(false));
  },[noteResult]);
  useEffect(()=>{ const c=new AbortController(); loadProviders(c.signal); return ()=>c.abort(); },[route.view,loadProviders]);
  useEffect(()=>{ if(resolution?.providers) setProviders(resolution.providers); },[resolution]);
  const [channels,setChannels]=useState<ChannelResponse|null>(null);
  const [channelsError,setChannelsError]=useState('');
  const [channelsLoading,setChannelsLoading]=useState(false);
  const [channelNonce,setChannelNonce]=useState(0);
  useEffect(()=>{
    if(route.view!=='channels'||route.event)return;
    const c=new AbortController();setChannelsLoading(true);setChannelsError('');
    api.channels(c.signal).then(d=>{setChannels(d);noteResult();}).catch(e=>{ if(!isAbort(e)){ setChannelsError(message(e)); noteResult(e);} }).finally(()=>setChannelsLoading(false));
    return ()=>c.abort();
  },[route.view,route.event,channelNonce,noteResult]);

  useEffect(()=>{
    if(!mobileNav)return;
    const onKey=(e:KeyboardEvent)=>{ if(e.key==='Escape') setMobileNav(false); };
    addEventListener('keydown',onKey); return ()=>removeEventListener('keydown',onKey);
  },[mobileNav]);

  const openGame=(event:Event)=>{ setOpenedEvent(event); navigate({event:event.id}); scrollTo({top:0}); };
  const closeGame=()=>{
    if(history.state?.akstreams&&history.length>1) history.back();
    else navigate({event:null,view:'games'},true);
  };
  const go=(view:Route['view'],sport?:Sport)=>navigate({view,event:null,...(sport?{sport,league:''}:{})});
  const enabledCount=providers.filter(p=>p.enabled).length;
  const status=!online?{label:'OFFLINE',tone:'off'}:serverDown?{label:'SERVER UNREACHABLE',tone:'off'}:{label:'CONNECTED',tone:'on'};
  const navItem=(label:string,icon:ReactNode,active:boolean,onClick:()=>void)=>
    <button className={active?'active':''} aria-current={active?'page':undefined} onClick={onClick}>{icon} {label}</button>;

  return <div className="app-shell">
    <a href="#main" className="skip-link">Skip to content</a>
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`} aria-label="Navigation">
      <a className="brand" href="./" onClick={e=>{e.preventDefault();navigate({view:'games',event:null,sport:'all',league:'',date:null});}}>
        <span className="brand-mark" aria-hidden="true"><Activity size={22} strokeWidth={3}/></span><span>AK<span>STREAMS</span></span>
      </a>
      <button className="icon-button sidebar-close" aria-label="Close menu" onClick={()=>setMobileNav(false)}><X size={18}/></button>
      <div className="nav-label">DISCOVER</div>
      <nav className="main-nav">
        {navItem('All games',<Compass size={18}/>,route.view==='games'&&!route.event&&route.sport==='all',()=>go('games','all'))}
        {navItem('Soccer',<span className="nav-glyph" aria-hidden="true">⚽</span>,route.view==='games'&&!route.event&&route.sport==='soccer',()=>go('games','soccer'))}
        {navItem('Basketball',<span className="nav-glyph" aria-hidden="true">🏀</span>,route.view==='games'&&!route.event&&route.sport==='basketball',()=>go('games','basketball'))}
        {navItem('Official free',<Trophy size={18}/>,route.view==='official'&&!route.event,()=>go('official'))}
        {navItem('Live channels',<Radio size={18}/>,route.view==='channels'&&!route.event,()=>go('channels'))}
      </nav>
      <div className="nav-label second-label">WORKSPACE</div>
      <nav className="main-nav">{navItem('My sources',<Link2 size={18}/>,route.view==='mine'&&!route.event,()=>go('mine'))}
        {navItem('Source providers',<Settings2 size={18}/>,route.view==='providers'&&!route.event,()=>go('providers'))}</nav>
      <div className="sidebar-bottom"><div className="system-status"><span className={`status-dot ${enabledCount?'on':''}`}/> DISCOVERY ENGINE</div>
        <strong>{providers.length?`${enabledCount} / ${providers.length} providers configured`:'Provider status unknown'}</strong><p>Streams are discovered, never hosted.</p></div>
    </aside>
    {mobileNav&&<div className="overlay" onClick={()=>setMobileNav(false)} aria-hidden="true"/>}
    <div className="main-shell">
      <header className="topbar">
        <div className="top-left"><button className="icon-button mobile-menu" aria-label="Open menu" aria-expanded={mobileNav} onClick={()=>setMobileNav(true)}><Menu size={22}/></button>
          <span className="topbar-label">LIVE SPORTS · SOURCE DISCOVERY</span></div>
        <div className="top-right"><div className={`top-indicator ${status.tone}`} role="status"><span className={`status-dot ${status.tone==='on'?'on':'off'}`}/> {status.label}</div></div>
      </header>
      {eventId ? <WatchView eventId={eventId} initialEvent={openedEvent?.id===eventId?openedEvent:null} liveEvent={liveEvent} resolution={resolution?.event.id===eventId?resolution:null}
          sourcesError={sourcesError} sourcesLoading={sourcesLoading} onBack={closeGame} onRefreshSources={()=>setSourceNonce(n=>n+1)} onProviders={()=>go('providers')} onOfficial={()=>go('official')}/>
        : route.view==='official' ? <OfficialView/>
        : route.view==='mine' ? <MySourcesView onOpenEvent={id=>{ setOpenedEvent(null); navigate({event:id}); }}/>
        : route.view==='providers' ? <ProvidersView providers={providers} demoStreams={demoStreams} error={providersError} loading={providersLoading} onRefresh={()=>loadProviders()}/>
        : route.view==='channels' ? <ChannelsView data={channels} error={channelsError} loading={channelsLoading} onRefresh={()=>setChannelNonce(n=>n+1)} onProviders={()=>go('providers')}/>
        : <GamesView date={date} todayDate={todayDate} sport={route.sport} league={route.league} demo={route.demo} board={board.key===dataKey?board:{key:'',data:null,error:'',updatedAt:null}}
            loading={boardLoading} pollMs={boardPoll} online={online}
            onDate={d=>navigate({date:d===todayDate?null:d,league:''})} onSport={s=>navigate({sport:s,league:''})} onLeague={l=>navigate({league:l},true)}
            onDemo={d=>navigate({demo:d})} onRefresh={()=>{ if(!boardBusy) setBoardNonce(n=>n+1); }} onOpen={openGame}/>}
      <footer className="footer">AKSTREAMS <span>·</span> local discovery engine <span>·</span> v0.3.0</footer>
    </div>
  </div>;
}
