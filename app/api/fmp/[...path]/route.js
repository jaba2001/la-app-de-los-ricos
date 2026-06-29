import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';

export const runtime = 'edge';

const ALLOWED = new Set([
  'quote','profile','key-metrics-ttm','ratios-ttm',
  'historical-price-eod/full','income-statement','news',
  'price-target-consensus','analyst-estimates','upgrades-downgrades-consensus',
  'discounted-cash-flow','balance-sheet-statement','price-target',
  'cash-flow-statement','peers','historical-dividends',
  'institutional-holder','historical-shares-float',
  'key-metrics','financial-growth','earnings-surprises',
  'search','senate-trading','house-disclosure','insider-trading',
]);

export async function GET(request, { params }) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('fmp', user.id, 40, 60); if (rl) return rl;
  const path = params.path.join('/');
  if (![...ALLOWED].some(p => path === p || path.startsWith(p + '/'))) {
    return new Response(JSON.stringify({error:'Endpoint not allowed', path}), {status:403, headers:{'Content-Type':'application/json'}});
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  if (symbol && !/^[A-Z.\-]{1,15}$/.test(symbol)) {
    return new Response(JSON.stringify({error:'Invalid symbol'}), {status:400, headers:{'Content-Type':'application/json'}});
  }

  if (!process.env.FMP_KEY) {
    return new Response(JSON.stringify({error:'Server misconfigured: FMP_KEY missing'}), {status:500, headers:{'Content-Type':'application/json'}});
  }

  const fmpBase = path === 'news'
    ? `https://financialmodelingprep.com/api/v3/stock_news`
    : `https://financialmodelingprep.com/stable/${path}`;
  const upstream = new URL(fmpBase);
  for (const [k,v] of url.searchParams) upstream.searchParams.set(k, v);
  upstream.searchParams.set('apikey', process.env.FMP_KEY);

  const res = await fetch(upstream.toString(), { headers: { 'Accept': 'application/json' } });
  const body = await res.text();

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

  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
