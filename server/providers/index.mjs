import { cached } from '../lib/cache.mjs';
import { dedupeSources } from '../lib/match.mjs';
import { findYouTube,youtubeInfo } from './youtube.mjs';
import { findPlaylist,playlistInfo } from './playlist.mjs';

const plugins=[{ id:'youtube',find:findYouTube,info:youtubeInfo },{ id:'playlist',find:findPlaylist,info:playlistInfo }];
export function providerInfo() { return plugins.map(x=>x.info()); }
export async function resolveSources(event,refresh=false) {
  if (event.isDemo) return { sources:process.env.DEMO_STREAM==='true' ? [{
    id:'demo:hls',provider:'Mux public player test',title:'HLS sample (not a sports broadcast)',
    kind:'hls',url:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',confidence:100,
    reason:'Demonstration only',status:'playable' }] : [], providerErrors:[] };
  const loader=async()=>{
    const results=await Promise.allSettled(plugins.map(p=>p.find(event)));
    const sources=dedupeSources(results.flatMap(r=>r.status==='fulfilled'?r.value:[]));
    const providerErrors=results.flatMap((r,i)=>r.status==='rejected' ? [`${plugins[i].id}: ${r.reason?.message || r.reason}`] : []);
    return {sources,providerErrors};
  };
  return refresh? loader() : cached(`sources:${event.id}`,90_000,loader);
}
