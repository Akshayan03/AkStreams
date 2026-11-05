import { normalize } from './match.mjs';

// Curated official destinations for broadcaster names as ESPN lists them. Each URL was checked
// to load on 2026-11-05 (from Canada; Peacock redirected to its "unavailable in your region"
// page there). A link is where a rights holder offers coverage — sign-in, a TV provider or a
// subscription is usually required. It is NEVER presented as a free or playable stream.
// `exact` names must match fully; `prefix` names also match numbered/regional variants
// ("DAZN CLE", "TSN 1").
const DIRECTORY = [
  { exact: ['nba tv'], label: 'NBA TV', url: 'https://www.nba.com/watch/nba-tv', access: 'tv-provider', home: 'US' },
  { exact: ['prime video', 'amazon prime video'], label: 'Prime Video', url: 'https://www.primevideo.com/', access: 'subscription' },
  { exact: ['peacock'], label: 'Peacock', url: 'https://www.peacocktv.com/', access: 'subscription', home: 'US' },
  { exact: ['nbc', 'nbcsn', 'nbc sports'], label: 'NBC Sports', url: 'https://www.nbcsports.com/watch', access: 'tv-provider', home: 'US' },
  { exact: ['usa net', 'usa network'], label: 'USA Network', url: 'https://www.usanetwork.com/live', access: 'tv-provider', home: 'US' },
  { exact: ['tele', 'telemundo'], label: 'Telemundo Deportes', url: 'https://www.telemundo.com/deportes', access: 'tv-provider', home: 'US' },
  { exact: ['espn', 'espn2', 'espnu', 'espnews', 'abc', 'espn deportes', 'espn+', 'espn plus'], label: 'ESPN', url: 'https://www.espn.com/watch/', access: 'subscription', home: 'US' },
  { exact: ['bein sports', 'bein sports usa', 'bein sports en espanol'], label: 'beIN SPORTS', url: 'https://www.beinsports.com/en-us/', access: 'subscription', home: 'US' },
  { exact: ['paramount+', 'paramount plus', 'cbs', 'cbs sports network', 'cbssn'], label: 'Paramount+', url: 'https://www.paramountplus.com/', access: 'subscription' },
  { exact: ['hulu'], label: 'Hulu', url: 'https://www.hulu.com/', access: 'subscription', home: 'US' },
  { prefix: ['dazn'], label: 'DAZN', url: 'https://www.dazn.com/', access: 'subscription' },
  { exact: ['fubo', 'fubotv', 'fubo sports'], label: 'Fubo', url: 'https://www.fubo.tv/', access: 'subscription' },
  { prefix: ['tsn'], label: 'TSN', url: 'https://www.tsn.ca/live', access: 'subscription', home: 'CA' },
  { prefix: ['sportsnet'], label: 'Sportsnet', url: 'https://www.sportsnet.ca/', access: 'subscription', home: 'CA' },
  { prefix: ['sky sports'], label: 'Sky Sports', url: 'https://www.skysports.com/watch', access: 'subscription', home: 'UK' },
];

// League-level official routes (independent of the per-game listing).
const LEAGUE_ROUTES = {
  NBA: { label: 'NBA League Pass', url: 'https://www.nba.com/watch/league-pass-stream', access: 'subscription',
    note: 'Out-of-market games. Local and national TV games are blacked out in the US and Canada.' },
};

const norm = s => normalize(s).replace(/\s+/g, ' ');
export function lookupBroadcaster(name) {
  const n = norm(name);
  if (!n) return null;
  return DIRECTORY.find(d => (d.exact || []).some(x => norm(x) === n)
    || (d.prefix || []).some(x => n === norm(x) || n.startsWith(`${norm(x)} `))) || null;
}

const ACCESS_NOTE = {
  'subscription': 'Subscription required',
  'tv-provider': 'TV provider sign-in required',
};
const titleCase = s => String(s || '').replace(/\w\S*/g, w => /^[A-Z]{2,3}$/.test(w) ? w : w[0].toUpperCase() + w.slice(1).toLowerCase());

/**
 * Official "where to watch" routes for an event, from the broadcaster metadata in its schedule
 * listing. Unknown names are kept (with no link) so nothing is silently dropped.
 */
export function whereToWatch(event) {
  const details = event.broadcastDetails?.length ? event.broadcastDetails
    : (event.broadcasters || []).map(name => ({ name, type: '', market: '', region: '' }));
  const seen = new Set();
  const routes = [];
  for (const d of details) {
    const key = norm(d.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const hit = lookupBroadcaster(d.name);
    const local = /home|away/i.test(d.market || '');
    const region = (d.region || '').toUpperCase();
    routes.push({
      name: d.name,
      type: titleCase(d.type) || 'Broadcast',
      market: titleCase(d.market) || '',
      region,
      service: hit?.label || null,
      url: hit?.url || null,
      access: hit?.access || 'unknown',
      accessNote: hit ? ACCESS_NOTE[hit.access] : local ? 'Regional or team service, usually in-market only' : 'Access unknown',
      regionNote: hit?.home && region && hit.home !== region ? `Service based in ${hit.home}` : '',
      note: hit ? '' : 'No official link mapped for this name.',
    });
  }
  return {
    listingRegion: [...new Set(details.map(d => (d.region || '').toUpperCase()).filter(Boolean))].join(', ') || 'unspecified',
    routes,
    league: LEAGUE_ROUTES[event.league] || null,
    caveat: 'From the ESPN listing, which covers United States broadcasts. Rights differ by country. These official sites usually need sign-in or a subscription, and they are not free streams of this game.',
  };
}
