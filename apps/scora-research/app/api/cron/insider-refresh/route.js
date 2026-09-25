// Insider top-buyers leaderboard.
// OpenInsider blocks Vercel datacenter IPs (both Edge and Node fetches fail),
// so we build the market-wide leaderboard from FMP's stable API instead
// (insider-trading/latest = recent Form 4s across all issuers). FMP_KEY is
// already configured in this project's Vercel env for the /api/fmp proxy.
import { assertCron } from '../../../../lib/server/cron.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;

  if (!process.env.FMP_KEY)
    return new Response(JSON.stringify({ error: 'FMP_KEY missing' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });

  // symbol -> { usd, insiders:Set }
  const agg = new Map();
  let pagesFetched = 0;
  let fmpError = null;

  try {
    for (let page = 0; page < 8; page++) {
      const u = `https://financialmodelingprep.com/stable/insider-trading/latest?page=${page}&limit=100&apikey=${process.env.FMP_KEY}`;
      const r = await fetch(u, { headers: { Accept: 'application/json' } });
      if (!r.ok) { fmpError = 'FMP HTTP ' + r.status; break; }
      const data = await r.json();
      if (!Array.isArray(data) || data.length === 0) break;
      pagesFetched++;
      for (const t of data) {
        // open-market purchases only: acquisition (A) + Purchase code
        const isBuy =
          t.acquisitionOrDisposition === 'A' &&
          /purchase|p-purchase/i.test(t.transactionType || '');
        if (!isBuy) continue;
        const sym = (t.symbol || '').toUpperCase();
        if (!/^[A-Z.\-]{1,6}$/.test(sym)) continue;
        const shares = Number(t.securitiesTransacted) || 0;
        const price = Number(t.price) || 0;
        const usd = shares * price;
        if (usd <= 0) continue;
        const e = agg.get(sym) || { usd: 0, insiders: new Set() };
        e.usd += usd;
        if (t.reportingName) e.insiders.add(t.reportingName);
        agg.set(sym, e);
      }
    }
  } catch (e) {
    fmpError = e.message;
  }

  if (agg.size === 0) {
    return new Response(
      JSON.stringify({ error: 'no insider buys parsed', fmp_error: fmpError, pagesFetched }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ranked = [...agg.entries()]
    .map(([ticker, v]) => ({ ticker, usd: v.usd, num_insiders: v.insiders.size }))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 50);

  const month = new Date().toISOString().slice(0, 7) + '-01';
  const rows = ranked.map((r, i) => ({
    month,
    rank: i + 1,
    ticker: r.ticker,
    sector: null,
    net_insider_buying_usd: r.usd,
    num_insiders: r.num_insiders,
    score: Math.min(100, Math.log10(r.usd) * 20),
  }));

  const sbResp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/smart_money_top_buyers?on_conflict=month,rank`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );
  const sbBody = sbResp.ok ? undefined : await sbResp.text();

  return new Response(
    JSON.stringify({
      source: 'fmp',
      pagesFetched,
      scraped: rows.length,
      supabase_status: sbResp.status,
      supabase_error: sbBody,
      fmp_error: fmpError,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
