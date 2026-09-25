import { requireUser } from '../../../../lib/server/auth.js';
import { checkRateLimit } from '../../../../lib/server/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/server/cors.js';
import { cacheKey, cacheGet, cacheSet } from '../../../../lib/server/cache.js';

export const runtime = 'edge';

const VALID_SERIES = /^[A-Z0-9_]{2,30}$/;

// Los opcionales que FRED acepta, cada uno con la forma que se le permite tener. Antes se
// reenviaban tal cual: cualquier texto llegaba a la API de FRED con nuestra clave puesta.
// Validarlos es lo que además permite CACHEAR, porque acota el espacio de claves: sin esto,
// `observation_start=<cualquier cosa>` sembraría entradas nuevas sin límite, y la instancia
// de Upstash está en `noeviction` (llena, RECHAZA escrituras — y el rate limiter escribe
// ahí mismo). Ver el razonamiento largo en lib/cache.js.
const OPTIONAL = {
  limit:             /^\d{1,5}$/,
  sort_order:        /^(asc|desc)$/,
  units:             /^[a-z0-9_]{1,12}$/,
  frequency:         /^[a-z]{1,4}$/,
  observation_start: /^\d{4}-\d{2}-\d{2}$/,
  observation_end:   /^\d{4}-\d{2}-\d{2}$/,
};

// Las series de FRED se publican como mucho a diario, así que 6 h es holgado y seguro.
const CACHE_TTL = 21600;

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('fred', user.id, 10, 60, request); if (rl) return rl;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');

  if (!seriesId || !VALID_SERIES.test(seriesId)) {
    return json({ error: 'Invalid series_id' }, 400);
  }

  if (!process.env.FRED_KEY) {
    return json({ error: 'Server misconfigured: FRED_KEY missing' }, 500);
  }

  // Se recogen ORDENADOS para que `?frequency=d&limit=5` y `?limit=5&frequency=d` compartan
  // entrada de caché, igual que hace cacheKey con los parámetros que sí conoce.
  const opts = [];
  for (const name of Object.keys(OPTIONAL).sort()) {
    const v = url.searchParams.get(name);
    if (v == null || v === '') continue;
    if (!OPTIONAL[name].test(v)) return json({ error: `Invalid ${name}` }, 400);
    opts.push([name, v]);
  }

  // La identidad de la petición va en la posición de `path` —como en /api/cot y
  // /api/congress— porque estos nombres no están en KNOWN_PARAMS y ya vienen validados
  // arriba: el espacio de claves queda acotado por la validación, no por la lista global.
  const suffix = opts.map(([k, v]) => `${k}=${v}`).join('&');
  const key = cacheKey('fred', suffix ? `${seriesId}?${suffix}` : seriesId, new URLSearchParams());
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

  const upstream = new URL('https://api.stlouisfed.org/fred/series/observations');
  upstream.searchParams.set('series_id', seriesId);
  upstream.searchParams.set('file_type', 'json');
  upstream.searchParams.set('api_key', process.env.FRED_KEY);
  for (const [k, v] of opts) upstream.searchParams.set(k, v);

  const res = await fetch(upstream.toString(), { headers: { 'Accept': 'application/json' } });
  const body = await res.text();
  // Solo se cachean respuestas buenas: un 500 de FRED cacheado 6 h convertiría una avería
  // pasajera suya en una avería nuestra que dura toda la tarde.
  if (res.ok) await cacheSet(key, { status: res.status, body }, CACHE_TTL);
  return new Response(body, {
    status: res.status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
      'X-Scora-Cache': res.ok ? 'MISS' : 'BYPASS',
    }),
  });
}

export async function OPTIONS(request) {
  return preflight(request);
}
