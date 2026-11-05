// Date helpers. "date" strings are calendar days (YYYY-MM-DD) in the viewer's time zone.
export const viewerTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function dateIn(instant: number | string | Date, timeZone = viewerTimeZone()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export const today = (timeZone = viewerTimeZone()) => dateIn(Date.now(), timeZone);

export function isDateString(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** "Thu, Nov 5" for a calendar day (no time zone drift: formatted at UTC noon). */
export function formatDay(date: string, locale?: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function dayLabel(date: string, now = today()): string {
  if (date === now) return 'Today';
  if (date === shiftDate(now, 1)) return 'Tomorrow';
  if (date === shiftDate(now, -1)) return 'Yesterday';
  return formatDay(date);
}
/** Kickoff instant in the viewer's zone, e.g. "Thu, Nov 5 · 9:00 PM". */
export function formatKickoff(iso: string, locale?: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Time TBA';
  const day = d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone });
  return `${day} · ${formatTime(iso, locale, timeZone)}`;
}
export function formatTime(iso: string, locale?: string, timeZone?: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'TBA' : d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone });
}
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
