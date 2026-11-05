// Conservative event/source matching: require BOTH teams to appear in a stream title.
// A broadcast channel alone is a candidate, not a confirmed event-specific stream.
const STOP_WORDS = new Set(['fc','cf','afc','sc','the','club','basketball','football','soccer','live','official','sports','stream','vs','v','and','de','at','cf','united']);
export function normalize(input = '') {
  return String(input).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function teamTokens(team = '') {
  return normalize(team).split(' ').filter(t => t.length > 1 && !STOP_WORDS.has(t));
}
const GENERIC_SUFFIXES = new Set(['city','united','fc','cf','sc','club']);
const ALIASES = {
  'manchester city':['man city','manchester city'],
  'manchester united':['man utd','man united','manchester united'],
  'tottenham hotspur':['spurs','tottenham'],
  'wolverhampton wanderers':['wolves','wolverhampton'],
  'internazionale':['inter milan','inter'],
  'paris saint germain':['psg','paris saint germain'],
};
export function teamMentioned(team, title) {
  const normalized = normalize(team);
  const text = ` ${normalize(title)} `;
  if (!normalized) return false;
  if (text.includes(` ${normalized} `)) return true;
  if ((ALIASES[normalized] || []).some(alias => text.includes(` ${alias} `))) return true;
  const tokens = teamTokens(team);
  if (tokens.length <= 1) return tokens.length === 1 && text.includes(` ${tokens[0]} `);
  // Prefer the distinctive nickname/mascot over a city name alone.
  const final = tokens.at(-1);
  if (final.length >= 4 && !GENERIC_SUFFIXES.has(final)) return text.includes(` ${final} `);
  return false;
}
export function matchEventTitle(event, streamTitle) {
  // Avoid mistaking analysis, videogames, radio commentary and highlights for full broadcasts.
  if (/\b(highlights?|recap|reaction|watch\s?along|preview|simulation|efootball|fc\s?2[4-9]|nba\s?2k|live\s?scores?|radio commentary)\b/i.test(streamTitle)) {
    return { score: 0, reason: 'Non-broadcast content', status: 'rejected' };
  }
  const a = teamMentioned(event.home, streamTitle);
  const b = teamMentioned(event.away, streamTitle);
  if (a && b) return { score: 98, reason: 'Both team names appear in the broadcast title', status: 'playable' };
  if (a || b) return { score: 23, reason: 'Only one team matches; not shown as a game stream', status: 'rejected' };
  return { score: 0, reason: 'No matching teams', status: 'rejected' };
}
export function channelMatchesBroadcaster(channel, broadcasters = []) {
  const c = normalize(channel);
  if (!c || c.length < 3) return false;
  return broadcasters.some(name => {
    const b = normalize(name);
    return b.length >= 3 && (b === c || (b.length >= 5 && (c.includes(b) || b.includes(c))));
  });
}
export function dedupeSources(sources) {
  const seen = new Set();
  return sources.filter(s => {
    const key = `${s.kind}|${s.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.confidence - a.confidence);
}
export function isPublicHttpUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (['localhost','localhost.localdomain','0.0.0.0','::1'].includes(host)) return false;
    if (/^(127|10|192\.168|169\.254)\./.test(host)) return false;
    const match172 = host.match(/^172\.(\d+)\./);
    if (match172 && +match172[1] >= 16 && +match172[1] <= 31) return false;
    return true;
  } catch { return false; }
}
