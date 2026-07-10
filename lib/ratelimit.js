import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let _redis = null;
function redis() {
  if (_redis) return _redis;
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

const _limiters = {};
function limiter(name, max, windowSec) {
  if (_limiters[name]) return _limiters[name];
  _limiters[name] = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.fixedWindow(max, `${windowSec} s`),
    prefix: `rl:${name}`,
  });
  return _limiters[name];
}

export async function checkRateLimit(name, userId, max = 10, windowSec = 60) {
  // Fail-open by design: rate limiting is a cost guard, not the security boundary
  // (requireUser already gates every route). Missing Upstash env or a Redis outage
  // must degrade to "no limit + warning", never to an opaque 500 on every request.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn(`ratelimit ${name}: Upstash env missing — failing open (auth still enforced)`);
    return null;
  }
  let res;
  try {
    const lim = limiter(name, max, windowSec);
    res = await lim.limit(userId);
  } catch (e) {
    console.warn(`ratelimit ${name}: ${e?.message || e} — failing open`);
    return null;
  }
  if (!res.success) {
    return new Response(JSON.stringify({error:'Too many requests', limit:max, window:`${windowSec}s`}), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': String(Math.ceil(res.reset / 1000) - Math.floor(Date.now()/1000)),
        'X-RateLimit-Limit': String(max),
        'X-RateLimit-Remaining': String(res.remaining),
      },
    });
  }
  return null;
}
