import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// E2E runs against the production build served by the real server, in installed Google Chrome
// (branded Chrome ships H.264/AAC decoders; no Playwright browser download needed).
const PORT = Number(process.env.E2E_PORT || 8791);
const scratch = process.env.AKSTREAMS_ARTIFACTS || path.join(process.env.TMPDIR || os.tmpdir(), 'akstreams-e2e');
export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(scratch, 'results'),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.E2E_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Toronto',
    locale: 'en-US',
    trace: 'retain-on-failure',
    // --disable-audio-output: in sessions without a usable audio sink (CI, sandboxed agents) Chrome's
    // media clock never advances for any video with an audio track, even a plain <video src=mp4>.
    // A null audio sink lets video decode/render be measured; audible output is NOT verified here.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', ...(process.env.E2E_REAL_AUDIO ? [] : ['--disable-audio-output'])] },
  },
  projects: [
    { name: 'fixture', testMatch: /fixture[-\w]*\.spec\.ts/ },
    { name: 'live', testMatch: /live[-\w]*\.spec\.ts/, use: { video: 'on' } },
  ],
  webServer: {
    command: 'node server/index.mjs',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    // Owner sources go to an isolated scratch store (reset in global setup), never config/.
    env: { PORT: String(PORT), HOST: '127.0.0.1', DEMO_STREAM: 'true', YOUTUBE_API_KEY: '', OFFICIAL_YOUTUBE_CHANNEL_IDS: '', AUTHORIZED_M3U_URLS: '', AUTHORIZED_M3U_FILE: '',
      AKSTREAMS_SOURCES_FILE: path.join(scratch, 'e2e-sources.local.json') },
  },
});
