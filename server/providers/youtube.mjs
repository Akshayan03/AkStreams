import { cached } from '../lib/cache.mjs';
import { matchEventTitle } from '../lib/match.mjs';
import { safeFetch, redactSecrets } from '../lib/net.mjs';

const CHANNEL_RE = /^UC[a-zA-Z0-9_-]{22}$/;
const MAX_CHANNELS = 10; // each search.list call costs 100 quota units
function rawIds() { return (process.env.OFFICIAL_YOUTUBE_CHANNEL_IDS || '').split(',').map(s=>s.trim()).filter(Boolean); }
function ids() { return [...new Set(rawIds().filter(s=>CHANNEL_RE.test(s)))].slice(0, MAX_CHANNELS); }
function keyValue() { return (process.env.YOUTUBE_API_KEY || '').trim(); }
function configured() { return Boolean(keyValue() && ids().length); }
const state = { lastError: '', lastErrorAt: '', lastSuccessAt: '' };

export function youtubeConfigIssues() {
  const issues = [];
  const key = keyValue();
  if (!key) issues.push('YOUTUBE_API_KEY is not set.');
  else if (!/^[A-Za-z0-9_-]{30,60}$/.test(key)) issues.push('YOUTUBE_API_KEY does not look like a Google API key (expected ~39 characters, usually starting with "AIza").');
  const invalid = rawIds().filter(s => !CHANNEL_RE.test(s));
  if (invalid.length) issues.push(`${invalid.length} channel ID(s) ignored: must look like UC + 22 characters (use the channel ID, not a @handle or URL).`);
  if (!rawIds().length) issues.push('OFFICIAL_YOUTUBE_CHANNEL_IDS is empty.');
  if (ids().length < new Set(rawIds().filter(s=>CHANNEL_RE.test(s))).size) issues.push(`Only the first ${MAX_CHANNELS} channels are searched to protect API quota.`);
  return issues;
}

const REASONS = {
  quotaExceeded: 'YouTube API daily quota exhausted; discovery resumes after the quota resets (midnight Pacific).',
  dailyLimitExceeded: 'YouTube API daily quota exhausted.',
  keyInvalid: 'YouTube rejected the API key. Check YOUTUBE_API_KEY.',
  accessNotConfigured: 'YouTube Data API v3 is not enabled for this key\'s Google Cloud project.',
  forbidden: 'YouTube refused the request for this key (check API restrictions on the key).',
  ipRefererBlocked: 'The API key is restricted to other referrers/IPs. Allow server-side use for this key.',
  channelNotFound: 'A configured YouTube channel ID does not exist.',
};
let fetchJson = async url => {
  const response = await safeFetch(url, { timeoutMs: 8000, maxBytes: 1_000_000, headers: { accept: 'application/json' } });
  let payload = null; try { payload = response.json(); } catch {}
  return { ok: response.ok, status: response.status, payload };
};
export function setYouTubeFetcher(fn) { fetchJson = fn; }

async function liveVideos(channelId) {
  return cached(`youtube:${channelId}`, 3 * 60_000, async () => {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({ part:'snippet', channelId, type:'video', eventType:'live', videoEmbeddable:'true',
      maxResults:'50', key:keyValue() }).forEach(([k,v]) => url.searchParams.set(k,v));
    const { ok, status, payload } = await fetchJson(url.href);
    if (!ok) {
      const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || '';
      throw new Error(REASONS[reason] || `YouTube API HTTP ${status}${reason ? ` (${reason})` : ''}`);
    }
    return (payload?.items || []).map(item=>({
      id:item.id?.videoId, title:item.snippet?.title || '', channelName:item.snippet?.channelTitle || 'Official channel',
      channelId:item.snippet?.channelId,
    })).filter(v=>v.id && /^[\w-]{11}$/.test(v.id) && v.channelId === channelId);
  });
}
export async function findYouTube(event) {
  if (!configured()) return { sources: [], status: 'not-configured', detail: 'Needs YOUTUBE_API_KEY and OFFICIAL_YOUTUBE_CHANNEL_IDS' };
  if (event.isDemo) return { sources: [], status: 'skipped', detail: 'Demo fixture' };
  if (['final','postponed','canceled'].includes(event.status)) return { sources: [], status: 'skipped', detail: 'Game is not live; live search skipped' };
  // A game hours away is not yet airing; only look for live videos near kickoff.
  if (event.status !== 'live' && Math.abs(Date.now() - new Date(event.kickoff).getTime()) > 2 * 60 * 60_000) {
    return { sources: [], status: 'skipped', detail: 'Live search starts 2 hours before kickoff' };
  }
  const channelIds = ids();
  const results = await Promise.allSettled(channelIds.map(liveVideos));
  const failures = results.flatMap(r => r.status === 'rejected' ? [redactSecrets(r.reason?.message || r.reason)] : []);
  if (failures.length) { state.lastError = [...new Set(failures)].join(' '); state.lastErrorAt = new Date().toISOString(); }
  if (failures.length === results.length) throw new Error(state.lastError);
  state.lastSuccessAt = new Date().toISOString();
  const videos = results.flatMap(r=>r.status === 'fulfilled' ? r.value : []);
  const sources = videos.flatMap(video=>{
    const match = matchEventTitle(event, video.title);
    if (match.status !== 'playable') return [];
    return [{
      id:`youtube:${video.id}`, provider:'Official YouTube', title: video.title,
      kind:'youtube', url:`https://www.youtube.com/watch?v=${video.id}`,
      videoId:video.id, confidence:match.score,reason:`${match.reason} · live on ${video.channelName}`,
      status:'playable', origin: video.channelName, provenance:'title-match', liveStatus:'live',
    }];
  });
  const detail = `${videos.length} live video(s) on ${channelIds.length - failures.length}/${channelIds.length} channel(s) checked`
    + (failures.length ? `; ${failures.length} channel(s) failed: ${[...new Set(failures)].join(' ')}` : '');
  return { sources, status: failures.length ? 'partial' : 'ok', detail };
}
export function youtubeInfo() {
  return { id:'youtube', name:'Official YouTube Live', enabled:configured(), kind:'youtube',
    description:configured() ? `${ids().length} approved channel(s) searched for live broadcasts naming both teams` : 'Needs YOUTUBE_API_KEY and OFFICIAL_YOUTUBE_CHANNEL_IDS',
    issues: youtubeConfigIssues(), ...state };
}
