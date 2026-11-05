import {useEffect,useMemo,useState} from 'react';
import type {ReactNode} from 'react';
import {Activity,ArrowLeft,ArrowRight,CalendarDays,ChevronRight,Compass,ExternalLink,Menu,Play,Radio,RefreshCw,Search,Settings2,ShieldCheck,Video,WifiOff} from 'lucide-react';
import {channels as getChannels,events as getEvents,providers as getProviders,sources as getSources} from './api';
import {VideoPlayer} from './components/VideoPlayer';
import type {Channel,Event,Provider,Source,Sport} from './types';

const fmtDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const localDate=()=>fmtDate(new Date());
const niceDate=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
const niceTime=(date:string)=>new Date(date).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const compactName=(s:string)=>s.replace(/(Football Club|Basketball Club)/gi,'').trim();
function Logo({name,url}:{name:string,url:string}){return url?<img className="club-logo" src={url} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>:<span className="club-placeholder">{name.slice(0,2).toUpperCase()}</span>}
function Pill({children,live=false}:{children:ReactNode,live?:boolean}){return <span className={`status-pill ${live?'status-live':''}`}>{children}</span>}

export default function App(){
  const [sport,setSport]=useState<Sport>('all');
  const [date,setDate]=useState(localDate());
  const [demo,setDemo]=useState(false);
  const [events,setEvents]=useState<Event[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [partial,setPartial]=useState(false);
  const [selected,setSelected]=useState<Event|null>(null);
  const [sources,setSources]=useState<Source[]>([]);
  const [sourcesLoading,setSourcesLoading]=useState(false);
  const [sourceError,setSourceError]=useState('');
  const [providerErrors,setProviderErrors]=useState<string[]>([]);
  const [activeSource,setActiveSource]=useState<Source|null>(null);
  const [providerList,setProviderList]=useState<Provider[]>([]);
  const [view,setView]=useState<'games'|'channels'|'providers'>('games');
  const [channels,setChannels]=useState<Channel[]>([]);
  const [search,setSearch]=useState('');
  const [mobileNav,setMobileNav]=useState(false);
  const [channelLoading,setChannelLoading]=useState(false);
  const [refreshToken,setRefreshToken]=useState(0);
  useEffect(()=>{getProviders().then(d=>setProviderList(d.providers)).catch(()=>{});},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    getEvents(date,sport,demo,controller.signal).then(data=>{
      setEvents(data.events);setPartial(data.partial);setLoading(false);
      if(data.errors.length && !data.events.length)setError('Fixture services are unavailable. Try the demo mode while developing.');
    }).catch(e=>{if(controller.signal.aborted)return;setLoading(false);setError(e.message);setEvents([])});
    return ()=>controller.abort();
  },[date,sport,demo,refreshToken]);
  useEffect(()=>{
    if(view!=='channels')return;
    setChannelLoading(true);
    getChannels().then(d=>setChannels(d.channels)).catch(()=>setChannels([])).finally(()=>setChannelLoading(false));
  },[view]);
  function openGame(event:Event){setSelected(event);setSources([]);setSourceError('');setActiveSource(null);setView('games');setSourcesLoading(true);
    getSources(event.id).then(data=>{setSources(data.sources);setProviderErrors(data.providerErrors);setProviderList(data.providers);}).catch(e=>setSourceError(e.message)).finally(()=>setSourcesLoading(false));
    history.replaceState(null,'',`?event=${encodeURIComponent(event.id)}`);
  }
  function closeGame(){setSelected(null);setActiveSource(null);history.replaceState(null,'',location.pathname);}
  function refreshSources(){if(!selected)return;setSourcesLoading(true);setSourceError('');setActiveSource(null);
    getSources(selected.id,true).then(data=>{setSources(data.sources);setProviderErrors(data.providerErrors)}).catch(e=>setSourceError(e.message)).finally(()=>setSourcesLoading(false));
  }
  function changeDate(days:number){const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);setDate(fmtDate(d));}
  const filtered=useMemo(()=>events.filter(event=>`${event.home} ${event.away} ${event.league}`.toLowerCase().includes(search.toLowerCase())),[events,search]);
  const live=filtered.filter(e=>e.status==='live');
  const upcoming=filtered.filter(e=>e.status==='scheduled');
  const finished=filtered.filter(e=>e.status==='final');
  const enabledCount=providerList.filter(p=>p.enabled).length;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <div className="brand" onClick={()=>{setView('games');closeGame();setMobileNav(false)}} role="button" tabIndex={0}>
        <div className="brand-mark"><Activity size={24} strokeWidth={3}/></div><span>AK<span>STREAMS</span></span>
      </div>
      <div className="nav-label">DISCOVER</div>
      <nav className="main-nav">
        <button className={view==='games'&&sport==='all'?'active':''} onClick={()=>{setView('games');setSport('all');closeGame();setMobileNav(false)}}><Compass size={18}/> Discover</button>
        <button className={view==='games'&&sport==='soccer'?'active':''} onClick={()=>{setView('games');setSport('soccer');closeGame();setMobileNav(false)}}><span className="soccer-icon">⚽</span> Soccer</button>
        <button className={view==='games'&&sport==='basketball'?'active':''} onClick={()=>{setView('games');setSport('basketball');closeGame();setMobileNav(false)}}><span className="basket-icon">◉</span> Basketball</button>
        <button className={view==='channels'?'active':''} onClick={()=>{setView('channels');closeGame();setMobileNav(false)}}><Radio size={18}/> Live Channels</button>
      </nav>
      <div className="nav-label second-label">WORKSPACE</div>
      <nav className="main-nav"><button className={view==='providers'?'active':''} onClick={()=>{setView('providers');closeGame();setMobileNav(false)}}><Settings2 size={18}/> Stream Providers</button></nav>
      <div className="sidebar-bottom"><div className="system-status"><span className="pulse-dot"/> DISCOVERY ENGINE</div><strong>{enabledCount} / {providerList.length} providers active</strong><p>Streams are discovered, not hosted.</p></div>
    </aside>
    {mobileNav&&<div className="overlay" onClick={()=>setMobileNav(false)}/>}
    <div className="main-shell">
      <header className="topbar">
        <div className="top-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={()=>setMobileNav(true)}><Menu size={22}/></button><span className="topbar-label">YOUR HOME FOR LIVE SPORTS</span></div>
        <div className="top-right"><div className="top-indicator"><span className="pulse-dot"/> SYSTEM ONLINE</div><div className="avatar">AK</div></div>
      </header>
      {selected ? <main className="main-content"><button className="back-link" onClick={closeGame}><ArrowLeft size={16}/> Back to matches</button>
        <div className="watch-headline"><div><div className="eyebrow">{selected.sport.toUpperCase()} <span>·</span> {selected.league}</div><h1>{selected.home} <span className="versus">vs</span> {selected.away}</h1><p>{niceDate(selected.kickoff)} · {niceTime(selected.kickoff)} {selected.isDemo?'· DEMO FIXTURE':''}</p></div><div><Pill live={selected.status==='live'}>{selected.status==='live'?'● LIVE':selected.status.toUpperCase()}</Pill></div></div>
        <div className="watch-layout"><div><div className="video-box"><VideoPlayer source={activeSource}/></div><div className="info-strip"><ShieldCheck size={16}/><span>AKStreams only indexes sources; availability, broadcast rights and geographic access depend on providers.</span></div></div>
          <div className="source-panel"><div className="panel-title"><div><h3>Available sources</h3><p>{sourcesLoading?'Checking configured providers':`${sources.length} possible source${sources.length!==1?'s':''} found`}</p></div><button className="icon-button" onClick={refreshSources} disabled={sourcesLoading} title="Refresh providers"><RefreshCw size={17} className={sourcesLoading?'spinning':''}/></button></div>
          {sourceError&&<div className="alert">{sourceError}</div>}
          {sourcesLoading&&<div className="skeleton" style={{height:92}}/>}
          {!sourcesLoading&&!sources.length&&<div className="no-source"><WifiOff size={28}/><strong>No verified sources found</strong><p>Enable official YouTube or your authorized M3U/HLS feeds in the provider configuration. A game being scheduled doesn't mean a stream exists.</p><button className="link-button" onClick={()=>{setSelected(null);setView('providers')}}>View providers <ChevronRight size={14}/></button></div>}
          {sources.map(s=><button key={s.id} className={`source-item ${activeSource?.id===s.id?'selected':''}`} onClick={()=>setActiveSource(s)}><span className="source-play"><Play size={17}/></span><span className="source-text"><strong>{s.title}</strong><small>{s.provider} · {s.status==='candidate'?'Unconfirmed broadcaster':'Event-title match'}</small></span><span className="source-activate"><ChevronRight size={16}/></span></button>)}
          {activeSource&&<div className="source-explainer"><div>{activeSource.reason}</div>{activeSource.status==='candidate'&&<strong>Game not confirmed on this channel.</strong>}</div>}
          {providerErrors.length>0&&<div className="source-warnings">{providerErrors.map(e=><p key={e}>{e}</p>)}</div>}
          </div></div>
        {selected.broadcasters.length>0&&<section className="broadcast-line"><h3>Announced broadcasters</h3><div>{selected.broadcasters.map(b=><span className="broadcaster-chip" key={b}>{b}</span>)}</div><p>Broadcast listings are not playable stream links.</p></section>}
      </main> : view==='providers' ? <main className="main-content"><div className="section-intro"><div className="eyebrow">INTEGRATIONS</div><h1>Stream providers</h1><p>This is AKStreams' Torrentio-equivalent: independently maintained modules search for playable broadcasts and score them against scheduled fixtures.</p></div><div className="provider-grid">{providerList.map(p=><div className="provider-card" key={p.id}><div className="provider-card-top"><div className="provider-symbol">{p.id==='youtube'?<Video size={22}/>:<Radio size={22}/>}</div><Pill live={p.enabled}>{p.enabled?'CONFIGURED':'NEEDS SETUP'}</Pill></div><h3>{p.name}</h3><p>{p.description}</p><div className="provider-foot">{p.id==='youtube'?'Live video discovery + fixture matching':'Playlist ingestion + broadcaster matching'}</div></div>)}</div><div className="config-instructions"><h3>Configure your discovery engine</h3><p>Copy <code>.env.example</code> to <code>.env</code> at the project root. Configure <code>YOUTUBE_API_KEY</code> and <code>OFFICIAL_YOUTUBE_CHANNEL_IDS</code>, or <code>AUTHORIZED_M3U_URLS</code>. Restart the API. See <code>docs/PROVIDERS.md</code> for adding another source provider.</p><p>AKStreams does not scrape paywalled broadcasts or bypass access controls.</p></div></main>
      : view==='channels' ? <main className="main-content"><div className="section-intro"><div className="eyebrow">STREAM DIRECTORY</div><h1>Live channels</h1><p>Channels discovered from your authorized playlists. These are channels, not confirmed streams of specific games.</p></div>{channelLoading?<div className="skeleton" style={{height:100}}/>:channels.length===0?<div className="empty-state"><Radio size={30}/><h3>No live channels configured</h3><p>Add a playlist URL or file in your <code>.env</code>. AKStreams will index its entries automatically.</p></div>:<div className="channel-grid">{channels.map((ch,i)=><a key={`${ch.url}-${i}`} href={ch.url} target="_blank" rel="noreferrer" className="channel-card"><div className="channel-symbol"><Radio size={20}/></div><strong>{ch.title}</strong><small>{ch.origin} · {ch.group||'Live channel'}</small><ExternalLink size={14}/></a>)}</div>}</main>
      : <main className="main-content"><section className="hero"><div className="hero-bg"/><div className="hero-content"><div className="hero-kicker"><span className="hero-live"/> THE NEXT ERA OF SPORTS STREAMING</div><h1>Every game.<br/><em>One destination.</em></h1><p>Find the match. Discover available broadcasts. Watch from one place.</p><button className="hero-button" onClick={()=>document.getElementById('fixtures')?.scrollIntoView({behavior:'smooth'})}>Browse matches <ArrowRight size={17}/></button></div><div className="hero-art"><div className="art-ring ring-1"/><div className="art-ring ring-2"/><div className="art-ring ring-3"/><span className="art-ball">⚽</span><span className="art-ball basket-ball">🏀</span></div></section>
        <section id="fixtures" className="fixtures-area"><div className="fixtures-head"><div><div className="eyebrow">THE LINEUP</div><h2>Match center <span className="title-count">{events.length}</span></h2></div><button className="icon-button" title="Refresh schedule" onClick={()=>setRefreshToken(x=>x+1)}><RefreshCw size={18} className={loading?'spinning':''}/></button></div>
        <div className="filter-row"><div className="sport-filters"><button className={sport==='all'?'active':''} onClick={()=>setSport('all')}>All games</button><button className={sport==='soccer'?'active':''} onClick={()=>setSport('soccer')}>⚽ Soccer</button><button className={sport==='basketball'?'active':''} onClick={()=>setSport('basketball')}>◉ Basketball</button></div><div className="right-filters"><div className="date-control"><button aria-label="Previous day" onClick={()=>changeDate(-1)}><ArrowLeft size={15}/></button><input aria-label="Match date" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button aria-label="Next day" onClick={()=>changeDate(1)}><ArrowRight size={15}/></button></div></div></div>
        <div className="below-filters"><div className="search-input"><Search size={17}/><input aria-label="Search match or league" placeholder="Search a team or competition..." value={search} onChange={e=>setSearch(e.target.value)}/></div><label className="demo-toggle"><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/><span>Demo data</span></label></div>
        {demo&&<div className="info-banner">Demo fixtures are fictional examples for building the UI and player. They are not real scheduled games.</div>}
        {partial&&<div className="info-banner">Some schedule providers did not respond. Results may be incomplete.</div>}
        {error&&<div className="alert">{error}</div>}
        {loading&&<div className="game-grid">{[1,2,3,4].map(n=><div className="skeleton game-skeleton" key={n}/>)}</div>}
        {!loading&&!filtered.length&&<div className="empty-state"><CalendarDays size={32}/><h3>No matches found</h3><p>Try a different date, remove your search, or enable demo data to preview the app.</p></div>}
        {live.length>0&&!loading&&<GameSection title="Live right now" subtitle="Happening right now" games={live} onOpen={openGame}/>}
        {upcoming.length>0&&!loading&&<GameSection title="Coming up" subtitle={niceDate(date)} games={upcoming} onOpen={openGame}/>}
        {finished.length>0&&!loading&&<GameSection title="Full time" subtitle="Completed games" games={finished} onOpen={openGame}/>}
        </section></main>}
      <footer className="footer">AKSTREAMS <span>·</span> Built for the game <span>·</span> v0.1.0</footer>
    </div>
  </div>;
}
function GameSection({title,subtitle,games,onOpen}:{title:string,subtitle:string,games:Event[],onOpen:(e:Event)=>void}){
  return <section className="game-section"><div className="game-section-head"><h3>{title}</h3><span>{subtitle}</span></div><div className="game-grid">{games.map(event=><button className="game-card" key={event.id} onClick={()=>onOpen(event)}>
    <div className="game-card-top"><span className="league-label">{event.league.toUpperCase()}</span><Pill live={event.status==='live'}>{event.isDemo?'DEMO':event.status==='live'?'● LIVE':event.status==='final'?'FINAL':niceTime(event.kickoff)}</Pill></div>
    <div className="matchup"><div className="club"><Logo name={event.home} url={event.homeLogo}/><strong>{compactName(event.home)}</strong></div><div className="match-vs">{event.status==='scheduled'?<span>VS</span>:<span className="score">{event.homeScore ?? '–'}<small>:</small>{event.awayScore ?? '–'}</span>}</div><div className="club"><Logo name={event.away} url={event.awayLogo}/><strong>{compactName(event.away)}</strong></div></div>
    <div className="game-card-bottom"><span><span className="game-card-sport">{event.sport==='soccer'?'⚽':'◉'}</span> {event.sport==='soccer'?'Soccer':'Basketball'}</span><span>Find streams <ChevronRight size={15}/></span></div>
  </button>)}</div></section>;
}
