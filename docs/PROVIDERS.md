# Build a new AKStreams source provider

AKStreams mirrors the *architecture* of Torrentio: a fixture is a metadata object, and independent providers try to resolve the event to playable URLs. Its baseline is for sources you have rights to access/distribute or legitimate provider watch pages.

## The event object

```js
{
  id: "soccer|2026-11-02|12345",
  sport: "soccer", league: "Premier League",
  home: "Arsenal", away: "Chelsea",
  status: "live", kickoff: "2026-11-02T20:00:00Z",
  broadcasters: ["Example Sports Network"],
  isDemo: false
}
```

## Provider contract

Implement `async find(event)` that returns normalized `Source[]`, and `info()` to tell the UI whether the provider has been configured. See `server/providers/youtube.mjs` and `server/providers/playlist.mjs`.

```js
export async function findMyProvider(event) {
  // 1. Ask your legal source catalog for live/scheduled broadcasts.
  // 2. Compare title/team IDs and game start time; DON'T assume any hit is a match.
  // 3. Return only sources your users can legitimately access.
  return [{
    id: "myprovider:broadcast-123",
    provider: "My Official Provider",
    title: `${event.home} vs ${event.away}`,
    kind: "external", // 'hls' | 'youtube' | 'external'
    url: "https://your-provider.example/watch/broadcast-123",
    confidence: 95,
    reason: "Provider event IDs and start time match",
    status: "playable" // or 'candidate' for unconfirmed channels
  }];
}
export function myProviderInfo() {
  return { id:'mine', name:'My Official Provider', enabled:true,description:'Provider description' };
}
```

Register it in `server/providers/index.mjs`:

```js
import {findMyProvider,myProviderInfo} from './myprovider.mjs';
const plugins = [
  {id:'youtube',find:findYouTube,info:youtubeInfo},
  {id:'playlist',find:findPlaylist,info:playlistInfo},
  {id:'mine',find:findMyProvider,info:myProviderInfo},
];
```

## Matching philosophy

A filename or live video containing **both** teams is likely to represent the intended match, but not conclusive. A channel named after a listed broadcaster is only a candidate for that game because channels show multiple events. Prefer official provider event IDs, league identifiers, explicit match schedules, and dates over title-only matching. Do not label a stream as working until you've actually validated it.

## Media types

- `youtube`: provide a verified `videoId`; use YouTube's hosted iframe player. A YouTube broadcast may disallow embedding or be country-restricted.
- `hls`: URL to an authorized `.m3u8` manifest. HLS.js handles it in supported browsers. The origin must support CORS.
- `external`: link to an official broadcaster's watch page or supported protocol. Opens in a separate page; do not assume it can embed.

## Recommended follow-on improvements

1. Broadcaster-aware rights mappings keyed by league and territory; only suggest sources available to the viewer.
2. A durable database for scheduled events, provider identities, source health, bookmarks and watch history.
3. EPG/XMLTV parser for playlist channels, enabling exact matchup/channel matching instead of possible-broadcaster guesses.
4. Better matching using team IDs and alias dictionaries ("Man Utd" ↔ "Manchester United").
5. Source validator for manifests that verifies video without bypassing DRM, login or access controls; CORS-aware testing.
6. Separate official provider login flows using their authorized APIs/SDKs.
7. Request coalescing and quota budgeting for upstream video APIs, plus observability and proper secrets management.

### Useful references

- YouTube live search API: https://developers.google.com/youtube/data/reference/rest/v3/search/list
- ESPN scoreboard (undocumented): https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
- HLS.js: https://github.com/video-dev/hls.js
- Official Stremio add-on SDK (optional future Stremio integration): https://github.com/Stremio/stremio-addon-sdk
