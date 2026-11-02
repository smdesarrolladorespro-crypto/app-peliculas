const cache = new Map();

export async function cached(key, ttlMs, factory) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit?.expiresAt > now) return hit.value;
  if (hit) cache.delete(key);
  const value = await factory();
  cache.set(key, { value, expiresAt: now + ttlMs });
  if (cache.size > 1000) {
    for (const [entryKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(entryKey);
  }
  return value;
}