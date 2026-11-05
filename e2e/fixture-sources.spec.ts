import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fixtureDir, hasFixture, playbackProof, shot } from './helpers';

// DETERMINISTIC SUITE for v0.3 sources. TEST FIXTURES:
//  * owner sources: the real server API with an isolated scratch store (AKSTREAMS_SOURCES_FILE),
//    a clearly fake token, and ffmpeg test-pattern HLS answered in the browser
//  * game/official data: intercepted /api responses, labelled as fixtures below
//  * YouTube embed: a local fixture page in place of youtube-nocookie.com (sandbox probe)
// The server's add-time check resolves DNS for test-streams.mux.dev (the probe itself may 404).
const TOKEN = 'E2E-TEST-ONLY-TOKEN-55aa77bb';
const OWNER_URL = `https://test-streams.mux.dev/akstreams-e2e/0123456789abcdef0123/index.m3u8?token=${TOKEN}`;
const FIXTURE_CDN = 'https://test-streams.mux.dev/akstreams-e2e/';

function serveHls(dir: string) {
  return async (route: Route) => {
    const file = path.join(fixtureDir, dir, route.request().url().split('?')[0].endsWith('.m3u8') ? 'index.m3u8' : path.basename(new URL(route.request().url()).pathname));
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, body: readFileSync(file), headers: {
      'content-type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'access-control-allow-origin': '*' } });
  };
}
/**
 * Playwright only intercepts the first URL of a redirect chain, so the play redirect is fetched
 * for real (asserting the server answers 302 to the raw URL), then answered with the fixture
 * playlist whose segments point at the intercepted fixture CDN.
 */
async function routeOwnerPlayback(page: Page, seen: string[]) {
  await page.route(/\/api\/custom-sources\/[a-f0-9]{16}\/open$/, async route => {
    const real = await route.fetch({ maxRedirects: 0 });
    seen.push(`${real.status()} ${real.headers()['location']}`);
    const manifest = readFileSync(path.join(fixtureDir, 'a', 'index.m3u8'), 'utf8').replace(/^(seg\d+\.ts)$/gm, `${FIXTURE_CDN}$1`);
    await route.fulfill({ status: 200, body: manifest, headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
  });
  await page.route(`${FIXTURE_CDN}**`, serveHls('a'));
}
/** Collects every /api JSON body the page receives (except the play redirect itself). */
function captureApi(page: Page) {
  const bodies: string[] = [];
  page.on('response', async r => {
    if (!r.url().includes('/api/') || /\/open$/.test(r.url())) return;
    try { bodies.push(await r.text()); } catch {}
  });
  return bodies;
}
const addForm = (page: Page) => page.getByRole('form', { name: 'Add source' });
async function submitSource(page: Page, url: string, label = '') {
  const form = addForm(page);
  await form.getByLabel('Stream or watch URL').fill(url);
  await form.getByLabel(/^Label/).fill(label);
  const auth = form.getByLabel(/I'm authorized/);
  if (!(await auth.isChecked())) await auth.check();
  await form.getByRole('button', { name: 'Save source' }).click();
}

test('owner sources: rejects bad URLs, masks tokens, persists, plays via redirect, disables and removes', async ({ page }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  const api = captureApi(page);
  const redirects: string[] = [];
  await routeOwnerPlayback(page, redirects);
  await page.goto('/?view=mine');
  await expect(page.getByRole('heading', { name: 'My sources' })).toBeVisible();
  await expect(page.getByText('No sources yet')).toBeVisible();

  for (const [url, message] of [
    ['javascript:alert(1)', 'Only https:// URLs are accepted.'],
    ['http://cdn.example.com/live.m3u8', 'Only https:// URLs are accepted.'],
    ['https://192.168.1.20/live.m3u8', 'Private, local or reserved network addresses are not allowed.'],
    ['https://127.0.0.1:8787/api/providers', 'Private, local or reserved network addresses are not allowed.'],
    ['https://localhost/live.m3u8', 'Private, local or reserved network addresses are not allowed.'],
    ['https://169.254.169.254/latest/meta-data/', 'Private, local or reserved network addresses are not allowed.'],
  ]) {
    await submitSource(page, url);
    await expect(addForm(page).getByRole('alert')).toHaveText(message);
  }
  await shot(page, 'fixture-mysources-rejected');

  await submitSource(page, OWNER_URL, 'E2E fixture channel (test pattern, not sports)');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('https://test-streams.mux.dev/…/index.m3u8');
  const item = page.locator('.my-source');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Not attached to a game (channel)');
  await expect(item.locator('code')).toHaveText('https://test-streams.mux.dev/…/index.m3u8');
  const id = await item.getAttribute('data-source-id');
  expect(id).toMatch(/^[a-f0-9]{16}$/);
  await page.reload();
  await expect(page.locator('.my-source')).toHaveCount(1); // persisted on the server
  expect(await page.locator('body').innerText()).not.toContain(TOKEN);
  await shot(page, 'fixture-mysources-saved');

  // Unattached sources are channels: listed under Live channels, never as a game.
  await page.getByRole('button', { name: 'Live channels' }).click();
  const channel = page.locator('.channel-card', { hasText: 'E2E fixture channel' });
  await expect(channel).toContainText('Added by you · Your sources · HLS');
  await channel.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByText('YOUR CHANNEL · this game is not verified on it')).toBeVisible();
  await expect(page.locator('[data-player-state]').first()).toHaveAttribute('data-player-state', 'playing');
  const proof = await playbackProof(page);
  console.log('owner source (fixture) proof', JSON.stringify(proof));
  expect(proof.currentTime).toBeGreaterThan(1.5);
  expect(proof.totalFrames).toBeGreaterThan(30);
  expect(redirects[0], 'server redirects to the raw URL only at play time').toBe(`302 ${OWNER_URL}`);
  await shot(page, 'fixture-owner-channel-playing');
  await page.getByRole('button', { name: 'Close player' }).click();

  await page.getByRole('button', { name: 'My sources' }).click();
  await page.locator('.my-source').getByRole('button', { name: 'Disable' }).click();
  await expect(page.locator('.my-source')).toContainText('DISABLED');
  await page.getByRole('button', { name: 'Live channels' }).click();
  await expect(page.locator('.channel-card', { hasText: 'E2E fixture channel' })).toHaveCount(0);
  expect((await page.request.get(`/api/custom-sources/${id}/open`, { maxRedirects: 0 })).status(), 'disabled source no longer redirects').toBe(404);
  await page.getByRole('button', { name: 'My sources' }).click();
  await page.locator('.my-source').getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('.my-source')).toContainText('ENABLED');
  await page.locator('.my-source').getByRole('button', { name: /^Remove/ }).click();
  await page.locator('.my-source').getByRole('button', { name: 'Confirm remove' }).click();
  await expect(page.getByText('No sources yet')).toBeVisible();

  expect(api.length).toBeGreaterThan(5);
  for (const body of api) expect(body, 'API responses never carry the stream token').not.toContain(TOKEN);
});

// TEST FIXTURE event + resolution in the server's response shape. Not a real game.
const fixtureEvent = {
  id: 'basketball|2026-11-05|fixture-2', providerId: 'fixture-2', sport: 'basketball', league: 'NBA',
  home: 'Fixture Home Team', away: 'Fixture Away Team', homeShort: 'HOM', awayShort: 'AWY', homeLogo: '', awayLogo: '',
  homeScore: '10', awayScore: '8', kickoff: new Date(Date.now() - 3600_000).toISOString(), status: 'live', clock: 'Q2 1:00', venue: '',
  broadcasters: ['NBA TV', 'Fixture Local TV'], broadcastDetails: [], isDemo: false,
};
const resolution = {
  event: fixtureEvent, providers: [], providerErrors: [], searchedAt: new Date().toISOString(),
  sources: [
    { id: 'custom:00000000000000aa', provider: 'Added by you', origin: 'Your sources', title: 'Owner fixture feed', kind: 'hls',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', confidence: 100, status: 'playable', provenance: 'owner', liveStatus: 'unknown', access: 'owner',
      reason: 'You attached this source to this game and confirmed you are authorized to use it.' },
    { id: 'official:FIXTURE0001', provider: 'FIBA (official YouTube)', origin: 'FIBA', title: 'Fixture Home Team v Fixture Away Team | replay', kind: 'youtube',
      url: 'https://www.youtube.com/watch?v=FIXTURE0001', videoId: 'FIXTURE0001', confidence: 98, status: 'playable', provenance: 'official-feed', liveStatus: 'replay', access: 'free',
      reason: 'Both team names appear in an official FIBA video title.' },
  ],
  providerResults: [
    { id: 'custom', name: 'Your sources', status: 'ok', count: 1, detail: '1 saved source(s) checked; 1 attached to this game' },
    { id: 'official', name: 'Official free broadcasts (no key)', status: 'ok', count: 1, detail: 'fixture' },
    { id: 'youtube', name: 'Official YouTube Live', status: 'not-configured', count: 0, detail: 'Needs YOUTUBE_API_KEY and OFFICIAL_YOUTUBE_CHANNEL_IDS' },
  ],
  watch: { listingRegion: 'US', caveat: 'From the ESPN listing, which covers United States broadcasts. Rights differ by country. These official sites usually need sign-in or a subscription, and they are not free streams of this game.',
    league: { label: 'NBA League Pass', url: 'https://www.nba.com/watch/league-pass-stream', access: 'subscription', note: 'Out-of-market games. Local and national TV games are blacked out in the US and Canada.' },
    routes: [
      { name: 'NBA TV', type: 'Tv', market: 'National', region: 'US', service: 'NBA TV', url: 'https://www.nba.com/watch/nba-tv', access: 'tv-provider', accessNote: 'TV provider sign-in required', regionNote: '', note: '' },
      { name: 'Fixture Local TV', type: 'Tv', market: 'Home', region: 'US', service: null, url: null, access: 'unknown', accessNote: 'Regional or team service, usually in-market only', regionNote: '', note: 'No official link mapped for this name.' }] },
};
// TEST FIXTURE standing in for the YouTube embed: tries a popup and a top-level navigation.
const SANDBOX_PROBE = `<!doctype html><body style="background:#123;color:#fff">fixture embed<script>
  let popup = 'unknown', topNav = 'unknown';
  try { popup = window.open('https://example.com/popup') ? 'opened' : 'blocked'; } catch (e) { popup = 'blocked'; }
  try { top.location.href = 'https://example.com/hijack'; topNav = 'attempted'; } catch (e) { topNav = 'blocked'; }
  parent.postMessage({ akstreamsSandboxProbe: true, popup, topNav }, '*');
</script></body>`;

test('watch page: where-to-watch links, owner + official sources, switching, sandboxed embed', async ({ page, context }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  await page.route('https://test-streams.mux.dev/**', serveHls('a'));
  await page.route('https://www.youtube-nocookie.com/embed/**', r => r.fulfill({ contentType: 'text/html', body: SANDBOX_PROBE }));
  await page.route(/\/api\/events\?/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: [fixtureEvent], partial: false, unavailable: false, errors: [], date: '2026-11-05', timeZone: 'America/Toronto', fetchedAt: new Date().toISOString() }) }));
  await page.route(/\/api\/events\/[^/?]+\/sources/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(resolution) }));
  await page.route(/\/api\/events\/[^/?]+$/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ event: fixtureEvent, fetchedAt: new Date().toISOString() }) }));
  const popups: string[] = [];
  context.on('page', p => popups.push(p.url()));
  await page.goto('/');
  await page.getByRole('button', { name: /^Fixture Home Team vs/ }).click();

  const wtw = page.getByRole('region', { name: /Where to watch/ });
  await expect(wtw).toContainText('they are not free streams of this game');
  const nbaTv = wtw.getByRole('link', { name: 'Open NBA TV official site' });
  await expect(nbaTv).toHaveAttribute('href', 'https://www.nba.com/watch/nba-tv');
  await expect(nbaTv).toHaveAttribute('target', '_blank');
  await expect(nbaTv).toHaveAttribute('rel', /noopener/);
  await expect(wtw).toContainText('TV provider sign-in required');
  await expect(wtw.locator('.wtw-route', { hasText: 'Fixture Local TV' })).toContainText('No link');
  await expect(wtw.getByRole('link', { name: 'Open NBA League Pass' })).toBeVisible();
  await expect(page.locator('.source-item', { hasText: 'NBA TV' }), 'broadcasters are not sources').toHaveCount(0);

  await expect(page.locator('.source-group-head', { hasText: 'Added by you' })).toBeVisible();
  await expect(page.locator('.source-item', { hasText: 'Fixture Home Team v Fixture Away Team' })).toContainText('REPLAY · free');
  await page.locator('.source-item', { hasText: 'Owner fixture feed' }).click();
  await expect(page.getByText('ADDED BY YOU · attached to this game')).toBeVisible();
  await expect(page.locator('[data-player-state]').first()).toHaveAttribute('data-player-state', 'playing');
  expect((await playbackProof(page, 1500)).currentTime).toBeGreaterThan(0.8);
  await shot(page, 'fixture-watch-owner-source-and-where-to-watch');

  const muxAfterSwitch: string[] = [];
  page.on('request', r => { if (r.url().includes('test-streams.mux.dev')) muxAfterSwitch.push(r.url()); });
  const probe = page.evaluate(() => new Promise(resolve => addEventListener('message', e => { if (e.data?.akstreamsSandboxProbe) resolve(e.data); })));
  await page.getByRole('button', { name: 'Try next source' }).click();
  await expect(page.getByText('OFFICIAL · FIBA · REPLAY · FREE')).toBeVisible();
  const frame = page.locator('iframe.video-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  await expect(frame).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/FIXTURE0001\?.*enablejsapi=1/);
  expect(await probe).toEqual({ akstreamsSandboxProbe: true, popup: 'blocked', topNav: 'blocked' });
  await page.waitForTimeout(500);
  expect(page.url(), 'embed cannot navigate the app').toContain('event=basketball');
  expect(popups, 'embed cannot open popups').toEqual([]);
  await expect(page.locator('video')).toHaveCount(0);
  expect(muxAfterSwitch, 'HLS stops loading after switching to the embed').toEqual([]);
  await shot(page, 'fixture-watch-official-embed-sandboxed');
});

