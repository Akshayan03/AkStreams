import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

// Official feeds, broadcaster routes and owner-source import. Every upstream is a TEST FIXTURE
// (no network): YouTube feed/watch/oEmbed responses, ESPN scoreboard, DNS and the HLS probe.
const tmp = mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'akstreams-sources-'));
const dist = path.join(tmp, 'dist'); mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
const STORE = path.join(tmp, 'config', 'sources.local.json');
Object.assign(process.env, { AKSTREAMS_SOURCES_FILE: STORE, DEMO_STREAM: 'false', YOUTUBE_API_KEY: '', OFFICIAL_YOUTUBE_CHANNEL_IDS: '', AUTHORIZED_M3U_FILE: '', AUTHORIZED_M3U_URLS: '' });

const logs = [];
for (const level of ['log', 'warn', 'error']) { const orig = console[level]; console[level] = (...args) => { logs.push(args.join(' ')); if (process.env.SHOW_LOGS) orig(...args); }; }

const official = await import('../providers/official.mjs');
const custom = await import('../providers/custom.mjs');
const { whereToWatch, lookupBroadcaster } = await import('../lib/broadcasters.mjs');
const { maskUrl, redactSecrets, assertPublicHost, UpstreamError } = await import('../lib/net.mjs');
const { createApp } = await import('../app.mjs');
const { setScoreboardFetcher } = await import('../providers/schedule.mjs');
const { clearCache } = await import('../lib/cache.mjs');

const FIBA = 'UCtInrnU3QbWqFGsdKT1GZtg', FIBA3X3 = 'UC7LpyJP5fupiJu2CdzRQheg';
const entry = (id, channel, title, short = false) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId>
  <title>${title}</title><link rel="alternate" href="https://www.youtube.com/${short ? 'shorts/' : 'watch?v='}${id}"/>
  <published>2026-11-05T19:00:30+00:00</published><updated>2026-11-05T19:00:31+00:00</updated></entry>`;
const feed = (channel, entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><yt:channelId>${channel.slice(2)}</yt:channelId>${entries.join('')}</feed>`;
const player = (videoId, { status = 'OK', embed = true, live, upcoming, liveContent = false, length = '900', title = 'Video', channelId = FIBA, start, end } = {}) =>
  `<html><script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status, playableInEmbed: embed, reason: status === 'OK' ? undefined : 'Not "now" {really}' },
    videoDetails: { videoId, title, channelId, author: 'FIBA', lengthSeconds: length, isLiveContent: liveContent, ...(upcoming ? { isUpcoming: true } : {}) },
    microformat: { playerMicroformatRenderer: { ...(live !== undefined || start ? { liveBroadcastDetails: { isLiveNow: Boolean(live), startTimestamp: start, endTimestamp: end } } : {}) } } })};var meta = {};</script></html>`;

