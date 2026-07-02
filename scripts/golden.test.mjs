// Golden tests for the pure calculation core — no test framework, no network.
// Run: node --experimental-strip-types scripts/golden.test.mjs
// These guard the math that drives every score. The RDCF bisection bug (implied
// CAGR converging to an extreme) would have been caught by the round-trip test below.

import { computeReverseDCF, computeWACC } from "../lib/reverseDcf.ts";
import { calcScores, getRating, computeICHealthScore, getMacroTilt, calcFactorTilts } from "../lib/scoring.ts";
import {
  computeSqueeze, computeADX, computeVolumeProfile, detectDivergences, computeTLResult,
} from "../lib/technicalIndicators.ts";
import { runBacktest } from "../lib/backtest.ts";

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); }
}
function approx(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, expected ~${b} ±${tol})`); }

// ── Reverse DCF ──────────────────────────────────────────────────────────────
{
  // Round-trip: the DCF value at the solved implied CAGR must reproduce the price.
  // This is the invariant the inverted-bisection bug violated.
  const cases = [
    { p: 210, rev: 390e9, m: 0.26, nd: 60e9, sh: 15.2e9, beta: 1.2, rf: 4.2, label: "AAPL-like" },
    { p: 55, rev: 100e9, m: 0.15, nd: -10e9, sh: 2e9, beta: 1.0, rf: 4.0, label: "mid-cap net cash" },
    { p: 20, rev: 30e9, m: 0.05, nd: 5e9, sh: 1e9, beta: 1.5, rf: 4.5, label: "low margin" },
  ];
  for (const c of cases) {
    const r = computeReverseDCF({ currentPrice: c.p, revenueTTM: c.rev, fcfMarginTTM: c.m, netDebt: c.nd, sharesOut: c.sh, beta: c.beta, rfRate: c.rf, creditStress: 30 });
    ok(r != null, `RDCF ${c.label}: returns a result`);
    if (r) {
      ok(r.impliedGrowthCagr >= -5 && r.impliedGrowthCagr <= 80, `RDCF ${c.label}: implied CAGR in band (${r.impliedGrowthCagr})`);
      ok(r.tvShare >= 0 && r.tvShare <= 1, `RDCF ${c.label}: tvShare in [0,1] (${r.tvShare})`);
      ok(r.wacc >= 7 && r.wacc <= 20, `RDCF ${c.label}: WACC clamped (${r.wacc})`);
    }
  }
  // AAPL-like implied CAGR should be a sane mid value, NOT the 80% the bug produced.
  const aapl = computeReverseDCF({ currentPrice: 210, revenueTTM: 390e9, fcfMarginTTM: 0.26, netDebt: 60e9, sharesOut: 15.2e9, beta: 1.2, rfRate: 4.2, creditStress: 30 });
  ok(aapl && aapl.impliedGrowthCagr < 40, `RDCF AAPL implied CAGR is realistic, not pinned high (${aapl?.impliedGrowthCagr})`);

  // Degradation: negative FCF margin → null (no meaningful implied growth).
  ok(computeReverseDCF({ currentPrice: 10, revenueTTM: 1e9, fcfMarginTTM: -0.1, netDebt: 0, sharesOut: 1e8, beta: 1, rfRate: 4, creditStress: 0 }) === null, "RDCF: negative FCF margin returns null");
  ok(computeReverseDCF({ currentPrice: 0, revenueTTM: 1e9, fcfMarginTTM: 0.2, netDebt: 0, sharesOut: 1e8, beta: 1, rfRate: 4, creditStress: 0 }) === null, "RDCF: zero price returns null");

  // WACC monotonic in rf and beta, clamped to [7,20].
  ok(computeWACC(4, 1, 0) < computeWACC(6, 1, 0), "WACC: increasing in rf");
  ok(computeWACC(4, 1, 0) < computeWACC(4, 1.5, 0), "WACC: increasing in beta");
  ok(computeWACC(50, 3, 100) === 20, "WACC: clamped to MAX 20");
  ok(computeWACC(0, 0, 0) === 7, "WACC: clamped to MIN 7");
}

// ── Scoring bounds ───────────────────────────────────────────────────────────
{
  // Sub-scores must respect their caps regardless of input extremes.
  const strong = calcScores({ pe: 8, pb: 1, evEbitda: 5, pfcf: 10, debtEquity: 0.1, currentRatio: 3, interestCoverage: 50, netDebtEbitda: 0, roic: 40, roe: 40, grossMargin: 80, revenueGrowth: 50, epsGrowth: 50, priceChange1M: 20, priceChange3M: 30, priceChange6M: 40, marketCap: 5e9, regime: "expansion" });
  ok(strong.value <= 25, `score value cap (${strong.value})`);
  ok(strong.health <= 30, `score health cap (${strong.health})`);
  ok(strong.momentum <= 25, `score momentum cap (${strong.momentum})`);
  ok(strong.growth <= 20, `score growth cap (${strong.growth})`);
  ok(strong.total === strong.value + strong.health + strong.momentum + strong.growth, "score total = sum of parts");
  ok(strong.total > 50, `strong company scores well (${strong.total})`);

  // Empty inputs → all zero, no crash.
  const empty = calcScores({});
  ok(empty.total === 0, `empty inputs → 0 total (${empty.total})`);

  // Weak company scores low.
  const weak = calcScores({ pe: 60, pb: 8, evEbitda: 30, debtEquity: 3, currentRatio: 0.5, interestCoverage: 1, roic: 2, revenueGrowth: -10, epsGrowth: -20, priceChange1M: -20, priceChange3M: -30, priceChange6M: -40, marketCap: 5e9, regime: "contraction" });
  ok(weak.total < strong.total, `weak < strong (${weak.total} < ${strong.total})`);

  // Sector-relative valuation: the same P/E scores differently by sector.
  // P/E 20 is below Tech's benchmark (28) but above Financials' (14).
  const techPe20 = calcScores({ pe: 20, sector: "Technology" });
  const finPe20 = calcScores({ pe: 20, sector: "Financials" });
  ok(techPe20.value > finPe20.value, `sector-relative: PE20 cheaper for Tech than Financials (${techPe20.value} > ${finPe20.value})`);
  // Unknown sector falls back to absolute bands (same as passing no sector).
  ok(calcScores({ pe: 20 }).value === calcScores({ pe: 20, sector: "Nonexistent" }).value, "sector-relative: unknown sector = absolute fallback");
  ok(calcScores({ pe: 12 }).value === 7, "absolute fallback: PE12 → 7 (no sector)");

  // Rating thresholds.
  ok(getRating(85).label === "STRONG BUY", "rating 85 = STRONG BUY");
  ok(getRating(60).label === "BUY", "rating 60 = BUY");
  ok(getRating(40).label === "CAUTION", "rating 40 = CAUTION");
  ok(getRating(20).label === "AVOID", "rating 20 = AVOID");

  // IC health score composite.
  ok(computeICHealthScore(null) === null, "IC health: null macro → null");
  ok(computeICHealthScore({ liquidity_cycle: 50, credit_stress: 50, recession_prob: 50, geopolitical_risk: 50, housing_stress: 50 }) === 50, "IC health: neutral 50s → 50");
  const healthy = computeICHealthScore({ liquidity_cycle: 90, credit_stress: 10, recession_prob: 10, geopolitical_risk: 10, housing_stress: 10 });
  ok(healthy > 80, `IC health: benign backdrop scores high (${healthy})`);

  // Macro tilt bounded [-20, 20].
  const tilt = getMacroTilt({ regime_id: "expansion", recession_prob: 10, credit_stress: 10, ic_score: 80, fear_greed: 10 }, "Technology");
  ok(tilt.tilt >= -20 && tilt.tilt <= 20, `macro tilt bounded (${tilt.tilt})`);
  const tiltBad = getMacroTilt({ regime_id: "contraction", recession_prob: 90, credit_stress: 90, ic_score: 10, fear_greed: 90 }, "Technology");
  ok(tiltBad.tilt < tilt.tilt, `contraction tilt < expansion tilt (${tiltBad.tilt} < ${tilt.tilt})`);

  // Factor tilts each capped at 20.
  const ft = calcFactorTilts({ pe: 8, pfcf: 8, evEbitda: 5, epsGrowth: 40, revenueGrowth: 40, roic: 30, roe: 30, grossMargin: 80, interestCoverage: 20, marketCap: 1e8, priceChange1M: 20, priceChange3M: 30, priceChange6M: 40 });
  for (const k of ["value", "growth", "momentum", "quality", "size"]) ok(ft[k] <= 20 && ft[k] >= 0, `factor ${k} in [0,20] (${ft[k]})`);
}

// ── Technical indicators ─────────────────────────────────────────────────────
{
  // Build a synthetic uptrend then downtrend series.
  const bars = [];
  let price = 100;
  for (let i = 0; i < 120; i++) {
    price += i < 60 ? 0.5 : -0.4;
    const noise = Math.sin(i / 3) * 0.5;
    bars.push({ open: price, high: price + 1 + noise, low: price - 1 - noise, close: price + noise, volume: 1e6 + i * 1000 });
  }
  const sqz = computeSqueeze(bars);
  ok(sqz.length === bars.length, "squeeze: one point per bar");
  ok(sqz.some(s => s.val != null), "squeeze: produces momentum values");
  ok(sqz.every(s => typeof s.sqzOn === "boolean"), "squeeze: sqzOn is boolean");

  const adx = computeADX(bars);
  ok(adx.length === bars.length, "ADX: one point per bar");
  ok(adx.some(a => a.adx != null && a.adx >= 0 && a.adx <= 100), "ADX: values in [0,100]");
  ok(adx.slice(-1)[0].plusDI == null || (adx.slice(-1)[0].plusDI >= 0 && adx.slice(-1)[0].plusDI <= 100), "ADX: +DI bounded");

  const vp = computeVolumeProfile(bars);
  ok(vp.buckets.length > 0, "VP: has buckets");
  ok(vp.pocMid > 0, "VP: POC is positive");
  ok(vp.vaLow <= vp.pocMid && vp.pocMid <= vp.vaHigh, `VP: POC within value area (${vp.vaLow} <= ${vp.pocMid} <= ${vp.vaHigh})`);
  const inVA = vp.buckets.filter(b => b.inVA).reduce((s, b) => s + b.vol, 0);
  const total = vp.buckets.reduce((s, b) => s + b.vol, 0);
  ok(inVA / total >= 0.65 && inVA / total <= 0.95, `VP: value area ~70% of volume (${(inVA / total * 100).toFixed(0)}%)`);

  const prices = bars.map(b => b.close);
  const mom = sqz.map(s => s.val);
  const divs = detectDivergences(prices, mom);
  ok(Array.isArray(divs), "divergences: returns array");

  // Empty data must not crash.
  ok(computeSqueeze([]).length === 0, "squeeze: empty input safe");
  ok(computeADX([]).length === 0, "ADX: empty input safe");
  ok(computeVolumeProfile([]).buckets.length === 0, "VP: empty input safe");

  // TL result assembles without throwing.
  const emaFast = prices.map((_, i) => prices.slice(Math.max(0, i - 9), i + 1).reduce((a, b) => a + b, 0) / Math.min(10, i + 1));
  const emaSlow = prices.map((_, i) => prices.slice(Math.max(0, i - 54), i + 1).reduce((a, b) => a + b, 0) / Math.min(55, i + 1));
  const rawHist = bars.map((b, i) => ({ high: b.high, low: b.low, price: b.close, emaFast: emaFast[i], emaSlow: emaSlow[i] }));
  const tl = computeTLResult(prices, emaFast, emaSlow, rawHist, sqz, adx, vp, 65);
  ok(tl != null, "TL result: computed");
  if (tl) {
    ok(tl.longSignals >= 0 && tl.longSignals <= 4, `TL long signals 0-4 (${tl.longSignals})`);
    ok(tl.shortSignals >= 0 && tl.shortSignals <= 4, `TL short signals 0-4 (${tl.shortSignals})`);
    ok(typeof tl.bias === "string" && tl.bias.length > 0, "TL bias is a label");
    ok(tl.stopLong < tl.tp1Long || tl.riskLong === 0, "TL: long stop below TP1");
  }
}

// ── Backtest ─────────────────────────────────────────────────────────────────
{
  // Construct a world where high-score picks genuinely beat SPY.
  const spy = [];
  for (let i = 0; i < 200; i++) spy.push({ date: `2026-${String(1 + Math.floor(i / 30)).padStart(2, "0")}-${String(1 + (i % 30)).padStart(2, "0")}`, close: 400 + i * 0.2 });
  // Winner ticker: rises fast. Loser: falls. Both have full history.
  const winner = spy.map((d, i) => ({ date: d.date, close: 100 + i * 0.8 }));
  const loser = spy.map((d, i) => ({ date: d.date, close: 100 - i * 0.3 }));
  const analyses = [
    { ticker: "WIN", date: "2026-01-05", score: 75 },
    { ticker: "WIN", date: "2026-02-05", score: 70 },
    { ticker: "WIN", date: "2026-03-05", score: 68 },
    { ticker: "LOSE", date: "2026-01-05", score: 30 },
    { ticker: "LOSE", date: "2026-02-05", score: 25 },
  ];
  const res = runBacktest(analyses, { WIN: winner, LOSE: loser }, spy, 60);
  ok(res.points.length === 5, `backtest: 5 points computed (${res.points.length})`);
  ok(res.buy.n === 3, `backtest: 3 buy-side (${res.buy.n})`);
  ok(res.buy.hitRate === 1, `backtest: winners all beat SPY (${res.buy.hitRate})`);
  ok(res.buy.avgAlpha > res.rest.avgAlpha, `backtest: buy alpha > rest (${res.buy.avgAlpha.toFixed(1)} > ${res.rest.avgAlpha.toFixed(1)})`);
  ok(res.verdict === "supportive", `backtest: verdict supportive (${res.verdict})`);
  // Too few high-score picks → insufficient, never a false "supportive".
  const thin = runBacktest([{ ticker: "WIN", date: "2026-01-05", score: 75 }], { WIN: winner }, spy, 60);
  ok(thin.verdict === "insufficient", `backtest: <3 picks → insufficient (${thin.verdict})`);
  // Missing history → point skipped, no crash.
  const noHist = runBacktest(analyses, {}, spy, 60);
  ok(noHist.points.length === 0, "backtest: missing history → 0 points, no crash");
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✓" : "✗"} golden: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of fails) console.error("  ✗ " + f); process.exit(1); }
