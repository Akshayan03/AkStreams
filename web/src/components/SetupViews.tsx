import {useState} from 'react';
import {AlertTriangle,ExternalLink,Play,Radio,RefreshCw,Video,X} from 'lucide-react';
import type {Channel,ChannelResponse,Provider} from '../types';
import {timeAgo} from '../lib/time';
import {VideoPlayer} from './VideoPlayer';
import {Pill} from './ui';

export function ProvidersView({providers,demoStreams,error,loading,onRefresh}:{providers:Provider[];demoStreams:boolean;error:string;loading:boolean;onRefresh:()=>void}) {
  return <main className="main-content" id="main">
    <div className="section-intro with-action"><div><div className="eyebrow">INTEGRATIONS</div><h1>Source providers</h1>
      <p>Independent modules search for broadcasts you're entitled to and score them against each fixture. Configuration lives in the server's <code>.env</code>; keys never reach this page.</p></div>
      <button className="icon-button" onClick={onRefresh} aria-label="Refresh provider status" disabled={loading}><RefreshCw size={18} className={loading?'spinning':''}/></button></div>
    {error&&<div className="alert" role="alert">{error}</div>}
    <div className="provider-grid">{providers.map(p=><article className="provider-card" key={p.id} aria-label={p.name}>
      <div className="provider-card-top"><div className="provider-symbol">{p.id==='youtube'?<Video size={22}/>:<Radio size={22}/>}</div>
        <Pill tone={p.lastError?'warn':p.enabled?'ok':undefined}>{p.lastError?'ERROR':p.enabled?'CONFIGURED':'NOT CONFIGURED'}</Pill></div>
      <h3>{p.name}</h3><p>{p.description}</p>
      {p.issues&&p.issues.length>0&&<ul className="issue-list">{p.issues.map(i=><li key={i}><AlertTriangle size={13}/> {i}</li>)}</ul>}
      {p.lastError&&<div className="alert small">Last error{p.lastErrorAt?` (${timeAgo(p.lastErrorAt)})`:''}: {p.lastError}</div>}
      <div className="provider-foot">{p.lastSuccessAt?`Last successful search ${timeAgo(p.lastSuccessAt)}`:p.enabled?'Not searched yet — open a game to search':p.id==='youtube'?'Live video discovery + fixture matching':'Playlist ingestion + broadcaster matching'}{p.channelCount?` · ${p.channelCount} playlist entries`:''}</div>
    </article>)}
      <article className="provider-card" aria-label="Player test streams">
        <div className="provider-card-top"><div className="provider-symbol"><Play size={22}/></div><Pill tone={demoStreams?'ok':undefined}>{demoStreams?'ON':'OFF'}</Pill></div>
        <h3>Player test streams</h3><p>Public HLS samples (Mux, Apple) attached to <em>demo fixtures only</em>, to check that playback works on this machine. Not sports.</p>
        <div className="provider-foot">{demoStreams?'Enable "Demo fixtures" on the match center to use them':'Set DEMO_STREAM=true to enable'}</div>
      </article>
    </div>
    <div className="config-instructions">
      <h3>Set up a provider</h3>
      <ol>
        <li>Copy <code>.env.example</code> to <code>.env</code> in the project root (it is git-ignored).</li>
        <li><strong>Official YouTube Live:</strong> create a YouTube Data API v3 key in your own Google Cloud project, then set <code>YOUTUBE_API_KEY</code> and <code>OFFICIAL_YOUTUBE_CHANNEL_IDS</code> (comma-separated <code>UC…</code> IDs of channels that hold streaming rights).</li>
        <li><strong>Authorized playlists:</strong> set <code>AUTHORIZED_M3U_URLS</code> (public https URLs) or <code>AUTHORIZED_M3U_FILE</code> (a local .m3u you're entitled to use).</li>
        <li>Run <code>npm run check-config</code> to validate (add <code>-- --live</code> to test the key and playlists), then restart AKStreams.</li>
      </ol>
      <p className="muted">AKStreams does not scrape paywalled broadcasts or bypass sign-in, DRM or geo restrictions. Without a configured provider it will honestly report that no source exists.</p>
    </div>
  </main>;
}

export function ChannelsView({data,error,loading,onRefresh,onProviders}:{data:ChannelResponse|null;error:string;loading:boolean;onRefresh:()=>void;onProviders:()=>void}) {
  const [playing,setPlaying]=useState<Channel|null>(null);
  const channels=data?.channels??[];
  return <main className="main-content" id="main">
    <div className="section-intro with-action"><div><div className="eyebrow">STREAM DIRECTORY</div><h1>Live channels</h1>
      <p>Sports channels from your authorized playlists. These are channels, not confirmed streams of any specific game.</p></div>
      <button className="icon-button" onClick={onRefresh} aria-label="Reload channels" disabled={loading}><RefreshCw size={18} className={loading?'spinning':''}/></button></div>
    {error&&<div className="alert" role="alert">{error}</div>}
    {data?.errors?.length?<div className="info-banner warn" role="status">{data.errors.join(' ')}</div>:null}
    {playing&&<div className="channel-player"><div className="channel-player-head"><strong>{playing.title}</strong><button className="icon-button" aria-label="Close player" onClick={()=>setPlaying(null)}><X size={16}/></button></div>
      <div className="video-box"><VideoPlayer source={{id:`channel:${playing.url}`,provider:playing.origin,origin:playing.origin,title:playing.title,kind:playing.kind,url:playing.url,confidence:0,status:'candidate',reason:'Playlist channel; not tied to a specific game.'}}/></div></div>}
    {loading&&!data?<div className="skeleton" style={{height:100}}/>
      :data&&!data.configured?<div className="empty-state"><Radio size={30}/><h3>No playlists configured</h3><p>Add <code>AUTHORIZED_M3U_URLS</code> or <code>AUTHORIZED_M3U_FILE</code> to <code>.env</code> and restart. AKStreams indexes the entries automatically.</p><button className="secondary-button" onClick={onProviders}>Provider setup</button></div>
      :data&&!channels.length?<div className="empty-state"><Radio size={30}/><h3>No sports channels found</h3><p>Your playlists loaded but no entries looked like sports channels (group or name containing sport, soccer, football, basketball, NBA, live or match).</p></div>
      :<div className="channel-grid">{channels.map((ch,i)=><div key={`${ch.url}-${i}`} className="channel-card">
        <div className="channel-symbol"><Radio size={20}/></div><strong>{ch.title}</strong><small>{ch.origin} · {ch.group||'Live channel'} · {ch.kind==='hls'?'HLS':'External'}</small>
        <div className="channel-actions">{ch.kind==='hls'&&<button className="secondary-button" onClick={()=>setPlaying(ch)}><Play size={14}/> Play</button>}
          <a className="secondary-button" href={ch.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Open</a></div>
      </div>)}</div>}
  </main>;
}
