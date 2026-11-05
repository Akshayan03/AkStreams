import test from 'node:test';
import assert from 'node:assert/strict';
import { dateIn, dayLabel, formatDay, isDateString, shiftDate, timeAgo } from './time.ts';
import { parseRoute, routeSearch } from './route.ts';
import { backoffDelay, scheduleInterval } from './poll.ts';

test('calendar-day helpers are time-zone safe', () => {
  assert.equal(dateIn('2026-11-06T02:00:00Z', 'America/Toronto'), '2026-11-05');
  assert.equal(dateIn('2026-11-06T02:00:00Z', 'Asia/Tokyo'), '2026-11-06');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-08', -1), '2026-03-07'); // DST weekend
  assert.equal(formatDay('2026-11-05', 'en-US'), 'Thu, Nov 5');
  assert.equal(dayLabel('2026-11-06', '2026-11-05'), 'Tomorrow');
  assert.equal(isDateString('2026-02-30'), false);
  assert.equal(timeAgo(new Date(Date.now() - 125_000).toISOString()), '2m ago');
});
test('routes round-trip and reject junk', () => {
  const r = parseRoute('?event=soccer%7C2026-11-05%7C123&sport=soccer&league=Premier%20League&date=2026-11-05');
  assert.equal(r.event, 'soccer|2026-11-05|123');
  assert.equal(r.league, 'Premier League');
  assert.equal(routeSearch(r, '2026-11-05'), '?event=soccer%7C2026-11-05%7C123&sport=soccer&league=Premier+League');
  const junk = parseRoute('?view=admin&sport=hockey&date=2026-99-99&event=<script>');
  assert.deepEqual(junk, { view: 'games', date: null, sport: 'all', league: '', event: null, demo: false });
  assert.equal(routeSearch({ ...junk, view: 'providers' }, '2026-11-05'), '?view=providers');
});
test('polling cadence and backoff', () => {
  assert.equal(scheduleInterval({ anyLive: true, isToday: true, startsSoon: false }), 30_000);
  assert.equal(scheduleInterval({ anyLive: false, isToday: true, startsSoon: false }), 120_000);
  assert.equal(scheduleInterval({ anyLive: false, isToday: false, startsSoon: false }), null);
  assert.deepEqual([0, 1, 2, 3, 10].map(n => backoffDelay(n, 30_000)), [30_000, 60_000, 120_000, 240_000, 300_000]);
});
