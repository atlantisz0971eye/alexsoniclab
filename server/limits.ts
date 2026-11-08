import type { ScanSnapshot } from "../app/lib/scanPage.ts";

/**
 * A per-IP rate limit and a snapshot cache, both in the memory of one server instance. On Vercel that memory lasts
 * as long as a warm instance and is not shared between instances, so these are a first line only: the real cache
 * is Vercel's CDN (the API answers with s-maxage), and a shared store (Upstash Redis / Vercel KV) would make the
 * limit exact. See the README.
 */

export const LIMITS = {
  /** Scans (cache misses) one address may start per window. */
  perIp: 8,
  windowMs: 10 * 60_000,
  /** Scans one instance starts per hour, whoever asks: a ceiling on cost. */
  perInstanceHour: 120,
  cacheMs: 60 * 60_000,
  cacheEntries: 60,
};

const hits = new Map<string, number[]>();
const instanceHits: number[] = [];

/** Count a scan for this address; false when it is over the limit. */
export function allowScan(ip: string, now = Date.now()): { ok: boolean; retryAfter: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < LIMITS.windowMs);
  while (instanceHits.length && now - instanceHits[0] > 3_600_000) instanceHits.shift();
  if (recent.length >= LIMITS.perIp) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.ceil((LIMITS.windowMs - (now - recent[0])) / 1000) };
  }
  if (instanceHits.length >= LIMITS.perInstanceHour) return { ok: false, retryAfter: Math.ceil((3_600_000 - (now - instanceHits[0])) / 1000) };
  recent.push(now);
  hits.set(ip, recent);
  instanceHits.push(now);
  // Forget addresses that have gone quiet, so the map cannot grow without end.
  if (hits.size > 5000) for (const [key, times] of hits) if (now - times[times.length - 1] > LIMITS.windowMs) hits.delete(key);
  return { ok: true, retryAfter: 0 };
}

const cache = new Map<string, { snapshot: ScanSnapshot; expires: number }>();

export function cached(key: string, now = Date.now()) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < now) {
    cache.delete(key);
    return null;
  }
  // Most recently used last.
  cache.delete(key);
  cache.set(key, entry);
  return entry.snapshot;
}

export function remember(key: string, snapshot: ScanSnapshot, now = Date.now()) {
  cache.set(key, { snapshot, expires: now + LIMITS.cacheMs });
  while (cache.size > LIMITS.cacheEntries) cache.delete(cache.keys().next().value as string);
}

/** Only for tests. */
export function resetLimits() {
  hits.clear();
  instanceHits.length = 0;
  cache.clear();
}
