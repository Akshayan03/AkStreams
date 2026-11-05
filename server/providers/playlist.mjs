import { readFile } from 'node:fs/promises';
import { cached } from '../lib/cache.mjs';
import { channelMatchesBroadcaster, isPublicHttpUrl, matchEventTitle, normalize } from '../lib/match.mjs';

// Supports standard EXTINF tvg-name/group-title, e.g.
// #EXTINF:-1 tvg-name="Team A vs Team B" group-title="Sports",Team A vs Team B
// https://your-authorized-server/live/match.m3u8
export function parseM3U(text, origin='playlist') {
  const result = []; let current=null;
  for (const line of String(text).split(/\r?\n/).map(x=>x.trim())) {
    if (line.startsWith('#EXTINF:')) {
      const attrs = Object.fromEntries([...line.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
      current={ title:attrs['tvg-name'] || line.split(',').slice(1).join(',').trim() || 'Unnamed channel',
        channel:attrs['tvg-name'] || line.split(',').slice(1).join(',').trim() || '',
        group: attrs['group-title'] || '', origin };
    } else if (line && !line.startsWith('#') && current) {
      if (isPublicHttpUrl(line)) result.push({ ...current, url:line,kind:/\.m3u8(?:\?|$)/i.test(line)?'hls':'external' });
      current=null;
    }
  }
  return result;
}
function configured() { return Boolean((process.env.AUTHORIZED_M3U_URLS || '').trim() || (process.env.AUTHORIZED_M3U_FILE || '').trim()); }
async function loadList() {
  return cached('playlists', 3 * 60_000, async () => {
    const urls=(process.env.AUTHORIZED_M3U_URLS || '').split(',').map(s=>s.trim()).filter(isPublicHttpUrl).slice(0,5);
    const fetched=await Promise.allSettled(urls.map(async url=>{
      const response=await fetch(url,{signal:AbortSignal.timeout(7000)});
      if (!response.ok) throw new Error(`Playlist request failed: ${response.status}`);
      const text=await response.text();
      if (text.length>3_000_000) throw new Error('Playlist too large');
      return parseM3U(text,new URL(url).hostname);
    }));
    let all=fetched.flatMap(r=>r.status==='fulfilled'?r.value:[]);
    if (process.env.AUTHORIZED_M3U_FILE) {
      try { all.push(...parseM3U(await readFile(process.env.AUTHORIZED_M3U_FILE,'utf8'),'Local playlist')); }
      catch(e) { console.warn('Local playlist not found:',e.message); }
    }
    return all.slice(0,5000);
  });
}
export async function getPlaylistChannels() {
  const channels=await loadList();
  return channels.filter(c=> /sport|basket|soccer|football|nba|live|match/i.test(`${c.group} ${c.title}`)).slice(0,160);
}
export async function findPlaylist(event) {
  if (!configured() || event.isDemo) return [];
  const channels=await loadList();
  return channels.flatMap((c,index)=>{
    const hit=matchEventTitle(event,c.title);
    if (hit.status === 'playable') return [{
      id:`playlist:${index}`,provider:c.origin,title:c.title,kind:c.kind,url:c.url,
      confidence:hit.score,reason:hit.reason,status:'playable'
    }];
    if (channelMatchesBroadcaster(c.channel,event.broadcasters)) return [{
      id:`playlist:${index}`,provider:c.origin,title:`${c.channel} · possible broadcaster`,kind:c.kind,url:c.url,
      confidence:55,reason:'Channel name matches an announced broadcaster. This game is NOT confirmed on the channel.',status:'candidate'
    }];
    return [];
  });
}
export function playlistInfo() { return { id:'playlist',name:'Authorized M3U/HLS playlists',enabled:configured(),
  description:configured()?'Scans configured playlists for event titles and announced broadcasters':'Set AUTHORIZED_M3U_URLS or AUTHORIZED_M3U_FILE' };
}
