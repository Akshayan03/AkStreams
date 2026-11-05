import { test, expect } from '@playwright/test';
import { playbackProof, shot } from './helpers';

// LIVE SUITE — real upstreams, no interception: ESPN public scoreboard and the public Mux/Apple
// HLS samples. Results depend on the real schedule and network; no provider keys are configured,
// so the app must report that honestly instead of inventing sources.

test('real ESPN schedule renders in the viewer time zone and opens a real game', async ({ page, request }) => {
  let date = '';
  let count = 0;
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  for (let i = 0; i < 7 && !count; i++) {
    const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    date = d.toISOString().slice(0, 10);
    const res = await request.get(`/api/events?date=${date}&tz=America/Toronto&sport=all`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    console.log(`live ESPN ${date}: ${body.events.length} games, partial=${body.partial}, errors=${JSON.stringify(body.errors)}`);
    count = body.events.length;
  }
  test.skip(!count, 'No NBA/soccer games in the next 7 days on ESPN');
  await page.goto(date === start ? '/' : `/?date=${date}`);
  await expect(page.locator('.game-card')).toHaveCount(count);
  await expect(page.getByText('Times shown in America/Toronto')).toBeVisible();
  await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 15_000 });
  const logos = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.club-logo')].filter(i => i.naturalWidth > 0).length);
  console.log(`real team logos rendered: ${logos}`);
  await shot(page, 'live-desktop-board');
  const first = page.locator('.game-card').first();
  const label = await first.getAttribute('aria-label');
  await first.click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('No source providers configured')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.source-item')).toHaveCount(0);
  console.log(`opened real game: ${label}`);
  await shot(page, 'live-desktop-watch-no-providers');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goBack();
  await expect(page.locator('.game-card').first()).toBeVisible();
  await expect.poll(async () => (await page.locator('.sidebar').boundingBox())?.x).toBeLessThan(-200); // drawer closed after resize
  await shot(page, 'live-mobile-board');
});

test('unknown real event id fails truthfully', async ({ page }) => {
  await page.goto(`/?event=${encodeURIComponent('basketball|2026-11-05|1')}`);
  await expect(page.getByRole('heading', { name: "Couldn't open this game" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Event not found')).toBeVisible();
});

test('public sample HLS streams really play and switch (not sports)', async ({ page }) => {
  await page.goto('/?demo=1');
  await page.getByRole('button', { name: /^Arsenal vs/ }).click();
  await page.locator('.source-item', { hasText: /Big Buck Bunny/ }).click();
  await expect(page.locator('[data-player-state]').first()).toHaveAttribute('data-player-state', 'playing', { timeout: 45_000 });
  const mux = await playbackProof(page, 12_000);
  console.log('live Mux proof', JSON.stringify(mux));
  expect(mux.currentTime).toBeGreaterThan(2);
  expect(mux.totalFrames).toBeGreaterThan(30);
  expect(mux.distinctColors).toBeGreaterThan(4);
  await shot(page, 'live-desktop-mux-playing');
  await page.locator('.source-item', { hasText: /Apple bipbop/ }).click();
  await expect(page.locator('[data-source-id="demo:apple-bipbop"]')).toHaveAttribute('data-player-state', 'playing', { timeout: 45_000 });
  const apple = await playbackProof(page, 4000);
  console.log('live Apple proof', JSON.stringify(apple));
  expect(apple.currentTime).toBeGreaterThan(2);
  expect(apple.totalFrames).toBeGreaterThan(30);
  await shot(page, 'live-desktop-apple-playing');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'live-mobile-apple-playing');
});
