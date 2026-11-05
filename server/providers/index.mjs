import { cached } from '../lib/cache.mjs';
import { dedupeSources } from '../lib/match.mjs';
import { redactSecrets } from '../lib/net.mjs';
import { findYouTube,youtubeInfo } from './youtube.mjs';
import { findPlaylist,playlistInfo } from './playlist.mjs';

const plugins=[{ id:'youtube',find:findYouTube,info:youtubeInfo },{ id:'playlist',find:findPlaylist,info:playlistInfo }];
export function providerInfo() { return plugins.map(x=>x.info()); }

// Public, CORS-enabled HLS test streams. VOD clips, NOT sports broadcasts; demo fixtures only.
export const DEMO_SOURCES = [
  { id:'demo:mux-bbb', provider:'Mux public test stream', origin:'test-streams.mux.dev',
    title:'Player test · Big Buck Bunny (HLS, not a sports broadcast)', kind:'hls',
    url:'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', confidence:100,
    reason:'Public HLS sample for testing the player only. It is not this match.', status:'playable', isTest:true },
  { id:'demo:apple-bipbop', provider:'Apple HLS example', origin:'devstreaming-cdn.apple.com',
    title:'Player test · Apple bipbop (HLS, not a sports broadcast)', kind:'hls',
    url:'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', confidence:100,
    reason:'Apple sample HLS stream for testing source switching. It is not this match.', status:'playable', isTest:true },
];
export function demoStreamsEnabled() { return process.env.DEMO_STREAM === 'true'; }

function normalizeResult(value) {
  if (Array.isArray(value)) return { sources: value, status: 'ok', detail: '' };
  return { sources: value?.sources || [], status: value?.status || 'ok', detail: value?.detail || '' };
}
export async function resolveSources(event,refresh=false) {
  if (event.isDemo) {
    const enabled = demoStreamsEnabled();
    return { sources: enabled ? DEMO_SOURCES : [], providerErrors:[], searchedAt:new Date().toISOString(),
      providerResults:[{ id:'demo', name:'Player test streams', status: enabled ? 'ok' : 'not-configured', count: enabled ? DEMO_SOURCES.length : 0,
        detail: enabled ? 'Public HLS samples (not sports) for demo fixtures' : 'Set DEMO_STREAM=true to attach public HLS test streams to demo fixtures' }] };
  }
  const loader=async()=>{
    const results=await Promise.allSettled(plugins.map(p=>p.find(event)));
    const providerResults=results.map((r,i)=>{
      const name = plugins[i].info().name;
      if (r.status==='rejected') return { id:plugins[i].id, name, status:'error', count:0, detail:redactSecrets(r.reason?.message || r.reason) };
      const n = normalizeResult(r.value);
      return { id:plugins[i].id, name, status:n.status, count:n.sources.length, detail:redactSecrets(n.detail) };
    });
    const sources=dedupeSources(results.flatMap(r=>r.status==='fulfilled'?normalizeResult(r.value).sources:[]));
    const providerErrors=providerResults.filter(p=>p.status==='error').map(p=>`${p.name}: ${p.detail}`);
    return {sources,providerErrors,providerResults,searchedAt:new Date().toISOString()};
  };
  return refresh? loader() : cached(`sources:${event.id}`,90_000,loader);
}
