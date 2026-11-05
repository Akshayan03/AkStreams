import path from 'node:path';
import os from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';
import type { Page } from '@playwright/test';

export const artifacts = process.env.AKSTREAMS_ARTIFACTS || path.join(process.env.TMPDIR || os.tmpdir(), 'akstreams-e2e');
export const fixtureDir = path.join(artifacts, 'hls-fixture');
export const shotDir = path.join(artifacts, 'screenshots');
mkdirSync(shotDir, { recursive: true });
export const hasFixture = () => existsSync(path.join(fixtureDir, 'a', 'index.m3u8'));
export const shot = (page: Page, name: string) => page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage: false });

export type Proof = { currentTime: number; paused: boolean; totalFrames: number; dropped: number; callbackFrames: number; distinctColors: number; width: number; height: number };
/**
 * Evidence that video is really decoding and rendering: currentTime advances, the decoder
 * reports frames, requestVideoFrameCallback fires for presented frames, and a canvas
 * snapshot of the current frame is not blank.
 */
export async function playbackProof(page: Page, sampleMs = 2500): Promise<Proof> {
  return page.evaluate(async ms => {
    const v = document.querySelector('video') as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (!v) throw new Error('no video element');
    const start = v.currentTime;
    let callbackFrames = 0;
    const tick = () => { callbackFrames++; v.requestVideoFrameCallback?.(tick); };
    v.requestVideoFrameCallback?.(tick);
    // Sample the rendered frame several times; keep the richest sample (clips may open on black).
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    let distinct = 0;
    for (let s = 0; s < 4; s++) {
      await new Promise(r => setTimeout(r, ms / 4));
      ctx.drawImage(v, 0, 0, 64, 36);
      const data = ctx.getImageData(0, 0, 64, 36).data;
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 16) colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      distinct = Math.max(distinct, colors.size);
    }
    const q = v.getVideoPlaybackQuality();
    return { currentTime: v.currentTime - start, paused: v.paused, totalFrames: q.totalVideoFrames, dropped: q.droppedVideoFrames,
      callbackFrames, distinctColors: distinct, width: v.videoWidth, height: v.videoHeight };
  }, sampleMs);
}
