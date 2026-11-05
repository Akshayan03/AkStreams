# AKStreams · Stream discovery for soccer and basketball

A local React/TypeScript sports app and a Node.js stream **discovery engine**, built as a monochrome sibling to AKFlix. It shows real NBA and European soccer schedules with live scores, searches the source providers **you** configure for each game, and plays what it finds when the provider allows it. If no authorized source exists, it says so instead of inventing one.

## Quick start

Requires Node.js 22+ and npm.

```bash
npm install
npm start            # builds the web app, then serves app + API on http://127.0.0.1:8787
```

Open **http://127.0.0.1:8787**. Stop with `Ctrl+C` (the server shuts down cleanly on SIGINT/SIGTERM).

| Command | What it does |
|---|---|
| `npm start` | Production build + server (one command) |
| `npm run serve` | Serve an existing build without rebuilding |
| `npm run dev` | API with `--watch` + Vite dev server on http://127.0.0.1:5173 (proxied to the API) |
| `npm run check-config` | Validate `.env` provider settings (`-- --live` also tests the key/playlists) |
| `npm test` | Server unit + endpoint tests and web helper tests (no network) |
| `npm run typecheck` / `npm run build` | TypeScript check / production build |
| `npm run e2e` | Browser E2E in installed Google Chrome with deterministic fixtures |
| `npm run e2e:live` | Browser E2E against real ESPN and public HLS samples (records video) |

Want to see the player work before configuring anything? Set `DEMO_STREAM=true` in `.env`, restart, tick **Demo fixtures** and open a demo game. It attaches two public HLS clips (Mux "Big Buck Bunny", Apple "bipbop"), clearly labelled as test streams. They are not sports.

## What works

- **Schedules and live scores** from ESPN's public scoreboard: NBA, Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the Champions League. Games are grouped by **your local calendar day** (ESPN groups by US Eastern day, so adjacent days are fetched and filtered). Postponed and canceled games are shown as such, not as "final".
- **Live refresh**: the board polls every 30 s while a game is live or about to start (every 2 min otherwise for today), only while the tab is visible and online. Requests are cancelled on navigation and back off exponentially on failure. The watch page refreshes the score every 30 s.
- **Navigation**: date (prev/next/today/picker), sport and league filters, search, and shareable URLs (`?date=…&sport=…&league=…`, `?event=…`) that survive reloads and work with the browser's back button.
- **Source discovery** for each game (`/api/events/:id/sources`), ranked: event-title matches first, then confidence, then embeddable over external. Every source shows its provenance (provider, origin, why it matched, confidence).
  - **Official YouTube Live**: searches up to 10 configured official channels for *currently live* embeddable broadcasts and keeps only those naming **both** teams.
  - **Authorized M3U/HLS playlists**: entries naming both teams are matches; channels named like an announced broadcaster are **unconfirmed candidates** and labelled "the game is NOT confirmed on it" everywhere, including over the video.
  - The watch page shows how each provider was searched (searched / skipped and why / not configured / error).
