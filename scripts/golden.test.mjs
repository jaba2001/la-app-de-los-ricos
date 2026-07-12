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
import { normalizeFundamentals } from "../lib/normalize.ts";
import { riskParity as rpTs, blendWeights as bwTs, applyDualMomentum as dmTs, growthWeights as gwTs, ALLOC_ASSETS } from "../lib/allocation.ts";
import { riskParity as rpJs, blendWeights as bwJs, applyDualMomentum as dmJs, growthWeights as gwJs } from "../research/allocate.mjs";
import { ALLOCATOR_BACKTEST, GROWTH_BACKTEST } from "../lib/trackRecord.ts";
import { ENSEMBLE_WEIGHTS } from "../lib/ensemble.ts";
import { classifyInstrument } from "../lib/instrument.ts";
import { timeframeReads } from "../lib/timeframes.ts";
import { ratingFrom, toRating, RATING_COLOR } from "../lib/rating.ts";
import { favoredStyle, favoredSectors, regimeFactorTilt, REGIME_FACTOR, REGIME_FACTOR_STATS } from "../lib/regimeSectors.ts";
import { sharpe, sortino, maxDrawdown, valueAtRisk, conditionalVaR, beta, jensenAlpha, informationRatio, riskReport } from "../lib/riskMetrics.ts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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

  // Penalty-only inputs must floor at 0, never render a negative gauge (2026-07 fix):
  // short float 30% (−5), rel volume 0.1 (−1), inst. selling −5% (−3), FCF −30 vs EPS 0 (−3),
  // capex 50% of revenue (−2), implied CAGR 35% (−4), TV share 0.8 (−2).
  const penalties = calcScores({ shortFloat: 0.30, relVolume: 0.1, instTrans: -0.05, fcfGrowthYoy: -30, epsGrowth: 0, capexToRevenue: 0.5, impliedGrowthCagr: 35, tvShare: 0.8 });
  ok(penalties.value >= 0, `penalty-only value floors at 0 (${penalties.value})`);
  ok(penalties.health >= 0, `penalty-only health floors at 0 (${penalties.health})`);
  ok(penalties.momentum >= 0, `penalty-only momentum floors at 0 (${penalties.momentum})`);
  ok(penalties.total >= 0, `penalty-only total floors at 0 (${penalties.total})`);

  // Sector aliases: FMP-stable spellings score identically to the GICS spellings.
  ok(calcScores({ pe: 20, sector: "Financial Services" }).value === calcScores({ pe: 20, sector: "Financials" }).value, "sector alias: Financial Services = Financials");
  ok(calcScores({ pe: 20, sector: "Basic Materials" }).value === calcScores({ pe: 20, sector: "Materials" }).value, "sector alias: Basic Materials = Materials");

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

  // Financial-sector health: a healthy bank must NOT score 0 on industrial leverage
  // ratios. It's scored on ROE/ROA/net margin/efficiency instead (JPM-like).
  const bank = calcScores({ sector: "Financial Services", roe: 16, roa: 1.3, netMargin: 30, operatingMargin: 0.40, debtEquity: 1.2, pe: 12, pb: 1.5, marketCap: 400e9 });
  ok(bank.health > 18, `bank health scored on ROE/ROA/margins, not zeroed (${bank.health})`);
  // Industrial path ignores roa/netMargin — same "bank" numbers on a tech name score lower health.
  const techSameNums = calcScores({ sector: "Technology", roe: 16, roa: 1.3, netMargin: 30, debtEquity: 1.2 });
  ok(techSameNums.health < bank.health, `industrial path doesn't use roa/netMargin (${techSameNums.health} < ${bank.health})`);
  // A weak financial (poor ROE/ROA) still scores low — the change doesn't just inflate all banks.
  const weakBank = calcScores({ sector: "Financial Services", roe: 3, roa: 0.3, netMargin: 8, operatingMargin: 0.05 });
  ok(weakBank.health < 10, `weak bank scores low health (${weakBank.health})`);

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

  // Regime→FACTOR tilt folded into the score (measured & validated Sharpe 1.24). A growth-
  // leaning name gets a macro tailwind in reflation and a headwind in contraction; value inverts.
  const growthProfile = { value: 2, growth: 18, momentum: 12, quality: 8, size: 5 };
  const valueProfile = { value: 18, growth: 2, momentum: 4, quality: 10, size: 8 };
  const mNeutral = { regime_id: "reflation", risk_on: 50 };
  const gRefl = getMacroTilt(mNeutral, "Technology", growthProfile).tilt;
  const gReflNoFt = getMacroTilt(mNeutral, "Technology").tilt;
  ok(gRefl > gReflNoFt, `growth name gets +factor tilt in reflation (${gRefl} > ${gReflNoFt})`);
  const gContr = getMacroTilt({ regime_id: "contraction", risk_on: 50 }, "Technology", growthProfile).tilt;
  const gContrNoFt = getMacroTilt({ regime_id: "contraction", risk_on: 50 }, "Technology").tilt;
  ok(gContr < gContrNoFt, `growth name gets −factor tilt in contraction (${gContr} < ${gContrNoFt})`);
  const vContr = getMacroTilt({ regime_id: "contraction", risk_on: 50 }, "Financials", valueProfile).tilt;
  ok(vContr > gContr, `value beats growth macro tilt in contraction (${vContr} > ${gContr})`);
  // Backward compatible: no factorTilts → identical to before (optional param).
  ok(getMacroTilt(mNeutral, "Technology").tilt === gReflNoFt, "no factorTilts → unchanged tilt");
  // Still bounded after the factor term.
  ok(gRefl >= -20 && gRefl <= 20 && vContr >= -20 && vContr <= 20, "factor-tilted macro tilt still bounded");
}

