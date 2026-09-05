// Una acción del usuario, una petición.
//
// EL PROBLEMA: abrir un ticker disparaba 33 peticiones al proxy (20 a FMP, 4 a Finnhub y
// una a cada uno de short-interest, finviz y congress). Cada una pagaba su propia ronda de
// autenticación y de rate-limit antes de tocar dato alguno, así que un solo análisis
// costaba ~99 viajes de red internos. Y como el cubo de FMP es de 40/min, 20 llamadas por
// ticker ponían un techo de DOS análisis por minuto y usuario: el tercero daba 429.
//
// LO QUE ESTE ENDPOINT NO ES: un atajo para saltarse los controles. Cada sub-petición entra
// por el MISMO `serve()` que usa su ruta individual, con sus mismas listas blancas, su
// validación de símbolo y su caché compartida. Y el rate-limit no se diluye: se cobra con
// `cost` el número real de llamadas por proveedor, así que un lote de 20 a FMP gasta 20 del
// cubo de FMP. Agrupar ahorra viajes, no cuota.
import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';

import { serve as fmpServe } from '../fmp/[...path]/route.js';
import { serve as finnhubServe } from '../finnhub/[...path]/route.js';
import { serve as shortIntServe } from '../short-interest/route.js';
import { serve as finvizServe } from '../finviz/quote/route.js';
import { serve as congressServe } from '../congress/[ticker]/route.js';
import { serve as edgarServe } from '../edgar/route.js';
import { serve as simfinServe } from '../simfin/route.js';

export const runtime = 'edge';

// El tope de sub-peticiones sale del uso real: la página de un ticker hace 33. 40 deja
// margen sin permitir que un lote se convierta en una herramienta de amplificación.
const MAX_SUB = 40;

// Los cubos por proveedor son los MISMOS que aplican las rutas sueltas. Duplicar aquí los
// números es feo; tenerlos distintos sería peor, así que si cambia uno hay que cambiar los
// dos. La prueba scripts/batch.test.mjs comprueba que no se separen.
const PROVIDERS = {
  fmp:        { serve: fmpServe,       limiter: 'fmp',      max: 40, window: 60 },
  finnhub:    { serve: finnhubServe,   limiter: 'finnhub',  max: 60, window: 60 },
  'short-interest': { serve: shortIntServe, limiter: 'shortint', max: 20, window: 60 },
  finviz:     { serve: finvizServe,    limiter: 'finviz',   max: 15, window: 60 },
  congress:   { serve: congressServe,  limiter: 'congress', max: 20, window: 60 },
  edgar:      { serve: edgarServe,     limiter: 'edgar',    max: 5,  window: 60 },
  simfin:     { serve: simfinServe,    limiter: 'simfin',   max: 5,  window: 60 },
};

/**
 * `/api/fmp/income-statement?symbol=AAPL` → a qué proveedor va, con qué contexto de ruta.
 * Devuelve null si no es una ruta que este endpoint sepa despachar; el llamante lo
 * convierte en un 400 para ESA sub-petición, sin tumbar el lote entero.
 */
export function route(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) return null;
  // Se rechaza cualquier cosa que no sea una ruta relativa limpia: sin host, sin `..`, sin
  // barras dobles. Un `path` con host sería una petición a un tercero firmada por nosotros.
  if (path.includes('//') || path.includes('..') || path.includes('\\')) return null;

  const qIdx = path.indexOf('?');
  const clean = qIdx === -1 ? path : path.slice(0, qIdx);
  const search = qIdx === -1 ? '' : path.slice(qIdx);
  const seg = clean.slice('/api/'.length).split('/').filter(Boolean);
  if (!seg.length) return null;

  const ok = (r) => (r && PROVIDERS[r.provider] ? r : null);

  if (seg[0] === 'fmp' || seg[0] === 'finnhub') {
    if (seg.length < 2) return null;
    return ok({ provider: seg[0], ctx: { params: { path: seg.slice(1) } }, search });
  }
  if (seg[0] === 'congress') {
    if (seg.length !== 2) return null;
    return ok({ provider: 'congress', ctx: { params: { ticker: seg[1] } }, search });
  }
  if ((seg[0] === 'edgar' || seg[0] === 'simfin') && seg.length === 1) {
    return ok({ provider: seg[0], ctx: {}, search });
  }
  if (seg[0] === 'short-interest' && seg.length === 1) {
    return ok({ provider: 'short-interest', ctx: {}, search });
  }
  if (seg[0] === 'finviz' && seg[1] === 'quote' && seg.length === 2) {
    return ok({ provider: 'finviz', ctx: {}, search });
  }
  return null;
}

/** Ejecuta `tasks` con como mucho `n` en vuelo. Las respuestas cacheadas vuelven al
 *  instante; las que no, salen a un proveedor externo, y 40 a la vez es maleducado
 *  (y la vía rápida a que nos limiten desde el otro lado). */
async function pool(tasks, n) {
  const out = new Array(tasks.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      out[idx] = await tasks[idx]();
    }
  }));
  return out;
}

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const reqs = body?.requests;
  if (!Array.isArray(reqs) || reqs.length === 0) return json({ error: 'requests must be a non-empty array' }, 400);
  if (reqs.length > MAX_SUB) return json({ error: `Too many sub-requests (max ${MAX_SUB})`, got: reqs.length }, 400);

  // Se resuelve TODO antes de gastar cuota: si el lote trae una ruta inválida, se sabe
  // ahora y no después de haber cobrado el rate-limit por las buenas.
  const seen = new Set();
  const items = [];
  for (const r of reqs) {
    const id = r?.id;
    if (typeof id !== 'string' || !id) return json({ error: 'Each request needs a string id' }, 400);
    if (seen.has(id)) return json({ error: `Duplicate id: ${id}` }, 400);
    seen.add(id);
    items.push({ id, path: r?.path, routed: route(r?.path) });
  }

  // Cuota por proveedor, cobrada de una vez y por el número real de llamadas.
  const counts = {};
  for (const it of items) if (it.routed) counts[it.routed.provider] = (counts[it.routed.provider] || 0) + 1;
  for (const [provider, n] of Object.entries(counts)) {
    const p = PROVIDERS[provider];
    const rl = await checkRateLimit(p.limiter, user.id, p.max, p.window, request, { cost: n });
    if (rl) return rl; // 429 del lote entero: pedir menos y reintentar es lo correcto
  }

  const origin = new URL(request.url).origin;
  const headers = new Headers(request.headers);
  headers.delete('content-type'); // las sub-peticiones son GET, sin cuerpo

  const results = await pool(items.map((it) => async () => {
    if (!it.routed) return { id: it.id, status: 400, body: JSON.stringify({ error: 'Unsupported path', path: it.path ?? null }) };
    const { provider, ctx, search } = it.routed;
    try {
      const sub = new Request(`${origin}${it.path.split('?')[0]}${search}`, { method: 'GET', headers });
      const res = await PROVIDERS[provider].serve(sub, ctx);
      return { id: it.id, status: res.status, body: await res.text(), cache: res.headers.get('X-Scora-Cache') ?? null };
    } catch (e) {
      // Una sub-petición rota no puede tumbar las otras 32: el cliente ya trataba cada
      // llamada por separado (Promise.allSettled), así que el lote conserva esa semántica.
      return { id: it.id, status: 502, body: JSON.stringify({ error: String(e?.message || e) }) };
    }
  }), 8);

  return json({ results }, 200);
}

export async function OPTIONS(request) {
  return preflight(request);
}
