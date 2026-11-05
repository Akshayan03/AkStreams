// Small in-memory TTL cache with request coalescing and a hard entry cap (LRU eviction).
const cache = new Map();
export const MAX_CACHE_ENTRIES = 400;

function sweep(now) {
  for (const [key, entry] of cache) if (now >= entry.expires) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}
/**
 * @template T
 * @param {string} key
 * @param {number | ((value:T)=>number)} duration ms, or a function of the loaded value
 * @param {()=>Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function cached(key, duration, loader) {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && now < existing.expires) {
    cache.delete(key); cache.set(key, existing); // refresh LRU position
    return existing.promise;
  }
  if (cache.size >= MAX_CACHE_ENTRIES) sweep(now);
  const promise = Promise.resolve().then(loader);
  const entry = { promise, expires: now + 30_000 };
  cache.set(key, entry);
  promise.then(value => { entry.expires = Date.now() + (typeof duration === 'function' ? duration(value) : duration); },
    () => { if (cache.get(key) === entry) cache.delete(key); });
  return promise;
}
export function forget(key) { cache.delete(key); }
export function forgetPrefix(prefix) { for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key); }
export function cacheSize() { return cache.size; }
export function clearCache() { cache.clear(); }
