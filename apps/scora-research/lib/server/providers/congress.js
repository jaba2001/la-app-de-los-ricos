// Implementacion del proveedor `congress`.
//
// Vive FUERA de app/ porque Next valida los ficheros route.js y solo admite unos exports
// concretos: exportar `serve` desde alli es un error de compilacion. Y `serve` tiene que
// ser exportable, porque /api/batch lo reutiliza — es lo que garantiza que el lote pase
// por la MISMA validacion y la misma cache que la ruta suelta, sin una segunda copia.

import { requireUser }    from '../auth.js';
import { checkRateLimit } from '../ratelimit.js';
import { corsHeaders, preflight } from '../cors.js';
import { cacheKey, cacheGet, cacheSet } from '../cache.js';

const CONGRESS_TTL = 43200; // 12 h — STOCK Act disclosures lag 30-45 days by statute

// Public datasets — no API key required (STOCK Act disclosures)
const SENATE_URL = 'https://senate-stock-watcher-data.s3-us-east-2.amazonaws.com/aggregate/all_transactions.json';
const HOUSE_URL  = 'https://house-stock-watcher-data.s3-us-east-2.amazonaws.com/data/all_transactions.json';

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

function normTicker(raw) {
  return String(raw || '').replace(/^[$]/, '').toUpperCase().trim();
}

export async function serve(request, { params }) {

  const ticker = (params.ticker || '').toUpperCase().replace(/[^A-Z.\-]/g, '');
  if (!ticker || ticker.length > 8) {
    return new Response(JSON.stringify({ error: 'Invalid ticker' }), {
      status: 400,
      headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
    });
  }

  // Each miss downloads the FULL Senate + House transaction dumps (multi-MB) just to keep
  // the rows for one ticker. STOCK Act disclosures land on a 30-45 day statutory delay, so
  // a 12 h shared entry is generous. `next: { revalidate }` on the fetches below only helps
  // within a warm isolate; this survives across them and across users.
  const key = cacheKey('congress', ticker, new URLSearchParams());
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=3600, s-maxage=${CONGRESS_TTL}`,
        'X-Scora-Cache': 'HIT',
      }),
    });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const trades = [];

  const fetchWithTimeout = (url, ms = 8000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal, next: { revalidate: 43200 } })
      .finally(() => clearTimeout(timer));
  };

  const [senateRes, houseRes] = await Promise.allSettled([
    fetchWithTimeout(SENATE_URL),
    fetchWithTimeout(HOUSE_URL),
  ]);

  if (senateRes.status === 'fulfilled' && senateRes.value.ok) {
    try {
      const all = await senateRes.value.json();
      for (const r of Array.isArray(all) ? all : []) {
        if (normTicker(r.ticker) !== ticker) continue;
        const date = normalizeDate(r.transaction_date);
        if (!date || date < cutoff) continue;
        trades.push({
          date,
          name:    r.senator || 'Unknown',
          party:   r.party || '',
          chamber: 'Senate',
          type:    (r.type || '').toLowerCase(),
          amount:  r.amount || '',
          disclosure_date: normalizeDate(r.disclosure_date),
        });
      }
    } catch {}
  }

  if (houseRes.status === 'fulfilled' && houseRes.value.ok) {
    try {
      const all = await houseRes.value.json();
      for (const r of Array.isArray(all) ? all : []) {
        if (normTicker(r.ticker) !== ticker) continue;
        const date = normalizeDate(r.transaction_date);
        if (!date || date < cutoff) continue;
        trades.push({
          date,
          name:    r.representative || 'Unknown',
          party:   r.party || '',
          chamber: 'House',
          type:    (r.type || '').toLowerCase(),
          amount:  r.amount || '',
          disclosure_date: normalizeDate(r.disclosure_date),
        });
      }
    } catch {}
  }

  trades.sort((a, b) => b.date.localeCompare(a.date));

  const body = JSON.stringify(trades.slice(0, 30));
  // Only cache when at least one chamber actually answered. An empty result is a normal,
  // cacheable answer for most tickers (few names have congressional trades), but an empty
  // result because BOTH dumps timed out is an outage — storing that for 12 h would keep
  // serving "no trades" long after the sources came back.
  const anySourceOk =
    (senateRes.status === 'fulfilled' && senateRes.value.ok) ||
    (houseRes.status === 'fulfilled' && houseRes.value.ok);
  if (anySourceOk) await cacheSet(key, { status: 200, body }, CONGRESS_TTL);

  // ⚠️ SI NINGUNA CAMARA CONTESTO, ESTO NO ES «NO HAY OPERACIONES»: ES UN APAGON.
  //
  // Antes se devolvia 200 con una lista vacia en los dos casos, asi que quien consume no podia
  // distinguirlos — y `computeSmartMoneySignal` trata la lista vacia como aportacion CERO. El
  // resultado es un score compuesto al que se le muere una de sus tres patas sin que nadie lo
  // note. Es el mismo defecto que costo una fecha de decision: «no se sabe» leido como «no hay».
  //
  // Los dos volcados dejaron de ser publicos: los buckets se movieron de `us-east-2` a
  // `us-west-2` Y pasaron a devolver 403. Comprobado el 2026-09-04. Asi que este camino no es
  // hipotetico: hoy es el unico que se recorre.
  if (!anySourceOk) {
    return new Response(JSON.stringify({ error: 'congress_sources_unavailable', trades: [] }), {
      status: 503,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Scora-Sources': 'none',
      }),
    });
  }

  return new Response(body, {
    status: 200,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=3600, s-maxage=${CONGRESS_TTL}`,
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
  const { user, error: authErr } = await requireUser(request);
  if (authErr) return authErr;

  const rl = await checkRateLimit('congress', user.id, 20, 60, request);
  if (rl) return rl;
  return serve(request, ctx);
}

export async function OPTIONS(request) {
  return preflight(request);
}
