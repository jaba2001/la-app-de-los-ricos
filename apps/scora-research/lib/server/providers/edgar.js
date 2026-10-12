// Implementacion del proveedor `edgar`.
//
// Vive FUERA de app/ porque Next valida los ficheros route.js y solo admite unos exports
// concretos: exportar `serve` desde alli es un error de compilacion. Y `serve` tiene que
// ser exportable, porque /api/batch lo reutiliza — es lo que garantiza que el lote pase
// por la MISMA validacion y la misma cache que la ruta suelta, sin una segunda copia.

import { requireUser } from '../auth.js';
import { checkRateLimit } from '../ratelimit.js';
import { corsHeaders, preflight } from '../cors.js';
import { cacheKey, cacheGet, cacheSet } from '../cache.js';
import { construirEstados, unidadesDe } from '../edgarHechos.js';
import { fetchConReintento } from './red.js';


const UA = 'ScoraMVP alealvarado804@gmail.com';
const EDGAR_TTL = 86400; // 24 h — XBRL company facts only change when a filing lands
// Module-level CIK map cache (persists while Edge instance is warm)
let _map = null;

async function getMap() {
  if (_map) return _map;
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': UA },
    next: { revalidate: 86400 },
  });
  if (!r.ok) throw new Error(`Ticker map fetch failed: ${r.status}`);
  const raw = await r.json();
  const m = {};
  for (const v of Object.values(raw)) m[String(v.ticker).toUpperCase()] = String(v.cik_str);
  _map = m;
  return m;
}

// Todos los hechos us-gaap de la empresa en UNA petición (companyfacts).
//
// POR QUÉ (12-10-2026). Antes se pedía cada concepto por separado (companyconcept, 18
// peticiones por ficha). Para KO la SEC respondía `"units":{"USD":{}}` —un objeto vacío— en
// casi todos los conceptos, mientras companyfacts traía los mismos datos completos; y ese
// objeto tumbaba la ficha entera con «not iterable». Una petición en vez de 18 es además lo
// que pide la política de acceso de la SEC (~300 KB comprimidos, < 0,2 s).
async function getFacts(cik10) {
  const r = await fetchConReintento(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik10}.json`, { headers: { 'User-Agent': UA } });
  // 404 = la empresa no tiene hechos XBRL (p. ej. solo presenta en papel): no es un fallo.
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(`companyfacts HTTP ${r.status}`);
  const d = await r.json();
  return d?.facts?.['us-gaap'] ?? {};
}


const EMPTY = JSON.stringify({ income: [], balanceSheet: [], cashFlow: [], annualIncome: [] });

export async function serve(request) {
  const CORS = corsHeaders(request, { 'Content-Type': 'application/json' });

  const url = new URL(request.url);
  const sym = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();

  // European tickers (contain a dot) are not on EDGAR — return empty gracefully
  if (!sym || !/^[A-Z0-9]{1,10}$/.test(sym)) {
    return new Response(EMPTY, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  }

  // Highest-value cache in the proxy: one call here downloads the company's whole XBRL
  // facts file from the SEC, which enforces fair-access limits (hence the tight 5/min
  // rate limit above). 24 h TTL because company facts only change when a filing lands —
  // same reasoning, and the same value, as the FMP statements endpoints.
  // v3: lo cacheado antes tiene CapEx positivo e ingresos de 2018 (v1) o no trae las acciones
  // diluidas (v2). v4: sale de companyfacts; con companyconcept KO salía vacía. Ver edgarHechos.js.
  const key = cacheKey('edgar', 'companyfacts-v4', new URLSearchParams({ symbol: sym }));
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { ...CORS, 'Cache-Control': `public, max-age=${EDGAR_TTL}, s-maxage=${EDGAR_TTL}`, 'X-Scora-Cache': 'HIT' },
    });
  }

  try {
    const map = await getMap();
    const cik = map[sym];
    if (!cik) {
      return new Response(EMPTY, { status: 200, headers: { ...CORS } });
    }
    const cik10 = cik.padStart(10, '0');

    // Los conceptos que hacen falta, sacados del fichero de hechos. Varios de ingresos y de deuda porque
    // cada empresa usa uno distinto y algunas lo cambian con los años (ver edgarHechos.js).
    const CONCEPTOS = {
      revenues: 'Revenues', revenueContract: 'RevenueFromContractWithCustomerExcludingAssessedTax',
      salesRevenueNet: 'SalesRevenueNet', grossProfit: 'GrossProfit', operatingIncome: 'OperatingIncomeLoss',
      netIncome: 'NetIncomeLoss', eps: 'EarningsPerShareDiluted', assets: 'Assets',
      cash: 'CashAndCashEquivalentsAtCarryingValue', equity: 'StockholdersEquity', liabilities: 'Liabilities',
      longTermDebt: 'LongTermDebt', longTermDebtNoncurrent: 'LongTermDebtNoncurrent',
      longTermDebtCurrent: 'LongTermDebtCurrent', commercialPaper: 'CommercialPaper',
      operatingCashFlow: 'NetCashProvidedByUsedInOperatingActivities',
      capex: 'PaymentsToAcquirePropertyPlantAndEquipment',
      dilutedShares: 'WeightedAverageNumberOfDilutedSharesOutstanding',
    };
    const gaap = await getFacts(cik10);
    const crudo = Object.fromEntries(Object.entries(CONCEPTOS).map(([n, tag]) => [n, unidadesDe(gaap, tag)]));
    const { income, balanceSheet, cashFlow, annualIncome } = construirEstados(crudo);

    const body = JSON.stringify({ income, balanceSheet, cashFlow, annualIncome, source: 'edgar', cik });
    await cacheSet(key, { status: 200, body }, EDGAR_TTL);

    return new Response(body, {
      status: 200,
      headers: { ...CORS, 'Cache-Control': `public, max-age=${EDGAR_TTL}, s-maxage=${EDGAR_TTL}`, 'X-Scora-Cache': 'MISS' },
    });
  } catch (err) {
    // Log the detail server-side; don't echo upstream internals back to the caller.
    console.error('edgar fetch failed:', err);
    return new Response(JSON.stringify({ error: 'EDGAR fetch failed' }), {
      status: 502, headers: CORS,
    });
  }
}


// `serve` es todo lo que pasa DESPUÉS de identificar al usuario: validar, mirar la caché y
// llamar al proveedor. Está separado de `GET` para que /api/batch pueda reutilizarlo sin
// repetir la autenticación por sub-petición — y, sobre todo, para que NO PUEDA saltarse
// nada: el lote entra por esta misma puerta, con las mismas listas blancas y la misma
// caché. Una segunda implementación de la validación es justo lo que no queremos.
export async function GET(request) {
  const { user, error: authErr } = await requireUser(request);
  if (authErr) return authErr;
  const rl = await checkRateLimit('edgar', user.id, 5, 60, request);
  if (rl) return rl;
  return serve(request);
}

export async function OPTIONS(request) {
  return preflight(request);
}
