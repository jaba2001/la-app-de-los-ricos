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

// La caché puede vivir en SU PROPIA instancia de Upstash, separada de la del rate limiter.
//
// POR QUÉ: la instancia compartida está en `noeviction` — al llenarse no descarta lo viejo,
// RECHAZA escrituras. Y el rate limiter escribe ahí mismo. Es decir: llenar la caché no la
// degrada, se lleva por delante el control de coste de las rutas de pago. Rechazar los
// parámetros desconocidos (ver cacheKey) sube mucho el listón, pero no cambia el hecho de
// que dos sistemas con criticidad muy distinta compartan un recurso agotable.
//
// Con UPSTASH_CACHE_REST_URL/TOKEN puestos, la caché se va a su instancia y el peor caso de
// una caché llena vuelve a ser lo que debería: caché llena. Sin poner nada, se usa la de
// siempre y el comportamiento es idéntico al de hoy: separarlas es una decisión de
// despliegue, no un cambio de código.
function cacheUrl()   { return process.env.UPSTASH_CACHE_REST_URL   || process.env.UPSTASH_REDIS_REST_URL; }
function cacheToken() { return process.env.UPSTASH_CACHE_REST_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN; }

let _redis = null;
function redis() {
  if (_redis) return _redis;
  _redis = new Redis({ url: cacheUrl(), token: cacheToken() });
  return _redis;
}

// Bump this to invalidate every cached entry at once (e.g. after changing what we store).
const PREFIX = 'c:v1:';

// Set CACHE_DISABLED=1 to bypass entirely without a deploy — useful when debugging a
// suspected stale-data problem.
function enabled() {
  return (
    process.env.CACHE_DISABLED !== '1' &&
    !!cacheUrl() &&
    !!cacheToken()
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
 *
 * Devuelve null si aparece un parámetro que la app no usa. El llamante debe tratar el
 * null como "sirve la petición, pero no la caches".
 *
 * POR QUÉ: la clave incluía CUALQUIER parámetro, así que un usuario autenticado podía
 * sembrar entradas distintas sin límite añadiendo basura (`?symbol=AAPL&x=1`, `&x=2`…).
 * La instancia de Upstash está en `noeviction`: al llenarse no descarta lo viejo, sino
 * que empieza a RECHAZAR escrituras — y el rate limiter escribe en esa misma instancia.
 * Es decir, inundar la caché no solo la degrada: se lleva por delante el control de
 * coste. Ignorar el parámetro desconocido tampoco vale, porque entonces dos peticiones
 * distintas compartirían entrada. No cachear es la única opción sin efectos colaterales:
 * el peor caso es una petición legítima que paga su viaje al proveedor.
 */
const KNOWN_PARAMS = new Set([
  'symbol', 'limit', 'from', 'to', 'period', 'metric', 'query', 'id',
]);

export function cacheKey(namespace, path, searchParams, skip = []) {
  const drop = new Set(['apikey', 'api_key', 'token', '_', ...skip]);
  const pairs = [];
  for (const [k, v] of searchParams) {
    const lk = k.toLowerCase();
    if (drop.has(lk)) continue;
    if (!KNOWN_PARAMS.has(lk)) return null; // parámetro inesperado → no se cachea
    pairs.push([k, v]);
  }
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  return `${namespace}:${path}${qs ? `?${qs}` : ''}`;
}

/** Cached payload, or null on miss / outage / disabled / clave nula. Never throws. */
export async function cacheGet(key) {
  if (!key || !enabled()) return null;
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
// Tope por entrada. Upstash free admite 1 MB por valor y 256 MB en total; una respuesta
// gigante (un histórico largo) se come el presupuesto compartido para poco beneficio.
const MAX_ENTRY_BYTES = 512 * 1024;

export async function cacheSet(key, { status, body }, ttlSec) {
  if (!key || !enabled()) return;
  if (!(status >= 200 && status < 300)) return;
  if (!body || body.length < 2) return; // empty / "" / "[]" isn't worth a round trip
  if (body.length > MAX_ENTRY_BYTES) return;
  try {
    await redis().set(PREFIX + key, { status, body }, { ex: ttlSec });
  } catch (e) {
    warn('set', e);
  }
}