// Fixture world for the official fetcher.
const pages = new Map();
const oembed = new Map();
let feedFailure = false;
const requested = [];
official.setOfficialFetcher(async url => {
  requested.push(url);
  const u = new URL(url);
  if (u.pathname === '/feeds/videos.xml') {
    const channel = u.searchParams.get('channel_id');
    if (feedFailure && channel === FIBA3X3) return { ok: false, status: 503, url, text: 'unavailable' };
    return { ok: true, status: 200, url, text: channel === FIBA
      ? feed(FIBA, [entry('LIVEnow0001', FIBA, 'LIVE - Fiji v Indonesia | FIBA Asia Cup'), entry('UPCOMING001', FIBA, 'LIVE - Malaysia v Fiji &amp; more'),
        entry('BOTCHECK001', FIBA, 'Thailand v Mongolia'), entry('SHORTclip01', FIBA, 'Dunk!', true), entry('badid', FIBA, 'Bad')])
      : feed(FIBA3X3, [entry('REPLAY00001', FIBA3X3, 'Puerto Rico vs Venezuela | FIBA 3x3 AmeriCup'), entry('PRIVATE0001', FIBA3X3, 'Removed')]) };
  }
  if (u.pathname === '/watch') { const html = pages.get(u.searchParams.get('v')); return html ? { ok: true, status: 200, url, text: html } : { ok: false, status: 404, url, text: '' }; }
  if (u.pathname === '/oembed') {
    const id = new URL(u.searchParams.get('url')).searchParams.get('v');
    const hit = oembed.get(id);
    return hit ? { ok: hit.status === 200, status: hit.status, url, text: JSON.stringify(hit.body || {}) } : { ok: false, status: 404, url, text: 'Not Found' };
  }
  throw new Error(`unexpected fetch ${url}`);
});
pages.set('LIVEnow0001', player('LIVEnow0001', { live: true, liveContent: true, length: '0', title: 'LIVE - Fiji v Indonesia | FIBA Asia Cup', start: '2026-11-05T20:00:00+00:00' }));
pages.set('UPCOMING001', player('UPCOMING001', { status: 'LIVE_STREAM_OFFLINE', upcoming: true, liveContent: true, length: '0', title: 'LIVE - Malaysia v Fiji', live: false, start: '2099-11-27T05:00:00+00:00' }));
pages.set('BOTCHECK001', '<html>Sign in to confirm you&#39;re not a bot</html>');
oembed.set('BOTCHECK001', { status: 200, body: { title: 'Thailand v Mongolia', author_name: 'FIBA' } });
pages.set('REPLAY00001', player('REPLAY00001', { title: 'Puerto Rico vs Venezuela | FIBA 3x3 AmeriCup', channelId: FIBA3X3 }));
pages.set('PRIVATE0001', player('PRIVATE0001', { status: 'ERROR', title: '' }));

