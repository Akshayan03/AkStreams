import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fixtureDir, hasFixture, playbackProof, shot } from './helpers';

// DETERMINISTIC SUITE — every upstream here is a TEST FIXTURE:
//  * schedule: the app's own demo fixtures, or intercepted /api responses (labelled below)
//  * video: the two public sample URLs are intercepted and answered with ffmpeg test-pattern HLS
// Real upstream evidence lives in live.spec.ts.
const MUX = 'https://test-streams.mux.dev/**';
const APPLE = 'https://devstreaming-cdn.apple.com/**';

function serveHls(dir: string) {
  return async (route: Route) => {
    const file = path.join(fixtureDir, dir, route.request().url().endsWith('.m3u8') ? 'index.m3u8' : path.basename(new URL(route.request().url()).pathname));
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
    await route.fulfill({ status: 200, body: readFileSync(file), headers: {
      'content-type': file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'access-control-allow-origin': '*' } });
  };
}
async function useFixtureStreams(page: Page) {
  await page.route(MUX, serveHls('a'));
  await page.route(APPLE, serveHls('b'));
}
const card = (page: Page, home: string) => page.getByRole('button', { name: new RegExp(`^${home} vs`) });
const sourceButton = (page: Page, text: RegExp) => page.locator('.source-item', { hasText: text });
const playerState = (page: Page) => page.locator('[data-player-state]').first();

// TEST FIXTURE event (shape of the server's ESPN mapping). Not a real game.
const fixtureEvent = (score: number) => ({
  id: 'basketball|2026-11-05|fixture-1', providerId: 'fixture-1', sport: 'basketball', league: 'NBA',
  home: 'Fixture Home Team', away: 'Fixture Away Team', homeShort: 'HOM', awayShort: 'AWY', homeLogo: '', awayLogo: '',
  homeScore: String(score), awayScore: '0', kickoff: new Date(Date.now() - 3600_000).toISOString(), status: 'live',
  clock: 'Q3 5:00', venue: '', broadcasters: ['Fixture Sports Network'], isDemo: false,
});

test('demo board: sport/league/search filters, URL state, deep link and back', async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.locator('.game-card')).toHaveCount(4);
  await expect(page.getByText('These fixtures are fictional')).toBeVisible();
  await page.getByRole('group', { name: 'Sport' }).getByRole('button', { name: 'Soccer' }).click();
  await expect(page).toHaveURL(/sport=soccer/);
  await expect(page.locator('.game-card')).toHaveCount(2);
  await page.getByRole('group', { name: 'League' }).getByRole('button', { name: 'Champions League' }).click();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page).toHaveURL(/league=Champions\+League/);
  await page.getByRole('searchbox').fill('zzz');
  await expect(page.getByText('No games match your filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.game-card')).toHaveCount(2);
  await card(page, 'Arsenal').click();
  await expect(page).toHaveURL(/event=soccer%7C/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Arsenal');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Arsenal'); // deep link survives reload
  await page.goBack();
  await expect(page.locator('.game-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
});