// ── Regime→sector/factor rotation lib (the differentiator, measured) ──────────
{
  // Favored style matches the validated rotation: growth in expansion/reflation, value in contraction.
  ok(favoredStyle("expansion").favored === "growth" && favoredStyle("reflation").favored === "growth", "favored style: growth in expansion/reflation");
  ok(favoredStyle("contraction").favored === "value" && favoredStyle("neutral").favored === "value", "favored style: value in contraction/neutral");
  ok(favoredStyle("nonsense") === null, "favored style: unknown regime → null");
  // Favored sectors are ranked, non-empty for real regimes, empty for unknown.
  ok(favoredSectors("reflation").length === 3 && favoredSectors("reflation")[0].etf === "XLK", "favored sectors: reflation top = Tech");
  ok(favoredSectors("contraction")[0].etf === "XLE", "favored sectors: contraction top = Energy");
  ok(favoredSectors("nonsense").length === 0, "favored sectors: unknown → empty");
  // regimeFactorTilt sign matches: growth up in reflation, down in contraction.
  ok(regimeFactorTilt("reflation", "growth", 1) > 0 && regimeFactorTilt("contraction", "growth", 1) < 0, "regimeFactorTilt: growth sign flips reflation↔contraction");
  ok(regimeFactorTilt("contraction", "value", 1) > 0, "regimeFactorTilt: value up in contraction");
  ok(regimeFactorTilt(null, "growth", 1) === 0 && regimeFactorTilt("reflation", null, 1) === 0, "regimeFactorTilt: null-safe");
  // Anti-drift: the canonical REGIME_FACTOR signs match what scoring/timeframes encode inline.
  for (const rg of ["expansion", "reflation", "stagflation", "contraction", "neutral"]) {
    ok(REGIME_FACTOR[rg].growth === (rg === "contraction" || rg === "neutral" ? -1 : 1), `REGIME_FACTOR ${rg} growth sign`);
    ok(REGIME_FACTOR[rg].value === -REGIME_FACTOR[rg].growth, `REGIME_FACTOR ${rg} value = −growth`);
  }
  // Claims anti-drift vs the measured validation (skipped in CI if the JSON isn't present).
  const rfvPath = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", "regime_factor_validate.json");
  if (existsSync(rfvPath)) {
    const rfv = JSON.parse(readFileSync(rfvPath, "utf8"));
    const rot = rfv.results?.["Regime rotation (G/V)"], spy = rfv.results?.["SPY"];
    if (rot && spy) {
      ok(Math.abs(REGIME_FACTOR_STATS.rotationSharpe - rot.sharpe) <= 0.03, `regime-factor drift: rotation Sharpe ${REGIME_FACTOR_STATS.rotationSharpe} vs ${rot.sharpe}`);
      ok(rot.sharpe > spy.sharpe, "regime rotation Sharpe still beats SPY (validation holds)");
    }
  }
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

// ── Fundamentals normalizer (FMP-stable + Finnhub → legacy canonical keys) ─────
{
  // Real UBER field names from FMP stable (the renamed ones) must map to the
  // legacy keys the scoring engine and components read. This guards the exact
  // legacy→stable mismatch that was silently zeroing VALUE/GROWTH.
  const fmpKeyMetrics = {
    evToEBITDATTM: 25.9, netDebtToEBITDATTM: 1.12, returnOnInvestedCapitalTTM: 0.2339,
    returnOnEquityTTM: 0.3332, returnOnAssetsTTM: 0.1417, currentRatioTTM: 1.069,
    evToSalesTTM: 2.95, freeCashFlowYieldTTM: 0.061,
  };
  const fmpRatios = {
    priceToEarningsRatioTTM: 17.66, priceToBookRatioTTM: 6.28, priceToFreeCashFlowRatioTTM: 15.4,
    debtToEquityRatioTTM: 0.39, currentRatioTTM: 1.069, interestCoverageRatioTTM: 5.2,
    grossProfitMarginTTM: 0.4103, operatingProfitMarginTTM: 0.1166, netProfitMarginTTM: 0.159,
    dividendYieldTTM: 0, freeCashFlowPerShareTTM: 4.8,
  };
  const fmpGrowth = { revenueGrowth: 0.1828, netIncomeGrowth: 0.02, epsgrowth: 0.023 };
  const profile = { beta: 1.12 };

  const a = normalizeFundamentals({ fmpKeyMetrics, fmpRatios, fmpGrowth, profile });
  ok(a.metrics.peRatioTTM === 17.66, `norm: pe from ratios.priceToEarningsRatioTTM (${a.metrics.peRatioTTM})`);
  ok(a.metrics.enterpriseValueOverEBITDATTM === 25.9, `norm: evEbitda from key-metrics.evToEBITDATTM (${a.metrics.enterpriseValueOverEBITDATTM})`);
  ok(a.metrics.roicTTM === 0.2339, `norm: roic from returnOnInvestedCapitalTTM (${a.metrics.roicTTM})`);
  ok(a.metrics.roeTTM === 0.3332, `norm: roe from returnOnEquityTTM (${a.metrics.roeTTM})`);
  ok(a.metrics.priceToFreeCashFlowsRatioTTM === 15.4, `norm: pfcf from priceToFreeCashFlowRatioTTM (${a.metrics.priceToFreeCashFlowsRatioTTM})`);
  ok(a.metrics.priceToBookRatioTTM === 6.28, `norm: pb mapped (${a.metrics.priceToBookRatioTTM})`);
  ok(a.metrics.beta === 1.12, `norm: beta from profile (${a.metrics.beta})`);
  ok(a.ratios.debtEquityRatioTTM === 0.39, `norm: d/e from debtToEquityRatioTTM (${a.ratios.debtEquityRatioTTM})`);
  ok(a.ratios.interestCoverageTTM === 5.2, `norm: interestCoverage from interestCoverageRatioTTM (${a.ratios.interestCoverageTTM})`);
  ok(a.ratios.revenueGrowthTTM === 0.1828, `norm: revenueGrowth from financial-growth (${a.ratios.revenueGrowthTTM})`);
  ok(a.ratios.netIncomeGrowthTTM === 0.02, `norm: netIncomeGrowth from financial-growth (${a.ratios.netIncomeGrowthTTM})`);
  ok(a.ratios.returnOnEquityTTM === 0.3332, `norm: ratios.returnOnEquityTTM preserved for Fundamentals tab (${a.ratios.returnOnEquityTTM})`);

  // Finnhub-only fallback (FMP quota exhausted): percents ÷100 into fractions.
  const fh = {
    peTTM: 17.66, evEbitdaTTM: 22.28, roiTTM: 23.39, roeTTM: 33.32, roaTTM: 14.17,
    grossMarginTTM: 35.54, operatingMarginTTM: 11.66, netMarginTTM: 15.9, pbAnnual: 6.28,
    pfcfShareTTM: 15.39, "totalDebt/totalEquityAnnual": 0.389, currentRatioAnnual: 1.13,
    netInterestCoverageAnnual: 1.34, revenueGrowthTTMYoy: 18.31, epsGrowthTTMYoy: -29.82, beta: 1.15,
  };
  const b = normalizeFundamentals({ finnhubMetric: fh });
  ok(b.metrics.peRatioTTM === 17.66, `norm-fh: pe fallback (${b.metrics.peRatioTTM})`);
  ok(b.metrics.enterpriseValueOverEBITDATTM === 22.28, `norm-fh: evEbitda fallback via evEbitdaTTM (${b.metrics.enterpriseValueOverEBITDATTM})`);
  approx(b.metrics.roeTTM, 0.3332, 1e-9, "norm-fh: roe ÷100 to fraction");
  approx(b.ratios.grossProfitMarginTTM, 0.3554, 1e-9, "norm-fh: grossMargin ÷100");
  ok(b.ratios.debtEquityRatioTTM === 0.389, `norm-fh: d/e via totalDebt/totalEquityAnnual (${b.ratios.debtEquityRatioTTM})`);
  approx(b.ratios.revenueGrowthTTM, 0.1831, 1e-9, "norm-fh: revenueGrowth ÷100");
  approx(b.ratios.netIncomeGrowthTTM, -0.2982, 1e-9, "norm-fh: epsGrowth ÷100 (negative preserved)");

  // Field-level merge: FMP has evEbitda but not roe; Finnhub fills only the gap.
  const c = normalizeFundamentals({ fmpKeyMetrics: { evToEBITDATTM: 25.9 }, finnhubMetric: { roeTTM: 33.32 } });
  ok(c.metrics.enterpriseValueOverEBITDATTM === 25.9, "norm-merge: FMP evEbitda kept");
  approx(c.metrics.roeTTM, 0.3332, 1e-9, "norm-merge: Finnhub fills missing roe");

  // The payoff: a normalized UBER feeds calcScores to a NON-zero value+growth,
  // exactly what the legacy-name bug was suppressing.
  const m = a.metrics, r = a.ratios;
  const s = calcScores({
    pe: m.peRatioTTM, pb: m.priceToBookRatioTTM, evEbitda: m.enterpriseValueOverEBITDATTM,
    pfcf: m.priceToFreeCashFlowsRatioTTM, debtEquity: r.debtEquityRatioTTM, currentRatio: r.currentRatioTTM,
    interestCoverage: r.interestCoverageTTM, netDebtEbitda: m.netDebtToEBITDATTM,
    roic: m.roicTTM * 100, roe: m.roeTTM * 100, grossMargin: r.grossProfitMarginTTM * 100,
    revenueGrowth: r.revenueGrowthTTM * 100, epsGrowth: r.netIncomeGrowthTTM * 100,
    marketCap: 150e9, sector: "Technology",
  });
  ok(s.value > 0, `norm→score: VALUE no longer zero (${s.value})`);
  ok(s.growth > 0, `norm→score: GROWTH no longer zero (${s.growth})`);
  ok(s.health > 0, `norm→score: HEALTH populated (${s.health})`);
}

// ── Allocator parity (F1.1) ──────────────────────────────────────────────────
// The allocator exists twice on purpose (lib/allocation.ts for the app, research/
// allocate.mjs for the backtest/paper fund — .mjs scripts can't import a .ts that this
// one imports from). These tests run BOTH with identical inputs and demand identical
// outputs, so a fix applied to one can never silently miss the other again (that drift
// is exactly how the 2026-07 riskParity fallback bug survived).
{
  const W = { SPY: 0.4, TLT: 0.15, IEF: 0.15, GLD: 0.1, DBC: 0.1, BIL: 0.1 };
  const volCases = [
    ["all vols", { SPY: 0.012, TLT: 0.009, IEF: 0.005, GLD: 0.010, DBC: 0.014, BIL: 0.001 }],
    ["one missing", { SPY: 0.012, TLT: 0.009, IEF: 0.005, GLD: 0.010 }],
    ["null vol", { SPY: 0.012, TLT: null, IEF: 0.005, GLD: 0.010, DBC: 0.014 }],
    ["no vols", {}],
  ];
  for (const [label, vols] of volCases) {
    const a = rpTs(W, vols), b = rpJs(W, vols);
    for (const k of ALLOC_ASSETS) ok(Math.abs((a[k] || 0) - (b[k] || 0)) < 1e-12, `parity riskParity ${label}: ${k} (${a[k]} vs ${b[k]})`);
    approx(ALLOC_ASSETS.reduce((s, k) => s + (a[k] || 0), 0), 1, 1e-9, `riskParity ${label}: total preserved`);
    ok(Math.abs(a.BIL - W.BIL) < 1e-12, `riskParity ${label}: BIL untouched`);
  }
  // Inverse-vol ordering: the low-vol sleeve must end up with MORE weight than the
  // high-vol one (IEF vol 0.005 vs DBC 0.014, equal-ish input weights).
  const rp = rpTs(W, volCases[0][1]);
  ok(rp.IEF > rp.DBC, `riskParity: inverse-vol ordering IEF>DBC (${rp.IEF.toFixed(3)} > ${rp.DBC.toFixed(3)})`);
  // No vols at all → weights unchanged (never a rescale from garbage).
  const un = rpTs(W, {});
  ok(ALLOC_ASSETS.every((k) => Math.abs((un[k] || 0) - (W[k] || 0)) < 1e-12), "riskParity: no vols → unchanged");

  for (const ro of [0, 25, 40, 50, 63, 100]) {
    const a = bwTs(ro), b = bwJs(ro);
    for (const k of ALLOC_ASSETS) ok(Math.abs(a[k] - b[k]) < 1e-12, `parity blendWeights(${ro}): ${k}`);
    approx(ALLOC_ASSETS.reduce((s, k) => s + a[k], 0), 1, 1e-9, `blendWeights(${ro}): sums to 1`);
  }

  const mom = { SPY: -3, TLT: 5, GLD: null, DBC: -0.1 };
  const da = dmTs(bwTs(60), mom), db = dmJs(bwJs(60), mom);
  for (const k of ALLOC_ASSETS) ok(Math.abs(da.weights[k] - db.weights[k]) < 1e-12, `parity dualMomentum: ${k}`);
  ok(da.movedToCash.slice().sort().join() === db.movedToCash.slice().sort().join(), `parity dualMomentum: movedToCash (${da.movedToCash} vs ${db.movedToCash})`);
  ok(da.weights.SPY === 0 && da.weights.DBC === 0 && da.weights.TLT > 0, "dualMomentum: negative sleeves gated, positive kept");

  // Growth profile parity + semantics (the default product mandate), incl. the BTC sleeve.
  for (const ro of [0, 49.9, 50, 63, 100]) {
    for (const btc of [undefined, -5, 0, 12]) {
      const a = gwTs(ro, btc), b = gwJs(ro, btc);
      for (const k of ALLOC_ASSETS) ok(Math.abs((a[k] || 0) - (b[k] || 0)) < 1e-12, `parity growthWeights(${ro},${btc}): ${k}`);
      approx(ALLOC_ASSETS.reduce((s, k) => s + (a[k] || 0), 0), 1, 1e-9, `growthWeights(${ro},${btc}): sums to 1`);
    }
  }
  ok(gwTs(50).SPY === 1 && gwTs(49.9).SPY < 1, "growth: switch at exactly 50");
  // BTC sleeve: held (5%, carved from SPY) only when risk-on AND BTC 12-1m > 0 — never leverage.
  ok(gwTs(60, 12).BTCUSD === 0.05 && Math.abs(gwTs(60, 12).SPY - 0.95) < 1e-12, "growth: BTC 5% carved from equity on uptrend");
  ok(gwTs(60, -3).BTCUSD === 0 && gwTs(60, -3).SPY === 1, "growth: no BTC when BTC trend down");
  ok(gwTs(40, 12).BTCUSD === 0, "growth: no BTC when risk-off (defensive)");
}

// ── Claims anti-drift (F1.2) ──────────────────────────────────────────────────
// The numbers the product ADVERTISES (lib/trackRecord.ts → landing, /track-record,
// AllWeatherAllocator) must match what the backtest actually measures. research/out is
// gitignored, so CI (no backtest run) skips this; any local run after a backtest
// refresh fails loudly if the hard-coded claims have drifted from the measurement.
{
  const summaryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", "backtest_assets_summary.json");
  if (existsSync(summaryPath)) {
    const m = JSON.parse(readFileSync(summaryPath, "utf8"));
    const pairs = [["strategy", "riskOnRP"], ["strategyNoRP", "riskOnDM"], ["control", "momOnly"], ["spy", "spy"]];
    for (const [claim, key] of pairs) {
      const c = ALLOCATOR_BACKTEST[claim], meas = m[key];
      ok(!!c && !!meas, `claims: ${claim}/${key} present`);
      if (!c || !meas) continue;
      ok(Math.abs(c.totalReturn - meas.total) <= Math.max(3, Math.abs(meas.total) * 0.02), `claims drift: ${claim} total ${c.totalReturn} vs measured ${meas.total.toFixed(1)}`);
      ok(Math.abs(c.sharpe - meas.sharpe) <= 0.03, `claims drift: ${claim} sharpe ${c.sharpe} vs measured ${meas.sharpe.toFixed(2)}`);
      ok(Math.abs(c.maxDrawdown - meas.maxDD) <= 0.5, `claims drift: ${claim} maxDD ${c.maxDrawdown} vs measured ${meas.maxDD.toFixed(1)}`);
    }
    ok(ALLOCATOR_BACKTEST.months === m.months, `claims drift: months ${ALLOCATOR_BACKTEST.months} vs measured ${m.months}`);
  } else {
    console.log("  (claims anti-drift: research/out/backtest_assets_summary.json not present — skipped)");
  }

  // Anti-drift: the GROWTH claims must match the PRODUCTION-path measurement
  // (research/growth_metrics.mjs → growth_metrics.json, through the live allocate.mjs).
  const gmPath = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", "growth_metrics.json");
  if (existsSync(gmPath)) {
    const gm = JSON.parse(readFileSync(gmPath, "utf8"));
    const g = GROWTH_BACKTEST.strategy, mr = gm.report?.growth, mt = gm.totals?.growth;
    ok(!!mr, "growth claims: production report present");
    if (mr) {
      ok(Math.abs(g.totalReturn - mt) <= Math.max(5, Math.abs(mt) * 0.02), `growth drift: total ${g.totalReturn} vs ${mt}`);
      ok(Math.abs(g.sharpe - mr.sharpe) <= 0.03, `growth drift: sharpe ${g.sharpe} vs ${mr.sharpe}`);
      ok(Math.abs(g.sortino - mr.sortino) <= 0.05, `growth drift: sortino ${g.sortino} vs ${mr.sortino}`);
      ok(Math.abs(g.maxDrawdown - mr.maxDrawdown) <= 0.5, `growth drift: maxDD ${g.maxDrawdown} vs ${mr.maxDrawdown}`);
      ok(Math.abs(g.alpha - mr.alpha) <= 0.2, `growth drift: alpha ${g.alpha} vs ${mr.alpha}`);
    }
    // SPY benchmark figures must match too (they anchor every risk-adjusted comparison).
    const sp = GROWTH_BACKTEST.spy, ms = gm.report?.spy;
    if (ms) { ok(Math.abs(sp.sharpe - ms.sharpe) <= 0.03 && Math.abs(sp.maxDrawdown - ms.maxDrawdown) <= 0.5, `growth drift: SPY sharpe/maxDD ${sp.sharpe}/${sp.maxDrawdown} vs ${ms.sharpe}/${ms.maxDrawdown}`); }
    ok(GROWTH_BACKTEST.months === gm.months, `growth drift: months ${GROWTH_BACKTEST.months} vs ${gm.months}`);
  }

  // Same guard for the A5 ensemble weights vs the latest measured signals_ic.json.
  const icPath = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", "signals_ic.json");
  if (existsSync(icPath)) {
    const measured = JSON.parse(readFileSync(icPath, "utf8")).ensembleWeights ?? {};
    for (const rk of ["low", "mid", "high"]) {
      const shipped = ENSEMBLE_WEIGHTS[rk] ?? {}, meas = measured[rk] ?? {};
      const factors = new Set([...Object.keys(shipped), ...Object.keys(meas)]);
      for (const f of factors) {
        ok(Math.abs((shipped[f] ?? 0) - (meas[f] ?? 0)) <= 0.05, `ensemble drift: ${rk}.${f} shipped ${(shipped[f] ?? 0)} vs measured ${(meas[f] ?? 0)}`);
      }
    }
  }
}

// ── Instrument classifier (crypto in the micro layer, 2026-07-11) ─────────────
{
  const crypto = ["BTC-USD", "ETH-USD", "IBIT", "GBTC", "SOL-USD"];
  for (const t of crypto) {
    const i = classifyInstrument(t);
    ok(i.type === "crypto", `classify ${t} → crypto (${i.type})`);
    ok(i.isEquity === false, `${t} is not equity`);
    ok(i.drivers.length > 0 && i.drivers.some((d) => d.field === "risk_on"), `${t} has macro drivers incl. risk_on`);
  }
  // Crypto must be checked BEFORE the equity fallthrough — BTC-USD is not a stock.
  ok(classifyInstrument("BTC").type === "crypto", "bare BTC → crypto");
  ok(classifyInstrument("AAPL").isEquity === true, "AAPL still equity");
  ok(classifyInstrument("GLD").type === "metal", "GLD still metal (no crypto regression)");
  ok(classifyInstrument("SPY").type === "broad-etf", "SPY still broad-etf");
}

// ── Multi-timeframe context layer (2026-07-11) ────────────────────────────────
{
  const growthFt = { value: 3, growth: 16, momentum: 12, quality: 8, size: 6 };
  const valueFt = { value: 16, growth: 3, momentum: 4, quality: 10, size: 8 };
  // Structural buy: risk-on + growth sector + growth factor in expansion + strong trend + fair entry.
  const sb = timeframeReads({ regime: "expansion", riskOn: 72, sector: "Technology", factorTilts: growthFt, mom12_1: 35, rsVsSector: 8, rsVsSpy: 12, rsi14: 55, pctFrom200dma: 8 });
  ok(sb.confluence === "structural-buy", `structural-buy confluence (${sb.confluence})`);
  ok(sb.monthly.score >= 62 && sb.weekly.score >= 62, "structural buy: monthly+weekly high");
  ok(sb.convictionMult === 1.0, "structural buy conviction 1.0");
  // Leader but overbought (RSI 82) → wait for pullback.
  const lx = timeframeReads({ regime: "expansion", riskOn: 72, sector: "Technology", factorTilts: growthFt, mom12_1: 35, rsVsSector: 8, rsVsSpy: 12, rsi14: 82, pctFrom200dma: 25 });
  ok(lx.confluence === "leader-extended", `leader-extended when overbought (${lx.confluence})`);
  ok(lx.daily.score < sb.daily.score, "overbought → lower daily/entry score than neutral RSI");
  // Bounce against the macro: growth stock, risk-OFF/contraction, but strong recent trend.
  const bo = timeframeReads({ regime: "contraction", riskOn: 25, sector: "Technology", factorTilts: growthFt, mom12_1: 20, rsVsSector: 5, rsVsSpy: 5, rsi14: 60, pctFrom200dma: 5 });
  ok(bo.confluence === "bounce-vs-macro", `bounce-vs-macro (${bo.confluence})`);
  ok(bo.monthly.score < 45 && bo.convictionMult <= 0.6 + 1e-9, "bounce: macro headwind gates conviction down");
  // Measured factor rotation: a VALUE name is macro-favored in contraction, a GROWTH name isn't.
  const valContraction = timeframeReads({ regime: "contraction", riskOn: 50, sector: "Financials", factorTilts: valueFt, mom12_1: 0, rsVsSector: 0, rsVsSpy: 0, rsi14: 50, pctFrom200dma: 0 });
  const growthContraction = timeframeReads({ regime: "contraction", riskOn: 50, sector: "Financials", factorTilts: growthFt, mom12_1: 0, rsVsSector: 0, rsVsSpy: 0, rsi14: 50, pctFrom200dma: 0 });
  ok(valContraction.monthly.score > growthContraction.monthly.score, `value>growth macro read in contraction (${valContraction.monthly.score} > ${growthContraction.monthly.score})`);
  // Daily is a REVERSION filter: oversold RSI scores HIGHER (better entry) than overbought.
  const os = timeframeReads({ regime: "neutral", riskOn: 50, sector: null, factorTilts: null, mom12_1: null, rsVsSector: null, rsVsSpy: null, rsi14: 25, pctFrom200dma: null });
  const ob = timeframeReads({ regime: "neutral", riskOn: 50, sector: null, factorTilts: null, mom12_1: null, rsVsSector: null, rsVsSpy: null, rsi14: 80, pctFrom200dma: null });
  ok(os.daily.score > ob.daily.score, "daily reversion: oversold entry > overbought");
  // All scores bounded 0-100.
  for (const r of [sb, lx, bo, os, ob]) for (const tf of [r.monthly, r.weekly, r.daily]) ok(tf.score >= 0 && tf.score <= 100, `timeframe score bounded (${tf.score})`);
}

// ── Directional rating: Strong Buy/Buy/Sell/Strong Sell, NO Hold (2026-07-12) ──────────
{
  const growthFt = { value: 3, growth: 16, momentum: 12, quality: 8, size: 6 };
  const RATINGS = new Set(["Strong Buy", "Buy", "Sell", "Strong Sell"]);
  // 4-way cut, median splits buy/sell, extremes are "Strong" — and NEVER Hold/Neutral.
  ok(toRating(60) === "Strong Buy" && toRating(50) === "Buy" && toRating(49.9) === "Sell" && toRating(39.9) === "Strong Sell", "toRating: 4-way cut");
  for (const x of [0, 39, 40, 49, 50, 59, 60, 100]) ok(RATINGS.has(toRating(x)), `toRating(${x}) never Hold (${toRating(x)})`);

  const bull = timeframeReads({ regime: "expansion", riskOn: 74, sector: "Technology", factorTilts: growthFt, mom12_1: 40, rsVsSector: 10, rsVsSpy: 12, rsi14: 50, pctFrom200dma: 8 });
  const bear = timeframeReads({ regime: "contraction", riskOn: 28, sector: "Technology", factorTilts: growthFt, mom12_1: -22, rsVsSector: -10, rsVsSpy: -9, rsi14: 82, pctFrom200dma: 24 });
  const flat = timeframeReads({ regime: "neutral", riskOn: 50, sector: null, factorTilts: null, mom12_1: 0, rsVsSector: null, rsVsSpy: null, rsi14: 50, pctFrom200dma: 0 });
  const rBull = ratingFrom(72, bull, { corrRegime: "low" });
  const rBear = ratingFrom(30, bear, { corrRegime: "low" });
  const rFlat = ratingFrom(50, flat, { corrRegime: "mid" });

  ok(rBull.directional > rBear.directional, `directional bull>bear (${rBull.directional}>${rBear.directional})`);
  ok(rBull.rating === "Strong Buy" || rBull.rating === "Buy", `bull → buy-side (${rBull.rating})`);
  ok(rBear.rating === "Sell" || rBear.rating === "Strong Sell", `bear → sell-side (${rBear.rating})`);
  for (const r of [rBull, rBear, rFlat]) {
    ok(RATINGS.has(r.rating), `rating in 4-set (${r.rating})`);
    for (const k of ["monthly", "weekly", "daily"]) ok(RATINGS.has(r.perTimeframe[k]), `perTimeframe ${k} in 4-set (${r.perTimeframe[k]})`);
    ok(r.convictionPct >= 0 && r.convictionPct <= 100, `conviction 0-100 (${r.convictionPct})`);
  }
  // Honest conviction: near the median → Low (decisive label, truthful certainty).
  ok(rFlat.conviction === "Low", `median → Low conviction (${rFlat.conviction})`);
  // Correlation regime caps conviction where selection has no measured IC (high-corr < low-corr).
  ok(ratingFrom(72, bull, { corrRegime: "high" }).convictionPct < rBull.convictionPct, "high-corr caps conviction below low-corr");
  // Directional monotonic in the score (timeframes fixed).
  ok(ratingFrom(80, bull, { corrRegime: "low" }).directional >= ratingFrom(40, bull, { corrRegime: "low" }).directional, "directional monotonic in score");
  for (const rat of ["Strong Buy", "Buy", "Sell", "Strong Sell"]) ok(typeof RATING_COLOR[rat] === "string" && RATING_COLOR[rat].length > 0, `rating color present (${rat})`);
}

// ── Risk metrics (institutional scorecard, 2026-07-11) ────────────────────────
{
  // Self-benchmark identities: beta=1, alpha=0, IR undefined→0 (zero tracking error).
  const s = [1.2, -0.8, 2.1, -1.5, 0.9, 3.0, -2.2, 1.1, 0.4, -0.6, 1.8, -1.0];
  approx(beta(s, s), 1, 1e-9, "beta vs self = 1");
  approx(jensenAlpha(s, s), 0, 1e-9, "alpha vs self = 0");
  ok(informationRatio(s, s) === 0, "IR vs self = 0 (no tracking error)");

  // Sortino only penalizes downside → for a series with the same total vol, a version
  // with losses clustered has a lower Sortino than Sharpe when mean>0.
  ok(sortino(s) >= sharpe(s) - 1e-9 || sortino(s) > 0, "sortino computes (downside-only)");
  // A series with NO negative months has zero downside deviation → sortino returns 0 (guard).
  ok(sortino([1, 2, 1, 2]) === 0, "sortino: no downside → 0 (divide-by-zero guarded)");

  // VaR/CVaR ordering: CVaR (tail mean) must be ≤ VaR (tail threshold), both negative here.
  const r = [-5, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  ok(conditionalVaR(r, 0.95) <= valueAtRisk(r, 0.95), "CVaR ≤ VaR (tail is worse than threshold)");
  ok(valueAtRisk(r, 0.95) < 0, "VaR negative for a series with losses");

  // Max drawdown: three −10% months compound to worse than −30%.
  ok(maxDrawdown([-10, -10, -10]) < -27 && maxDrawdown([-10, -10, -10]) > -28, `maxDD 3×−10% ≈ −27.1% (${maxDrawdown([-10, -10, -10]).toFixed(1)})`);
  ok(maxDrawdown([1, 2, 3]) === 0, "maxDD of all-positive = 0");

  // riskReport shape + benchmark fields present only when a benchmark is passed.
  const rep = riskReport(s);
  ok(rep.beta === null && rep.alpha === null, "riskReport: no benchmark → null relative metrics");
  const rep2 = riskReport(s, s);
  ok(rep2.beta === 1 && rep2.alpha === 0, "riskReport: self-benchmark → beta 1, alpha 0");
  ok(typeof rep.sortino === "number" && typeof rep.cvar95 === "number", "riskReport: absolute metrics present");
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✓" : "✗"} golden: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of fails) console.error("  ✗ " + f); process.exit(1); }
