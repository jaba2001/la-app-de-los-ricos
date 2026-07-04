// ─────────────────────────────────────────────────────────────────────────────
// PROOF-OF-CONCEPT: point-in-time Scora score, reconstructed for a past date from
// 100% free data, then measured against realized forward return vs SPY.
//
// Proves the crux of the whole track-record system:
//   1. Fundamentals as KNOWN on asOf (SEC EDGAR, filed<=asOf) — zero look-ahead
//   2. Price + momentum as of asOf (FMP historical)
//   3. The SAME production scoring.ts computes the score (no re-implementation)
//   4. Forward return asOf→fwd vs SPY = the alpha the score would have earned
//
// Run: node --experimental-strip-types --no-warnings research/poc.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { tickerToCik, fundamentalsAsOf } from "./edgar.mjs";
import { priceAsOf, momentum } from "./prices.mjs";
import { calcScores, getRating } from "../lib/scoring.ts";

const AS_OF = process.argv[2] || "2021-05-28";
const FWD   = process.argv[3] || "2022-05-27"; // ~1 year forward
const TICKERS = ["AAPL", "MSFT", "NVDA", "JPM", "KO", "XOM"];

const pct = (v, d = 1) => (v == null ? "  —  " : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
const num = (v, d = 1) => (v == null ? "—" : v.toFixed(d));

async function scoreAsOf(ticker) {
  const cik = await tickerToCik(ticker);
  if (!cik) return null;
  const f = await fundamentalsAsOf(cik, AS_OF);
  const price = await priceAsOf(ticker, AS_OF);
  const mom = await momentum(ticker, AS_OF);
  if (price == null || f.revTTM == null) return { ticker, insufficient: true, f, price };

  const mcap = f.shares && price ? price * f.shares : null;
  const inputs = {
    pe:            mcap && f.niTTM > 0 ? mcap / f.niTTM : null,
    pb:            mcap && f.equity > 0 ? mcap / f.equity : null,
    debtEquity:    f.equity > 0 ? f.debt / f.equity : null,
    currentRatio:  f.curL > 0 ? f.curA / f.curL : null,
    roe:           f.equity > 0 ? (f.niTTM / f.equity) * 100 : null,
    roa:           f.assets > 0 ? (f.niTTM / f.assets) * 100 : null,
    netMargin:     f.revTTM > 0 ? (f.niTTM / f.revTTM) * 100 : null,
    grossMargin:   f.revTTM > 0 && f.gpTTM != null ? (f.gpTTM / f.revTTM) * 100 : null,
    revenueGrowth: f.revPrevTTM > 0 ? (f.revTTM / f.revPrevTTM - 1) * 100 : null,
    epsGrowth:     f.niPrevTTM > 0 ? (f.niTTM / f.niPrevTTM - 1) * 100 : null,
    priceChange1M: mom.m1, priceChange3M: mom.m3, priceChange6M: mom.m6,
    marketCap:     mcap,
    // sector left null → absolute valuation bands (SIC→sector mapping is a later step)
  };
  const s = calcScores(inputs);
  return { ticker, cik, f, price, inputs, score: s, ic: s.total }; // no macro tilt in PoC (regime recompute is the next module)
}

const spyAt = await priceAsOf("SPY", AS_OF);
const spyFwd = await priceAsOf("SPY", FWD);
const spyRet = spyAt && spyFwd ? (spyFwd / spyAt - 1) * 100 : null;

console.log(`\n  SCORA — point-in-time score as of ${AS_OF}, forward return to ${FWD}`);
console.log(`  SPY: $${num(spyAt, 2)} → $${num(spyFwd, 2)}  (${pct(spyRet)}%)\n`);
console.log("  Ticker  Score  Rating       PE     ROE   RevGr   NetMgr  | filed≤asOf   fwd%    vs SPY");
console.log("  " + "─".repeat(84));

const results = [];
for (const t of TICKERS) {
  const r = await scoreAsOf(t);
  if (!r || r.insufficient) { console.log(`  ${t.padEnd(7)} insufficient EDGAR/price coverage as of ${AS_OF}`); continue; }
  const pf = await priceAsOf(t, FWD);
  const fwd = pf && r.price ? (pf / r.price - 1) * 100 : null;
  const alpha = fwd != null && spyRet != null ? fwd - spyRet : null;
  const rt = getRating(r.ic);
  results.push({ ...r, fwd, alpha });
  console.log(
    `  ${t.padEnd(7)}${String(r.score.total).padStart(4)}   ${rt.label.padEnd(11)}` +
    `${num(r.inputs.pe).padStart(6)} ${num(r.inputs.roe).padStart(6)}% ${pct(r.inputs.revenueGrowth).padStart(6)}% ${num(r.inputs.netMargin).padStart(6)}%  | ` +
    `${(r.f.asOfLatestFiling ?? "—").padEnd(10)} ${pct(fwd).padStart(6)}%  ${pct(alpha).padStart(6)}%`
  );
}

// Bucket summary — the headline metric
const buy = results.filter((r) => r.ic >= 60 && r.alpha != null);
const rest = results.filter((r) => r.ic < 60 && r.alpha != null);
const avg = (a) => (a.length ? a.reduce((s, r) => s + r.alpha, 0) / a.length : null);
console.log("  " + "─".repeat(84));
console.log(`\n  Bucket score≥60: n=${buy.length}  avg alpha ${pct(avg(buy))}%   |   score<60: n=${rest.length}  avg alpha ${pct(avg(rest))}%`);
console.log(`  (PoC: 6 names, 1 date, no macro tilt, absolute bands — proves the pipeline, not the edge.)\n`);
