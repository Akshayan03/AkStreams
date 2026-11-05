import test from 'node:test';
import assert from 'node:assert/strict';
import { getEvents, getEventById, isValidDate, isValidTimeZone, localDateOf, mapStatus, setScoreboardFetcher, shiftDate } from '../providers/schedule.mjs';
import { clearCache } from '../lib/cache.mjs';

// TEST FIXTURE: synthetic ESPN-shaped scoreboards, not real games.
const game = (id, date, state = 'pre', name = 'STATUS_SCHEDULED', teams = ['Boston Celtics', 'Toronto Raptors']) => ({
  id, date, status: { type: { state, name, shortDetail: state === 'in' ? 'Q3 4:12' : '' } },
  competitions: [{ competitors: [
    { homeAway: 'home', team: { displayName: teams[0] }, score: '70' },
    { homeAway: 'away', team: { displayName: teams[1] }, score: '65' }] }],
});
function fixture(map) {
  const calls = [];
  setScoreboardFetcher(async url => {
    calls.push(url);
    const slug = url.match(/sports\/\w+\/([\w.]+)\/scoreboard/)[1];
    const date = url.match(/dates=(\d+)/)[1];
    if (map.fail?.includes(slug)) throw new Error('HTTP 503');
    return { events: (map[`${slug}:${date}`] || []) };
  });
  return calls;
}

test('validates dates and time zones strictly', () => {
  assert.equal(isValidDate('2026-11-05'), true);
  for (const bad of ['2026-02-31', '2026-13-01', '1999-12-31', '2026-1-1', '', null]) assert.equal(isValidDate(bad), false, String(bad));
  assert.equal(isValidTimeZone('America/Toronto'), true);
  assert.equal(isValidTimeZone('Mars/Base'), false);
  assert.equal(isValidTimeZone('../../etc'), false);
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(localDateOf('2026-11-06T02:00:00Z', 'America/Toronto'), '2026-11-05');
  assert.equal(localDateOf('2026-11-06T02:00:00Z', 'Asia/Tokyo'), '2026-11-06');
});

test('maps postponed/canceled separately from final and hides pre-game scores', () => {
  assert.equal(mapStatus({ state: 'post', name: 'STATUS_POSTPONED' }), 'postponed');
  assert.equal(mapStatus({ state: 'post', name: 'STATUS_CANCELED' }), 'canceled');
  assert.equal(mapStatus({ state: 'post', name: 'STATUS_FINAL' }), 'final');
  assert.equal(mapStatus({ state: 'in', name: 'STATUS_HALFTIME' }), 'live');
});

test('filters adjacent ESPN days into the viewer\'s local calendar day', async () => {
  clearCache();
  // A 9pm Eastern tip-off on ESPN day 2026-11-05 is 2026-11-06 in Tokyo.
  fixture({ 'nba:20261105': [game('1', '2026-11-06T02:00Z')], 'nba:20261106': [game('2', '2026-11-07T00:00Z')] });
  const toronto = await getEvents('2026-11-05', 'basketball', 'America/Toronto');
  assert.deepEqual(toronto.events.map(e => e.providerId), ['1']);
  const tokyo = await getEvents('2026-11-06', 'basketball', 'Asia/Tokyo');
  assert.deepEqual(tokyo.events.map(e => e.providerId), ['1']);
  assert.equal(tokyo.events[0].id, 'basketball|2026-11-05|1', 'id keeps the ESPN day so lookups are exact');
  assert.equal(tokyo.events[0].homeScore, null, 'scheduled games carry no score');
});

test('reports partial and total upstream failure truthfully', async () => {
  clearCache();
  fixture({ fail: ['eng.1'] });
  const partial = await getEvents('2026-11-05', 'soccer', 'UTC');
  assert.equal(partial.partial, true); assert.equal(partial.unavailable, false);
  assert.match(partial.errors[0], /ESPN Premier League: HTTP 503/);
  clearCache();
  fixture({ fail: ['nba'] });
  const down = await getEvents('2026-11-05', 'basketball', 'UTC');
  assert.equal(down.unavailable, true); assert.equal(down.events.length, 0);
});

test('looks up a single event by id with live status and score', async () => {
  clearCache();
  fixture({ 'nba:20261105': [game('9', '2026-11-06T00:30Z', 'in', 'STATUS_IN_PROGRESS')] });
  const { event } = await getEventById('basketball|2026-11-05|9');
  assert.equal(event.status, 'live'); assert.equal(event.homeScore, '70'); assert.equal(event.clock, 'Q3 4:12');
  assert.equal((await getEventById('basketball|2026-11-05|404')).event, null);
});