// TEST FIXTURE official feed payloads in the server's /api/official shape.
const item = (id: string, liveStatus: string, extra: Record<string, unknown> = {}) => ({
  id: `official:${id}`, videoId: id, title: `Fixture ${liveStatus} game ${id}`, channelName: 'FIBA', channelId: 'UCtInrnU3QbWqFGsdKT1GZtg', owner: 'FIBA (International Basketball Federation)',
  url: `https://www.youtube.com/watch?v=${id}`, published: '2026-11-05T19:00:00Z', liveStatus, scheduledStart: liveStatus === 'upcoming' ? '2026-11-06T05:30:00Z' : '',
  embeddable: true, verified: liveStatus !== 'unknown', access: 'free', detail: liveStatus === 'unknown' ? 'Live status unverified: YouTube asked for a bot/consent check (not bypassed)' : 'Checked via the public watch page', ...extra });
const channels = [{ id: 'UCtInrnU3QbWqFGsdKT1GZtg', name: 'FIBA', handle: '@FIBA', owner: 'FIBA' }, { id: 'UC7LpyJP5fupiJu2CdzRQheg', name: 'FIBA3x3', handle: '@FIBA3x3', owner: 'FIBA 3x3' }];

test('official broadcasts page: live/upcoming/replay/unverified labels, blocked embed, feed failures', async ({ page }) => {
  let mode = 'partial';
  await page.route('**/api/official', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(mode === 'partial'
    ? { enabled: true, channels, checkedAt: new Date().toISOString(), errors: ['FIBA3x3 feed HTTP 503'],
      items: [item('LIVEfixture', 'live'), item('UPCOMfixtur', 'upcoming'), item('REPLAYfixtu', 'replay'), item('NOEMBEDfixt', 'replay', { embeddable: false, title: 'Fixture replay with embedding disabled' }), item('UNKNOWNfixt', 'unknown')] }
    : { enabled: true, channels, checkedAt: new Date().toISOString(), errors: ['FIBA feed HTTP 503', 'FIBA3x3 feed: Network error: ENOTFOUND'], items: [] }) }));
  await page.route('https://www.youtube-nocookie.com/embed/**', r => r.fulfill({ contentType: 'text/html', body: '<body style="background:#246">fixture embed</body>' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Official free' }).click();
  await expect(page).toHaveURL(/view=official/);
  await expect(page.getByText('Some official feeds failed: FIBA3x3 feed HTTP 503')).toBeVisible();
  for (const [section, status] of [['Live now', 'LIVE NOW'], ['Upcoming', 'UPCOMING'], ['Replays', 'REPLAY'], ['Status unverified', 'STATUS UNVERIFIED']]) {
    await expect(page.getByRole('region', { name: section }).locator('.status-pill').first()).toContainText(status);
  }
  await expect(page.getByRole('region', { name: 'Status unverified' })).toContainText('not bypassed');
  const blocked = page.locator('.official-card', { hasText: 'embedding disabled' });
  await expect(blocked.getByRole('button', { name: /Watch here/ })).toHaveCount(0);
  await expect(blocked.getByRole('link', { name: 'YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=NOEMBEDfixt');
  await page.getByRole('button', { name: 'Watch here: Fixture live game LIVEfixture' }).click();
  await expect(page.locator('.player-badge')).toHaveText('OFFICIAL · FIBA · LIVE NOW · FREE');
  await expect(page.locator('iframe.video-frame')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  await shot(page, 'fixture-official-page');

  mode = 'down';
  await page.getByRole('button', { name: 'Refresh official broadcasts' }).click();
  await expect(page.getByRole('heading', { name: 'Official feeds unavailable' })).toBeVisible();
  await expect(page.getByText('This is not the same as "nothing on"')).toBeVisible();
  await shot(page, 'fixture-official-feeds-down');
});
