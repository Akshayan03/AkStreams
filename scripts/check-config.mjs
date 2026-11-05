// Validates provider configuration in .env without printing secrets.
//   npm run check-config            offline checks only
//   npm run check-config -- --live  also calls YouTube channels.list (1 quota unit) and fetches playlists
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
else console.log('No .env file found (copy .env.example to .env). Checking process environment only.\n');
const live = process.argv.includes('--live');
const { youtubeInfo } = await import('../server/providers/youtube.mjs');
const { playlistInfo, getPlaylistChannels } = await import('../server/providers/playlist.mjs');
const { safeFetch, redactSecrets } = await import('../server/lib/net.mjs');

let problems = 0;
const line = (ok, text) => { console.log(`${ok ? '  ok ' : '  !! '} ${text}`); if (!ok) problems++; };
const note = text => console.log(`  -- ${text}`);
const host = (process.env.HOST || '127.0.0.1').trim();
line(['127.0.0.1','localhost','::1'].includes(host), `HOST=${host} (must be loopback)`);
const port = Number(process.env.PORT || 8787);
line(Number.isInteger(port) && port > 0 && port < 65536, `PORT=${process.env.PORT || '8787 (default)'}`);

for (const info of [youtubeInfo(), playlistInfo()]) {
  console.log(`\n${info.name}: ${info.enabled ? 'configured' : 'not configured'}`);
  for (const issue of info.issues) { if (/not set|is empty|^Set /.test(issue)) note(`${issue} (optional; provider stays off)`); else line(false, issue); }
  if (!info.issues.length) line(true, info.description);
}

if (live) {
  console.log('\nLive checks');
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  const ids = (process.env.OFFICIAL_YOUTUBE_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(s => /^UC[\w-]{22}$/.test(s)).slice(0, 10);
  if (key && ids.length) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.set('part', 'snippet'); url.searchParams.set('id', ids.join(',')); url.searchParams.set('key', key);
      const res = await safeFetch(url.href, { timeoutMs: 8000, maxBytes: 1_000_000 });
      const body = (() => { try { return res.json(); } catch { return {}; } })();
      if (!res.ok) line(false, `YouTube API rejected the request: HTTP ${res.status} ${body?.error?.errors?.[0]?.reason || ''}`);
      else {
        const found = new Map((body.items || []).map(i => [i.id, i.snippet?.title]));
        for (const id of ids) line(found.has(id), found.has(id) ? `channel ${id} = ${found.get(id)}` : `channel ${id} not found`);
      }
    } catch (error) { line(false, `YouTube check failed: ${redactSecrets(error.message)}`); }
  } else console.log('  -- YouTube live check skipped (not configured)');
  if (playlistInfo().enabled) {
    const { channels, errors } = await getPlaylistChannels();
    for (const e of errors) line(false, e);
    line(errors.length === 0, `${playlistInfo().channelCount} playlist entries loaded, ${channels.length} look like sports channels`);
  } else console.log('  -- Playlist live check skipped (not configured)');
}
console.log(problems ? `\n${problems} problem(s) found.` : '\nConfiguration looks valid.');
process.exitCode = problems ? 1 : 0;
