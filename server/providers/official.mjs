import { cached } from '../lib/cache.mjs';
import { matchEventTitle } from '../lib/match.mjs';
import { safeFetch, redactSecrets } from '../lib/net.mjs';

// Keyless discovery of FREE official broadcasts on governing-body YouTube channels.
// - Listing: each channel's public Atom feed (youtube.com/feeds/videos.xml), the official,
//   key-free feed YouTube publishes for every channel (latest ~15 uploads).
// - Verification: the public watch page's player metadata (playability, embeddability,
//   live/upcoming/ended), falling back to the public oEmbed endpoint. Nothing behind sign-in is
//   requested; if YouTube answers with a consent or bot check, the video is reported as
//   unverified rather than worked around.
// Channel provenance (checked 2026-11-05): fiba.basketball links to youtube.com/fiba, which
// resolves to the channel below; FIBA3x3 is the @FIBA3x3 handle's canonical channel.
// Being public on YouTube does not by itself establish streaming rights for any region;
// each rights holder geo-restricts as it chooses.
export const OFFICIAL_CHANNELS = [
  { id: 'UCtInrnU3QbWqFGsdKT1GZtg', name: 'FIBA', handle: '@FIBA', owner: 'FIBA (International Basketball Federation)' },
  { id: 'UC7LpyJP5fupiJu2CdzRQheg', name: 'FIBA3x3', handle: '@FIBA3x3', owner: 'FIBA 3x3' },
];
const VIDEO_ID_RE = /^[\w-]{11}$/;
const MAX_VERIFY_PER_CHANNEL = 12;

let fetchText = async (url, maxBytes) => {
  const response = await safeFetch(url, { timeoutMs: 8000, maxBytes, headers: { 'accept-language': 'en-US,en;q=0.8' } });
  return { ok: response.ok, status: response.status, url: response.url, text: response.text() };
};
export function setOfficialFetcher(fn) { fetchText = fn; }
export function officialEnabled() { return process.env.OFFICIAL_FEEDS !== 'off'; }
const state = { lastError: '', lastErrorAt: '', lastSuccessAt: '', channelCount: 0 };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#'
  ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`)); return m ? decodeXml(m[1]).trim() : ''; };

/** Parses a YouTube channel Atom feed into entries. */
export function parseChannelFeed(xml) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, body]) => {
    const videoId = tag(body, 'yt:videoId');
    if (!VIDEO_ID_RE.test(videoId)) return [];
    const link = body.match(/<link rel="alternate" href="([^"]+)"/)?.[1] || '';
    return [{ videoId, channelId: tag(body, 'yt:channelId'), title: tag(body, 'title').slice(0, 300),
      published: tag(body, 'published'), updated: tag(body, 'updated'), isShort: /\/shorts\//.test(link) }];
  });
}

/** Extracts the balanced JSON object that follows `marker` in an HTML page (string-aware). */
export function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

/**
 * Live status from the watch page's player response:
 * live (broadcasting now) · upcoming (scheduled) · replay (ended stream, or full-length upload)
 * · highlights (short clip).
 */
export function classifyPlayer(player, videoId, now = Date.now()) {
  const details = player?.videoDetails;
  if (!details || details.videoId !== videoId) return { verified: false, reason: 'Video metadata missing from the response' };
  const ps = player.playabilityStatus || {};
  // Bot checks and age gates both surface as LOGIN_REQUIRED; neither is worked around.
  if (ps.status === 'LOGIN_REQUIRED') return { verified: false, reason: 'YouTube requires sign-in or a bot check for this video (not bypassed)' };
  const live = player.microformat?.playerMicroformatRenderer?.liveBroadcastDetails || {};
  const length = Number(details.lengthSeconds || 0);
  const embeddable = ps.playableInEmbed !== false;
  let liveStatus;
  if (live.isLiveNow === true && ps.status === 'OK') liveStatus = 'live';
  else if (details.isUpcoming === true || (ps.status === 'LIVE_STREAM_OFFLINE' && live.startTimestamp && Date.parse(live.startTimestamp) > now - 6 * 3600_000 && !live.endTimestamp)) liveStatus = 'upcoming';
  else if (details.isLiveContent === true) liveStatus = 'replay';
  else liveStatus = length > 0 && length < 240 ? 'highlights' : 'replay';
  const unavailable = !['OK', 'LIVE_STREAM_OFFLINE'].includes(ps.status);
  return { verified: true, title: String(details.title || ''), channelId: String(details.channelId || ''), channelName: String(details.author || ''),
    liveStatus, embeddable, unavailable, unavailableReason: unavailable ? String(ps.reason || ps.status || 'Unavailable') : '',
    scheduledStart: live.startTimestamp || '', endedAt: live.endTimestamp || '', lengthSeconds: length };
}

/** Verifies one video: watch-page player metadata, else oEmbed (title + embeddability only). */
export async function verifyVideo(videoId) {
  if (!VIDEO_ID_RE.test(videoId)) throw new Error('Invalid YouTube video ID');
  return cached(`ytmeta:${videoId}`, meta => meta.liveStatus === 'live' ? 60_000 : meta.liveStatus === 'upcoming' || !meta.verified ? 120_000 : 30 * 60_000, async () => {
    let blocked = '';
    try {
      const page = await fetchText(`https://www.youtube.com/watch?v=${videoId}`, 3_000_000);
      if (page.ok && !/consent\.|\/sorry\//.test(page.url || '')) {
        const meta = classifyPlayer(extractJsonAfter(page.text, 'ytInitialPlayerResponse'), videoId);
        if (meta.verified) return { ...meta, method: 'watch-page' };
        blocked = /confirm you(?:'|&#39;|\\u0027)re not a bot|consent\.youtube\.com/i.test(page.text) ? 'YouTube asked for a bot/consent check (not bypassed)' : meta.reason;
      } else blocked = `watch page HTTP ${page.status}${/consent\.|\/sorry\//.test(page.url || '') ? ' (consent/bot check, not bypassed)' : ''}`;
    } catch (error) { blocked = redactSecrets(error?.message || error); }
    const oembed = await fetchText(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, 100_000);
    if (oembed.status === 401 || oembed.status === 403) return { verified: false, method: 'oembed', embeddable: false, liveStatus: 'unknown', title: '', reason: `Embedding disabled by the channel; live status unverified (${blocked})` };
    if (!oembed.ok) return { verified: false, method: 'oembed', embeddable: null, liveStatus: 'unknown', title: '', missing: oembed.status === 404 || oembed.status === 400, reason: `Video not found or private (oEmbed HTTP ${oembed.status}); ${blocked}` };
    let data = {}; try { data = JSON.parse(oembed.text); } catch {}
    return { verified: false, method: 'oembed', embeddable: true, liveStatus: 'unknown', title: String(data.title || ''), channelName: String(data.author_name || ''),
      reason: `Live status unverified: ${blocked}` };
  });
}

