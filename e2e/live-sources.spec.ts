import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { playbackProof, shot } from './helpers';

// LIVE SUITE (v0.3): real upstreams, no interception.
//  * Official FIBA / FIBA3x3 YouTube feeds, read without a key, then played in the app's sandboxed
//    embed. Evidence: the YouTube player's own state over postMessage (enablejsapi) + pixel change.
//  * Owner import attached to a real ESPN game, using the public Mux sample with a FAKE token
//    (isolated scratch store). The sample is a test clip, not the game, and is labelled so.

type YtInfo = { currentTime?: number; playerState?: number; videoData?: { video_id?: string; title?: string; author?: string; isLive?: boolean }; duration?: number };
/** Subscribes to the YouTube embed's postMessage API and returns the latest merged player info. */
async function youtubeState(page: Page, ms: number): Promise<YtInfo[]> {
  return page.evaluate(async ms => {
    const frame = document.querySelector('iframe.video-frame') as HTMLIFrameElement;
    const samples: YtInfo[] = []; let info: YtInfo = {};
    const onMessage = (e: MessageEvent) => {
      if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname)) return;
      try { const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d?.info) info = { ...info, ...d.info }; } catch {}
    };
    addEventListener('message', onMessage);
    const send = (o: object) => frame.contentWindow?.postMessage(JSON.stringify({ ...o, id: 1, channel: 'widget' }), '*');
    const end = Date.now() + ms;
    while (Date.now() < end) {
      send({ event: 'listening' });
      await new Promise(r => setTimeout(r, 1000));
      samples.push({ ...info, videoData: info.videoData && { video_id: info.videoData.video_id, title: info.videoData.title, author: info.videoData.author, isLive: info.videoData.isLive } });
    }
    removeEventListener('message', onMessage);
    return samples;
  }, ms) as Promise<YtInfo[]>;
}
/** Fraction of pixels that changed noticeably between two PNG screenshots (decoded in a blank page). */
async function pixelChange(page: Page, a: Buffer, b: Buffer) {
  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(async ([a, b]) => {
      const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
      const px = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib); let changed = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 48) changed++;
      return changed / (w * h);
    }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
  } finally { await scratch.close(); }
}

test('official FIBA broadcast plays inside the app with changing footage (keyless feed)', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/?view=official');
  await expect(page.locator('.official-card').first()).toBeVisible({ timeout: 90_000 });
  const statuses = await page.locator('.official-card').evaluateAll(cards => cards.map(c => (c as HTMLElement).dataset.liveStatus));
  const counts = statuses.reduce<Record<string, number>>((m, s) => ({ ...m, [s!]: (m[s!] || 0) + 1 }), {});
  console.log(`official feed items by verified status: ${JSON.stringify(counts)}`);
  await shot(page, 'live-official-list');
  // Prefer a verified live broadcast; otherwise a verified replay (stated as such).
  const pick = page.locator(`.official-card[data-live-status="${counts.live ? 'live' : 'replay'}"]`).filter({ has: page.getByRole('button', { name: /^Watch here/ }) }).first();
  test.skip(!(await pick.count()), 'No embeddable live or replay item in the official feeds right now');
  const title = (await pick.locator('.official-title').innerText()).trim();
  const status = await pick.getAttribute('data-live-status');
  const channel = (await pick.locator('.league-label').innerText()).trim();
  await pick.getByRole('button', { name: /^Watch here/ }).click();
  const frame = page.locator('iframe.video-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  const videoId = (await frame.getAttribute('src'))!.match(/embed\/([\w-]{11})/)![1];
  await expect(page.locator('.player-badge')).toContainText(new RegExp(`^OFFICIAL · ${channel} · ${status!.toUpperCase()}`, 'i'));
  await page.waitForTimeout(6000); // player boot + any pre-roll
  const samples = await youtubeState(page, 12_000);
  const shots: Buffer[] = [];
  for (let i = 0; i < 3; i++) { shots.push(await frame.screenshot({ path: `${process.env.AKSTREAMS_ARTIFACTS || '.'}/screenshots/live-official-frame-${i + 1}.png` })); await page.waitForTimeout(3000); }
  const change12 = await pixelChange(page, shots[0], shots[1]);
  const change23 = await pixelChange(page, shots[1], shots[2]);
  const first = samples.find(s => typeof s.currentTime === 'number'), last = [...samples].reverse().find(s => typeof s.currentTime === 'number');
  const evidence = { videoId, title, channel, appStatus: status, ytVideoId: last?.videoData?.video_id, ytAuthor: last?.videoData?.author, ytIsLive: last?.videoData?.isLive,
    playerState: last?.playerState, currentTimeAdvance: first && last ? Number((last.currentTime! - first.currentTime!).toFixed(2)) : null, duration: last?.duration,
    pixelChange: [Number(change12.toFixed(3)), Number(change23.toFixed(3))] };
  console.log(`OFFICIAL SPORTS VIDEO EVIDENCE ${JSON.stringify(evidence)}`);
  await shot(page, 'live-official-playing');
  expect(evidence.ytVideoId, 'YouTube player reports the chosen official video').toBe(videoId);
  expect(evidence.playerState, 'YouTube player state 1 = playing').toBe(1);
  expect(evidence.currentTimeAdvance!).toBeGreaterThan(5);
  expect(Math.max(change12, change23), 'rendered footage changes between frames').toBeGreaterThan(0.02);
});

