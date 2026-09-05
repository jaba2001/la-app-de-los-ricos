// Proxy contract smoke test — verifies every route the frontend calls actually
// exists on the deployed ic-proxy. No JWT needed: an existing protected route
// answers 401 (auth-first), a missing route answers 404, a disallowed FMP/Finnhub
// path answers 403. This catches the class of bug where the frontend calls a path
// the proxy never exposed (three AI/data features shipped broken for exactly this).
//
// Run: node scripts/smoke-proxy.mjs   (uses global fetch, Node 18+)

const BASE = process.env.PROXY_URL ?? "https://ic-proxy-psi.vercel.app";
const SYM = "AAPL";
const today = new Date().toISOString().slice(0, 10);
const ago90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

// [method, path, ...statuses that mean "route exists / contract intact"]
const ROUTES = [
  // FMP
  ["GET", `/api/fmp/quote?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/profile?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/key-metrics-ttm?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/ratios-ttm?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/financial-growth?symbol=${SYM}&limit=1`, 401],
  ["GET", `/api/fmp/historical-price-eod/full?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/income-statement?symbol=${SYM}&limit=5`, 401],
  ["GET", `/api/fmp/balance-sheet-statement?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/cash-flow-statement?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/peers?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/price-target?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/analyst-estimates?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/institutional-holder?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/earnings-surprises?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/insider-trading?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/discounted-cash-flow?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/senate-trading?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/house-disclosure?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/historical-shares-float?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/shares-float?symbol=${SYM}`, 401],
  ["GET", `/api/fmp/search?query=apple`, 401],
  ["GET", `/api/fmp/news?tickers=SPY&limit=1`, 401],
  // Finnhub
  ["GET", `/api/finnhub/quote?symbol=${SYM}`, 401],
  ["GET", `/api/finnhub/company-news?symbol=${SYM}&from=${ago90}&to=${today}`, 401],
  ["GET", `/api/finnhub/news?category=general`, 401],
  ["GET", `/api/finnhub/stock/insider-transactions?symbol=${SYM}`, 401],
  ["GET", `/api/finnhub/stock/metric?symbol=${SYM}&metric=all`, 401],
  ["GET", `/api/finnhub/stock/price-target?symbol=${SYM}`, 401],
  ["GET", `/api/finnhub/stock/earnings?symbol=${SYM}`, 401],
  ["GET", `/api/finnhub/stock/recommendation?symbol=${SYM}`, 401],
  ["GET", `/api/finnhub/stock/short-interest?symbol=${SYM}&from=${ago90}&to=${today}`, 401],
  ["GET", `/api/finnhub/calendar/earnings?symbol=${SYM}&from=${today}&to=${in30}`, 401],
  // Congress (free STOCK-Act S3 route) + short interest + data fallbacks + AI
  ["GET", `/api/congress/${SYM}`, 401],
  ["GET", `/api/short-interest?symbol=${SYM}`, 401],
  ["GET", `/api/edgar?symbol=${SYM}`, 401],
  ["GET", `/api/simfin?symbol=${SYM}`, 401],
  ["GET", `/api/finviz/quote?symbol=${SYM}`, 401],
  // POST-only routes: a GET returns 405 (exists) — proves the path is mounted.
  ["GET", `/api/anthropic/messages`, 401, 405],
  ["GET", `/api/llm`, 401, 405],
];

const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error("timeout")), ms));

let ok = 0, bad = 0;
const fails = [];
for (const [method, path, ...good] of ROUTES) {
  try {
    const res = await Promise.race([fetch(`${BASE}${path}`, { method }), timeout(15000)]);
    if (good.includes(res.status)) {
      ok++;
    } else {
      bad++;
      fails.push(`${res.status} ${method} ${path}  (expected ${good.join("/")})`);
    }
  } catch (e) {
    bad++;
    fails.push(`ERR ${method} ${path}  (${e.message})`);
  }
}

console.log(`\n${bad === 0 ? "✓" : "✗"} proxy contract: ${ok} routes intact, ${bad} broken`);
if (bad > 0) { for (const f of fails) console.error("  ✗ " + f); process.exit(1); }
