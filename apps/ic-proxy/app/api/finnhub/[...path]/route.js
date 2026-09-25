import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/cors.js';
import { cacheKey, cacheGet, cacheSet, dedupe } from '../../../../lib/cache.js';

export const runtime = 'edge';

const ALLOWED = new Set([
  'quote', 'profile2', 'company-news', 'news', 'stock/recommendation',
  'stock/insider-transactions', 'stock/insider-sentiment',
  'stock/earnings', 'calendar/earnings', 'calendar/economic',
  'stock/financials-reported', 'stock/transcripts',
  'stock/short-interest', 'stock/social-sentiment',
  'forex/rates', 'crypto/candle',
  'stock/metric', 'stock/price-target',
]);

// A segment may only be a plain path atom. Without this, an encoded slash lets a caller
// smuggle traversal past the allowlist ("quote%2F..%2F..%2Fother" passes startsWith
// "quote/" and then new URL() normalises the ".." away), reaching any upstream endpoint
// with our API key attached.
// Se rechazan además "." y ".." como segmento completo: son los únicos que new URL()
// colapsa al normalizar, y con ellos fuera el path validado y el path pedido son
// literalmente el mismo string. Validar una cosa y pedir otra es el patrón que abrió
// el agujero original; esto lo cierra por construcción, no por análisis.
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
const isDotSegment = (s) => s === '.' || s === '..';

export async function serve(request, { params }) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  const segments = params.path;
  if (!segments.every(s => SAFE_SEGMENT.test(s) && !isDotSegment(s))) {
    return json({ error: 'Invalid path' }, 400);
  }
  const path = segments.join('/');
  if (![...ALLOWED].some(p => path === p || path.startsWith(p + '/'))) {
    return json({ error: 'Endpoint not allowed', path }, 403);
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  if (symbol && !/^[A-Z.\-:]{1,12}$/.test(symbol)) {
    return json({ error: 'Invalid symbol' }, 400);
  }

  if (!process.env.FINNHUB_KEY) {
    return json({ error: 'Server misconfigured: FINNHUB_KEY missing' }, 500);
  }

  // Per-endpoint TTL. These MIRROR the values the FMP route already uses for the
  // equivalent kind of data (profile 7d, filings/insider 24h, TTM metrics 12h, analyst
  // 6h) rather than inventing a new freshness policy — Finnhub previously used a flat
  // 60s for everything, which is right for a quote and needlessly strict for a company
  // profile. Anything not listed keeps the original 60s.
  const CACHE_TTL =
    /^profile2/.test(path)
      ? 604800                 // 7 d    — company profile is near-static
    : /^(stock\/insider-transactions|stock\/insider-sentiment|stock\/financials-reported|stock\/transcripts|stock\/short-interest)/.test(path)
      ? 86400                  // 24 h   — filings-derived, updates daily at best
    : /^stock\/metric/.test(path)
      ? 43200                  // 12 h   — TTM metrics
    : /^(stock\/earnings|calendar\/earnings|stock\/recommendation|stock\/price-target)/.test(path)
      ? 21600                  // 6 h    — analyst/earnings data
    : 60;                      // 1 min  — quotes, news, everything else (unchanged)

  // After requireUser + checkRateLimit, so the cache can never bypass either.
  const key = cacheKey('finnhub', path, url.searchParams);
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        'X-Scora-Cache': 'HIT',
      }),
    });
  }

  const upstream = new URL(`https://finnhub.io/api/v1/${path}`);
  for (const [k,v] of url.searchParams) upstream.searchParams.set(k, v);
  upstream.searchParams.set('token', process.env.FINNHUB_KEY);

  // Single-flight: si otra petición ya está pidiendo esta misma clave, se espera a la suya
  // en vez de salir otra vez al proveedor (ver `dedupe` en lib/cache.js).
  const { status, body } = await dedupe(key, async () => {
    const res = await fetch(upstream.toString(), { headers: { 'Accept': 'application/json' } });
    const text = await res.text();
    await cacheSet(key, { status: res.status, body: text }, CACHE_TTL);
    return { status: res.status, body: text };
  });

  return new Response(body, {
    status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
      'X-Scora-Cache': 'MISS',
    }),
  });
}


// `serve` es todo lo que pasa DESPUÉS de identificar al usuario: validar, mirar la caché y
// llamar al proveedor. Está separado de `GET` para que /api/batch pueda reutilizarlo sin
// repetir la autenticación por sub-petición — y, sobre todo, para que NO PUEDA saltarse
// nada: el lote entra por esta misma puerta, con las mismas listas blancas y la misma
// caché. Una segunda implementación de la validación es justo lo que no queremos.
export async function GET(request, ctx) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('finnhub', user.id, 60, 60, request); if (rl) return rl;
  return serve(request, ctx);
}

export async function OPTIONS(request) {
  return preflight(request);
}