const TOKEN = 'E2E-TEST-ONLY-TOKEN-live-31c4';
test('owner-authorized source attached to a real game plays and never exposes its token', async ({ page, request }) => {
  test.setTimeout(150_000);
  const bodies: string[] = [];
  page.on('response', async r => { if (r.url().includes('/api/') && !/\/open$/.test(r.url())) { try { bodies.push(await r.text()); } catch {} } });
  let date = '';
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  for (let i = 0; i < 7 && !date; i++) {
    const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    const body = await (await request.get(`/api/events?date=${d.toISOString().slice(0, 10)}&tz=America/Toronto`)).json();
    if (body.events.length) date = d.toISOString().slice(0, 10);
  }
  test.skip(!date, 'No NBA/soccer games in the next 7 days on ESPN');
  await page.goto(date === start ? '/' : `/?date=${date}`);
  const card = page.locator('.game-card').first();
  const label = await card.getAttribute('aria-label');
  await card.click();
  await expect(page.getByText(/No source found for this game|Source search failed/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Add source for this game' }).click();
  const form = page.getByRole('form', { name: 'Add source' });
  await form.getByLabel('Stream or watch URL').fill(`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8?token=${TOKEN}`);
  await form.getByLabel(/^Label/).fill('E2E TEST SOURCE · Mux sample clip, not this game');
  await expect(form.getByLabel(/Attach to this game only/)).toBeChecked();
  await form.getByLabel(/I'm authorized/).check();
  await form.getByRole('button', { name: 'Save source' }).click();
  const item = page.locator('.source-item', { hasText: 'E2E TEST SOURCE' });
  await expect(item).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.source-group-head', { hasText: 'Added by you' })).toBeVisible();
  await item.click();
  await expect(page.getByText('ADDED BY YOU · attached to this game')).toBeVisible();
  await expect(page.locator('[data-player-state]').first()).toHaveAttribute('data-player-state', 'playing', { timeout: 45_000 });
  const proof = await playbackProof(page, 6000);
  console.log(`owner source on real game "${label}" via redirect: ${JSON.stringify(proof)}`);
  expect(proof.currentTime).toBeGreaterThan(2);
  expect(proof.totalFrames).toBeGreaterThan(30);
  await shot(page, 'live-owner-source-on-real-game');
  expect(await page.locator('body').innerText()).not.toContain(TOKEN);
  for (const b of bodies) expect(b).not.toContain(TOKEN);
  // Cleanup through the UI: remove it, and the game no longer offers it.
  await page.getByRole('button', { name: 'My sources' }).click();
  const saved = page.locator('.my-source', { hasText: 'E2E TEST SOURCE' });
  await expect(saved).toContainText('Attached to');
  await saved.getByRole('button', { name: /^Remove/ }).click();
  await saved.getByRole('button', { name: 'Confirm remove' }).click();
  await expect(page.locator('.my-source', { hasText: 'E2E TEST SOURCE' })).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.source-item', { hasText: 'E2E TEST SOURCE' })).toHaveCount(0, { timeout: 30_000 });
});
