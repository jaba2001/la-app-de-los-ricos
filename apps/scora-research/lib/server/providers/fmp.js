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
import { respaldoYahoo, esSimboloFueraDePlan, esLimiteAgotado } from './yahoo.js';
import { fetchConReintento } from './red.js';


// Solo lo que el front pide de verdad. Cada ruta de aquí es una puerta a FMP firmada con
// nuestra clave y con cargo a nuestra cuota, así que las que nadie usaba se cerraron el 27-09
// (AUDIT_REPORT B-1). El cron insider-refresh llama a FMP directamente, no por aquí.
//
// 12-10-2026, recorriendo cada pestaña en un navegador con sesión: cinco de estas devolvían
// `[]` con 404 en CADA análisis, porque /stable las renombró o el plan no las incluye. Se
// cambian por las que sí responden (comprobado contra la API real):
//   peers               → stock-peers
//   price-target        → price-target-consensus
//   earnings-surprises  → earnings            (trae epsActual/epsEstimated por trimestre)
//   institutional-holder, house-disclosure → fuera: 402 en este plan, no hay sustituto.
//   search              → fuera: /stable/search no existe (404). El buscador va por /api/search
//                         (lib/server/busqueda.js), que no gasta cuota de FMP.
const ALLOWED = new Set([
  'quote','profile','key-metrics-ttm','ratios-ttm',
  'historical-price-eod/full','income-statement',
  'analyst-estimates','discounted-cash-flow','balance-sheet-statement','price-target-consensus',
  'cash-flow-statement','stock-peers','shares-float',
  'financial-growth','earnings',
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

export async function serve(request, ctx) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  // En Next 15 `params` es una Promise (el acceso síncrono solo va por una capa de
  // compatibilidad obsoleta). /api/batch pasa un objeto plano: `await` vale para los dos.
  const segments = (await ctx.params).path;
  if (!segments.every(s => SAFE_SEGMENT.test(s) && !isDotSegment(s))) {
    return json({ error: 'Invalid path' }, 400);
  }
  const path = segments.join('/');
  if (![...ALLOWED].some(p => path === p || path.startsWith(p + '/'))) {
    return json({ error: 'Endpoint not allowed', path }, 403);
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  // Con dígitos: el buscador ofrece valores como 0700.HK o 7203.T, y sin ellos la ficha salía
  // vacía por un 400 nuestro (AUDIT_REPORT M-4). Sigue sin admitir nada que altere la URL.
  if (symbol && !/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
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
    : /^(income-statement|balance-sheet-statement|cash-flow-statement|earnings)/.test(path)
      ? 86400                  // 24 h   — statements / earnings
    : /^(stock-peers|profile)/.test(path)
      ? 604800                 // 7 d    — nearly static company info
    : /^(key-metrics-ttm|ratios-ttm|key-metrics|financial-growth)/.test(path)
      ? 43200                  // 12 h   — TTM ratios (updated weekly)
    : /^(price-target-consensus|analyst-estimates|discounted-cash-flow)/.test(path)
      ? 21600                  // 6 h    — analyst updates infrequent intraday
    : 3600;                    // 1 h    — sensible default for everything else

  // Shared cache lookup. Deliberately AFTER requireUser + checkRateLimit so it can never
  // be used to bypass auth or the cost guard — it only skips the upstream call.
  const key = cacheKey('fmp', path, url.searchParams);
  const hit = await cacheGet(key);
  // Una entrada de error es de antes de que se dejaran de cachear (ver abajo): se ignora.
  if (hit && hit.status >= 200 && hit.status < 300) {
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
  const { status, body, fuente } = await dedupe(key, async () => {
    const res = await fetchConReintento(upstream.toString(), { headers: { 'Accept': 'application/json' } });
    let r = { status: res.status, body: await res.text(), fuente: 'fmp' };
    // ETFs fuera del plan (402 «Special Endpoint») o FMP sin cuota del día (429 «Limit
    // Reach»): cotización e histórico salen de Yahoo con la forma de FMP. Ver yahoo.js.
    if ((path === 'quote' || path === 'historical-price-eod/full') && (esSimboloFueraDePlan(r.status, r.body) || esLimiteAgotado(r.status, r.body))) {
      const y = await respaldoYahoo(path, url.searchParams);
      if (y) r = { ...y, fuente: 'yahoo' };
    }
    // Solo se cachea lo que salió bien. Antes se cacheaba TODO, errores incluidos: un 402 o un
    // 429 se quedaba fijado hasta 24 h para todos los usuarios aunque la causa ya no existiera.
    if (r.status >= 200 && r.status < 300) await cacheSet(key, r, CACHE_TTL);
    return r;
  });

  const ok = status >= 200 && status < 300;
  return new Response(body, {
    status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': ok ? `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}` : 'no-store',
      'X-Scora-Cache': 'MISS',
      'X-Scora-Source': fuente ?? 'fmp',
    }),
  });
}


// `serve` es todo lo que pasa DESPUÉS de identificar al usuario: validar, mirar la caché y
// llamar al proveedor. Está separado de `GET` para que /api/batch pueda reutilizarlo sin
// repetir la autenticación por sub-petición — y, sobre todo, para que NO PUEDA saltarse
// nada: el lote entra por esta misma puerta, con las mismas listas blancas y la misma
// caché. Una segunda implementación de la validación es justo lo que no queremos.
/**
 * Llamadas a FMP por usuario y minuto. Era 40, y abrir la ficha de UNA acción gasta ~21: al
 * analizar la segunda en el mismo minuto el lote entero salía 429 y la ficha quedaba vacía
 * («11 data sources unavailable», recorrido del 12-10-2026). 120 ≈ cinco fichas por minuto,
 * un ritmo de uso normal; la caché compartida absorbe las repetidas. Lo usa también el lote.
 */
export const LIMITE_FMP = { max: 120, window: 60 };

export async function GET(request, ctx) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('fmp', user.id, LIMITE_FMP.max, LIMITE_FMP.window, request); if (rl) return rl;
  return serve(request, ctx);
}

export async function OPTIONS(request) {
  return preflight(request);
}
