import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import * as Sentry from '@sentry/nextjs';
import { corsHeaders } from './cors.js';

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

/**
 * IP del cliente, para limitar por una dimensión distinta del user id.
 *
 * Registrarse es gratis, así que un límite por usuario no acota el gasto real: N cuentas
 * son N veces la cuota. La IP no es infalible (se rota), pero es el recurso que sí cuesta
 * algo, y sube el listón del abuso trivial. Vercel siempre pone x-forwarded-for; el
 * fallback 'unknown' comparte un único cubo, que es el lado seguro (más estricto, nunca
 * más permisivo).
 */
export function clientIp(request) {
  return (request?.headers?.get?.('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// Set RATELIMIT_FAIL_CLOSED=1 to turn the degradation below into a 503 instead. Worth
// enabling once Upstash is confirmed live in production: it trades availability for a
// hard ceiling on the paid routes (Anthropic), which is the right trade for cost abuse.
const FAIL_CLOSED = process.env.RATELIMIT_FAIL_CLOSED === '1';

function degrade(request, name, reason, forceClosed = false) {
  const failClosed = FAIL_CLOSED || forceClosed;
  // Report to Sentry as well as the console. Vercel's log retention rotates, and a
  // fail-open degradation is invisible by design: every route keeps returning 200 while
  // the cost guard in front of the paid APIs (Anthropic above all) is simply gone. That
  // is exactly the failure mode nobody notices until the bill arrives. No-op without
  // SENTRY_DSN; wrapped so telemetry can never break the request path.
  try {
    Sentry.captureMessage(
      `ratelimit ${name}: ${reason} — failing ${failClosed ? 'closed' : 'open'}`,
      { level: failClosed ? 'error' : 'warning', tags: { limiter: name, fail_mode: failClosed ? 'closed' : 'open' } }
    );
  } catch { /* never let reporting break rate limiting */ }

  if (!failClosed) {
    console.warn(`ratelimit ${name}: ${reason} — failing open (auth still enforced)`);
    return null;
  }
  console.error(`ratelimit ${name}: ${reason} — failing closed`);
  return new Response(JSON.stringify({ error: 'Rate limiter unavailable' }), {
    status: 503,
    headers: corsHeaders(request, { 'Content-Type': 'application/json', 'Retry-After': '30' }),
  });
}

/**
 * Los tipos van en JSDoc porque este modulo es JavaScript y ahora lo llaman rutas en
 * TypeScript (app/api/data). Sin ellos, TS deduce `request: null` del valor por defecto y
 * rechaza que se le pase un Request de verdad.
 *
 * @param {string} name
 * @param {string} userId
 * @param {number} [max]
 * @param {number} [windowSec]
 * @param {Request|null} [request]
 * @param {{failClosed?: boolean, cost?: number}} [opts]
 * @returns {Promise<Response|null>}
 *
 * @param opts.failClosed  Force a 503 when the limiter is unavailable, ignoring the global
 *   fail-open default. Required for UNAUTHENTICATED routes: fail-open is only defensible
 *   when requireUser still stands behind it. On /api/waitlist there is nothing behind it,
 *   and the route also triggers an outbound email per call — degrading to "no limit" there
 *   would hand out an anonymous mail cannon pointed at arbitrary addresses.
 */
export async function checkRateLimit(name, userId, max = 10, windowSec = 60, request = null, opts = {}) {
  const forceClosed = opts.failClosed === true;
  // `cost` consume varias unidades de golpe. Lo usa /api/batch: un lote con 20 llamadas a
  // FMP tiene que gastar 20 del cubo de FMP, no 1. Sin esto, agrupar peticiones sería una
  // forma trivial de saltarse el límite — el lote sería más barato que las 20 sueltas que
  // sustituye, que es justo lo contrario de lo que debe pasar.
  const cost = Number.isInteger(opts.cost) && opts.cost > 0 ? opts.cost : 1;
  // Fail-open by default: rate limiting is a cost guard, not the security boundary
  // (requireUser already gates every authenticated route). Missing Upstash env or a Redis
  // outage must degrade to "no limit + warning", never to an opaque 500 on every request.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return degrade(request, name, 'Upstash env missing', forceClosed);
  }
  let res;
  try {
    const lim = limiter(name, max, windowSec);
    res = await lim.limit(userId, { rate: cost });
  } catch (e) {
    return degrade(request, name, e?.message || String(e), forceClosed);
  }
  if (!res.success) {
    return new Response(JSON.stringify({error:'Too many requests', limit:max, window:`${windowSec}s`, ...(cost > 1 ? { cost } : {})}), {
      status: 429,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(res.reset / 1000) - Math.floor(Date.now()/1000)),
        'X-RateLimit-Limit': String(max),
        'X-RateLimit-Remaining': String(res.remaining),
      }),
    });
  }
  return null;
}
