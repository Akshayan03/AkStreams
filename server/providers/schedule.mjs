import { cached } from '../lib/cache.mjs';
import { safeFetch } from '../lib/net.mjs';

export const LEAGUES = [
  ['basketball','NBA','basketball','nba'],
  ['soccer','Premier League','soccer','eng.1'],
  ['soccer','La Liga','soccer','esp.1'],
  ['soccer','Serie A','soccer','ita.1'],
  ['soccer','Bundesliga','soccer','ger.1'],
  ['soccer','Ligue 1','soccer','fra.1'],
  ['soccer','Champions League','soccer','uefa.champions'],
];

// Upstream fetcher is swappable so endpoint tests can run without the network.
let fetchScoreboard = async url => {
  const response = await safeFetch(url, { timeoutMs: 6500, maxBytes: 4_000_000, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};
export function setScoreboardFetcher(fn) { fetchScoreboard = fn; }

export const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false;
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2100;
}
/** Calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDateOf(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function todayIn(timeZone) { return localDateOf(Date.now(), timeZone); }
export function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}

function extractBroadcasters(event, competition) {
  const all = [ ...(event.broadcasts || []), ...(competition.broadcasts || []), ...(competition.geoBroadcasts || []) ];
  const names = [];
  for (const item of all) {
    if (typeof item === 'string') names.push(item);
    if (item?.names) names.push(...item.names);
    if (item?.name) names.push(item.name);
    if (item?.media?.shortName) names.push(item.media.shortName);
  }
  return [...new Set(names.map(String).map(s => s.trim()).filter(Boolean))].slice(0, 20);
}
// ESPN geoBroadcasts carry type (TV/Streaming/Radio), market (National/Home/Away) and region.
function extractBroadcastDetails(competition) {
  const seen = new Set();
  return (competition.geoBroadcasts || []).flatMap(g => {
    const name = String(g?.media?.shortName || '').trim().slice(0, 80);
    const type = String(g?.type?.shortName || '').slice(0, 20);
    const market = String(g?.market?.type || '').slice(0, 20);
    if (!name || /radio/i.test(type) || seen.has(`${name}|${market}`)) return [];
    seen.add(`${name}|${market}`);
    return [{ name, type, market, region: String(g?.region || '').slice(0, 8), lang: String(g?.lang || '').slice(0, 8) }];
  }).slice(0, 20);
}
export function mapStatus(type = {}) {
  const name = String(type.name || '').toUpperCase();
  if (/CANCEL|ABANDON|FORFEIT/.test(name)) return 'canceled';
  if (/POSTPONED|SUSPENDED/.test(name)) return 'postponed';
  if (type.state === 'in') return 'live';
  if (type.state === 'post') return 'final';
  return 'scheduled';
}
function mapEvent(raw, competition, sport, league, espnDate) {
  const comps = competition.competitors || [];
  const home = comps.find(c => c.homeAway === 'home') || comps[0];
  const away = comps.find(c => c.homeAway === 'away') || comps[1];
  if (!home || !away || !raw.id) return null;
  const type = raw.status?.type || competition.status?.type || {};
  const status = mapStatus(type);
  const hasScore = status === 'live' || status === 'final';
  const score = c => (hasScore && c.score !== undefined && c.score !== null && c.score !== '' ? String(c.score?.displayValue ?? c.score) : null);
  return {
    id: `${sport}|${espnDate}|${raw.id}`,
    providerId: String(raw.id), sport, league,
    home: home.team?.displayName || home.team?.name || 'Home',
    away: away.team?.displayName || away.team?.name || 'Away',
    homeShort: home.team?.shortDisplayName || home.team?.abbreviation || 'HOME',
    awayShort: away.team?.shortDisplayName || away.team?.abbreviation || 'AWAY',
    homeLogo: home.team?.logoDark || home.team?.logo || '', awayLogo: away.team?.logoDark || away.team?.logo || '',
    homeScore: score(home), awayScore: score(away),
    kickoff: raw.date || competition.date || `${espnDate}T12:00:00Z`,
    status,
    clock: type.shortDetail || type.detail || '',
    venue: competition.venue?.fullName || '',
    broadcasters: extractBroadcasters(raw, competition),
    broadcastDetails: extractBroadcastDetails(competition),
    isDemo: false,
  };
}
export function parseESPN(payload, sport, league, espnDate) {
  return (payload?.events || []).flatMap(raw => {
    const comp = (raw.competitions || [])[0];
    const event = comp ? mapEvent(raw, comp, sport, league, espnDate) : null;
    return event ? [event] : [];
  });
}

// Live boards refresh quickly; settled past days rarely change.
function ttlFor(espnDate, events) {
  if (events.some(e => e.status === 'live')) return 20_000;
  const today = todayIn('America/New_York');
  if (espnDate < shiftDate(today, -1)) return 10 * 60_000;
  if (espnDate > shiftDate(today, 1)) return 5 * 60_000;
  return 60_000;
}
/** One ESPN scoreboard (one league, one ESPN/US-Eastern day). */
async function getBoard(espnDate, [sport, league, category, espnSlug]) {
  return cached(`espn:${espnSlug}:${espnDate}`, events => ttlFor(espnDate, events), async () => {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${category}/${espnSlug}/scoreboard?dates=${espnDate.replaceAll('-', '')}`;
    try { return parseESPN(await fetchScoreboard(url), sport, league, espnDate); }
    catch (error) { throw new Error(`ESPN ${league}: ${error?.message || error}`); }
  });
}
async function collect(dates, sport) {
  const chosen = LEAGUES.filter(([s]) => sport === 'all' || sport === s);
  const jobs = dates.flatMap(d => chosen.map(info => getBoard(d, info)));
  const results = await Promise.allSettled(jobs);
  const events = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const errors = [...new Set(results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason)))];
  return { events, errors, failed: results.filter(r => r.status === 'rejected').length, total: jobs.length };
}

/**
 * Games whose kickoff falls on `date` in the viewer's time zone. ESPN groups games by US
 * Eastern day, so the adjacent ESPN days are fetched and filtered by local calendar day.
 */
export async function getEvents(date, sport = 'all', timeZone = SERVER_TIME_ZONE) {
  const { events, errors, failed, total } = await collect([shiftDate(date, -1), date, shiftDate(date, 1)], sport);
  const seen = new Set();
  const list = events.filter(e => {
    const key = `${e.league}|${e.providerId}`;
    if (seen.has(key) || localDateOf(e.kickoff, timeZone) !== date) return false;
    seen.add(key); return true;
  }).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || a.league.localeCompare(b.league));
  return { events: list, partial: failed > 0, unavailable: failed === total, errors, date, timeZone, fetchedAt: new Date().toISOString() };
}
/** Exact lookup by event id (`sport|espnDate|espnId`), used by the watch page and source discovery. */
export async function getEventById(id) {
  const [sport, espnDate, providerId] = String(id).split('|');
  if (providerId?.startsWith('demo-')) return { event: getDemoEvents(espnDate, sport, SERVER_TIME_ZONE).events.find(e => e.id === id) || null, errors: [] };
  const { events, errors } = await collect([espnDate], sport);
  return { event: events.find(e => e.id === id) || null, errors };
}

export function getDemoEvents(date, sport = 'all', timeZone = SERVER_TIME_ZONE) {
  const starts = [-90, 30, 120, 240]; // minutes relative to now on "today", else fixed evening slots
  const today = todayIn(timeZone);
  const list = [
    ['soccer','Premier League','Arsenal','Chelsea','ARS','CHE'],
    ['basketball','NBA','Toronto Raptors','Boston Celtics','TOR','BOS'],
    ['soccer','Champions League','Real Madrid','Manchester City','RMA','MCI'],
    ['basketball','NBA','Golden State Warriors','Los Angeles Lakers','GSW','LAL']
  ];
  return { events: list.map((x, i) => {
    const kickoff = date === today
      ? new Date(Math.floor((Date.now() + starts[i] * 60_000) / 300_000) * 300_000).toISOString()
      : new Date(`${date}T${String(17 + i).padStart(2, '0')}:00:00Z`).toISOString();
    const status = date < today ? 'final' : date === today && i === 0 ? 'live' : 'scheduled';
    return {
      id: `${x[0]}|${date}|demo-${i}`, providerId: `demo-${i}`, sport:x[0],league:x[1],
      home:x[2],away:x[3],homeShort:x[4],awayShort:x[5],homeLogo:'',awayLogo:'',
      homeScore:status === 'scheduled' ? null : '1',awayScore:status === 'scheduled' ? null : '0',kickoff,
      status,clock:'Demo fixture',venue:'',broadcasters:[],broadcastDetails:[],isDemo:true,
    };
  }).filter(event => sport === 'all' || event.sport === sport), partial:false, unavailable:false, errors:[], date, timeZone, fetchedAt:new Date().toISOString() };
}
