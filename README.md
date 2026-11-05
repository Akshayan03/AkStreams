# AKStreams · Stream discovery for soccer and basketball

A runnable React/TypeScript sports frontend and a Node.js stream **discovery engine**. Designed as a clean sibling to AKFlix. This starter deliberately focuses on **finding sources**, not just mocking a streaming UI.

## What works

- Live schedule and score metadata from ESPN scoreboards: NBA, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, UEFA Champions League.
- `GET /api/events/:id/sources` searches independently configured source providers automatically and ranks results.
- **Official YouTube Live provider:** queries YouTube Data API for **currently live** broadcasts on a list of approved/official channels and matches broadcast titles to BOTH fixture teams.
- **M3U/HLS provider:** fetches configured playlists, parses `#EXTINF`, matches game titles, and flags channels matching announced broadcasters as **unconfirmed candidates**.
- Select a discovered YouTube / HLS source and watch inside AKStreams (where the provider permits embedding); otherwise open the external player.
- Live channels directory from configured playlists; source provider status/configuration page.
- Sample fixtures mode and opt-in test HLS stream for player development (clearly labeled demo, not sports).
- Source matching tests, basic rate limits, caching, API error handling, and a documented adapter interface.

## Run locally

Requires Node.js 22+ and npm. Use **two commands** from the root directory:

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. API: **http://localhost:8787/health**.

The app queries ESPN for actual schedules by default. When offline, turn on **Demo data** to preview sample match cards.

### Enable automatic source discovery

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
YOUTUBE_API_KEY=YOUR_YOUTUBE_DATA_API_V3_KEY
OFFICIAL_YOUTUBE_CHANNEL_IDS=UCtInrnU3QbWqFGsdKT1GZtg
# optional: only playlists you have permission to access
AUTHORIZED_M3U_URLS=https://your-provider.example/authorized-sports.m3u
```

The example channel ID is the FIBA official YouTube channel; it broadcasts **some** games, often outside the NBA. You can add authorized sources / channels matching your chosen competitions; a configured channel does not imply a live match or territorial availability. The YouTube API key is never exposed to the web frontend.

**Important:** The YouTube search API has per-query quota costs. We cache each channel's live listings for 3 minutes, and search once per channel (not once per game). Google documents the API quotas: https://developers.google.com/youtube/data/reference/rest/v3/search/list

For local playlists set `AUTHORIZED_M3U_FILE=./config/streams.m3u`. Sample syntax lives in `config.sample.m3u`. Only add streams you're authorized to access; do not commit private stream credentials.

To test HLS playback in demo mode set `DEMO_STREAM=true` in `.env`. This adds a publicly available Mux test stream **only on demo fixtures**. It is not an NBA or soccer match.

## Source discovery pipeline

```
ESPN fixture catalog (NBA + soccer leagues)
    |
    v
AKStreams API /api/events/:eventId/sources
    |
    +--> OfficialYouTubeProvider (Data API -> live videos -> 2-team match)
    |
    +--> AuthorizedM3UProvider (playlist -> event-name or broadcaster match)
    |
    +--> Your future provider modules (server/providers/*.mjs)
    |
    v
Normalized source results + match confidence + provenance
    |
    v
AKStreams React player (YouTube embeds / HLS.js / provider site)
```

**No Real-Debrid is involved**: live streams are already served by a broadcast origin/CDN; providers discover the URLs and the web player connects to them. See [docs/PROVIDERS.md](docs/PROVIDERS.md) to implement additional resolvers.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /api/events?date=2026-11-02&sport=all` | Real games, leagues, status and broadcaster information |
| `GET /api/events?date=2026-11-02&demo=1` | Clearly marked sample fixtures |
| `GET /api/events/{encodedId}/sources` | Source discovery, confidence and errors |
| `GET /api/events/{encodedId}/sources?refresh=1` | Re-scan resolvers (YouTube/playlist per-provider caches still apply) |
| `GET /api/providers` | Provider configuration/status |
| `GET /api/channels` | Authorized playlist sports channels |

## Design choices and limitations

- **Finding a source is not proof that a game can play:** geo-blocking, provider sign-in, live-vs-highlight mismatches, HLS CORS, and expired URLs can prevent playback. We classify uncertain broadcaster-channel matches as `candidate` and show the reason.
- **Source coverage is not automatic for every league**. Most top-flight NBA and European soccer broadcasts are licensed. The free/official YouTube source resolver will find eligible broadcasts, not magically unlock paid games.
- ESPN scoreboard endpoints are undocumented and may change or limit use. Swap out `server/providers/schedule.mjs` for an appropriately licensed commercial sports-data API if deploying publicly.
- Browser HLS.js requires correct CORS response headers from the stream origin; Safari can often play HLS natively. AKStreams does not proxy or circumvent DRM/login/geo restrictions.
- Add authentication, secrets vault, licensed provider contracts, monitoring, robust SSRF validation, internationalization and rights compliance before a public deployment.
- This code is independent of the older AKFlix repository; it can be integrated later in a yarn/monorepo workspace.

## File layout

```text
akstreams/
  server/
    index.mjs                 # HTTP endpoints
    providers/
      schedule.mjs            # ESPN scoreboard event metadata
      youtube.mjs             # Official live YouTube discovery
      playlist.mjs            # M3U/HLS stream discovery
      index.mjs               # Provider orchestration and ranking
    lib/
      match.mjs               # Event/source matching + safety validation
      cache.mjs
    tests/
  web/
    src/App.tsx               # AKFlix-inspired React interface
    src/components/VideoPlayer.tsx
    src/styles.css
  docs/PROVIDERS.md
  .env.example
```

Run `npm test` (backend tests require **no** npm packages). Never add `YOUTUBE_API_KEY` to frontend environment variables.
