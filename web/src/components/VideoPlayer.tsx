import {useEffect,useRef} from 'react';
import Hls from 'hls.js';
import {ExternalLink,Play,RadioTower} from 'lucide-react';
import type {Source} from '../types';

export function VideoPlayer({source}:{source:Source|null}) {
  const ref=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(!source || source.kind!=='hls'|| !ref.current)return;
    const element=ref.current;
    let hls:Hls|null=null;
    if(Hls.isSupported()) {
      hls=new Hls({liveSyncDurationCount:3,maxBufferLength:30});
      hls.loadSource(source.url);hls.attachMedia(element);
    } else if(element.canPlayType('application/vnd.apple.mpegurl')){
      element.src=source.url;
    }
    return ()=>{ hls?.destroy();element.removeAttribute('src');element.load(); };
  },[source?.id,source?.url]);
  if(!source) return <div className="player-placeholder">
    <div className="player-placeholder-icon"><RadioTower size={26}/></div>
    <h3>No stream selected</h3>
    <p>Choose a discovered source below. AKStreams does not invent or host game streams.</p>
  </div>;
  if(source.kind==='youtube')return <iframe className="video-frame" title={source.title}
    src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.videoId||'')}?autoplay=1`}
    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>;
  if(source.kind==='hls')return <div className="video-hls-wrap">
    <video ref={ref} controls playsInline autoPlay className="video-frame"/>
    <a className="video-fallback" href={source.url} target="_blank" rel="noopener noreferrer">Open source directly <ExternalLink size={12}/></a>
  </div>;
  return <div className="player-placeholder">
    <div className="player-placeholder-icon"><Play size={26}/></div>
    <h3>Open external broadcaster</h3><p>This provider does not support embedded playback.</p>
    <a className="primary-button" target="_blank" rel="noopener noreferrer" href={source.url}>Open stream <ExternalLink size={15}/></a>
  </div>;
}
