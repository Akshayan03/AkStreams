import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelMatchesBroadcaster } from '../lib/match.mjs';
import { safeFetch, assertPublicHost, maskUrl, redactSecrets, UpstreamError } from '../lib/net.mjs';
import { verifyVideo } from './official.mjs';

// Sources the OWNER explicitly adds in the app (instead of editing .env). Stored only in a local,
// git-ignored JSON file (mode 0600). Raw URLs may carry access tokens: they are kept in that
// file, handed to the browser only through a same-origin redirect at play time, and never
// appear in list, provider or status responses or in logs (maskUrl / redactSecrets).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EVENT_ID_RE = /^(soccer|basketball)\|(\d{4}-\d{2}-\d{2})\|([-\w]{1,40})$/;
const ID_RE = /^[a-f0-9]{16}$/;
const MAX_SOURCES = 200;
const MAX_URL_LENGTH = 2048;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);

export function storePath() {
  const f = (process.env.AKSTREAMS_SOURCES_FILE || '').trim();
  return f ? path.resolve(ROOT, f) : path.join(ROOT, 'config', 'sources.local.json');
}
export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

// Network hooks are swappable so tests can run without DNS or upstream access.
let hostCheck = assertPublicHost;
let probeFetch = url => safeFetch(url, { timeoutMs: 8000, maxBytes: 512_000, maxRedirects: 3, headers: { accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, */*;q=0.5' } });
export function setCustomNet({ hostCheck: h, probe: p } = {}) { if (h) hostCheck = h; if (p) probeFetch = p; }

let records = null;
let writing = Promise.resolve();
const state = { lastError: '', lastErrorAt: '' };
async function load() {
  if (records) return records;
  try {
    const data = JSON.parse(await readFile(storePath(), 'utf8'));
    // Hand-edited entries must still be https (the play endpoint redirects to them).
    records = Array.isArray(data?.sources) ? data.sources.filter(r => ID_RE.test(r?.id) && typeof r.url === 'string' && /^https:\/\//i.test(r.url)
      && ['hls', 'youtube', 'external'].includes(r.kind) && (!r.videoId || /^[\w-]{11}$/.test(r.videoId))).slice(0, MAX_SOURCES) : [];
  } catch (error) {
    if (error.code !== 'ENOENT') { state.lastError = `Could not read ${path.basename(storePath())}: ${error.code || 'invalid JSON'}`; state.lastErrorAt = new Date().toISOString(); }
    records = [];
  }
  return records;
}
async function save() {
  const file = storePath();
  const body = JSON.stringify({ version: 1, note: 'AKStreams owner sources. Local only; may contain access tokens. Do not commit or share.', sources: records }, null, 2);
  writing = writing.then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, file);
    await chmod(file, 0o600).catch(() => {});
  });
  return writing;
}
/** For tests: drop the in-memory copy so the next call re-reads the store file. */
export function resetCustomStore() { records = null; }

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export function youtubeVideoId(u) {
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  const id = host === 'youtu.be' ? parts[0]
    : u.pathname === '/watch' ? u.searchParams.get('v')
    : ['embed', 'live', 'shorts', 'v'].includes(parts[0]) ? parts[1] : null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

/** Validates an owner-supplied URL and classifies it as hls / youtube / external. */
export async function inspectUrl(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new InputError('Enter a stream URL.');
  if (text.length > MAX_URL_LENGTH) throw new InputError(`URL is longer than ${MAX_URL_LENGTH} characters.`);
  let u;
  try { u = new URL(text); } catch { throw new InputError('That is not a valid URL.'); }
  if (u.protocol !== 'https:') throw new InputError('Only https:// URLs are accepted.');
  if (u.username || u.password) throw new InputError('URLs with embedded user names or passwords are not accepted.');
  try { await hostCheck(u.hostname); }
  catch (error) {
    throw new InputError(error.code === 'BLOCKED_ADDRESS' ? 'Private, local or reserved network addresses are not allowed.' : `The host ${u.hostname} could not be resolved.`);
  }
  const videoId = youtubeVideoId(u);
  if (YT_HOSTS.has(u.hostname.toLowerCase()) && !videoId) throw new InputError('Use a YouTube video, live or embed URL (channel and playlist pages are not supported).');
  if (videoId) {
    const meta = await verifyVideo(videoId).catch(error => ({ verified: false, reason: redactSecrets(error.message), liveStatus: 'unknown', embeddable: null }));
    if (meta.missing) throw new InputError('YouTube says this video does not exist or is private.');
    if (meta.unavailable) throw new InputError(`YouTube reports this video as unavailable: ${clean(meta.unavailableReason, 160)}`);
    return { kind: meta.embeddable === false ? 'external' : 'youtube', videoId, url: `https://www.youtube.com/watch?v=${videoId}`,
      suggestedLabel: clean(meta.title, 120), check: { ok: Boolean(meta.verified), at: new Date().toISOString(), liveStatus: meta.liveStatus || 'unknown',
        embeddable: meta.embeddable ?? null, detail: meta.verified ? `YouTube video verified (${meta.liveStatus}${meta.embeddable === false ? ', embedding disabled' : ''})` : clean(meta.reason, 200) } };
  }
  // HLS if the path says so or the URL answers with an M3U playlist; otherwise an external page.
  let probe;
  try {
    const res = await probeFetch(u.href);
    probe = { ok: res.ok, status: res.status, isM3U: res.ok && /^﻿?#EXTM3U/.test(res.text().slice(0, 64)) };
  } catch (error) {
    if (error instanceof UpstreamError && error.code === 'BLOCKED_ADDRESS') throw new InputError('The URL redirects to a private, local or reserved network address.');
    probe = { ok: false, status: 0, isM3U: false, error: error instanceof UpstreamError && error.code === 'TOO_LARGE' ? 'response too large for a playlist' : redactSecrets(error.message) };
  }
  const looksHls = /\.m3u8$/i.test(u.pathname);
  if (probe.isM3U || looksHls) {
    if (probe.ok && !probe.isM3U) throw new InputError('The URL responded, but not with an HLS (#EXTM3U) playlist.');
    return { kind: 'hls', url: u.href, suggestedLabel: '', check: { ok: probe.isM3U, at: new Date().toISOString(), liveStatus: 'unknown', embeddable: null,
      detail: probe.isM3U ? 'HLS playlist reachable from this computer' : `Saved unverified: ${probe.status ? `HTTP ${probe.status}` : probe.error} (it may still play in the browser, or only while live)` } };
  }
  return { kind: 'external', url: u.href, suggestedLabel: '', check: { ok: probe.ok, at: new Date().toISOString(), liveStatus: 'unknown', embeddable: false,
    detail: probe.ok ? 'Web page; opens in a new tab (only official YouTube embeds and direct HLS play inside AKStreams)' : `Web page; opens in a new tab. Check failed: ${probe.status ? `HTTP ${probe.status}` : probe.error}` } };
}

export function publicView(r) {
  return { id: r.id, label: r.label, kind: r.kind, displayUrl: r.kind === 'youtube' || (r.kind === 'external' && r.videoId) ? `youtube.com/watch?v=${r.videoId}` : maskUrl(r.url),
    videoId: r.videoId || undefined, eventId: r.eventId || null, eventLabel: r.eventLabel || '', enabled: r.enabled !== false,
    createdAt: r.createdAt, updatedAt: r.updatedAt, check: r.check || null };
}
export async function listCustom() {
  const list = await load();
  return { sources: list.map(publicView), storedIn: path.relative(ROOT, storePath()) || storePath(), max: MAX_SOURCES };
}
function parseAttachment(body) {
  if (body.eventId === undefined || body.eventId === null || body.eventId === '') return { eventId: null, eventLabel: '' };
  if (typeof body.eventId !== 'string' || !EVENT_ID_RE.test(body.eventId)) throw new InputError('Invalid game to attach the source to.');
  return { eventId: body.eventId, eventLabel: clean(body.eventLabel, 120) };
}
export async function addCustom(body) {
  if (!body || typeof body !== 'object') throw new InputError('Expected a JSON object.');
  const list = await load();
  if (list.length >= MAX_SOURCES) throw new InputError(`You already have ${MAX_SOURCES} sources. Remove some first.`);
  const attach = parseAttachment(body);
  if (body.authorized !== true) throw new InputError('Confirm that you are authorized to use this source.');
  const info = await inspectUrl(body.url);
  if (list.some(r => r.url === info.url && (r.eventId || null) === attach.eventId)) throw new InputError('This source is already saved for that game.', 409);
  const now = new Date().toISOString();
  const record = { id: randomBytes(8).toString('hex'), label: clean(body.label, 120) || info.suggestedLabel || `${info.kind === 'hls' ? 'HLS stream' : 'Source'} · ${new URL(info.url).hostname}`,
    url: info.url, kind: info.kind, videoId: info.videoId, ...attach, enabled: true, createdAt: now, updatedAt: now, check: info.check };
  list.push(record);
  await save();
  return publicView(record);
}
export async function updateCustom(id, body) {
  if (!ID_RE.test(id)) throw new InputError('Unknown source.', 404);
  if (!body || typeof body !== 'object') throw new InputError('Expected a JSON object.');
  const list = await load();
  const record = list.find(r => r.id === id);
  if (!record) throw new InputError('Unknown source.', 404);
  const before = record.eventId || null;
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw new InputError('"enabled" must be true or false.'); record.enabled = body.enabled; }
  if (body.label !== undefined) { const label = clean(body.label, 120); if (!label) throw new InputError('Label cannot be empty.'); record.label = label; }
  if ('eventId' in body) Object.assign(record, parseAttachment(body));
  record.updatedAt = new Date().toISOString();
  await save();
  return { source: publicView(record), affected: [...new Set([before, record.eventId || null])] };
}
export async function removeCustom(id) {
  if (!ID_RE.test(id)) throw new InputError('Unknown source.', 404);
  const list = await load();
  const index = list.findIndex(r => r.id === id);
  if (index < 0) throw new InputError('Unknown source.', 404);
  const [removed] = list.splice(index, 1);
  await save();
  return { affected: [removed.eventId || null] };
}
/** Raw URL for the same-origin play redirect. Only for enabled sources. */
export async function openUrl(id) {
  if (!ID_RE.test(id)) return null;
  const record = (await load()).find(r => r.id === id);
  return record && record.enabled !== false ? record.url : null;
}

function toSource(r, attached) {
  return {
    id: `custom:${r.id}`, provider: 'Added by you', origin: 'Your sources', title: r.label, kind: r.kind,
    // HLS and pages go through the local redirect so the raw (possibly tokenized) URL is not in API output.
    url: r.kind === 'youtube' ? `https://www.youtube.com/watch?v=${r.videoId}` : `/api/custom-sources/${r.id}/open`,
    videoId: r.videoId, confidence: attached ? 100 : 55, status: attached ? 'playable' : 'candidate', provenance: 'owner',
    liveStatus: r.check?.liveStatus || 'unknown', access: 'owner',
    reason: attached ? 'You attached this source to this game and confirmed you are authorized to use it.'
      : 'Your saved channel is named like an announced broadcaster. This game is NOT confirmed on it.',
  };
}
export async function findCustom(event) {
  const list = (await load()).filter(r => r.enabled !== false);
  if (!list.length) return { sources: [], status: 'not-configured', detail: 'No sources added yet. Use "Add source" on a game or on the My sources page.' };
  if (event.isDemo) return { sources: [], status: 'skipped', detail: 'Demo fixture' };
  const attached = list.filter(r => r.eventId === event.id).map(r => toSource(r, true));
  const channels = list.filter(r => !r.eventId && channelMatchesBroadcaster(r.label, event.broadcasters)).map(r => toSource(r, false));
  return { sources: [...attached, ...channels], status: 'ok',
    detail: `${list.length} saved source(s) checked; ${attached.length} attached to this game${channels.length ? `, ${channels.length} channel(s) named like a broadcaster` : ''}` };
}
/** Unattached saved sources, listed with playlist channels (never tied to a game). */
export async function customChannels() {
  return (await load()).filter(r => r.enabled !== false && !r.eventId).map(r => ({
    title: r.label, channel: r.label, group: 'Your sources', origin: 'Added by you', kind: r.kind, videoId: r.videoId,
    url: r.kind === 'youtube' ? `https://www.youtube.com/watch?v=${r.videoId}` : `/api/custom-sources/${r.id}/open`,
  }));
}
export function customInfo() {
  const list = records || [];
  const enabled = list.filter(r => r.enabled !== false);
  return { id: 'custom', name: 'Your sources', kind: 'custom', enabled: enabled.length > 0,
    description: list.length ? `${enabled.length} enabled of ${list.length} saved · ${enabled.filter(r => r.eventId).length} attached to specific games` : 'Add an official watch link or an HLS stream you are authorized to use. Stored only on this computer.',
    issues: [], channelCount: 0, ...state };
}
export async function warmCustom() { await load(); }
