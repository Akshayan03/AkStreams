import { cached } from '../lib/cache.mjs';
import { matchEventTitle } from '../lib/match.mjs';

function ids() { return (process.env.OFFICIAL_YOUTUBE_CHANNEL_IDS || '').split(',').map(s=>s.trim()).filter(s=>/^UC[a-zA-Z0-9_-]{22}$/.test(s)); }
function configured() { return Boolean(process.env.YOUTUBE_API_KEY && ids().length); }

async function liveVideos(channelId) {
  return cached(`youtube:${channelId}`, 3 * 60_000, async () => {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({ part:'snippet', channelId, type:'video', eventType:'live',videoEmbeddable:'true',
      maxResults:'50', key:process.env.YOUTUBE_API_KEY }).forEach(([k,v]) => url.searchParams.set(k,v));
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`YouTube discovery error ${response.status}`);
    const payload = await response.json();
    return (payload.items || []).map(item=>({
      id:item.id?.videoId, title:item.snippet?.title || '', channelName:item.snippet?.channelTitle || 'Official channel',
      channelId:item.snippet?.channelId,
    })).filter(v=>v.id && v.channelId === channelId);
  });
}
export async function findYouTube(event) {
  if (!configured() || event.isDemo || event.status === 'final') return [];
  // A game hours away is not yet airing; only look for live videos near kickoff.
  if (event.status !== 'live' && Math.abs(Date.now() - new Date(event.kickoff).getTime()) > 2 * 60 * 60_000) return [];
  const results = await Promise.allSettled(ids().map(liveVideos));
  return results.flatMap(r=>r.status === 'fulfilled' ? r.value : []).flatMap(video=>{
    const match = matchEventTitle(event, video.title);
    if (match.status !== 'playable') return [];
    return [{
      id:`youtube:${video.id}`, provider:'Official YouTube', title: video.title,
      kind:'youtube', url:`https://www.youtube.com/watch?v=${video.id}`,
      videoId:video.id, confidence:match.score,reason:`${match.reason} · ${video.channelName}`,
      status:'playable',
    }];
  });
}
export function youtubeInfo() {
  return { id:'youtube', name:'Official YouTube Live', enabled:configured(),
    description:configured() ? `${ids().length} approved channel(s) indexed for live matches` : 'Needs YOUTUBE_API_KEY and OFFICIAL_YOUTUBE_CHANNEL_IDS' };
}
