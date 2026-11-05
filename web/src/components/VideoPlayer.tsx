import {useCallback,useEffect,useRef,useState} from 'react';
import type Hls from 'hls.js';
import {AlertTriangle,ExternalLink,Maximize,Minimize,Play,RadioTower,RotateCcw,SkipForward,Volume2,VolumeX} from 'lucide-react';
import type {Source} from '../types';
import {LIVE_LABEL} from './ui';

export type PlayerState='idle'|'loading'|'playing'|'buffering'|'paused'|'blocked'|'error';
const START_TIMEOUT_MS=25_000;

function describeHlsError(data:{type:string;details:string;response?:{code:number}}):string {
  const code=data.response?.code;
  if(data.details.startsWith('manifestLoad')||data.details.startsWith('levelLoad')||data.details.startsWith('fragLoad')) {
    if(code===401||code===403) return `The stream origin refused access (HTTP ${code}). It may require sign-in or be geo-restricted; AKStreams does not bypass that.`;
    if(code===404||code===410) return `The stream URL no longer exists (HTTP ${code}). Live links often expire.`;
    if(code===0||code===undefined) return 'The browser could not load the stream. The origin may block cross-origin (CORS) playback or be offline. Try opening it externally.';
    return `The stream origin returned HTTP ${code}.`;
  }
  if(data.details==='manifestParsingError') return 'The URL did not return a valid HLS playlist.';
  if(data.type==='keySystemError'||data.details.startsWith('keySystem')) return 'This stream is DRM-protected and cannot play here.';
  if(data.type==='mediaError') return 'The browser could not decode this stream (unsupported codec or corrupt media).';
  return `Playback failed (${data.details}).`;
}

function Provenance({source}:{source:Source}) {
  const live=source.liveStatus&&source.liveStatus!=='unknown'?` · ${LIVE_LABEL[source.liveStatus]}`:'';
  if(source.isTest) return <div className="player-badge badge-test" role="note">TEST STREAM · not a sports broadcast</div>;
  if(source.provenance==='owner') return source.status==='candidate'
    ?<div className="player-badge badge-candidate" role="note">YOUR CHANNEL · this game is not verified on it</div>
    :<div className="player-badge badge-owner" role="note">ADDED BY YOU · attached to this game</div>;
  if(source.status==='candidate') return <div className="player-badge badge-candidate" role="note">UNCONFIRMED CHANNEL · this game is not verified on it</div>;
  if(source.provenance==='official-feed') return <div className={`player-badge badge-official ${source.liveStatus==='live'?'is-live':''}`} role="note">OFFICIAL · {source.origin}{live} · FREE</div>;
  return <div className="player-badge" role="note">TITLE MATCH · {source.origin||source.provider}{live}</div>;
}
// YouTube embeds run sandboxed: scripts and their own origin only. No popups, top navigation,
// forms or downloads. enablejsapi lets the page read player state over postMessage.
const youtubeEmbed=(videoId:string)=>`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${new URLSearchParams({autoplay:'1',playsinline:'1',rel:'0',enablejsapi:'1',origin:location.origin})}`;

