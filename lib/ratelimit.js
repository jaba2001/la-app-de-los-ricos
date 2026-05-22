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
  const lim = limiter(name, max, windowSec);
  const res = await lim.limit(userId);
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
