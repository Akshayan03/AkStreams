import { cached } from '../lib/cache.mjs';

const LEAGUES = [
  ['basketball','NBA','basketball','nba'],
  ['soccer','Premier League','soccer','eng.1'],
  ['soccer','La Liga','soccer','esp.1'],
  ['soccer','Serie A','soccer','ita.1'],
  ['soccer','Bundesliga','soccer','ger.1'],
  ['soccer','Ligue 1','soccer','fra.1'],
  ['soccer','Champions League','soccer','uefa.champions'],
];

function extractBroadcasters(event, competition) {
  const all = [ ...(event.broadcasts || []), ...(competition.broadcasts || []) ];
  const names = [];
  for (const item of all) {
    if (typeof item === 'string') names.push(item);
    if (item?.names) names.push(...item.names);
    if (item?.name) names.push(item.name);
    if (item?.media?.shortName) names.push(item.media.shortName);
  }
  return [...new Set(names.map(String).map(s => s.trim()).filter(Boolean))];
}
function mapEvent(raw, competition, sport, league, date) {
  const comps = competition.competitors || [];
  const home = comps.find(c => c.homeAway === 'home') || comps[0];
  const away = comps.find(c => c.homeAway === 'away') || comps[1];
  if (!home || !away) return null;
  const state = raw.status?.type?.state || competition.status?.type?.state || 'pre';
  return {
    id: `${sport}|${date}|${raw.id}`,
    providerId: String(raw.id), sport, league,
    home: home.team?.displayName || home.team?.name || 'Home',
    away: away.team?.displayName || away.team?.name || 'Away',
    homeShort: home.team?.shortDisplayName || home.team?.abbreviation || 'HOME',
    awayShort: away.team?.shortDisplayName || away.team?.abbreviation || 'AWAY',
    homeLogo: home.team?.logo || '', awayLogo: away.team?.logo || '',
    homeScore: home.score ?? null, awayScore: away.score ?? null,
    kickoff: raw.date || competition.date || `${date}T12:00:00Z`,
    status: state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled',
    clock: raw.status?.type?.shortDetail || raw.status?.type?.detail || '',
    broadcasters: extractBroadcasters(raw, competition),
    isDemo: false,
  };
}
export function parseESPN(payload, sport, league, date) {
  return (payload.events || []).flatMap(raw => {
    const comp = (raw.competitions || [])[0];
    const event = comp ? mapEvent(raw, comp, sport, league, date) : null;
    return event ? [event] : [];
  });
}
async function getOne(date, [sport, league, category, espnSlug]) {
  const compactDate = date.replaceAll('-', '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${category}/${espnSlug}/scoreboard?dates=${compactDate}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`ESPN ${league}: HTTP ${response.status}`);
    return parseESPN(await response.json(), sport, league, date);
  } finally { clearTimeout(id); }
}
export async function getEvents(date, sport = 'all') {
  const chosen = LEAGUES.filter(([s]) => sport === 'all' || sport === s);
  return cached(`events:${date}:${sport}`, 60_000, async () => {
    const results = await Promise.allSettled(chosen.map(info => getOne(date, info)));
    const events = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const errors = results.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason));
    events.sort((a,b) => new Date(a.kickoff) - new Date(b.kickoff));
    return { events, partial: errors.length > 0, errors, fetchedAt: new Date().toISOString() };
  });
}
export function getDemoEvents(date, sport = 'all') {
  const starts = ['18:00','19:30','20:00','21:00'];
  const list = [
    ['soccer','Premier League','Arsenal','Chelsea','ARS','CHE'],
    ['basketball','NBA','Toronto Raptors','Boston Celtics','TOR','BOS'],
    ['soccer','Champions League','Real Madrid','Manchester City','RMA','MCI'],
    ['basketball','NBA','Golden State Warriors','Los Angeles Lakers','GSW','LAL']
  ];
  return { events: list.map((x, i) => ({
    id: `${x[0]}|${date}|demo-${i}`, providerId: `demo-${i}`, sport:x[0],league:x[1],
    home:x[2],away:x[3],homeShort:x[4],awayShort:x[5],homeLogo:'',awayLogo:'',
    homeScore:null,awayScore:null,kickoff:`${date}T${starts[i]}:00-05:00`,
    status:'scheduled',clock:'Demo fixture',broadcasters:[],isDemo:true,
  })).filter(event => sport === 'all' || event.sport === sport), partial:false, errors:[],fetchedAt:new Date().toISOString() };
}
