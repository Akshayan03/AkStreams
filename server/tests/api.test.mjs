import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Endpoint tests against the real HTTP app with TEST FIXTURES for upstreams (no network).
const SECRET = 'TEST-ONLY-fake-youtube-key-1234567890';
const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'akstreams-test-'));
const dist = path.join(tmp, 'dist'); mkdirSync(path.join(dist, 'assets'), { recursive: true });
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
const playlist = path.join(tmp, 'list.m3u');
writeFileSync(playlist, [
  '#EXTM3U',
  '#EXTINF:-1 group-title="Sports",Boston Celtics vs Toronto Raptors',
  'https://cdn.example.com/game.m3u8',
  '#EXTINF:-1 group-title="Sports",TSN 1',
  'https://cdn.example.com/tsn.m3u8',
  '#EXTINF:-1 group-title="Sports",Raptors highlights',
  'https://cdn.example.com/hl.m3u8',
].join('\n'));
Object.assign(process.env, { DEMO_STREAM: 'true', YOUTUBE_API_KEY: SECRET, OFFICIAL_YOUTUBE_CHANNEL_IDS: 'UCtInrnU3QbWqFGsdKT1GZtg,@bad', AUTHORIZED_M3U_FILE: playlist, AUTHORIZED_M3U_URLS: '' });

const { createApp } = await import('../app.mjs');
const { setScoreboardFetcher } = await import('../providers/schedule.mjs');
const { setYouTubeFetcher } = await import('../providers/youtube.mjs');
const soon = new Date(Date.now() + 30 * 60_000).toISOString();
const espnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(soon));
setScoreboardFetcher(async url => url.includes('/nba/') && url.includes(espnDay.replaceAll('-', '')) ? { events: [{
  id: '77', date: soon, status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
  competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Boston Celtics' } }, { homeAway: 'away', team: { displayName: 'Toronto Raptors' } }],
    broadcasts: [{ names: ['TSN'] }] }] }] } : { events: [] });
let youtubeMode = 'ok';
setYouTubeFetcher(async url => {
  assert.ok(url.includes('key='), 'server sends key upstream only');
  if (youtubeMode === 'quota') return { ok: false, status: 403, payload: { error: { errors: [{ reason: 'quotaExceeded' }] } } };
  return { ok: true, status: 200, payload: { items: [
    { id: { videoId: 'abcdefghijk' }, snippet: { title: 'LIVE: Boston Celtics vs Toronto Raptors', channelTitle: 'FIBA', channelId: 'UCtInrnU3QbWqFGsdKT1GZtg' } },
    { id: { videoId: 'zzzzzzzzzzz' }, snippet: { title: 'Celtics highlights', channelTitle: 'FIBA', channelId: 'UCtInrnU3QbWqFGsdKT1GZtg' } }] } };
});

const server = createApp({ port: 0, distDir: dist, rateLimit: 1000 });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
const get = (p, headers = {}) => fetch(base + p, { headers });
const eventId = `basketball|${espnDay}|77`;

test('health, security headers and no wildcard CORS', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});
test('rejects foreign Host (DNS rebinding) and foreign Origin', async () => {
  const http = await import('node:http');
  const status = await new Promise((resolve, reject) => http.get(`${base}/api/providers`, { headers: { host: 'attacker.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(status, 421);
  assert.equal((await get('/api/providers', { origin: 'https://attacker.example' })).status, 403);
  const ok = await get('/api/providers', { origin: 'http://localhost:5173' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
test('validates parameters and methods', async () => {
  assert.equal((await get('/api/events?date=2026-02-31')).status, 400);
  assert.equal((await get('/api/events?sport=hockey')).status, 400);
  assert.equal((await get('/api/events?tz=Not/AZone')).status, 400);
  assert.equal((await get('/api/events/not-an-id/sources')).status, 400);
  assert.equal((await get('/api/events/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base + '/api/events', { method: 'POST' })).status, 405);
  assert.equal((await get('/api/nope')).status, 404);
});
test('serves the SPA with traversal protection', async () => {
  assert.match(await (await get('/')).text(), /id="root"/);
  assert.match(await (await get('/some/client/route')).text(), /id="root"/);
  const asset = await get('/assets/app.js');
  assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
    const r = await get(p); assert.notEqual(await r.text(), 'top secret', p);
  }
  assert.equal((await get('/missing.js')).status, 404);
});
test('provider status explains issues and never exposes the key', async () => {
  const body = await (await get('/api/providers')).text();
  assert.ok(!body.includes(SECRET));
  const { providers } = JSON.parse(body);
  assert.equal(providers.find(p => p.id === 'youtube').enabled, true);
  assert.match(providers.find(p => p.id === 'youtube').issues.join(' '), /1 channel ID\(s\) ignored/);
});
test('demo fixtures carry only clearly labelled test streams', async () => {
  const { events } = await (await get('/api/events?demo=1&date=2026-11-05&tz=UTC')).json();
  assert.equal(events.length, 4);
  const res = await (await get(`/api/events/${encodeURIComponent(events[0].id)}/sources`)).json();
  assert.ok(res.sources.length >= 2);
  assert.ok(res.sources.every(s => s.isTest && /not a sports broadcast/.test(s.title)));
});
test('discovers, ranks and labels sources for a real-shaped event', async () => {
  const { events } = await (await get(`/api/events?date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(soon))}&tz=UTC&sport=basketball`)).json();
  assert.equal(events[0].id, eventId);
  const raw = await (await get(`/api/events/${encodeURIComponent(eventId)}/sources?refresh=1`)).text();
  assert.ok(!raw.includes(SECRET), 'key never in response');
  const res = JSON.parse(raw);
  const titles = res.sources.map(s => `${s.status}:${s.kind}:${s.title}`);
  assert.deepEqual(titles, [
    'playable:hls:Boston Celtics vs Toronto Raptors',
    'playable:youtube:LIVE: Boston Celtics vs Toronto Raptors',
    'candidate:hls:TSN 1 · possible broadcaster',
  ]);
  assert.match(res.sources[2].reason, /NOT confirmed/);
  assert.ok(res.providerResults.every(p => p.status === 'ok'));
  const single = await (await get(`/api/events/${encodeURIComponent(eventId)}`)).json();
  assert.equal(single.event.home, 'Boston Celtics');
});
test('surfaces provider errors with helpful text', async () => {
  youtubeMode = 'quota';
  const { clearCache } = await import('../lib/cache.mjs'); clearCache();
  const res = await (await get(`/api/events/${encodeURIComponent(eventId)}/sources?refresh=1`)).json();
  const yt = res.providerResults.find(p => p.id === 'youtube');
  assert.equal(yt.status, 'error'); assert.match(yt.detail, /quota/);
  assert.equal(res.sources.length, 2, 'playlist results still returned');
  const { providers } = await (await get('/api/providers')).json();
  assert.match(providers.find(p => p.id === 'youtube').lastError, /quota/);
});
test('unknown events return 404, not fake data', async () => {
  const r = await get(`/api/events/${encodeURIComponent(`basketball|${espnDay}|999`)}/sources`);
  assert.equal(r.status, 404);
});