test('plays a source with decoded frames, switches cleanly, and stops on leave', async ({ page }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  await useFixtureStreams(page);
  await page.goto('/?demo=1');
  await card(page, 'Arsenal').click();
  await expect(page.locator('.source-group-head', { hasText: 'Player test streams' })).toBeVisible();
  await expect(page.getByText('Public sample video for checking playback. Not this game.')).toBeVisible();
  await sourceButton(page, /Big Buck Bunny/).click();
  await expect(page.getByText('TEST STREAM · not a sports broadcast')).toBeVisible();
  await expect(playerState(page)).toHaveAttribute('data-player-state', 'playing');
  const a = await playbackProof(page);
  console.log('fixture source A proof', JSON.stringify(a));
  expect(a.currentTime).toBeGreaterThan(1.5);
  expect(a.totalFrames).toBeGreaterThan(30);
  expect(a.callbackFrames).toBeGreaterThan(20);
  expect(a.distinctColors).toBeGreaterThan(8);
  await shot(page, 'fixture-desktop-watch-playing');

  const muxAfterSwitch: string[] = [];
  await sourceButton(page, /Apple bipbop/).click();
  page.on('request', r => { if (r.url().includes('test-streams.mux.dev')) muxAfterSwitch.push(r.url()); });
  await expect(page.locator('[data-source-id="demo:apple-bipbop"]')).toHaveAttribute('data-player-state', 'playing');
  const b = await playbackProof(page);
  console.log('fixture source B proof', JSON.stringify(b));
  expect(b.currentTime).toBeGreaterThan(1.5);
  expect(b.distinctColors).toBeGreaterThan(4);
  expect(muxAfterSwitch, 'old source must stop loading after switch').toEqual([]);

  const afterLeave: string[] = [];
  page.on('request', r => { if (/devstreaming-cdn|test-streams/.test(r.url())) afterLeave.push(r.url()); });
  await page.getByRole('button', { name: 'Back to matches' }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.waitForTimeout(2500);
  expect(afterLeave, 'leaving the watch page must stop all stream requests').toEqual([]);
});

test('failed source explains the error and recovers via next source', async ({ page }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  await page.route(MUX, r => r.fulfill({ status: 404, body: 'gone', headers: { 'access-control-allow-origin': '*' } }));
  await page.route(APPLE, serveHls('b'));
  await page.goto('/?demo=1');
  await card(page, 'Arsenal').click();
  await sourceButton(page, /Big Buck Bunny/).click();
  await expect(page.getByRole('alert').filter({ hasText: "Can't play this source" })).toContainText('HTTP 404', { timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Open externally' })).toHaveAttribute('href', /test-streams\.mux\.dev/);
  await shot(page, 'fixture-desktop-source-error');
  await page.getByRole('button', { name: 'Next source' }).first().click();
  await expect(page.locator('[data-source-id="demo:apple-bipbop"]')).toHaveAttribute('data-player-state', 'playing');
  const proof = await playbackProof(page, 1500);
  console.log('recovered source proof', JSON.stringify(proof));
  expect(proof.currentTime).toBeGreaterThan(0.8);
});

test('keyboard operation and fullscreen', async ({ page }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  await useFixtureStreams(page);
  await page.goto('/?demo=1');
  await card(page, 'Arsenal').focus();
  await page.keyboard.press('Enter');
  await sourceButton(page, /Big Buck Bunny/).focus();
  await page.keyboard.press('Enter');
  await expect(playerState(page)).toHaveAttribute('data-player-state', 'playing');
  await page.locator('.player-frame').focus();
  await page.keyboard.press('k');
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
  await page.keyboard.press('k');
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused)).toBe(false);
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.muted)).toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toContain('player-frame');
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test('truthful states: schedule outage, unconfigured providers, offline', async ({ page, context }) => {
  await page.route(/\/api\/events\?/, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Upstream unavailable (test fixture)' }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Schedule unavailable' })).toBeVisible();
  await expect(page.getByText('Upstream unavailable (test fixture)')).toBeVisible();
  await page.unroute(/\/api\/events\?/);

  await page.route(/\/api\/events\?/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    events: [fixtureEvent(50)], partial: false, unavailable: false, errors: [], date: '2026-11-05', timeZone: 'America/Toronto', fetchedAt: new Date().toISOString() }) }));
  await page.route(/\/api\/events\/[^/?]+\/sources/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    event: fixtureEvent(50), sources: [], providers: [], providerErrors: [], searchedAt: new Date().toISOString(),
    providerResults: [
      { id: 'youtube', name: 'Official YouTube Live', status: 'not-configured', count: 0, detail: 'Needs YOUTUBE_API_KEY and OFFICIAL_YOUTUBE_CHANNEL_IDS' },
      { id: 'playlist', name: 'Authorized M3U/HLS playlists', status: 'not-configured', count: 0, detail: 'Set AUTHORIZED_M3U_URLS or AUTHORIZED_M3U_FILE' }] }) }));
  await page.route(/\/api\/events\/[^/?]+$/, r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ event: fixtureEvent(50), fetchedAt: new Date().toISOString() }) }));
  await page.reload();
  await card(page, 'Fixture Home Team').click();
  await expect(page.getByText('No source providers configured')).toBeVisible();
  await expect(page.locator('.source-item')).toHaveCount(0);
  await expect(page.getByText('Fixture Sports Network')).toBeVisible();
  await expect(page.getByText('not playable links')).toBeVisible();
  await page.getByRole('button', { name: 'Set up providers' }).click();
  await expect(page.getByRole('heading', { name: 'Source providers' })).toBeVisible();
  await expect(page.getByText('NOT CONFIGURED').first()).toBeVisible();
  await shot(page, 'fixture-desktop-providers');

  await page.getByRole('button', { name: 'All games' }).click();
  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await expect(page.locator('.top-indicator')).toHaveText(/OFFLINE/);
  await expect(page.locator('.top-indicator')).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('.top-indicator')).toHaveText(/CONNECTED/);
});

test('live scores refresh every 30s while visible and pause while hidden', async ({ page }) => {
  let calls = 0;
  await page.clock.install();
  await page.route(/\/api\/events\?/, r => { calls++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
    events: [fixtureEvent(calls)], partial: false, unavailable: false, errors: [], date: '2026-11-05', timeZone: 'America/Toronto', fetchedAt: new Date().toISOString() }) }); });
  await page.goto('/');
  await expect(page.locator('.score')).toHaveText('1:0');
  await expect(page.getByText(/auto-refresh 30s/)).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.locator('.score')).toHaveText('2:0');
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenAt = calls;
  await page.clock.fastForward(120_000);
  expect(calls, 'no polling while hidden').toBe(hiddenAt);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.score')).toHaveText(`${hiddenAt + 1}:0`); // overdue -> immediate refresh
});

test('responsive layouts without horizontal overflow', async ({ page }) => {
  test.skip(!hasFixture(), 'ffmpeg fixture unavailable');
  await useFixtureStreams(page);
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 820, height: 1180 }], ['mobile', { width: 390, height: 844 }]] as const) {
    await page.setViewportSize(size);
    await page.goto('/?demo=1');
    await expect(page.locator('.game-card')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} board overflow`).toBeLessThanOrEqual(0);
    await shot(page, `fixture-${name}-board`);
    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Open menu' }).click();
      await expect.poll(async () => (await page.locator('.sidebar').boundingBox())?.x).toBe(0);
      await shot(page, 'fixture-mobile-menu');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
    }
    await card(page, 'Arsenal').click();
    await sourceButton(page, /Big Buck Bunny/).click();
    await expect(playerState(page)).toHaveAttribute('data-player-state', 'playing');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} watch overflow`).toBeLessThanOrEqual(0);
    await shot(page, `fixture-${name}-watch`);
  }
});
