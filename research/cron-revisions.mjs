// LIVE monthly analyst-REVISION tracking cron — the free "measure-before-you-pay" harness.
// We proved the deep point-in-time estimate archive is the paid product (Finnhub free gives
// only ~4 months of recommendation history), so we cannot BACKTEST revision alpha for free.
// Instead we accumulate it FORWARD: each month, snapshot every name's analyst consensus level
// + its recent revision momentum + price into sl_revisions, and once ≥2 monthly snapshots
// exist, compute the live cross-sectional IC of the revision signal vs next-month returns.
// After ~6-12 months this says — with our own universe's evidence — whether paying for a
// proper PIT estimate feed (~$100s/mo) is justified. All free: Finnhub recommendation trends.
//   node --experimental-strip-types --no-warnings research/cron-revisions.mjs [--dry]
// Env: FINNHUB_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (writes); SUPABASE_ANON_KEY ok for reads.
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { priceAsOf } from "./prices.mjs";
import { CURATED } from "./universe.mjs";

const DRY = process.argv.includes("--dry");
const today = new Date().toISOString().slice(0, 10);
const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_READ_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const FINNHUB = process.env.FINNHUB_KEY;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── stats ───────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j; } return r; }
function spearman(x, y) { if (x.length < 5) return null; const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : null; }

// Consensus level from a recommendation-trend row: bullish = +, bearish = − (range ~[-2,2]).
const consOf = (r) => { const n = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0); return n ? (2 * (r.strongBuy || 0) + (r.buy || 0) - (r.sell || 0) - 2 * (r.strongSell || 0)) / n : null; };

if (!FINNHUB) { console.error("FINNHUB_KEY missing — cannot pull recommendation trends."); process.exit(1); }

// ── pull the revision signal for the universe ─────────────────────────────────
const rows = [];
for (const t of CURATED) {
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${t}&token=${FINNHUB}`, { headers: { Accept: "application/json" } });
    if (!res.ok) { console.error(`  ${t}: finnhub ${res.status}`); await sleep(1100); continue; }
    const trend = await res.json();
    if (!Array.isArray(trend) || trend.length === 0) { await sleep(1100); continue; }
    trend.sort((a, b) => (a.period < b.period ? 1 : -1)); // newest first
    const consNow = consOf(trend[0]);
    const consOld = consOf(trend[trend.length - 1]);
    const price = await priceAsOf(t, today);
    if (consNow == null || price == null) { await sleep(1100); continue; }
    const nAnalysts = (trend[0].strongBuy || 0) + (trend[0].buy || 0) + (trend[0].hold || 0) + (trend[0].sell || 0) + (trend[0].strongSell || 0);
    rows.push({ snap_date: today, ticker: t, cons: +consNow.toFixed(4), rev: consOld != null ? +(consNow - consOld).toFixed(4) : null, n_analysts: nAnalysts, price: +price.toFixed(4) });
    await sleep(1100); // free tier: ≤60/min
  } catch (e) { console.error(`  ${t}: ${e.message}`); await sleep(1100); }
}
console.log(`revision snapshot ${today}: ${rows.length}/${CURATED.length} names (cons + 3m revision + price)`);

// ── write the snapshot ────────────────────────────────────────────────────────
if (DRY || !process.env.SUPABASE_SERVICE_KEY) {
  writeFileSync(join(OUT, "revisions_snap.json"), JSON.stringify(rows, null, 2));
  console.log(rows.slice(0, 12).map((r) => `  ${r.ticker.padEnd(6)} cons ${String(r.cons).padStart(6)}  rev ${String(r.rev).padStart(6)}  n=${String(r.n_analysts).padStart(2)}  $${r.price}`).join("\n"));
  console.log(`  → wrote research/out/revisions_snap.json (${rows.length} rows)`);
  if (!DRY) console.error("SUPABASE_SERVICE_KEY not set — snapshot not written to DB.");
} else {
  const res = await fetch(`${SB_URL}/rest/v1/sl_revisions?on_conflict=snap_date,ticker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  console.log(`supabase sl_revisions: ${res.status} ${res.ok ? "ok" : await res.text()}`);
  if (!res.ok) process.exit(1);
}

// ── measure: live cross-sectional IC of the revision signal, from accumulated snapshots ──
// Pull the full history, join consecutive month pairs on ticker, compute forward return and
// the Spearman IC of rev→fwd and cons→fwd. Needs ≥2 distinct snapshot dates to say anything.
try {
  const hist = await fetch(`${SB_URL}/rest/v1/sl_revisions?select=snap_date,ticker,cons,rev,price&order=snap_date.asc`, { headers: { apikey: SB_READ_KEY, Authorization: `Bearer ${SB_READ_KEY}` } });
  const all = hist.ok ? await hist.json() : [];
  const dates = [...new Set(all.map((r) => r.snap_date))].sort();
  if (dates.length < 2) {
    console.log(`\n  live IC: pending — ${dates.length} monthly snapshot(s) so far; need ≥2 to measure the first forward IC (next month).`);
  } else {
    const byDate = new Map(dates.map((d) => [d, new Map(all.filter((r) => r.snap_date === d).map((r) => [r.ticker, r]))]));
    const revICs = [], consICs = [];
    for (let i = 0; i < dates.length - 1; i++) {
      const a = byDate.get(dates[i]), b = byDate.get(dates[i + 1]);
      const rev = [], cons = [], fwd = [];
      for (const [tk, r0] of a) { const r1 = b.get(tk); if (!r1 || r0.price == null || r1.price == null || r0.price <= 0) continue; const f = (r1.price / r0.price - 1) * 100; if (r0.rev != null) { rev.push(r0.rev); } cons.push(r0.cons); fwd.push(f); }
      // rev/cons aligned to fwd by construction of the loop above only when pushed together:
      const revPairs = []; const consPairs = [];
      for (const [tk, r0] of a) { const r1 = b.get(tk); if (!r1 || r0.price == null || r1.price == null || r0.price <= 0) continue; const f = (r1.price / r0.price - 1) * 100; if (r0.rev != null) revPairs.push([r0.rev, f]); if (r0.cons != null) consPairs.push([r0.cons, f]); }
      const rIC = spearman(revPairs.map((p) => p[0]), revPairs.map((p) => p[1])); if (rIC != null) revICs.push(rIC);
      const cIC = spearman(consPairs.map((p) => p[0]), consPairs.map((p) => p[1])); if (cIC != null) consICs.push(cIC);
    }
    const fmt = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(3));
    console.log(`\n  ── live revision IC (${dates.length} snapshots, ${dates.length - 1} forward month(s)) ──`);
    console.log(`  revision-momentum IC: ${fmt(mean(revICs))}   consensus-level IC: ${fmt(mean(consICs))}   (bar to justify paying: ≳ +0.03)`);
    console.log(`  window: ${dates[0]} → ${dates.at(-1)}`);
  }
} catch (e) { console.error(`  measure step: ${e.message}`); }