test('parses YouTube channel Atom feeds (entities, shorts, invalid ids)', () => {
  const list = official.parseChannelFeed(feed(FIBA, [entry('AAAAAAAAAAA', FIBA, 'A &amp; B &#39;x&#39; &#x1F3C0;'), entry('BBBBBBBBBBB', FIBA, 'Short', true), entry('bad', FIBA, 'x')]));
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "A & B 'x' 🏀");
  assert.equal(list[1].isShort, true);
});
test('extracts the player JSON even with braces and quotes inside strings', () => {
  const obj = official.extractJsonAfter(player('X1234567890', { status: 'ERROR' }), 'ytInitialPlayerResponse');
  assert.equal(obj.playabilityStatus.reason, 'Not "now" {really}');
  assert.equal(official.extractJsonAfter('<html>nothing</html>', 'ytInitialPlayerResponse'), null);
});
test('classifies live, upcoming, replay and highlights from player metadata only', () => {
  const c = (id, opts) => official.classifyPlayer(official.extractJsonAfter(player(id, opts), 'ytInitialPlayerResponse'), id, Date.parse('2026-11-05T21:00:00Z'));
  assert.equal(c('V0000000001', { live: true, liveContent: true, length: '0' }).liveStatus, 'live');
  assert.equal(c('V0000000002', { status: 'LIVE_STREAM_OFFLINE', upcoming: true, liveContent: true, start: '2026-11-06T05:30:00+00:00' }).liveStatus, 'upcoming');
  assert.equal(c('V0000000003', { liveContent: true, live: false, start: '2026-11-04T05:00:00+00:00', end: '2026-11-04T07:00:00+00:00' }).liveStatus, 'replay');
  assert.equal(c('V0000000004', { length: '890' }).liveStatus, 'replay');
  assert.equal(c('V0000000005', { length: '41' }).liveStatus, 'highlights');
  // "LIVE" in a title is not trusted: an upload with a LIVE title is still a replay.
  assert.equal(c('V0000000006', { title: 'LIVE 🔴 Final', length: '5400' }).liveStatus, 'replay');
  assert.equal(c('V0000000007', { embed: false }).embeddable, false);
  assert.equal(c('V0000000008', { status: 'LOGIN_REQUIRED' }).verified, false);
  assert.equal(official.classifyPlayer(official.extractJsonAfter(player('V0000000009'), 'ytInitialPlayerResponse'), 'OTHER000000').verified, false);
  assert.equal(c('V0000000010', { status: 'ERROR' }).unavailable, true);
});
test('official broadcasts: verified, grouped, shorts skipped, bot check falls back to oEmbed', async () => {
  clearCache(); requested.length = 0;
  const r = await official.getOfficialBroadcasts();
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.items.map(i => `${i.liveStatus}:${i.videoId}:${i.verified}`), [
    'live:LIVEnow0001:true', 'upcoming:UPCOMING001:true', 'replay:REPLAY00001:true', 'unknown:BOTCHECK001:false']);
  assert.ok(!requested.some(u => u.includes('SHORTclip01')), 'shorts are not fetched');
  assert.ok(!r.items.some(i => i.videoId === 'PRIVATE0001'), 'unavailable videos are dropped');
  const bot = r.items.find(i => i.videoId === 'BOTCHECK001');
  assert.match(bot.detail, /not bypassed/);
  assert.equal(r.items[1].scheduledStart, '2099-11-27T05:00:00+00:00');
  assert.ok(r.items.every(i => i.access === 'free' && i.url.startsWith('https://www.youtube.com/watch?v=')));
});
test('official broadcasts: one failing feed is reported, the other still listed', async () => {
  clearCache(); feedFailure = true;
  try {
    const r = await official.getOfficialBroadcasts();
    assert.match(r.errors.join(' '), /FIBA3x3 feed HTTP 503/);
    assert.ok(r.items.length >= 2 && r.items.every(i => i.channelName === 'FIBA'));
  } finally { feedFailure = false; clearCache(); }
});
test('event search matches official titles naming both teams; NBA games honestly find none', async () => {
  clearCache();
  const fiji = await official.findOfficial({ id: 'basketball|2026-11-05|1', home: 'Fiji', away: 'Indonesia', isDemo: false });
  assert.equal(fiji.sources.length, 1);
  assert.equal(fiji.sources[0].liveStatus, 'live');
  assert.equal(fiji.sources[0].provenance, 'official-feed');
  const nba = await official.findOfficial({ id: 'basketball|2026-11-05|2', home: 'Phoenix Suns', away: 'Orlando Magic', isDemo: false });
  assert.equal(nba.sources.length, 0);
  assert.equal(nba.status, 'ok');
  assert.match(nba.detail, /none name both teams/);
});