- **Player**: HLS via hls.js (lazy-loaded) or native HLS in Safari, YouTube embeds, external links. Clear error messages (403/404/CORS/DRM/codec), retry, next source, open externally, autoplay-block handling, 25 s start timeout, fullscreen and keyboard controls (`space`/`k` play-pause, `m` mute, `f` fullscreen, `r` retry after an error). Switching sources or leaving the page tears playback down completely.
- **Truthful states**: loading, empty day, filters with no matches, partial upstream outage, total schedule outage ("this is not the same as no games"), offline (keeps the last board and says scores aren't updating), server unreachable, and "no providers configured".
- **Provider status page** with configuration issues (e.g. ignored channel IDs), last error and last successful search. **Live channels** lists sports channels from your playlists and can play HLS ones inline.

## Configure sources

```bash
cp .env.example .env
npm run check-config            # offline validation
npm run check-config -- --live  # also calls YouTube channels.list (1 quota unit) and fetches playlists
```

```dotenv
YOUTUBE_API_KEY=your-own-youtube-data-api-v3-key
OFFICIAL_YOUTUBE_CHANNEL_IDS=UCxxxxxxxxxxxxxxxxxxxxxx,UCyyyyyyyyyyyyyyyyyyyyyy
AUTHORIZED_M3U_URLS=https://your-provider.example/authorized-sports.m3u
AUTHORIZED_M3U_FILE=./config/streams.m3u
```

- Create the YouTube key in **your own** Google Cloud project (YouTube Data API v3). Each live search costs 100 quota units (default daily quota 10,000); results are cached per channel for 3 minutes and searched only for games that are live or within 2 hours of kickoff. Quota/key errors are shown with a plain explanation.
- Channel IDs must be `UC…` IDs (not `@handles`). Pick channels that actually hold streaming rights for the games you want; a configured channel does not imply any particular game is live or available in your region.
- Playlist URLs must be public `https://` URLs; private/LAN hosts are refused. Local files go in `AUTHORIZED_M3U_FILE` (`config/*.m3u` is git-ignored). Sample syntax: `config.sample.m3u`.
- The key and playlist query strings are never sent to the browser or written to logs. Restart AKStreams after editing `.env`.

**Without a configured provider there are no game sources.** Most NBA and top-flight soccer broadcasts are licensed to paid services; AKStreams finds what your configured, authorized providers expose. It does not scrape, and it does not bypass sign-in, DRM or geo restrictions.

## Security model (local use)

- Binds to **127.0.0.1** only; any non-loopback `HOST` is refused at startup. Not intended for public hosting.
- Requests must carry a loopback `Host` header (blocks DNS-rebinding), and API calls from foreign `Origin`s get 403. No wildcard CORS; only the app's own origin, the Vite dev origin and `ALLOWED_ORIGINS` (loopback only).
- Every server-side fetch goes through one client that allows only http/https, rejects credentials in URLs, checks **resolved IPs at connect time** against private/loopback/link-local/CGNAT/multicast/IPv4-mapped/NAT64/6to4 ranges, re-validates every redirect (max 3, no HTTPS→HTTP), caps response size (also after decompression), times out, and limits concurrency to 6.
- Bounded LRU cache (400 entries), per-IP rate limit, request/header timeouts, a CSP that only allows YouTube frames, `nosniff`, `frame-ancestors 'none'`, and path-traversal-safe static serving.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /api/events?date=2026-11-05&sport=all&tz=America/Toronto` | Games on that local day (`partial`, `unavailable`, `errors` report upstream health) |
| `GET /api/events?date=…&demo=1` | Clearly marked fictional fixtures |
| `GET /api/events/{encodedId}` | One event (used for live score refresh) |
| `GET /api/events/{encodedId}/sources[?refresh=1]` | Ranked sources, `providerResults` (how each provider was searched) |
| `GET /api/providers` | Provider configuration, issues, last error/success |
| `GET /api/channels` | Sports channels from authorized playlists |

## Tests

- `npm test` — 30 tests: matching/ranking, SSRF guard (private ranges, IPv6/mapped forms, redirect hops, size caps, timeouts, gzip), time-zone day filtering, upstream partial/total failure reporting, all HTTP endpoints (Host/Origin guards, validation, static traversal, secret never in responses, provider error mapping), and web route/time/poll helpers. Upstreams are replaced with labelled test fixtures.
- `npm run e2e` — Playwright in installed Google Chrome against the production build. Two synthetic HLS clips are generated with `ffmpeg` and served in place of the sample URLs (test fixture). Covers filters/URL state/deep links/back, **real playback proof** (currentTime advances, decoded frames, `requestVideoFrameCallback` presented frames, non-blank canvas pixels), source switching with no further requests to the old source, teardown on leaving, error → next-source recovery, keyboard and fullscreen, schedule outage / unconfigured providers / offline, 30 s live polling that pauses while hidden, and desktop/tablet/mobile layouts without horizontal overflow.
- `npm run e2e:live` — real ESPN schedule, a real game's truthful "no providers configured" state, a real not-found path, and the real Mux/Apple samples playing and switching, with video recorded. Artifacts go to `$AKSTREAMS_ARTIFACTS` (default `$TMPDIR/akstreams-e2e`).
- E2E launches Chrome with `--disable-audio-output`: in sessions without a usable audio device (CI, sandboxed shells) Chrome's media clock never advances for any video that has an audio track. Video decode/render is verified; audible output is not. Set `E2E_REAL_AUDIO=1` to run with real audio output.

CI (`.github/workflows/ci.yml`) runs unit tests, typecheck, build and the fixture E2E on every push/PR; the live-upstream E2E runs as a non-blocking job.

## Limitations

- **A found source is not proof a game will play**: geo-blocking, sign-in, expired URLs and missing CORS headers can stop playback; the player explains which and offers retry, next source or open externally.
- The public HLS samples are short VOD clips, not live sports; they only prove the player pipeline works on your machine. Apple's sample is fMP4; Mux's is MPEG-TS.
- ESPN's scoreboard is undocumented and may change or rate-limit. Swap `server/providers/schedule.mjs` for a licensed sports-data API before any public deployment.
- Browser HLS needs the stream origin to send CORS headers (Safari's native HLS is more lenient). AKStreams does not proxy streams.
- YouTube embeds may be blocked by the channel or region; the player always offers "open on YouTube".
- Not built for public hosting: no accounts, secrets vault, licensed rights mapping, or monitoring.

## File layout

```text
server/
  index.mjs              entrypoint: .env, loopback bind, graceful shutdown
  app.mjs                HTTP routing, Host/Origin guards, CSP, static build serving
  lib/net.mjs            SSRF-safe bounded upstream client
  lib/cache.mjs          bounded TTL/LRU cache with request coalescing
  lib/match.mjs          event/source matching, ranking, stream URL checks
  providers/schedule.mjs ESPN schedules, time-zone day filtering, event lookup
  providers/youtube.mjs  official YouTube live discovery
  providers/playlist.mjs authorized M3U/HLS discovery
  providers/index.mjs    provider orchestration, demo test streams
  tests/                 node:test suites
web/src/
  App.tsx                shell, URL routing, polling
  components/            GamesView, WatchView, VideoPlayer, SetupViews, ui
  lib/                   time/route/poll helpers (+ tests)
e2e/                     Playwright fixture + live suites
scripts/                 dev runner, config checker
docs/PROVIDERS.md        how to add a provider
```
