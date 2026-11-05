const cache = new Map();
export async function cached(key, durationMs, loader) {
  const existing = cache.get(key);
  if (existing && Date.now() < existing.expires) return existing.promise;
  const promise = Promise.resolve().then(loader);
  cache.set(key, { promise, expires: Date.now() + durationMs });
  promise.catch(() => { if (cache.get(key)?.promise === promise) cache.delete(key); });
  return promise;
}
