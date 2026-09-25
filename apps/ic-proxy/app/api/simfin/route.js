import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';
import { cacheKey, cacheGet, cacheSet } from '../../../lib/cache.js';

export const runtime = 'edge';

const SIMFIN_TTL = 43200; // 12 h — statements don't change intraday
const BASE = 'https://backend.simfin.com/api/v3';
const EMPTY = JSON.stringify({ income: [], balanceSheet: [], cashFlow: [], annualIncome: [], source: 'simfin' });

// SimFin compact format: { columns: [...names], data: [[...row], ...] }
// Values are in thousands of reporting currency — multiply by 1000 for actual.
function colIdx(columns, ...names) {
  for (const n of names) {
    const i = columns.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

function rowVal(columns, row, ...names) {
  const i = colIdx(columns, ...names);
  return i >= 0 && row[i] != null ? row[i] : null;
}

// Convert compact { columns, data } into array of plain objects.
// fieldMap: { outputKey: ['ColName1', 'ColName2', ...fallbacks] }
// Returns sorted newest-first; skips TTM rows.
function parseCompact(stmt, fieldMap) {
  if (!stmt?.columns || !Array.isArray(stmt.data)) return [];
  const { columns, data } = stmt;
  return data
    .map(row => {
      const period = rowVal(columns, row, 'Fiscal Period') ?? '';
      if (!period || period === 'TTM') return null;
      const year   = rowVal(columns, row, 'Fiscal Year')  ?? 0;
      const date   = rowVal(columns, row, 'Report Date')  ?? `${year}-12-31`;
      const out = { date, period: period.toUpperCase(), year };
      for (const [key, names] of Object.entries(fieldMap)) {
        const raw = rowVal(columns, row, ...names);
        // SimFin stores values in thousands of reporting currency
        out[key] = raw != null ? raw * 1000 : null;
      }
      return out;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
}

const QUARTERLY = new Set(['Q1','Q2','Q3','Q4']);
const ANNUAL    = new Set(['FY','ANNUAL','H1','H2']);

export async function serve(request) {
  const CORS = corsHeaders(request, { 'Content-Type': 'application/json' });

  const sfKey = process.env.SIMFIN_KEY ?? '';
  if (!sfKey) {
    // Not configured — return empty gracefully so scora-research keeps working
    return new Response(EMPTY, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
  }

  const url = new URL(request.url);
  const sym = (url.searchParams.get('symbol') ?? '').toUpperCase().trim();

  // Only handles European tickers (contain a dot, e.g. ASML.AS, SAP.XETRA)
  if (!sym || !sym.includes('.')) {
    return new Response(EMPTY, { status: 200, headers: CORS });
  }

  // 12 h shared entry — statements don't change intraday, and SimFin's free tier is the
  // tightest quota of any upstream here (hence the 5/min rate limit above).
  const key = cacheKey('simfin', sym, new URLSearchParams());
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { ...CORS, 'Cache-Control': `public, max-age=${SIMFIN_TTL}, s-maxage=${SIMFIN_TTL}`, 'X-Scora-Cache': 'HIT' },
    });
  }

  // Strip exchange suffix: ASML.AS → ASML, SAP.XETRA → SAP, SHEL.L → SHEL
  const baseTicker = sym.split('.')[0];

  const hdrs = { Authorization: `api-key ${sfKey}` };
  const periods  = 'q1,q2,q3,q4,fy';
  const fyears   = [new Date().getFullYear() - 3, new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].join(',');

  try {
    const mkUrl = (stmt) =>
      `${BASE}/companies/statements/compact?ticker=${encodeURIComponent(baseTicker)}&statements=${stmt}&period=${periods}&fyear=${fyears}`;

    const [plRes, bsRes, cfRes] = await Promise.all([
      fetch(mkUrl('pl'), { headers: hdrs }),
      fetch(mkUrl('bs'), { headers: hdrs }),
      fetch(mkUrl('cf'), { headers: hdrs }),
    ]);

    // Parse JSON, guarding non-JSON errors
    const safeJson = async (r) => { try { return r.ok ? await r.json() : null; } catch { return null; } };
    const [plJson, bsJson, cfJson] = await Promise.all([
      safeJson(plRes), safeJson(bsRes), safeJson(cfRes),
    ]);

    // Top-level is an array; first element is our company
    const pl = Array.isArray(plJson) ? plJson[0] : plJson;
    const bs = Array.isArray(bsJson) ? bsJson[0] : bsJson;
    const cf = Array.isArray(cfJson) ? cfJson[0] : cfJson;

    if (!pl?.found && !bs?.found && !cf?.found) {
      return new Response(EMPTY, { status: 200, headers: { ...CORS, 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } });
    }

    const currency = pl?.currency ?? bs?.currency ?? cf?.currency ?? 'EUR';

    // ── Income statement (quarterly) ─────────────────────────────────────────
    const plRows = parseCompact(pl, {
      revenue:         ['Revenue'],
      grossProfit:     ['Gross Profit'],
      operatingIncome: ['Operating Income (Loss)'],
      netIncome:       ['Net Income', 'Net Income (Common)'],
      eps:             ['Earnings Per Share (Diluted)', 'Earnings Per Share (Basic)'],
    });

    const income = plRows.filter(r => QUARTERLY.has(r.period)).slice(0, 12).map(r => ({
      date:            r.date,
      revenue:         r.revenue,
      grossProfit:     r.grossProfit,
      operatingIncome: r.operatingIncome,
      netIncome:       r.netIncome,
      eps:             r.eps,
    }));

    // ── Annual income (for HistoricalFinancials chart) ────────────────────────
    const annualIncome = plRows.filter(r => ANNUAL.has(r.period)).slice(0, 5).map(r => ({
      date:         r.date,
      calendarYear: r.year,
      revenue:      r.revenue,
      netIncome:    r.netIncome,
      freeCashFlow: null,
    }));

    // ── Balance sheet ─────────────────────────────────────────────────────────
    const bsRows = parseCompact(bs, {
      totalAssets:             ['Total Assets'],
      cashAndCashEquivalents:  ['Cash, Cash Equivalents & Short Term Investments', 'Cash & Cash Equivalents'],
      totalDebt:               ['Long Term Debt', 'Total Debt'],
      totalStockholdersEquity: ['Total Equity'],
      totalLiabilities:        ['Total Liabilities'],
    });

    const balanceSheet = bsRows.filter(r => QUARTERLY.has(r.period) || ANNUAL.has(r.period)).slice(0, 8).map(r => ({
      date:                    r.date,
      totalAssets:             r.totalAssets,
      cashAndCashEquivalents:  r.cashAndCashEquivalents,
      totalDebt:               r.totalDebt,
      totalStockholdersEquity: r.totalStockholdersEquity,
      totalLiabilities:        r.totalLiabilities,
    }));

    // ── Cash flow ─────────────────────────────────────────────────────────────
    const cfRows = parseCompact(cf, {
      operatingCashFlow:  ['Net Cash from Operating Activities'],
      // SimFin CapEx is stored as negative (cash outflow) → Math.abs()
      capitalExpenditure: ['Change in Fixed Assets & Intangibles', 'Capital Expenditures'],
    });

    const cashFlow = cfRows.filter(r => QUARTERLY.has(r.period)).slice(0, 8).map(r => {
      const ocf = r.operatingCashFlow;
      const cap = r.capitalExpenditure != null ? Math.abs(r.capitalExpenditure) : null;
      return {
        date:               r.date,
        operatingCashFlow:  ocf,
        capitalExpenditure: cap,
        freeCashFlow:       ocf != null && cap != null ? ocf - cap : null,
      };
    });

    const body = JSON.stringify({ income, balanceSheet, cashFlow, annualIncome, currency, source: 'simfin', ticker: baseTicker });
    await cacheSet(key, { status: 200, body }, SIMFIN_TTL);

    return new Response(
      body,
      { status: 200, headers: { ...CORS, 'Cache-Control': `public, max-age=${SIMFIN_TTL}, s-maxage=${SIMFIN_TTL}`, 'X-Scora-Cache': 'MISS' } }
    );
  } catch (err) {
    // Log the detail server-side; don't echo upstream internals back to the caller.
    console.error('simfin fetch failed:', err);
    return new Response(JSON.stringify({ error: 'SimFin fetch failed' }), {
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
  const rl = await checkRateLimit('simfin', user.id, 5, 60, request);
  if (rl) return rl;
  return serve(request);
}

export async function OPTIONS(request) {
  return preflight(request);
}