async function channelFeed(channel) {
  return cached(`ytfeed:${channel.id}`, 3 * 60_000, async () => {
    const res = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`, 1_000_000);
    if (!res.ok) throw new Error(`${channel.name} feed HTTP ${res.status}`);
    const entries = parseChannelFeed(res.text).filter(e => e.channelId === channel.id);
    if (!entries.length && !/<feed\b/.test(res.text)) throw new Error(`${channel.name} feed returned no Atom document`);
    return entries;
  });
}
const RANK = { live: 0, upcoming: 1, replay: 2, unknown: 3, highlights: 4 };

/** All recent official videos, verified and classified. Shorts are skipped without fetching. */
export async function getOfficialBroadcasts() {
  if (!officialEnabled()) return { enabled: false, channels: OFFICIAL_CHANNELS, items: [], errors: [], checkedAt: new Date().toISOString() };
  const errors = [];
  const feeds = await Promise.allSettled(OFFICIAL_CHANNELS.map(channelFeed));
  const items = (await Promise.all(feeds.map(async (feed, i) => {
    const channel = OFFICIAL_CHANNELS[i];
    if (feed.status === 'rejected') { errors.push(redactSecrets(feed.reason?.message || feed.reason)); return []; }
    const entries = feed.value.filter(e => !e.isShort).slice(0, MAX_VERIFY_PER_CHANNEL);
    return Promise.all(entries.map(async entry => {
      let meta;
      try { meta = await verifyVideo(entry.videoId); }
      catch (error) { meta = { verified: false, liveStatus: 'unknown', embeddable: null, reason: redactSecrets(error?.message || error) }; }
      return toItem(entry, channel, meta);
    }));
  }))).flat().filter(item => !item.unavailable);
  items.sort((a, b) => RANK[a.liveStatus] - RANK[b.liveStatus]
    || (a.liveStatus === 'upcoming' ? Date.parse(a.scheduledStart || a.published) - Date.parse(b.scheduledStart || b.published) : Date.parse(b.published) - Date.parse(a.published)));
  if (errors.length) { state.lastError = errors.join(' '); state.lastErrorAt = new Date().toISOString(); } else state.lastError = '';
  if (errors.length < OFFICIAL_CHANNELS.length) state.lastSuccessAt = new Date().toISOString();
  state.channelCount = OFFICIAL_CHANNELS.length - errors.length;
  return { enabled: true, channels: OFFICIAL_CHANNELS, items, errors, checkedAt: new Date().toISOString(),
    unverified: items.filter(i => !i.verified).length };
}
function toItem(entry, channel, meta) {
  return {
    id: `official:${entry.videoId}`, videoId: entry.videoId, title: meta.title || entry.title, channelName: channel.name, channelId: channel.id,
    owner: channel.owner, url: `https://www.youtube.com/watch?v=${entry.videoId}`, published: entry.published,
    liveStatus: meta.liveStatus || 'unknown', scheduledStart: meta.scheduledStart || '', embeddable: meta.embeddable ?? null,
    verified: Boolean(meta.verified), unavailable: Boolean(meta.unavailable), access: 'free',
    detail: meta.verified ? `Checked via ${meta.method === 'watch-page' ? 'the public watch page' : 'oEmbed'}${meta.lengthSeconds ? ` · ${Math.round(meta.lengthSeconds / 60)} min` : ''}` : meta.reason || 'Unverified',
  };
}
export function officialItemToSource(item, extra = {}) {
  const embeddable = item.embeddable !== false;
  return {
    id: item.id, provider: `${item.channelName} (official YouTube)`, origin: item.channelName, title: item.title,
    kind: embeddable ? 'youtube' : 'external', url: item.url, videoId: item.videoId, confidence: 100,
    reason: `Official ${item.owner} channel, found in its public feed. ${embeddable ? '' : 'The channel disabled embedding, so it opens on YouTube. '}${item.detail}.`,
    status: 'playable', provenance: 'official-feed', liveStatus: item.liveStatus, scheduledStart: item.scheduledStart, access: 'free', ...extra,
  };
}

/** Event-specific search: titles must name both teams before any video is verified. */
export async function findOfficial(event) {
  if (!officialEnabled()) return { sources: [], status: 'not-configured', detail: 'OFFICIAL_FEEDS=off' };
  if (event.isDemo) return { sources: [], status: 'skipped', detail: 'Demo fixture' };
  const feeds = await Promise.allSettled(OFFICIAL_CHANNELS.map(channelFeed));
  const failures = feeds.flatMap(f => f.status === 'rejected' ? [redactSecrets(f.reason?.message || f.reason)] : []);
  if (failures.length === feeds.length) throw new Error(failures.join(' '));
  const entries = feeds.flatMap((f, i) => f.status === 'fulfilled' ? f.value.filter(e => !e.isShort).map(e => [e, OFFICIAL_CHANNELS[i]]) : []);
  const matched = entries.filter(([e]) => matchEventTitle(event, e.title).status === 'playable').slice(0, 4);
  const sources = (await Promise.all(matched.map(async ([entry, channel]) => {
    const item = toItem(entry, channel, await verifyVideo(entry.videoId).catch(error => ({ verified: false, reason: error.message })));
    return item.unavailable ? [] : [officialItemToSource(item, { confidence: 98, reason: `Both team names appear in an official ${channel.name} video title. ${item.detail}.` })];
  }))).flat();
  const names = OFFICIAL_CHANNELS.map(c => c.name).join(', ');
  const detail = `${entries.length} recent official video(s) on ${names} checked; ${sources.length ? `${sources.length} name both teams` : 'none name both teams'}`
    + (failures.length ? `; ${failures.join(' ')}` : '');
  return { sources, status: failures.length ? 'partial' : 'ok', detail };
}
export function officialInfo() {
  return { id: 'official', name: 'Official free broadcasts (no key)', enabled: officialEnabled(), kind: 'official',
    description: officialEnabled()
      ? `Public feeds of ${OFFICIAL_CHANNELS.map(c => c.name).join(' and ')} on YouTube, with live, upcoming and replay status checked. FIBA competitions only. These channels do not carry NBA or European soccer games.`
      : 'Disabled with OFFICIAL_FEEDS=off',
    issues: [], ...state };
}