export function VideoPlayer({source,onNext,hasNext=false}:{source:Source|null;onNext?:()=>void;hasNext?:boolean}) {
  const frameRef=useRef<HTMLDivElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const [state,setState]=useState<PlayerState>('idle');
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [muted,setMuted]=useState(false);
  const [fullscreen,setFullscreen]=useState(false);

  useEffect(()=>{
    const f=()=>setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange',f);
    return ()=>document.removeEventListener('fullscreenchange',f);
  },[]);

  useEffect(()=>{
    const element=videoRef.current;
    if(!source||source.kind!=='hls'||!element){ setState('idle'); setError(''); return; }
    let hls:Hls|null=null;
    let disposed=false;
    let started=false;
    let networkRetries=0,mediaRecoveries=0;
    setState('loading');setError('');
    const fail=(message:string)=>{ if(disposed)return; setState('error');setError(message); hls?.stopLoad(); element.pause(); };
    const startTimer=setTimeout(()=>{ if(!started) fail('The stream did not start within 25 seconds. It may be offline, blocked by CORS, or unavailable in your region.'); },START_TIMEOUT_MS);
    const tryPlay=()=>{
      element.play().catch(e=>{
        if(disposed)return;
        if((e as DOMException).name==='NotAllowedError') {
          // Autoplay with sound blocked: retry muted and tell the viewer.
          element.muted=true;setMuted(true);
          element.play().catch(()=>{ if(!disposed) setState('blocked'); });
        }
      });
    };
    const onPlaying=()=>{ started=true;clearTimeout(startTimer);setState('playing'); };
    const onWaiting=()=>{ if(started) setState('buffering'); };
    const onPause=()=>{ if(started&&!element.ended) setState('paused'); };
    const onVolume=()=>setMuted(element.muted);
    const onNativeError=()=>{ if(!hls) fail(element.error?.code===4?'This browser cannot play the stream format, or the URL is not reachable.':'Playback failed in the browser.'); };
    element.addEventListener('playing',onPlaying);element.addEventListener('waiting',onWaiting);
    element.addEventListener('pause',onPause);element.addEventListener('volumechange',onVolume);element.addEventListener('error',onNativeError);
    element.muted=muted;

    (async()=>{
      const {default:HlsCtor}=await import('hls.js');
      if(disposed)return;
      if(HlsCtor.isSupported()) {
        hls=new HlsCtor({liveSyncDurationCount:3,maxBufferLength:30,manifestLoadingMaxRetry:2,levelLoadingMaxRetry:2,fragLoadingMaxRetry:3,enableWorker:true});
        hls.on(HlsCtor.Events.ERROR,(_evt,data)=>{
          if(!data.fatal||disposed)return;
          if(data.type===HlsCtor.ErrorTypes.NETWORK_ERROR&&started&&networkRetries<3) { networkRetries++; setState('buffering'); setTimeout(()=>{ if(!disposed) hls?.startLoad(); },1000*networkRetries); return; }
          if(data.type===HlsCtor.ErrorTypes.MEDIA_ERROR&&mediaRecoveries<2) { mediaRecoveries++; if(mediaRecoveries===2) hls?.swapAudioCodec(); hls?.recoverMediaError(); return; }
          fail(describeHlsError(data as never));
        });
        hls.on(HlsCtor.Events.MANIFEST_PARSED,tryPlay);
        hls.loadSource(source.url);hls.attachMedia(element);
      } else if(element.canPlayType('application/vnd.apple.mpegurl')) {
        element.src=source.url;tryPlay();
      } else fail('This browser cannot play HLS streams. Open the stream in Safari or VLC.');
    })().catch(()=>fail('The HLS player failed to load.'));

    return ()=>{
      disposed=true;clearTimeout(startTimer);
      element.removeEventListener('playing',onPlaying);element.removeEventListener('waiting',onWaiting);
      element.removeEventListener('pause',onPause);element.removeEventListener('volumechange',onVolume);element.removeEventListener('error',onNativeError);
      hls?.destroy();
      element.pause();element.removeAttribute('src');element.load();
    };
    // `muted` is read once per load on purpose; toggling mute must not reload the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[source?.id,source?.url,source?.kind,attempt]);

  const retry=useCallback(()=>setAttempt(a=>a+1),[]);
  const toggleFullscreen=useCallback(()=>{
    const frame=frameRef.current;if(!frame)return;
    if(document.fullscreenElement) { void document.exitFullscreen(); return; }
    if(frame.requestFullscreen) { frame.requestFullscreen().catch(()=>{}); return; }
    const v=videoRef.current as (HTMLVideoElement&{webkitEnterFullscreen?:()=>void})|null;
    v?.webkitEnterFullscreen?.();
  },[]);
  const toggleMute=useCallback(()=>{ const v=videoRef.current; if(v){ v.muted=!v.muted; setMuted(v.muted); if(v.paused&&state==='blocked') void v.play(); } },[state]);
  const togglePlay=useCallback(()=>{ const v=videoRef.current; if(!v)return; if(v.paused) v.play().catch(()=>setState('blocked')); else v.pause(); },[]);

  function onKeyDown(e:React.KeyboardEvent) {
    if(e.target instanceof HTMLButtonElement||e.target instanceof HTMLAnchorElement)return;
    if(e.altKey||e.ctrlKey||e.metaKey)return;
    const k=e.key.toLowerCase();
    if(k==='f'){e.preventDefault();toggleFullscreen();}
    else if(source?.kind==='hls'&&(k===' '||k==='k')){e.preventDefault();togglePlay();}
    else if(source?.kind==='hls'&&k==='m'){e.preventDefault();toggleMute();}
    else if(k==='r'&&state==='error'){e.preventDefault();retry();}
  }

  if(!source) return <div className="player-placeholder" data-player-state="idle">
    <div className="player-placeholder-icon"><RadioTower size={26}/></div>
    <h3>No stream selected</h3>
    <p>Choose a discovered source. AKStreams does not invent or host game streams.</p>
  </div>;

  const toolbar=<div className="player-toolbar">
    <span className={`player-state state-${state}`} aria-live="polite">{source.kind==='hls'?{idle:'Ready',loading:'Connecting…',playing:'Playing',buffering:'Buffering…',paused:'Paused',blocked:'Click play to start',error:'Playback failed'}[state]:source.kind==='youtube'?'YouTube player':'External source'}</span>
    <span className="toolbar-spacer"/>
    {source.kind==='hls'&&<button className="tool-button" onClick={toggleMute} aria-label={muted?'Unmute':'Mute'} title={muted?'Unmute (m)':'Mute (m)'}>{muted?<VolumeX size={16}/>:<Volume2 size={16}/>}</button>}
    {source.kind==='hls'&&<button className="tool-button" onClick={retry} aria-label="Reload stream" title="Reload stream"><RotateCcw size={16}/></button>}
    {hasNext&&onNext&&<button className="tool-button" onClick={onNext} aria-label="Try next source" title="Try next source"><SkipForward size={16}/></button>}
    <a className="tool-button" href={source.url} target="_blank" rel="noopener noreferrer" aria-label="Open source in a new tab" title="Open source in a new tab"><ExternalLink size={16}/></a>
    {source.kind!=='external'&&<button className="tool-button" onClick={toggleFullscreen} aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} title="Fullscreen (f)">{fullscreen?<Minimize size={16}/>:<Maximize size={16}/>}</button>}
  </div>;

  return <div className="player" data-player-state={source.kind==='hls'?state:source.kind} data-source-id={source.id}>
    <div className="player-frame" ref={frameRef} tabIndex={0} onKeyDown={onKeyDown}
      aria-label={`Video player: ${source.title}. Keys: space play/pause, m mute, f fullscreen.`}>
      <Provenance source={source}/>
      {source.kind==='youtube'&&<iframe key={source.videoId} className="video-frame" title={source.title}
        src={youtubeEmbed(source.videoId||'')} sandbox="allow-scripts allow-same-origin allow-presentation"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>}
      {source.kind==='hls'&&<video ref={videoRef} controls playsInline className="video-frame" aria-label={source.title}/>}
      {source.kind==='external'&&<div className="player-placeholder">
        <div className="player-placeholder-icon"><Play size={26}/></div>
        <h3>Opens on the provider's site</h3><p>This source can't be embedded here. It opens in a new tab on {source.origin||source.provider}, which may ask you to sign in.</p>
        <a className="primary-button" target="_blank" rel="noopener noreferrer" href={source.url}>Open source <ExternalLink size={15}/></a>
      </div>}
      {source.kind==='hls'&&state==='loading'&&<div className="player-overlay" aria-hidden="true"><span className="spinner"/></div>}
      {source.kind==='hls'&&state==='blocked'&&<button className="player-overlay overlay-button" onClick={togglePlay}><Play size={34}/><span>Click to play</span></button>}
      {source.kind==='hls'&&state==='error'&&<div className="player-overlay player-error" role="alert">
        <AlertTriangle size={28}/><strong>Can't play this source</strong><p>{error}</p>
        <div className="error-actions">
          <button className="secondary-button" onClick={retry}><RotateCcw size={15}/> Retry</button>
          {hasNext&&onNext&&<button className="secondary-button" onClick={onNext}><SkipForward size={15}/> Next source</button>}
          <a className="secondary-button" href={source.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/> Open externally</a>
        </div>
      </div>}
    </div>
    {toolbar}
  </div>;
}
