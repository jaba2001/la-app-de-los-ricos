import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';
import { cacheKey, cacheGet, cacheSet } from '../../../lib/cache.js';

export const runtime = 'edge';

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

async function getConcept(cik10, tag) {
  try {
    const r = await fetch(
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik10}/us-gaap/${tag}.json`,
      { headers: { 'User-Agent': UA } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.units?.USD ?? null;
  } catch { return null; }
}

// Duration facts: quarterly (10-Q, 70–110 days) or annual (10-K, 300–400 days)
function parseDuration(facts, form) {
  if (!facts?.length) return [];
  const [lo, hi] = form === '10-Q' ? [70, 110] : [300, 400];
  return facts
    .filter(f => {
      if (!f.start || !f.end) return false;
      if (f.form !== form && !(form === '10-Q' && f.form === '10-K')) return false;
      // For 10-K we only allow annual range; for 10-Q allow quarterly range
      if (f.form === '10-K' && form === '10-Q') return false;
      const d = (+new Date(f.end) - +new Date(f.start)) / 86400000;
      return d >= lo && d <= hi;
    })
    .sort((a, b) => (+new Date(b.end) - +new Date(a.end)) || (+new Date(b.filed) - +new Date(a.filed)))
    .reduce((acc, f) => { if (!acc.length || acc.at(-1).end !== f.end) acc.push(f); return acc; }, []);
}

// Instant facts (balance sheet): no start date
function parseInstant(facts, form = '10-Q') {
  if (!facts?.length) return [];
  return facts
    .filter(f => f.form === form && f.end && !f.start)
    .sort((a, b) => (+new Date(b.end) - +new Date(a.end)) || (+new Date(b.filed) - +new Date(a.filed)))
    .reduce((acc, f) => { if (!acc.length || acc.at(-1).end !== f.end) acc.push(f); return acc; }, []);
}

// Augment Q1/Q2/Q3 with computed Q4 = annual - (Q1+Q2+Q3)
function addQ4(qFacts, aFacts) {
  const result = [...qFacts];
  for (const ann of aFacts.slice(0, 6)) {
    if (result.some(q => q.end === ann.end)) continue; // Q4 already present
    const annStart = +new Date(ann.start);
    const annEnd   = +new Date(ann.end);
    const qs = qFacts.filter(q => {
      const e = +new Date(q.end); const s = +new Date(q.start);
      return e > annStart && e <= annEnd && s >= annStart - 6 * 86400000;
    });
    if (qs.length === 3) {
      const q3 = qs.sort((a, b) => +new Date(b.end) - +new Date(a.end))[0];
      result.push({ end: ann.end, start: q3.end, val: ann.val - qs.reduce((s, q) => s + q.val, 0), form: 'Q4', filed: ann.filed });
    }
  }
  return result.sort((a, b) => +new Date(b.end) - +new Date(a.end));
}

const findVal = (arr, date) => arr.find(f => f.end === date)?.val ?? null;

const EMPTY = JSON.stringify({ income: [], balanceSheet: [], cashFlow: [], annualIncome: [] });

export async function serve(request) {
  const CORS = corsHeaders(request, { 'Content-Type': 'application/json' });

  const url = new URL(request.url);
  const sym = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();

  // European tickers (contain a dot) are not on EDGAR — return empty gracefully
  if (!sym || !/^[A-Z0-9]{1,10}$/.test(sym)) {
    return new Response(EMPTY, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  }

  // Highest-value cache in the proxy: one call here fans out to 13 parallel XBRL
  // requests against the SEC, which enforces fair-access limits (hence the tight 5/min
  // rate limit above). 24 h TTL because company facts only change when a filing lands —
  // same reasoning, and the same value, as the FMP statements endpoints.
  const key = cacheKey('edgar', 'companyfacts', new URLSearchParams({ symbol: sym }));
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

    // Parallel fetch all XBRL concepts (13 requests)
    const [
      revF, revAltF, grossF, opIncF, netIncF, epsF,
      assetsF, cashF, debtF, equityF, liabF,
      ocfF, capexF,
    ] = await Promise.all([
      getConcept(cik10, 'Revenues'),
      getConcept(cik10, 'RevenueFromContractWithCustomerExcludingAssessedTax'),
      getConcept(cik10, 'GrossProfit'),
      getConcept(cik10, 'OperatingIncomeLoss'),
      getConcept(cik10, 'NetIncomeLoss'),
      getConcept(cik10, 'EarningsPerShareDiluted'),
      getConcept(cik10, 'Assets'),
      getConcept(cik10, 'CashAndCashEquivalentsAtCarryingValue'),
      getConcept(cik10, 'LongTermDebt'),
      getConcept(cik10, 'StockholdersEquity'),
      getConcept(cik10, 'Liabilities'),
      getConcept(cik10, 'NetCashProvidedByUsedInOperatingActivities'),
      getConcept(cik10, 'PaymentsToAcquirePropertyPlantAndEquipment'),
    ]);

    // Pick revenue concept (prefer Revenues; fall back to ContractRevenue)
    const revData = (revF?.length ? revF : null) ?? revAltF ?? [];

    // Parse quarterly & annual series
    const revQ  = parseDuration(revData,  '10-Q');   const revA  = parseDuration(revData,  '10-K');
    const grossQ = parseDuration(grossF,  '10-Q');   const grossA = parseDuration(grossF,  '10-K');
    const opQ   = parseDuration(opIncF,   '10-Q');   const opA   = parseDuration(opIncF,   '10-K');
    const netQ  = parseDuration(netIncF,  '10-Q');   const netA  = parseDuration(netIncF,  '10-K');
    const epsQ  = parseDuration(epsF,     '10-Q');
    const ocfQ  = parseDuration(ocfF,     '10-Q');   const ocfA  = parseDuration(ocfF,     '10-K');
    const capQ  = parseDuration(capexF,   '10-Q');   const capA  = parseDuration(capexF,   '10-K');

    // Augment with Q4 (computed = annual - Q1-Q2-Q3)
    const revAll   = addQ4(revQ,   revA);
    const grossAll = addQ4(grossQ, grossA);
    const opAll    = addQ4(opQ,    opA);
    const netAll   = addQ4(netQ,   netA);
    const ocfAll   = addQ4(ocfQ,   ocfA);
    const capAll   = addQ4(capQ,   capA);

    // ── Quarterly income statement ─────────────────────────────────
    const qDates = revAll.map(f => f.end).slice(0, 12);
    const income = qDates.map(date => ({
      date,
      revenue:         findVal(revAll,   date),
      grossProfit:     findVal(grossAll, date),
      operatingIncome: findVal(opAll,    date),
      netIncome:       findVal(netAll,   date),
      eps:             findVal(epsQ,     date), // EPS not computed for Q4
    }));

    // ── Balance sheet ──────────────────────────────────────────────
    const assetI  = parseInstant(assetsF);
    const cashI   = parseInstant(cashF);
    const debtI   = parseInstant(debtF);
    const equityI = parseInstant(equityF);
    const liabI   = parseInstant(liabF);
    const bsDates = assetI.map(f => f.end).slice(0, 8);
    const balanceSheet = bsDates.map(date => ({
      date,
      totalAssets:             findVal(assetI,  date),
      cashAndCashEquivalents:  findVal(cashI,   date),
      totalDebt:               findVal(debtI,   date),
      totalStockholdersEquity: findVal(equityI, date),
      totalLiabilities:        findVal(liabI,   date),
    }));

    // ── Cash flow ──────────────────────────────────────────────────
    const cfDates = ocfAll.map(f => f.end).slice(0, 8);
    const cashFlow = cfDates.map(date => {
      const ocf = findVal(ocfAll, date);
      const cap = findVal(capAll, date);
      const capAbs = cap != null ? Math.abs(cap) : null; // stored positive; UI expects OCF - CapEx
      return {
        date,
        operatingCashFlow:  ocf,
        capitalExpenditure: capAbs,
        freeCashFlow: ocf != null && capAbs != null ? ocf - capAbs : null,
      };
    });

    // ── Annual income (for HistoricalFinancials chart) ─────────────
    const annualIncome = revA.slice(0, 5).map(f => {
      const ocf = findVal(ocfA, f.end);
      const cap = findVal(capA, f.end);
      return {
        date:         f.end,
        calendarYear: new Date(f.end).getFullYear(),
        revenue:      f.val,
        netIncome:    findVal(netA, f.end),
        freeCashFlow: ocf != null && cap != null ? ocf - Math.abs(cap) : null,
      };
    });

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
