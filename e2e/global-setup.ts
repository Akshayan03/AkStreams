import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { artifacts, fixtureDir } from './helpers';

// TEST FIXTURE: two short synthetic HLS clips (ffmpeg test patterns), served to the page via
// request interception in fixture.spec.ts. They stand in for the public sample URLs so the
// deterministic suite does not depend on third-party CDNs. Not sports content.
export default async function globalSetup() {
  if (!existsSync('web/dist/index.html')) throw new Error('Run `npm run build` before the E2E suite.');
  // TEST STORE: owner sources created by the suites live here and start empty on every run.
  rmSync(path.join(artifacts, 'e2e-sources.local.json'), { force: true });
  for (const [name, pattern] of [['a', 'testsrc2'], ['b', 'smptebars']] as const) {
    const dir = `${fixtureDir}/${name}`;
    if (existsSync(`${dir}/index.m3u8`)) continue;
    mkdirSync(dir, { recursive: true });
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `${pattern}=size=640x360:rate=30`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '24', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '64k',
        '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', `${dir}/seg%03d.ts`, `${dir}/index.m3u8`]);
    } catch (error) {
      console.warn(`ffmpeg unavailable; fixture playback tests will be skipped (${(error as Error).message})`);
      return;
    }
  }
}
