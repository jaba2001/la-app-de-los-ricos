// Shared response cache on Upstash Redis.
//
// WHY THIS EXISTS (and why the Cache-Control headers weren't enough):
// every data route here starts with requireUser(), so every request carries an
// `Authorization` header. CDNs do not cache responses to authenticated requests — and
// must not: a shared cache keyed on a per-user credential is how you serve one user's
// response to another. So the generous `s-maxage` values on these routes only ever
// acted as a PRIVATE max-age in each visitor's own browser. Two different users asking
// for AAPL each paid a full round trip to FMP/Finnhub/EDGAR.
//
// This cache is keyed on the UPSTREAM REQUEST ONLY — never on user id. That's the whole
// point: FMP's answer for AAPL is identical for everyone, so the second user should get
// it for free. Nothing user-specific may ever be stored here (see cacheKey below).
//
// Failure contract mirrors lib/ratelimit.js: FAIL-OPEN, always. A cache miss, a Redis
// outage or missing env must degrade to "call the upstream", never to an error. The
// cache is a cost optimisation, not a dependency.
import { Redis } from '@upstash/redis';
import * as Sentry from '@sentry/nextjs';

let _redis = null;
function redis() {
  if (_redis) return _redis;
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

// Bump this to invalidate every cached entry at once (e.g. after changing what we store).
const PREFIX = 'c:v1:';

// Set CACHE_DISABLED=1 to bypass entirely without a deploy — useful when debugging a
// suspected stale-data problem.
function enabled() {
  return (
    process.env.CACHE_DISABLED !== '1' &&
    !!process.env.UPSTASH_REDIS_REST_URL &&
    !!process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

let _warned = false;
function warn(op, e) {
  const msg = `cache ${op}: ${e?.message || e} — bypassing`;
  console.warn(msg);
  // Report once per isolate: a Redis outage would otherwise emit one Sentry event per
  // request, and the signal ("the cache is down") only needs saying once.
  if (!_warned) {
    _warned = true;
    try { Sentry.captureMessage(msg, { level: 'warning', tags: { subsystem: 'cache' } }); } catch { /* ignore */ }
  }
}

/**
 * Build a cache key from the upstream identity of a request.
 * Query params are SORTED so `?symbol=A&limit=1` and `?limit=1&symbol=A` share an entry.
 * `skip` drops params that must never reach the key (API keys, cache-busters).
 */
export function cacheKey(namespace, path, searchParams, skip = []) {
  const drop = new Set(['apikey', 'api_key', 'token', '_', ...skip]);
  const pairs = [];
  for (const [k, v] of searchParams) if (!drop.has(k.toLowerCase())) pairs.push([k, v]);
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${namespace}:${path}${qs ? `?${qs}` : ''}`;
}

/** Cached payload, or null on miss / outage / disabled. Never throws. */
export async function cacheGet(key) {
  if (!enabled()) return null;
  try {
    const hit = await redis().get(PREFIX + key);
    // Upstash deserialises JSON automatically; guard against anything unexpected.
    return hit && typeof hit === 'object' && typeof hit.body === 'string' ? hit : null;
  } catch (e) {
    warn('get', e);
    return null;
  }
}

/**
 * Store an upstream response. Only 2xx bodies are cached — caching a 429 or a 500 for
 * hours would turn a transient upstream blip into a lasting outage.
 */
export async function cacheSet(key, { status, body }, ttlSec) {
  if (!enabled()) return;
  if (!(status >= 200 && status < 300)) return;
  if (!body || body.length < 2) return; // empty / "" / "[]" isn't worth a round trip
  try {
    await redis().set(PREFIX + key, { status, body }, { ex: ttlSec });
  } catch (e) {
    warn('set', e);
  }
}
