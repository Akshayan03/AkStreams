import { isDateString } from './time.ts';
import type { Sport } from '../types.ts';

export type View = 'games' | 'channels' | 'providers' | 'official' | 'mine';
export type Route = { view: View; date: string | null; sport: Sport; league: string; event: string | null; demo: boolean };

const VIEWS: View[] = ['games', 'channels', 'providers', 'official', 'mine'];
const SPORTS: Sport[] = ['all', 'soccer', 'basketball'];

export function parseRoute(search: string): Route {
  const q = new URLSearchParams(search);
  const view = q.get('view') as View;
  const sport = q.get('sport') as Sport;
  const event = q.get('event');
  return {
    view: VIEWS.includes(view) ? view : 'games',
    date: isDateString(q.get('date')) ? q.get('date') : null,
    sport: SPORTS.includes(sport) ? sport : 'all',
    league: (q.get('league') || '').slice(0, 60),
    event: event && /^(soccer|basketball)\|\d{4}-\d{2}-\d{2}\|[-\w]{1,40}$/.test(event) ? event : null,
    demo: q.get('demo') === '1',
  };
}
/** Serializes only non-default values so URLs stay short and shareable. */
export function routeSearch(route: Route, todayDate: string): string {
  const q = new URLSearchParams();
  if (route.event) q.set('event', route.event);
  else if (route.view !== 'games') q.set('view', route.view);
  if (route.view === 'games' || route.event) {
    if (route.date && route.date !== todayDate) q.set('date', route.date);
    if (route.sport !== 'all') q.set('sport', route.sport);
    if (route.league) q.set('league', route.league);
  }
  if (route.demo) q.set('demo', '1');
  const s = q.toString();
  return s ? `?${s}` : '';
}
