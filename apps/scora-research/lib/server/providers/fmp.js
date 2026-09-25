// Implementacion del proveedor `fmp`.
//
// Vive FUERA de app/ porque Next valida los ficheros route.js y solo admite unos exports
// concretos: exportar `serve` desde alli es un error de compilacion. Y `serve` tiene que
// ser exportable, porque /api/batch lo reutiliza — es lo que garantiza que el lote pase
// por la MISMA validacion y la misma cache que la ruta suelta, sin una segunda copia.

import { requireUser } from '../auth.js';
import { checkRateLimit } from '../ratelimit.js';
import { corsHeaders, preflight } from '../cors.js';
import { cacheKey, cacheGet, cacheSet, dedupe } from '../cache.js';


const ALLOWED = new Set([
  'quote','profile','key-metrics-ttm','ratios-ttm',
  'historical-price-eod/full','income-statement','news',
  'price-target-consensus','analyst-estimates','upgrades-downgrades-consensus',
  'discounted-cash-flow','balance-sheet-statement','price-target',
  'cash-flow-statement','peers','historical-dividends',
  'institutional-holder','historical-shares-float','shares-float',
  'key-metrics','financial-growth','earnings-surprises',
  'search','senate-trading','house-disclosure','insider-trading',
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
  if (symbol && !/^[A-Z.\-]{1,15}$/.test(symbol)) {
    return json({ error: 'Invalid symbol' }, 400);
  }

  if (!process.env.FMP_KEY) {
    return json({ error: 'Server misconfigured: FMP_KEY missing' }, 500);
  }

  // Dynamic cache TTL by endpoint — financial statements change quarterly, prices are live
  const CACHE_TTL =
    path === 'quote'
      ? 60                     // 1 min  — live price
    : /^historical-price-eod/.test(path)
      ? 3600                   // 1 h    — EOD history (today's bar isn't closed yet)
    : /^(income-statement|balance-sheet-statement|cash-flow-statement|earnings-surprises|historical-shares-float|institutional-holder|senate-trading|house-disclosure|insider-trading|historical-dividends)/.test(path)
      ? 86400                  // 24 h   — statements / holders / disclosures
    : /^(peers|profile)/.test(path)
      ? 604800                 // 7 d    — nearly static company info
    : /^(key-metrics-ttm|ratios-ttm|key-metrics|financial-growth)/.test(path)
      ? 43200                  // 12 h   — TTM ratios (updated weekly)
    : /^(price-target|analyst-estimates|price-target-consensus|upgrades-downgrades-consensus|discounted-cash-flow)/.test(path)
      ? 21600                  // 6 h    — analyst updates infrequent intraday
    : 3600;                    // 1 h    — sensible default for everything else

  // Shared cache lookup. Deliberately AFTER requireUser + checkRateLimit so it can never
  // be used to bypass auth or the cost guard — it only skips the upstream call.
  const key = cacheKey('fmp', path, url.searchParams);
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

  const fmpBase = path === 'news'
    ? `https://financialmodelingprep.com/api/v3/stock_news`
    : `https://financialmodelingprep.com/stable/${path}`;
  const upstream = new URL(fmpBase);
  for (const [k,v] of url.searchParams) upstream.searchParams.set(k, v);
  upstream.searchParams.set('apikey', process.env.FMP_KEY);

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
  const rl = await checkRateLimit('fmp', user.id, 40, 60, request); if (rl) return rl;
  return serve(request, ctx);
}

export async function OPTIONS(request) {
  return preflight(request);
}
