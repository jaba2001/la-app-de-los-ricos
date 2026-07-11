// ─────────────────────────────────────────────────────────────────────────────
// PAPER FUND · measure + auto-grade (Phase 8). Replays the fund's own sealed rebalance
// snapshots (sl_paper_fund) forward on free total-return prices: base 100 at inception,
// each month held at the weights of the most recent rebalance, compounded. Computes NAV
// vs SPY, max drawdown, annualized Sharpe, and an honest letter grade, then upserts one
// row to sl_paper_fund_track (a NAV history). No hindsight — only sealed decisions.
// Run: SUPABASE_SERVICE_KEY=… node --experimental-strip-types --no-warnings research/paperfund_measure.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { priceAsOf } from "./prices.mjs";

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const today = new Date().toISOString().slice(0, 10);
const ASSETS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL"];

async function fetchRebalances() {
  if (!SB_KEY) return [];
  const r = await fetch(`${SB_URL}/rest/v1/sl_paper_fund?select=rebalance_date,weights&order=rebalance_date.asc`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  return r.ok ? await r.json() : [];
}

// month-end grid from inception → today
function monthGrid(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + "T00:00:00Z"); d.setUTCDate(1);
  const end = new Date(toISO + "T00:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); }
  if (out[out.length - 1] !== toISO) out.push(toISO);
  return out;
}
const weightsAsOf = (rebs, date) => { let w = rebs[0].weights; for (const r of rebs) { if (r.rebalance_date <= date) w = r.weights; else break; } return w; };

const rebs = await fetchRebalances();
if (!rebs.length) { console.log("  no rebalances yet — run paperfund_rebalance first."); process.exit(0); }

const inception = rebs[0].rebalance_date;
const grid = monthGrid(inception, today);
console.log(`\n  PAPER FUND measure · inception ${inception} · ${grid.length - 1} periods → ${today}`);

// price cache
const px = {};
async function P(a, d) { const k = a + d; if (k in px) return px[k]; const v = await priceAsOf(a, d); px[k] = v; return v; }

let nav = 100, spyNav = 100, b6040Nav = 100, peak = 100, maxDD = 0;
const rets = [];
for (let i = 1; i < grid.length; i++) {
  const d0 = grid[i - 1], d1 = grid[i];
  const w = weightsAsOf(rebs, d0);
  let portRet = 0, ok = false;
  for (const a of ASSETS) {
    const wa = Number(w[a]) || 0; if (wa === 0) continue;
    const p0 = await P(a, d0), p1 = await P(a, d1);
    if (p0 != null && p1 != null && p0 > 0) { portRet += wa * (p1 / p0 - 1); ok = true; }
  }
  const s0 = await P("SPY", d0), s1 = await P("SPY", d1);
  const spyRet = s0 != null && s1 != null && s0 > 0 ? s1 / s0 - 1 : 0;
  // Declared benchmark: static 60/40 (SPY/IEF), rebalanced on the same monthly grid —
  // the same construction the GROWTH_BACKTEST claim is measured against.
  const i0 = await P("IEF", d0), i1 = await P("IEF", d1);
  const iefRet = i0 != null && i1 != null && i0 > 0 ? i1 / i0 - 1 : 0;
  if (ok) { nav *= 1 + portRet; rets.push(portRet); }
  spyNav *= 1 + spyRet;
  b6040Nav *= 1 + (0.6 * spyRet + 0.4 * iefRet);
  peak = Math.max(peak, nav);
  maxDD = Math.min(maxDD, nav / peak - 1);
}

const totalRet = nav / 100 - 1, spyTotalRet = spyNav / 100 - 1, b6040TotalRet = b6040Nav / 100 - 1;
const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(12) : 0;

const grade = rets.length < 2 ? "Accruing"
  : sharpe >= 1.0 ? "A" : sharpe >= 0.7 ? "B" : sharpe >= 0.4 ? "C" : sharpe >= 0 ? "D" : "F";

const row = {
  as_of: today, inception,
  nav: +nav.toFixed(2), spy_nav: +spyNav.toFixed(2),
  bench6040_nav: +b6040Nav.toFixed(2), bench6040_ret: +(b6040TotalRet * 100).toFixed(2),
  total_ret: +(totalRet * 100).toFixed(2), spy_ret: +(spyTotalRet * 100).toFixed(2),
  max_dd: +(maxDD * 100).toFixed(2), sharpe: +sharpe.toFixed(2), grade,
  updated_at: new Date().toISOString(), // refresh on re-measure (PostgREST won't touch it otherwise)
};
console.log(`  NAV ${row.nav} (${row.total_ret >= 0 ? "+" : ""}${row.total_ret}%) vs 60/40 ${row.bench6040_nav} (${row.bench6040_ret}%) vs SPY ${row.spy_nav} (${row.spy_ret}%) · maxDD ${row.max_dd}% · Sharpe ${row.sharpe} · grade ${grade}`);

if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_paper_fund_track?on_conflict=as_of`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed sl_paper_fund_track from the JSON)");
  const { writeFileSync } = await import("fs");
  writeFileSync(new URL("./out/paperfund_track.json", import.meta.url), JSON.stringify(row, null, 2));
}
