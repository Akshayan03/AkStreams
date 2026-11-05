import {useMemo,useState} from 'react';
import {ArrowLeft,ArrowRight,CalendarDays,ChevronRight,RefreshCw,Search,WifiOff} from 'lucide-react';
import type {Event,EventResponse,Sport} from '../types';
import {dayLabel,formatDay,shiftDate,timeAgo} from '../lib/time';
import {EventStatus,Logo,compactName,hasScore} from './ui';

export type Board={key:string;data:EventResponse|null;error:string;updatedAt:string|null};

export function GamesView(props:{
  date:string;todayDate:string;sport:Sport;league:string;demo:boolean;board:Board;loading:boolean;pollMs:number|null;online:boolean;
  onDate:(d:string)=>void;onSport:(s:Sport)=>void;onLeague:(l:string)=>void;onDemo:(d:boolean)=>void;onRefresh:()=>void;onOpen:(e:Event)=>void;
}) {
  const {date,todayDate,sport,league,demo,board,loading,pollMs,online}=props;
  const [search,setSearch]=useState('');
  const events=board.data?.events??[];
  const leagues=useMemo(()=>[...new Set(events.map(e=>e.league))].sort(),[events]);
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return events.filter(e=>(!league||e.league===league)&&(!q||`${e.home} ${e.away} ${e.homeShort} ${e.awayShort} ${e.league}`.toLowerCase().includes(q)));
  },[events,search,league]);
  const groups:[string,string,Event[]][]=[
    ['Live now','In progress',filtered.filter(e=>e.status==='live')],
    ['Coming up',dayLabel(date,todayDate),filtered.filter(e=>e.status==='scheduled')],
    ['Full time','Completed',filtered.filter(e=>e.status==='final')],
    ['Postponed or canceled','Not being played as scheduled',filtered.filter(e=>e.status==='postponed'||e.status==='canceled')],
  ];
  const data=board.data;
  return <main className="main-content" id="main">
    <section className="hero">
      <div className="hero-content">
        <div className="hero-kicker"><span className="live-dot" aria-hidden="true"/> NBA · EUROPEAN SOCCER</div>
        <h1>Every game.<br/><em>Every authorized source.</em></h1>
        <p>Real schedules and live scores, plus the sources your configured providers can actually find for each match. Nothing is invented: if no authorized source exists, AKStreams says so.</p>
      </div>
    </section>
    <section id="fixtures" className="fixtures-area" aria-labelledby="match-center">
      <div className="fixtures-head">
        <div><div className="eyebrow">MATCH CENTER</div><h2 id="match-center">{dayLabel(date,todayDate)} <span className="title-sub">{formatDay(date)}</span> <span className="title-count" aria-label={`${filtered.length} games`}>{filtered.length}</span></h2></div>
        <div className="refresh-meta">
          {board.updatedAt&&<span className="muted">Updated {timeAgo(board.updatedAt)}{pollMs&&online?` · auto-refresh ${pollMs/1000}s`:''}</span>}
          <button className="icon-button" aria-label="Refresh schedule" title="Refresh schedule" onClick={props.onRefresh} disabled={loading}><RefreshCw size={18} className={loading?'spinning':''}/></button>
        </div>
      </div>
      <div className="filter-row">
        <div className="segmented" role="group" aria-label="Sport">
          {(['all','soccer','basketball'] as Sport[]).map(s=><button key={s} aria-pressed={sport===s} className={sport===s?'active':''} onClick={()=>props.onSport(s)}>{s==='all'?'All sports':s==='soccer'?'Soccer':'Basketball'}</button>)}
        </div>
        <div className="date-control" role="group" aria-label="Date">
          <button aria-label="Previous day" onClick={()=>props.onDate(shiftDate(date,-1))}><ArrowLeft size={15}/></button>
          <input aria-label="Match date" type="date" value={date} onChange={e=>{ if(e.target.value) props.onDate(e.target.value); }}/>
          <button aria-label="Next day" onClick={()=>props.onDate(shiftDate(date,1))}><ArrowRight size={15}/></button>
          {date!==todayDate&&<button className="today-button" onClick={()=>props.onDate(todayDate)}>Today</button>}
        </div>
      </div>
      <div className="below-filters">
        <div className="search-input"><Search size={17} aria-hidden="true"/><input type="search" aria-label="Search team or competition" placeholder="Search a team or competition…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <label className="demo-toggle"><input type="checkbox" checked={demo} onChange={e=>props.onDemo(e.target.checked)}/><span>Demo fixtures</span></label>
      </div>
      {leagues.length>1&&<div className="league-chips" role="group" aria-label="League">
        <button aria-pressed={!league} className={!league?'active':''} onClick={()=>props.onLeague('')}>All leagues</button>
        {leagues.map(l=><button key={l} aria-pressed={league===l} className={league===l?'active':''} onClick={()=>props.onLeague(l)}>{l}</button>)}
      </div>}
      {demo&&<div className="info-banner" role="note"><strong>Demo mode.</strong> These fixtures are fictional and exist only to exercise the interface and player. They are not real games.</div>}
      {!online&&<div className="info-banner warn" role="status"><WifiOff size={15}/> You're offline. {data?'Showing the last schedule loaded; scores are not updating.':'Reconnect to load the schedule.'}</div>}
      {board.error&&data&&online&&<div className="info-banner warn" role="status">Couldn't refresh: {board.error} Showing results from {timeAgo(board.updatedAt!)}; retrying automatically.</div>}
      {data?.partial&&!data.unavailable&&<div className="info-banner" role="status">Some leagues didn't respond ({data.errors.length}). Results may be incomplete.<details><summary>Details</summary><ul>{data.errors.map(e=><li key={e}>{e}</li>)}</ul></details></div>}
      {loading&&<div className="game-grid" aria-busy="true" aria-label="Loading games">{[1,2,3,4].map(n=><div className="skeleton game-skeleton" key={n}/>)}</div>}
      {!loading&&!data&&board.error&&<div className="empty-state" role="alert"><WifiOff size={30}/><h3>Schedule unavailable</h3><p>{board.error}</p><button className="secondary-button" onClick={props.onRefresh}><RefreshCw size={15}/> Try again</button></div>}
      {!loading&&data?.unavailable&&<div className="empty-state" role="alert"><WifiOff size={30}/><h3>Schedule provider unavailable</h3><p>ESPN's scoreboard didn't respond for any league, so AKStreams can't tell whether games are on. This is not the same as "no games".</p><button className="secondary-button" onClick={props.onRefresh}><RefreshCw size={15}/> Try again</button></div>}
      {!loading&&data&&!data.unavailable&&!filtered.length&&<div className="empty-state"><CalendarDays size={32}/>
        <h3>{events.length?'No games match your filters':`No ${sport==='all'?'NBA or soccer':sport==='soccer'?'soccer':'NBA'} games ${date===todayDate?'today':`on ${formatDay(date)}`}`}</h3>
        <p>{events.length?'Clear the search or league filter.':'Covered: NBA, Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the Champions League (times in your time zone).'}</p>
        <div className="error-actions"><button className="secondary-button" onClick={()=>props.onDate(shiftDate(date,1))}>Next day <ArrowRight size={14}/></button>{(search||league)&&<button className="secondary-button" onClick={()=>{setSearch('');props.onLeague('');}}>Clear filters</button>}</div>
      </div>}
      {!loading&&groups.map(([title,subtitle,games])=>games.length>0&&<section className="game-section" key={title} aria-label={title}>
        <div className="game-section-head"><h3>{title}</h3><span>{subtitle}</span></div>
        <div className="game-grid">{games.map(e=><GameCard key={e.id} event={e} onOpen={props.onOpen}/>)}</div>
      </section>)}
      {data&&<p className="tz-note muted">Times shown in {data.timeZone.replace(/_/g,' ')}. Schedules and scores: ESPN public scoreboard.</p>}
    </section>
  </main>;
}

function GameCard({event,onOpen}:{event:Event;onOpen:(e:Event)=>void}) {
  return <button className={`game-card ${event.status==='live'?'is-live':''}`} onClick={()=>onOpen(event)}
    aria-label={`${event.home} vs ${event.away}, ${event.league}${hasScore(event)?`, ${event.homeScore} to ${event.awayScore}`:''}. Find sources`}>
    <div className="game-card-top"><span className="league-label">{event.league.toUpperCase()}</span><EventStatus event={event}/></div>
    <div className="matchup">
      <div className="club"><Logo name={event.home} url={event.homeLogo}/><strong>{compactName(event.home)}</strong></div>
      <div className="match-vs">{hasScore(event)?<span className="score">{event.homeScore}<small>:</small>{event.awayScore}</span>:<span>VS</span>}</div>
      <div className="club"><Logo name={event.away} url={event.awayLogo}/><strong>{compactName(event.away)}</strong></div>
    </div>
    <div className="game-card-bottom"><span>{event.sport==='soccer'?'Soccer':'Basketball'}{event.broadcasters.length?` · ${event.broadcasters.slice(0,2).join(', ')}`:''}</span><span className="card-cta">Sources <ChevronRight size={15}/></span></div>
  </button>;
}