test('where to watch: real ESPN broadcaster names map to official sites with region caveats', () => {
  const w = whereToWatch({ league: 'NBA', broadcasters: [], broadcastDetails: [
    { name: 'NBA TV', type: 'TV', market: 'National', region: 'us' },
    { name: 'DAZN CLE', type: 'Streaming', market: 'Home', region: 'us' },
    { name: 'Suns Live', type: 'Streaming', market: 'Home', region: 'us' },
    { name: 'Peacock', type: 'STREAMING', market: 'National', region: 'us' },
    { name: 'TSN 1', type: 'TV', market: 'National', region: 'ca' }] });
  const by = Object.fromEntries(w.routes.map(r => [r.name, r]));
  assert.equal(by['NBA TV'].url, 'https://www.nba.com/watch/nba-tv');
  assert.equal(by['NBA TV'].access, 'tv-provider');
  assert.equal(by['NBA TV'].type, 'TV');
  assert.equal(by['DAZN CLE'].service, 'DAZN');
  assert.equal(by['Suns Live'].url, null);
  assert.match(by['Suns Live'].accessNote, /in-market/);
  assert.equal(by['Peacock'].type, 'Streaming');
  assert.equal(by['TSN 1'].regionNote, '', 'Canadian service listed for Canada');
  assert.equal(by['Peacock'].regionNote, '');
  assert.equal(whereToWatch({ broadcastDetails: [{ name: 'TSN', type: 'TV', market: 'National', region: 'us' }] }).routes[0].regionNote, 'Service based in CA');
  assert.equal(w.listingRegion, 'US, CA');
  assert.match(w.caveat, /not free streams/);
  assert.equal(w.league.label, 'NBA League Pass');
  assert.equal(lookupBroadcaster('Telemundo Deportes Ahora'), null, 'no loose substring matches');
  assert.equal(lookupBroadcaster('Universo'), null);
});
test('URL masking and secret redaction', () => {
  assert.equal(maskUrl('https://cdn.example.com/live/abcdef0123456789abcdef/index.m3u8?token=SECRET'), 'https://cdn.example.com/…/index.m3u8');
  assert.equal(maskUrl('https://cdn.example.com/s/eyJhbGciOiJIUzI1NiJ9xyzxyzxyz'), 'https://cdn.example.com/…');
  assert.ok(!redactSecrets('GET https://x.example/a.m3u8?hdnts=exp=1~acl=*~hmac=abc&access_token=zzz').includes('zzz'));
  assert.ok(!redactSecrets('https://x.example/a.m3u8?hdnts=exp=1~acl=*~hmac=abc').includes('hmac=abc'));
});
test('private, loopback, link-local and local names are rejected by the host check', async () => {
  for (const host of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', '::ffff:192.168.1.1', 'localhost', 'printer.local', 'box.internal']) {
    await assert.rejects(assertPublicHost(host), e => e instanceof UpstreamError && e.code === 'BLOCKED_ADDRESS', host);
  }
});

// ---------- owner source import via the real HTTP app ----------
const TOKEN = 'TESTONLY-secret-token-9f8e7d6c5b4a';
const HLS_URL = `https://owner-feed.example.net/live/${'ab12'.repeat(6)}/index.m3u8?token=${TOKEN}`;
const probes = new Map([[HLS_URL, { status: 200, body: '#EXTM3U\n#EXT-X-VERSION:3\n' }]]);
custom.setCustomNet({
  // DNS fixture: IP literals and local names go through the real guard; the rebind host "resolves" privately.
  hostCheck: async host => {
    const bare = host.replace(/^\[|\]$/g, '');
    if (net.isIP(bare) || /local|internal/.test(bare)) return assertPublicHost(host);
    if (bare === 'rebind.example.net') throw new UpstreamError('Blocked private or reserved address', { code: 'BLOCKED_ADDRESS' });
    if (bare === 'nxdomain.example.net') throw new UpstreamError('Host does not resolve', { code: 'ENOTFOUND' });
  },
  probe: async url => {
    if (url.startsWith('https://redirects-private.example.net/')) throw new UpstreamError('Blocked private or reserved address for 10.0.0.1', { code: 'BLOCKED_ADDRESS' });
    const hit = probes.get(url) || (url.includes('not-hls') ? { status: 200, body: '<html>hello</html>' } : url.includes('offline') ? null : { status: 200, body: '<html>Official watch page</html>' });
    if (!hit) throw new UpstreamError('Upstream timed out after 8000 ms', { code: 'TIMEOUT' });
    return { ok: hit.status < 300, status: hit.status, text: () => hit.body };
  },
});
const soon = new Date(Date.now() + 20 * 60_000).toISOString();
const espnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(soon));
setScoreboardFetcher(async url => url.includes('/nba/') && url.includes(espnDay.replaceAll('-', '')) ? { events: [{
  id: '501', date: soon, status: { type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
  competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Phoenix Suns' } }, { homeAway: 'away', team: { displayName: 'Orlando Magic' } }],
    broadcasts: [{ market: 'home', names: ['Suns Live'] }],
    geoBroadcasts: [{ type: { shortName: 'Streaming' }, market: { type: 'Home' }, media: { shortName: 'Suns Live' }, region: 'us', lang: 'en' },
      { type: { shortName: 'Radio' }, market: { type: 'National' }, media: { shortName: 'ERADM' }, region: 'us' }] }] }] } : { events: [] });
