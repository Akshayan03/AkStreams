import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cached } from '../lib/cache.mjs';
import { channelMatchesBroadcaster, isPublicHttpUrl, matchEventTitle } from '../lib/match.mjs';
import { safeFetch, redactSecrets } from '../lib/net.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_PLAYLIST_BYTES = 3_000_000;
const MAX_URLS = 5;

// Supports standard EXTINF tvg-name/group-title, e.g.
// #EXTINF:-1 tvg-name="Team A vs Team B" group-title="Sports",Team A vs Team B
// https://your-authorized-server/live/match.m3u8
export function parseM3U(text, origin='playlist') {
  const result = []; let current=null;
  for (const line of String(text).split(/\r?\n/).map(x=>x.trim())) {
    if (line.startsWith('#EXTINF:')) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
      const display = line.replace(/([\w-]+)="[^"]*"/g, '').split(',').slice(1).join(',').trim();
      current={ title:(attrs['tvg-name'] || display || 'Unnamed channel').slice(0, 200),
        channel:(attrs['tvg-name'] || display || '').slice(0, 200),
        group: (attrs['group-title'] || '').slice(0, 100), origin };
    } else if (line && !line.startsWith('#') && current) {
      if (isPublicHttpUrl(line)) result.push({ ...current, url:line,kind:/\.m3u8(?:[?#]|$)/i.test(line)?'hls':'external' });
      current=null;
    }
  }
  return result;
}
function rawUrls() { return (process.env.AUTHORIZED_M3U_URLS || '').split(',').map(s=>s.trim()).filter(Boolean); }
function urls() { return rawUrls().filter(u => isPublicHttpUrl(u) && new URL(u).protocol === 'https:').slice(0, MAX_URLS); }
function filePath() { const f = (process.env.AUTHORIZED_M3U_FILE || '').trim(); return f ? path.resolve(ROOT, f) : ''; }
function configured() { return Boolean(urls().length || filePath()); }
const state = { lastError: '', lastErrorAt: '', lastSuccessAt: '', channelCount: 0 };

export function playlistConfigIssues() {
  const issues = [];
  const bad = rawUrls().filter(u => !(isPublicHttpUrl(u) && new URL(u).protocol === 'https:'));
  if (bad.length) issues.push(`${bad.length} playlist URL(s) ignored: must be public https:// URLs (private/LAN hosts are blocked).`);
  if (rawUrls().filter(u => isPublicHttpUrl(u) && new URL(u).protocol === 'https:').length > MAX_URLS) issues.push(`Only the first ${MAX_URLS} playlist URLs are used.`);
  if (!rawUrls().length && !filePath()) issues.push('Set AUTHORIZED_M3U_URLS or AUTHORIZED_M3U_FILE.');
  return issues;
}

async function loadList() {
  return cached('playlists', 3 * 60_000, async () => {
    const errors = [];
    const fetched=await Promise.allSettled(urls().map(async url=>{
      const host = new URL(url).hostname;
      try {
        const response=await safeFetch(url,{ timeoutMs:8000, maxBytes:MAX_PLAYLIST_BYTES });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseM3U(response.text(), host);
      } catch (error) { throw new Error(`Playlist ${host}: ${redactSecrets(error.message)}`); }
    }));
    fetched.forEach(r => { if (r.status === 'rejected') errors.push(r.reason.message); });
    const all=fetched.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    const file = filePath();
    if (file) {
      try {
        const info = await stat(file);
        if (info.size > MAX_PLAYLIST_BYTES) throw new Error('file larger than 3 MB');
        all.push(...parseM3U(await readFile(file,'utf8'),'Local playlist'));
      } catch(e) { errors.push(`Local playlist ${path.basename(file)}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`); }
    }
    state.channelCount = Math.min(all.length, 5000);
    if (errors.length) { state.lastError = errors.join(' '); state.lastErrorAt = new Date().toISOString(); }
    else state.lastError = '';
    if (all.length || !errors.length) state.lastSuccessAt = new Date().toISOString();
    return { channels: all.slice(0,5000), errors };
  });
}
export async function getPlaylistChannels() {
  if (!configured()) return { channels: [], errors: [], configured: false };
  const { channels, errors } = await loadList();
  return { channels: channels.filter(c=> /sport|basket|soccer|football|nba|live|match/i.test(`${c.group} ${c.title}`)).slice(0,160), errors, configured: true };
}
export async function findPlaylist(event) {
  if (!configured()) return { sources: [], status: 'not-configured', detail: 'Set AUTHORIZED_M3U_URLS or AUTHORIZED_M3U_FILE' };
  if (event.isDemo) return { sources: [], status: 'skipped', detail: 'Demo fixture' };
  const { channels, errors } = await loadList();
  if (!channels.length && errors.length) throw new Error(errors.join(' '));
  const sources = channels.flatMap((c,index)=>{
    const hit=matchEventTitle(event,c.title);
    if (hit.status === 'playable') return [{
      id:`playlist:${index}`,provider:c.origin,title:c.title,kind:c.kind,url:c.url,
      confidence:hit.score,reason:`${hit.reason} (playlist entry title)`,status:'playable',origin:c.origin
    }];
    if (channelMatchesBroadcaster(c.channel,event.broadcasters)) return [{
      id:`playlist:${index}`,provider:c.origin,title:`${c.channel} · possible broadcaster`,kind:c.kind,url:c.url,
      confidence:55,reason:'Channel name matches an announced broadcaster. This game is NOT confirmed on the channel.',status:'candidate',origin:c.origin
    }];
    return [];
  });
  const detail = `${channels.length} playlist entr${channels.length === 1 ? 'y' : 'ies'} scanned` + (errors.length ? `; ${errors.join(' ')}` : '');
  return { sources, status: errors.length ? 'partial' : 'ok', detail };
}
export function playlistInfo() { return { id:'playlist',name:'Authorized M3U/HLS playlists',enabled:configured(), kind:'playlist',
  description:configured()?`Scans ${urls().length} playlist URL(s)${filePath() ? ' + local file' : ''} for event titles and announced broadcasters`:'Set AUTHORIZED_M3U_URLS or AUTHORIZED_M3U_FILE',
  issues: playlistConfigIssues(), ...state };
}
