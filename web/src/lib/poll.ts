/** Exponential backoff with a cap: base, 2x, 4x … up to max. */
export function backoffDelay(failures: number, baseMs: number, maxMs = 5 * 60_000): number {
  if (failures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** Math.min(failures, 10));
}
/** Live games refresh quickly; today's board slowly; other days not at all. */
export function scheduleInterval(opts: { anyLive: boolean; isToday: boolean; startsSoon: boolean }): number | null {
  if (opts.anyLive || opts.startsSoon) return 30_000;
  if (opts.isToday) return 120_000;
  return null;
}