const eventId = `basketball|${espnDay}|501`;

const server = createApp({ port: 0, distDir: dist, rateLimit: 1000 });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
// createApp's allowed origins are computed from `port` (0 here), so use the always-allowed Vite dev origin.
const DEV = 'http://localhost:5173';
test.after(() => server.close());
const post = (body, headers = {}) => fetch(`${base}/api/custom-sources`, { method: 'POST', headers: { origin: DEV, 'content-type': 'application/json', 'sec-fetch-site': 'same-site', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const req = (method, p, body) => fetch(base + p, { method, headers: { origin: DEV, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });

test('writes are refused without an allowed Origin, cross-site, or without JSON', async () => {
  const ok = { url: HLS_URL, authorized: true };
  assert.equal((await fetch(`${base}/api/custom-sources`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ok) })).status, 403, 'no Origin');
  assert.equal((await post(ok, { origin: 'https://attacker.example' })).status, 403, 'foreign Origin');
  assert.equal((await post(ok, { origin: ORIGIN })).status, 403, 'origin not on the allow list for this port');
  assert.equal((await post(ok, { 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-site fetch');
  assert.equal((await post(ok, { 'content-type': 'text/plain' })).status, 415, 'simple-request content type');
  assert.equal((await post('{"url":')).status, 400, 'bad JSON');
  assert.equal((await post({ url: `https://x.example/${'a'.repeat(20_000)}`, authorized: true })).status, 413, 'body too large');
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers: { origin: DEV, 'content-type': 'application/json' } })).status, 405, 'other routes stay read-only');
  assert.equal(existsSync(STORE), false, 'nothing written');
});
test('malformed, non-https and private-address URLs are rejected with clear reasons', async () => {
  const cases = [
    ['not a url', /not a valid URL/], ['javascript:alert(1)', /https/], ['http://cdn.example.com/a.m3u8', /https/], ['ftp://x.example/a', /https/],
    ['https://user:pw@cdn.example.com/a.m3u8', /user names or passwords/], ['https://127.0.0.1/a.m3u8', /Private, local or reserved/],
    ['https://10.1.2.3/live.m3u8', /Private/], ['https://169.254.169.254/latest/meta-data', /Private/], ['https://[::1]/a.m3u8', /Private/],
    ['https://localhost/a.m3u8', /Private/], ['https://nas.local/a.m3u8', /Private/], ['https://rebind.example.net/a.m3u8', /Private/],
    ['https://nxdomain.example.net/a.m3u8', /could not be resolved/], ['https://redirects-private.example.net/a.m3u8', /redirects to a private/],
    ['https://cdn.example.com/not-hls.m3u8', /not with an HLS/], ['https://www.youtube.com/@FIBA', /YouTube video, live or embed URL/], ['', /Enter a stream URL/],
  ];
  for (const [url, re] of cases) {
    const r = await post({ url, authorized: true });
    const body = await r.json();
    assert.equal(r.status, 400, url); assert.match(body.error, re, url);
  }
  const unauthorized = await post({ url: HLS_URL });
  assert.equal(unauthorized.status, 400); assert.match((await unauthorized.json()).error, /authorized/);
  assert.equal((await post({ url: HLS_URL, authorized: true, eventId: 'nba|bad' })).status, 400);
});

let hlsId, channelId, ytId;
test('adds an event-attached HLS source; the token never appears in API output or logs', async () => {
  const r = await post({ url: HLS_URL, label: 'Owner test feed', authorized: true, eventId, eventLabel: 'Phoenix Suns vs Orlando Magic · NBA' });
  assert.equal(r.status, 201);
  const raw = await r.text();
  assert.ok(!raw.includes(TOKEN) && !raw.includes('ab12ab12'), 'no token or token-like path in response');
  const { source } = JSON.parse(raw);
  hlsId = source.id;
  assert.equal(source.kind, 'hls'); assert.equal(source.displayUrl, 'https://owner-feed.example.net/…/index.m3u8');
  assert.equal(source.check.ok, true); assert.equal(source.eventId, eventId);
  assert.equal((await post({ url: HLS_URL, authorized: true, eventId })).status, 409, 'duplicate for the same game');
  // Stored raw (needed to play) in an owner-only file.
  const stored = JSON.parse(readFileSync(STORE, 'utf8'));
  assert.equal(stored.sources[0].url, HLS_URL);
  assert.equal(statSync(STORE).mode & 0o777, 0o600);
  for (const p of ['/api/custom-sources', '/api/providers', '/api/channels', `/api/events/${encodeURIComponent(eventId)}/sources?refresh=1`]) {
    const text = await (await fetch(base + p)).text();
    assert.ok(!text.includes(TOKEN), `${p} leaks the token`);
  }
  assert.ok(!logs.join('\n').includes(TOKEN), 'token never logged');
  assert.ok(logs.some(l => l.includes('Owner source added: hls https://owner-feed.example.net/…/index.m3u8')));
});
test('attached source is offered only for its game, with owner provenance and a same-origin play redirect', async () => {
  const res = await (await fetch(`${base}/api/events/${encodeURIComponent(eventId)}/sources`)).json();
  const mine = res.sources.find(s => s.id === `custom:${hlsId}`);
  assert.equal(mine.status, 'playable'); assert.equal(mine.provenance, 'owner');
  assert.equal(mine.url, `/api/custom-sources/${hlsId}/open`);
  assert.equal(res.providerResults.find(p => p.id === 'custom').count, 1);
  assert.ok(res.watch.routes.some(r => r.name === 'Suns Live' && r.url === null), 'unmapped team service stays visible without a link');
  assert.ok(!res.watch.routes.some(r => r.name === 'ERADM'), 'radio dropped');
  const open = await fetch(`${base}/api/custom-sources/${hlsId}/open`, { redirect: 'manual' });
  assert.equal(open.status, 302); assert.equal(open.headers.get('location'), HLS_URL); assert.equal(open.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await fetch(`${base}/api/custom-sources/${hlsId}/open`, { redirect: 'manual', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  // Another game does not get it.
  const other = await custom.findCustom({ id: 'basketball|2026-11-05|999', broadcasters: [], isDemo: false });
  assert.equal(other.sources.length, 0);
});
test('unattached channels are candidates only when named like an announced broadcaster', async () => {
  const r = await post({ url: 'https://watch.example.org/suns-live', label: 'Suns Live', authorized: true });
  assert.equal(r.status, 201);
  ({ source: { id: channelId } } = await r.json());
  const found = await custom.findCustom({ id: 'basketball|2026-11-05|7', broadcasters: ['Suns Live'], isDemo: false });
  const ch = found.sources.find(s => s.id === `custom:${channelId}`);
  assert.equal(ch.status, 'candidate'); assert.equal(ch.kind, 'external'); assert.match(ch.reason, /NOT confirmed/);
  assert.equal((await custom.findCustom({ id: 'basketball|2026-11-05|8', broadcasters: ['NBA TV'], isDemo: false })).sources.length, 0);
  const channels = await (await fetch(`${base}/api/channels`)).json();
  assert.ok(channels.configured && channels.channels.some(c => c.title === 'Suns Live' && c.group === 'Your sources'));
});
test('YouTube links are verified (live status, embeddable) and stored by video id', async () => {
  const r = await post({ url: 'https://youtu.be/LIVEnow0001?si=trackingjunk', authorized: true, eventId });
  assert.equal(r.status, 201);
  const { source } = await r.json();
  ytId = source.id;
  assert.equal(source.kind, 'youtube'); assert.equal(source.videoId, 'LIVEnow0001');
  assert.equal(source.check.liveStatus, 'live'); assert.equal(source.displayUrl, 'youtube.com/watch?v=LIVEnow0001');
  assert.equal(source.label, 'LIVE - Fiji v Indonesia | FIBA Asia Cup');
  const missing = await post({ url: 'https://www.youtube.com/watch?v=MISSING0001', authorized: true });
  assert.equal(missing.status, 400); assert.match((await missing.json()).error, /does not exist or is private/);
});
test('an unreachable HLS URL is saved as unverified, not silently accepted as working', async () => {
  const r = await post({ url: 'https://offline.example.net/live/index.m3u8', authorized: true });
  const { source } = await r.json();
  assert.equal(r.status, 201); assert.equal(source.check.ok, false); assert.match(source.check.detail, /unverified/);
  await req('DELETE', `/api/custom-sources/${source.id}`);
});
test('disable, re-enable, persist across restart and remove', async () => {
  let r = await req('PATCH', `/api/custom-sources/${hlsId}`, { enabled: false });
  assert.equal(r.status, 200); assert.equal((await r.json()).source.enabled, false);
  let res = await (await fetch(`${base}/api/events/${encodeURIComponent(eventId)}/sources`)).json();
  assert.ok(!res.sources.some(s => s.id === `custom:${hlsId}`), 'disabled source is not offered (cache invalidated)');
  assert.equal((await fetch(`${base}/api/custom-sources/${hlsId}/open`, { redirect: 'manual' })).status, 404);
  assert.equal((await req('PATCH', `/api/custom-sources/${hlsId}`, { enabled: 'yes' })).status, 400);
  await req('PATCH', `/api/custom-sources/${hlsId}`, { enabled: true });
  custom.resetCustomStore(); // simulate a restart: re-read from disk
  const list = await (await fetch(`${base}/api/custom-sources`)).json();
  assert.deepEqual(list.sources.map(s => s.id).sort(), [hlsId, channelId, ytId].sort());
  assert.ok(list.sources.find(s => s.id === hlsId).enabled);
  assert.ok(list.storedIn.endsWith('sources.local.json'));
  for (const id of [hlsId, channelId, ytId]) assert.equal((await req('DELETE', `/api/custom-sources/${id}`)).status, 204);
  assert.equal((await req('DELETE', `/api/custom-sources/${hlsId}`)).status, 404);
  assert.equal((await req('DELETE', '/api/custom-sources/not-an-id')).status, 405);
  res = await (await fetch(`${base}/api/events/${encodeURIComponent(eventId)}/sources`)).json();
  assert.equal(res.providerResults.find(p => p.id === 'custom').status, 'not-configured');
  assert.deepEqual(JSON.parse(readFileSync(STORE, 'utf8')).sources, []);
});
test('hand-edited store entries that are not https (or malformed) are ignored, never redirected to', async () => {
  writeFileSync(STORE, JSON.stringify({ version: 1, sources: [
    { id: '0123456789abcdef', label: 'bad scheme', url: 'javascript:alert(1)', kind: 'external', enabled: true },
    { id: '1123456789abcdef', label: 'bad video', url: 'https://www.youtube.com/watch?v=x', kind: 'youtube', videoId: '"><script>', enabled: true },
    { id: '2123456789abcdef', label: 'ok', url: 'https://cdn.example.com/a.m3u8', kind: 'hls', enabled: true }] }));
  custom.resetCustomStore();
  const list = await (await fetch(`${base}/api/custom-sources`)).json();
  assert.deepEqual(list.sources.map(s => s.label), ['ok']);
  assert.equal((await fetch(`${base}/api/custom-sources/0123456789abcdef/open`, { redirect: 'manual' })).status, 404);
});
