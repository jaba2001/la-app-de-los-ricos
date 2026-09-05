// Proxy for the CFTC Commitments of Traders (Disaggregated Futures-and-Options Combined,
// Socrata dataset kh3c-gbw2). Free, no key, weekly. Returns the last ~10 weekly observations
// of managed-money long/short + open interest for a metal, normalized for the client. Used by
// the Metals cockpit as the honest "institutional positioning" read. Auth-gated + 6h cache.
import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';
import { cacheKey, cacheGet, cacheSet } from '../../../lib/cache.js';

export const runtime = 'edge';

const COT_TTL = 21600; // 6 h — COT prints weekly (Friday)

// CFTC contract-market codes → metal.
const CODES = {
  gold:     { code: '088691', name: 'Gold',     unit: '100 oz' },
  silver:   { code: '084691', name: 'Silver',   unit: '5,000 oz' },
  platinum: { code: '076651', name: 'Platinum', unit: '50 oz' },
  copper:   { code: '085692', name: 'Copper',   unit: '25,000 lb' },
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function fetchCot(code) {
  const base = 'https://publicreporting.cftc.gov/resource/kh3c-gbw2.json';
  const qs =
    `?cftc_contract_market_code=${encodeURIComponent(code)}` +
    `&%24select=${encodeURIComponent('report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,open_interest_all')}` +
    `&%24order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}` +
    `&%24limit=10`;
  const r = await fetch(base + qs, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const raw = await r.json();
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => ({
    date: String(o.report_date_as_yyyy_mm_dd || '').slice(0, 10),
    managedLong: num(o.m_money_positions_long_all),
    managedShort: num(o.m_money_positions_short_all),
    openInterest: num(o.open_interest_all),
  })).filter((x) => x.date);
}

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('cot', user.id, 30, 60, request); if (rl) return rl;

  const market = (new URL(request.url).searchParams.get('market') || 'all').toLowerCase();
  const headers = corsHeaders(request, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=21600, s-maxage=21600', // 6h — COT prints weekly (Fri)
  });

  // COT prints once a week (Friday), so a 6 h shared cache is very safe — and `market=all`
  // fans out to one CFTC request per metal, which is exactly what we don't want repeated
  // per user.
  const key = cacheKey('cot', market, new URLSearchParams());
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, { status: hit.status, headers: { ...headers, 'X-Scora-Cache': 'HIT' } });
  }

  try {
    if (market === 'all') {
      const keys = Object.keys(CODES);
      const results = await Promise.all(keys.map(async (k) => {
        const rows = await fetchCot(CODES[k].code);
        return [k, { market: k, name: CODES[k].name, unit: CODES[k].unit, rows }];
      }));
      const body = JSON.stringify(Object.fromEntries(results));
      await cacheSet(key, { status: 200, body }, COT_TTL);
      return new Response(body, { status: 200, headers: { ...headers, 'X-Scora-Cache': 'MISS' } });
    }
    const def = CODES[market];
    if (!def) return new Response(JSON.stringify({ error: 'Unknown market', market }), { status: 400, headers });
    const rows = await fetchCot(def.code);
    const body = JSON.stringify({ market, name: def.name, unit: def.unit, rows });
    await cacheSet(key, { status: 200, body }, COT_TTL);
    return new Response(body, { status: 200, headers: { ...headers, 'X-Scora-Cache': 'MISS' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'CFTC fetch failed', detail: String(e?.message ?? e) }), { status: 502, headers });
  }
}

export async function OPTIONS(request) {
  return preflight(request);
}
