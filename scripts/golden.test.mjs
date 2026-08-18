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
import { ratingFrom, toRating, RATING_COLOR, HORIZON_WEIGHTS, HORIZON_LABEL } from "../lib/rating.ts";
import { favoredStyle, favoredSectors, regimeFactorTilt, REGIME_FACTOR, REGIME_FACTOR_STATS } from "../lib/regimeSectors.ts";
import { sharpe, sortino, maxDrawdown, valueAtRisk, conditionalVaR, beta, jensenAlpha, informationRatio, riskReport } from "../lib/riskMetrics.ts";
import { attributeReturn, toDatedCloses, dominantDriver } from "../lib/attribution.ts";
import { buildVerdict, factorTiltsFromScores, corrRegimeFrom, deriveTechnicals, smaOf, rsiOf, periodReturn } from "../lib/verdict.ts";
import { setHorizon, readHorizon, subscribeHorizon, __resetHorizonForTests } from "../lib/horizon.ts";
import { stockPickingRegime } from "../lib/microScore.ts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

let passed = 0, failed = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); }
}
function approx(a, b, tol, msg) { ok(Math.abs(a - b) <= tol, `${msg} (got ${a}, expected ~${b} ±${tol})`); }

// ── Artefactos de evidencia (2026-08-18) ─────────────────────────────────────
// Estos JSON justifican constantes que viajan en el código (ENSEMBLE_WEIGHTS,
// GROWTH_BACKTEST, ALLOCATOR_BACKTEST, REGIME_FACTOR_STATS). Estaban en .gitignore, así
// que en cada checkout limpio los guardianes anti-deriva se saltaban EN SILENCIO y daban
// verde sin haber comprobado nada: los pesos del ensemble derivaron meses así
// (mid.value 0.99 vs 0.634 medido) sin que ningún test se quejara.
// Ahora están versionados y su ausencia es un FALLO, no un salto.
function requireArtifact(name, regenCmd) {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", name);
  if (existsSync(path)) {
    try { return JSON.parse(readFileSync(path, "utf8")); }
    catch (e) { ok(false, `artefacto ${name} ilegible (${e.message}) — regenera con: ${regenCmd}`); return null; }
  }
  ok(false, `FALTA el artefacto research/out/${name}: el guardián anti-deriva no puede comprobar nada. Está versionado; si lo has borrado, regenéralo con: ${regenCmd}`);
  return null;
}

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

  // ── Novy-Marx gross profitability strengthens quality (2026-07-13, qgv_lab finding) ──
  {
    const base = { pe: 18, roic: 10, roe: 14, grossMargin: 45, interestCoverage: 8, revenueGrowth: 12, epsGrowth: 8, debtEquity: 0.4, currentRatio: 1.8, sector: "Technology", marketCap: 5e10 };
    const withGP = { ...base, grossProfitability: 45 };  // high GP/assets — the regime-robust quality signal
    // The QUALITY factor (which getMacroTilt rotates by regime) rises with gross profitability.
    ok(calcFactorTilts(withGP).quality > calcFactorTilts(base).quality, `gross profitability lifts the quality factor (${calcFactorTilts(withGP).quality} > ${calcFactorTilts(base).quality})`);
    // Non-financial HEALTH rises with gross profitability (always-on quality).
    ok(calcScores(withGP).health > calcScores(base).health, `gross profitability lifts non-financial health (${calcScores(withGP).health} > ${calcScores(base).health})`);
    // Graceful: null grossProfitability = exact prior behavior (optional, no-op).
    ok(calcScores({ ...base, grossProfitability: null }).total === calcScores(base).total, "null grossProfitability → no-op (score)");
    ok(calcFactorTilts({ ...base, grossProfitability: null }).quality === calcFactorTilts(base).quality, "null grossProfitability → no-op (factor)");
    // Financials use ROE/ROA-based health → gross profitability isn't double-counted there.
    ok(calcScores({ ...base, sector: "Financials", grossProfitability: 45 }).health === calcScores({ ...base, sector: "Financials" }).health, "financials: gross profitability not added to sector health");
    // Still capped [0,20] with the new signal.
    ok(calcFactorTilts({ ...base, grossProfitability: 90, roic: 40, roe: 40, grossMargin: 90 }).quality <= 20, "quality still capped at 20 with gross profitability");
  }

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
  const rfv = requireArtifact("regime_factor_validate.json", "node --experimental-strip-types research/regime_factor_validate.mjs");
  if (rfv) {
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
  const m = requireArtifact("backtest_assets_summary.json", "node --experimental-strip-types research/backtest_assets.mjs");
  if (m) {
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
  }

  // Anti-drift: the GROWTH claims must match the PRODUCTION-path measurement
  // (research/growth_metrics.mjs → growth_metrics.json, through the live allocate.mjs).
  const gm = requireArtifact("growth_metrics.json", "node --experimental-strip-types research/growth_metrics.mjs");
  if (gm) {
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
  //
  // ONLY comparable against a SURVIVORSHIP-FREE run. ENSEMBLE_WEIGHTS were derived from
  // `backtest.mjs --full 120` (point-in-time S&P 500 membership); the default CURATED
  // universe is survivorship-biased by construction — it keeps only names still listed
  // today, which inflates momentum IC and deflates value IC. Comparing the two produces
  // large, meaningless "drift" (a 2026-07-26 curated 43-name run reported mid.value 0.03
  // vs the shipped 0.99) and would pressure someone into overwriting good weights with
  // biased ones. So: skip unless the artifact says it came from a --full run.
  const icRun = requireArtifact("signals_ic.json", "node --experimental-strip-types research/backtest.mjs --full 120");
  if (icRun) {
    const measured = icRun.ensembleWeights ?? {};
    // `full` is absent on artifacts written before this flag existed — treat unknown
    // provenance as not comparable rather than assuming it's fine.
    if (icRun.full !== true) {
      console.log(`  … ensemble drift check skipped: signals_ic.json is not a --full run (universe ${icRun.universe ?? "?"}, full=${icRun.full ?? "unknown"}). Re-run: node --experimental-strip-types research/backtest.mjs --full 120`);
    } else {
    for (const rk of ["low", "mid", "high"]) {
      const shipped = ENSEMBLE_WEIGHTS[rk] ?? {}, meas = measured[rk] ?? {};
      const factors = new Set([...Object.keys(shipped), ...Object.keys(meas)]);
      for (const f of factors) {
        ok(Math.abs((shipped[f] ?? 0) - (meas[f] ?? 0)) <= 0.05, `ensemble drift: ${rk}.${f} shipped ${(shipped[f] ?? 0)} vs measured ${(meas[f] ?? 0)}`);
      }
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

// ── Return attribution ("why did it move?", 2026-08-17) ──────────────────────
{
  // Build newest-first dated closes from a newest-first list of daily returns (%).
  // day 0 is the most recent bar.
  const mkSeries = (rets, start = 100) => {
    // Walk oldest→newest compounding, then emit newest-first with ISO dates.
    const oldestFirst = [...rets].reverse();
    const closes = [start];
    for (const r of oldestFirst) closes.push(closes[closes.length - 1] * (1 + r / 100));
    const out = [];
    for (let i = closes.length - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(2026, 0, 1) + (closes.length - 1 - i) * -86400000);
      out.push({ date: d.toISOString().slice(0, 10), close: closes[i] });
    }
    return out;
  };
  // Deterministic pseudo-random market path (no Math.random — golden means reproducible).
  const n = 200;
  const mktRets = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 0.9 + Math.cos(i * 0.4) * 0.5);
  const market = mkSeries(mktRets);

  // — Identity: buckets must sum to the realized return, always. —
  {
    const stockRets = mktRets.map((r, i) => 2 * r + Math.sin(i * 3.1) * 0.3);
    const stock = mkSeries(stockRets);
    for (const h of [1, 5, 21]) {
      const a = attributeReturn({ stock, market, sector: null, horizonDays: h });
      ok(a != null, `attribution h=${h}: returns a result`);
      if (a) {
        const sum = a.components.reduce((s, c) => s + c.contribution, 0);
        approx(sum, a.totalReturn, 1e-9, `attribution h=${h}: components sum to total return`);
        approx(a.systematicReturn + a.idioReturn, a.totalReturn, 1e-9, `attribution h=${h}: systematic + idio = total`);
        ok(a.components.length === 2, `attribution h=${h}: no sector leg → 2 buckets`);
        ok(a.sampleDays >= 40, `attribution h=${h}: sample size honored (${a.sampleDays})`);
      }
    }
  }

  // — A stock that IS 2× the market has beta 2 and (almost) no idiosyncratic move. —
  {
    const stock = mkSeries(mktRets.map((r) => 2 * r));
    const a = attributeReturn({ stock, market, sector: null, horizonDays: 5 });
    ok(a != null, "attribution 2×market: result");
    if (a) {
      approx(a.betaMarket, 2, 0.05, `attribution 2×market: beta ≈ 2 (${a.betaMarket.toFixed(3)})`);
      ok(Math.abs(a.idioReturn) < Math.abs(a.totalReturn) * 0.15, `attribution 2×market: idio is small (${a.idioReturn.toFixed(3)} vs total ${a.totalReturn.toFixed(3)})`);
      const drv = dominantDriver(a);
      ok(drv?.key === "market", `attribution 2×market: dominant driver is market (got ${drv?.key})`);
    }
  }

  // — A flat stock in a moving market: the market leg is offset by an equal residual. —
  {
    const stock = mkSeries(Array.from({ length: n }, () => 0));
    const a = attributeReturn({ stock, market, sector: null, horizonDays: 5 });
    ok(a != null, "attribution flat stock: result");
    if (a) {
      approx(a.totalReturn, 0, 1e-9, "attribution flat stock: total return is 0");
      approx(a.betaMarket, 0, 1e-9, "attribution flat stock: beta 0 (no covariance)");
      approx(a.idioReturn, 0, 1e-9, "attribution flat stock: idio 0");
    }
  }

  // — Sector leg: orthogonalized, adds a third bucket, identity still exact. —
  {
    const sectorRets = mktRets.map((r, i) => 1.1 * r + Math.sin(i * 0.9) * 0.6);
    const sector = mkSeries(sectorRets);
    const stockRets = mktRets.map((r, i) => 1.0 * r + 0.8 * (Math.sin(i * 0.9) * 0.6) + Math.cos(i * 2.3) * 0.2);
    const stock = mkSeries(stockRets);
    const a = attributeReturn({ stock, market, sector, horizonDays: 21 });
    ok(a != null, "attribution with sector: result");
    if (a) {
      ok(a.components.length === 3, "attribution with sector: 3 buckets");
      ok(a.betaSector !== null && a.sectorExcessReturn !== null, "attribution with sector: sector stats present");
      const sum = a.components.reduce((s, c) => s + c.contribution, 0);
      approx(sum, a.totalReturn, 1e-9, "attribution with sector: components still sum to total");
      const shares = a.components.reduce((s, c) => s + c.share, 0);
      approx(shares, 1, 1e-9, "attribution with sector: shares sum to 1");
      ok(a.components.every((c) => c.share >= 0 && c.share <= 1), "attribution: every share in [0,1]");
    }
  }

  // — Sector identical to the market must NOT produce a degenerate second leg. —
  // (unknown sector falls back to SPY upstream; caller passes null, and even if the same
  //  array leaks through the identity must hold and shares stay finite)
  {
    const stock = mkSeries(mktRets.map((r, i) => 1.3 * r + Math.sin(i * 5.1) * 0.4));
    const a = attributeReturn({ stock, market, sector: market, horizonDays: 5 });
    ok(a != null, "attribution sector==market: result");
    if (a) {
      const sum = a.components.reduce((s, c) => s + c.contribution, 0);
      approx(sum, a.totalReturn, 1e-9, "attribution sector==market: identity holds");
      ok(a.components.every((c) => Number.isFinite(c.contribution) && Number.isFinite(c.share)), "attribution sector==market: no NaN/Infinity leaks");
      approx(a.sectorExcessReturn ?? 0, 0, 1e-9, "attribution sector==market: sector excess is ~0 (fully orthogonalized away)");
    }
  }

  // — Date alignment: a hole in the market series must not shift the stock series. —
  // Window deliberately larger than the history so sampleDays reports the true overlap.
  {
    const stock = mkSeries(mktRets.map((r) => 2 * r));
    const full = attributeReturn({ stock, market, sector: null, horizonDays: 5, betaWindow: 400 });
    const holed = market.filter((_, i) => i !== 3 && i !== 17);
    const a = attributeReturn({ stock, market: holed, sector: null, horizonDays: 5, betaWindow: 400 });
    ok(a != null && full != null, "attribution with gaps: result");
    if (a && full) {
      // Index-aligning would smear the stock against the wrong days and wreck beta;
      // date-aligning keeps it at 2 while simply using fewer observations.
      approx(a.betaMarket, 2, 0.15, `attribution with gaps: beta still ≈2 (${a.betaMarket.toFixed(3)})`);
      ok(a.sampleDays < full.sampleDays, `attribution with gaps: overlap shrinks (${a.sampleDays} < ${full.sampleDays})`);
      ok(full.sampleDays > 120, `attribution: betaWindow can exceed the default (${full.sampleDays})`);
      approx(a.components.reduce((s, c) => s + c.contribution, 0), a.totalReturn, 1e-9, "attribution with gaps: identity holds");
    }
  }

  // — Degradation: bad inputs return null instead of a wrong answer. —
  {
    const stock = mkSeries(mktRets.map((r) => 2 * r));
    ok(attributeReturn({ stock, market, sector: null, horizonDays: 0 }) === null, "attribution: horizon 0 → null");
    ok(attributeReturn({ stock, market, sector: null, horizonDays: -5 }) === null, "attribution: negative horizon → null");
    ok(attributeReturn({ stock, market, sector: null, horizonDays: NaN }) === null, "attribution: NaN horizon → null");
    ok(attributeReturn({ stock: [], market, sector: null, horizonDays: 1 }) === null, "attribution: empty stock → null");
    ok(attributeReturn({ stock, market: [], sector: null, horizonDays: 1 }) === null, "attribution: empty market → null");
    ok(attributeReturn({ stock: stock.slice(0, 10), market: market.slice(0, 10), sector: null, horizonDays: 1 }) === null, "attribution: sample below minimum → null");
    // Disjoint dates → no overlap → null, not a garbage beta. Shift every year back a
    // decade so the two calendars cannot intersect at all.
    const shifted = market.map((p) => ({ date: p.date.replace(/^\d{4}/, (y) => String(Number(y) - 10)), close: p.close }));
    ok(shifted.every((p) => !market.some((m) => m.date === p.date)), "attribution: shifted calendar truly disjoint (test setup)");
    ok(attributeReturn({ stock, market: shifted, sector: null, horizonDays: 1 }) === null, "attribution: no overlapping dates → null");
  }

  // — Beta clamp: a pathological series cannot let one bucket swallow the residual. —
  {
    const wild = mkSeries(mktRets.map((r, i) => 50 * r + Math.sin(i) * 0.01));
    const a = attributeReturn({ stock: wild, market, sector: null, horizonDays: 5 });
    ok(a != null && Math.abs(a.betaMarket) <= 3 + 1e-9, `attribution: beta clamped to ±3 (${a?.betaMarket.toFixed(2)})`);
    if (a) approx(a.components.reduce((s, c) => s + c.contribution, 0), a.totalReturn, 1e-9, "attribution clamped: identity still exact");
  }

  // — toDatedCloses: sanitizes raw rows. —
  {
    const rows = [
      { date: "2026-08-17T00:00:00Z", close: 101 },
      { date: "2026-08-16", close: "100" },
      { date: "2026-08-15", close: 0 },        // non-positive → dropped
      { date: "2026-08-14", close: "abc" },    // NaN → dropped
      { date: null, close: 99 },               // no date → dropped
      null,                                     // null row → dropped
    ];
    const cleaned = toDatedCloses(rows);
    ok(cleaned.length === 2, `toDatedCloses: keeps only usable rows (${cleaned.length})`);
    ok(cleaned[0].date === "2026-08-17", "toDatedCloses: trims timestamp to ISO day");
    ok(cleaned[1].close === 100, "toDatedCloses: coerces numeric strings");
    ok(toDatedCloses(null).length === 0 && toDatedCloses(undefined).length === 0, "toDatedCloses: null/undefined → []");

    // Provider order must not matter: an oldest-first feed would otherwise invert
    // every sign downstream. Sorting by date makes that failure unrepresentable.
    const oldestFirst = [
      { date: "2026-08-14", close: 97 },
      { date: "2026-08-15", close: 98 },
      { date: "2026-08-16", close: 99 },
      { date: "2026-08-17", close: 101 },
    ];
    const norm = toDatedCloses(oldestFirst);
    ok(norm[0].date === "2026-08-17" && norm[norm.length - 1].date === "2026-08-14", "toDatedCloses: oldest-first input is normalized to newest-first");
    // Duplicate days collapse to one bar (first occurrence wins).
    const dupes = toDatedCloses([{ date: "2026-08-17", close: 101 }, { date: "2026-08-17", close: 999 }, { date: "2026-08-16", close: 99 }]);
    ok(dupes.length === 2 && dupes[0].close === 101, `toDatedCloses: de-duplicates by day (${dupes.length} rows, first close ${dupes[0].close})`);

    // End-to-end: the same data fed in reverse order must attribute identically.
    {
      const rev = (s) => [...s].reverse().map((p) => ({ date: p.date, close: p.close }));
      const stockRows = mkSeries(mktRets.map((r) => 1.5 * r)).map((p) => ({ date: p.date, close: p.close }));
      const marketRows = market.map((p) => ({ date: p.date, close: p.close }));
      const fwd = attributeReturn({ stock: toDatedCloses(stockRows), market: toDatedCloses(marketRows), sector: null, horizonDays: 5 });
      const bwd = attributeReturn({ stock: toDatedCloses(rev(stockRows)), market: toDatedCloses(rev(marketRows)), sector: null, horizonDays: 5 });
      ok(fwd != null && bwd != null, "attribution order-invariance: both directions produce a result");
      if (fwd && bwd) {
        approx(bwd.totalReturn, fwd.totalReturn, 1e-9, "attribution order-invariance: same total return");
        approx(bwd.betaMarket, fwd.betaMarket, 1e-9, "attribution order-invariance: same beta");
        approx(bwd.idioReturn, fwd.idioReturn, 1e-9, "attribution order-invariance: same residual");
      }
    }
  }

  // — dominantDriver: refuses to attribute noise. —
  {
    const tiny = mkSeries(Array.from({ length: n }, (_, i) => (i === 0 ? 0.01 : Math.sin(i * 1.7) * 0.9)));
    const a = attributeReturn({ stock: tiny, market, sector: null, horizonDays: 1 });
    ok(a != null, "dominantDriver: setup result");
    if (a) ok(dominantDriver(a) === null, `dominantDriver: sub-threshold move → null (total ${a.totalReturn.toFixed(3)}%)`);
  }
}

// ── Verdict (answer-first headline, 2026-08-17) ──────────────────────────────
{
  const scores = { value: 18, health: 22, momentum: 19, growth: 14, total: 68 };
  const tech = { mom12_1: 24, rsVsSector: 6, rsVsSpy: 9, rsi14: 58, pctFrom200dma: 12 };
  const base = { scores, icScore: 71, regime: "expansion", riskOn: 62, impliedCorr: 15, sector: "Technology", technicals: tech };

  // — The whole reason this module exists: it must reproduce, exactly, the manual
  //   composition the Overview tab does inline. If these ever drift, the headline card
  //   and the detail panel would show two different calls for the same stock. —
  {
    const v = buildVerdict(base);
    const ft = factorTiltsFromScores(scores);
    const tf = timeframeReads({
      regime: "expansion", riskOn: 62, sector: "Technology", factorTilts: ft,
      mom12_1: tech.mom12_1, rsVsSector: tech.rsVsSector, rsVsSpy: tech.rsVsSpy,
      rsi14: tech.rsi14, pctFrom200dma: tech.pctFrom200dma,
    });
    const pickR = stockPickingRegime(15);
    const corr = pickR.regime === "favorable" ? "low" : pickR.regime === "unfavorable" ? "high" : "mid";
    const rt = ratingFrom(71, tf, { corrRegime: corr });
    ok(v.rating === rt.rating, `verdict matches inline composition: rating (${v.rating} vs ${rt.rating})`);
    ok(v.directional === rt.directional, `verdict matches inline composition: directional (${v.directional} vs ${rt.directional})`);
    ok(v.convictionPct === rt.convictionPct, `verdict matches inline composition: conviction% (${v.convictionPct} vs ${rt.convictionPct})`);
    ok(v.conviction === rt.conviction, "verdict matches inline composition: conviction label");
    ok(v.summary === tf.summary && v.confluence === tf.confluence, "verdict matches inline composition: confluence + summary");
    ok(v.note === rt.note, "verdict matches inline composition: note");
    ok(JSON.stringify(v.perTimeframe) === JSON.stringify(rt.perTimeframe), "verdict matches inline composition: perTimeframe calls");
    ok(v.timeframes.monthly.score === tf.monthly.score && v.timeframes.weekly.score === tf.weekly.score && v.timeframes.daily.score === tf.daily.score, "verdict matches inline composition: timeframe scores");
    for (const k of ["monthly", "weekly", "daily"]) {
      ok(["Strong Buy", "Buy", "Sell", "Strong Sell"].includes(v.perTimeframe[k]), `verdict: perTimeframe.${k} is a valid rating (${v.perTimeframe[k]})`);
    }
  }

  // — Shape and contract. —
  {
    const v = buildVerdict(base);
    ok(["Strong Buy", "Buy", "Sell", "Strong Sell"].includes(v.rating), `verdict: rating in the 4-way set (${v.rating})`);
    ok(["Low", "Medium", "High"].includes(v.conviction), `verdict: conviction label valid (${v.conviction})`);
    ok(v.directional >= 0 && v.directional <= 100, `verdict: directional in [0,100] (${v.directional})`);
    ok(v.convictionPct >= 0 && v.convictionPct <= 100, `verdict: conviction% in [0,100] (${v.convictionPct})`);
    ok(v.reasons.length > 0 && v.reasons.length <= 3, `verdict: 1-3 plain reasons (${v.reasons.length})`);
    ok(v.reasons.every((r) => typeof r === "string" && r.length > 0), "verdict: no empty reasons");
    ok(typeof v.whatWouldChangeIt === "string" && v.whatWouldChangeIt.length > 10, "verdict: falsifier present and non-trivial");
    ok(typeof v.color === "string" && v.color.length > 0, "verdict: color present");
  }

  // — Determinism: a verdict that changes between identical calls cannot be audited. —
  {
    const a = buildVerdict(base), b = buildVerdict(base);
    ok(JSON.stringify(a) === JSON.stringify(b), "verdict: deterministic for identical inputs");
  }

  // — Every confluence state has a falsifier (no undefined leaking into the UI). —
  {
    const states = ["structural-buy", "leader-extended", "bounce-vs-macro", "improving", "avoid", "mixed"];
    const seen = new Set();
    const probes = [
      { regime: "expansion", riskOn: 70, mom12_1: 30, rsVsSector: 10, rsVsSpy: 12, rsi14: 55, pctFrom200dma: 10 },
      { regime: "expansion", riskOn: 70, mom12_1: 40, rsVsSector: 15, rsVsSpy: 18, rsi14: 82, pctFrom200dma: 30 },
      { regime: "contraction", riskOn: 20, mom12_1: 15, rsVsSector: 5, rsVsSpy: 4, rsi14: 60, pctFrom200dma: 5 },
      { regime: "expansion", riskOn: 65, mom12_1: -20, rsVsSector: -8, rsVsSpy: -9, rsi14: 25, pctFrom200dma: -12 },
      { regime: "contraction", riskOn: 15, mom12_1: -30, rsVsSector: -12, rsVsSpy: -15, rsi14: 35, pctFrom200dma: -20 },
      { regime: "stagflation", riskOn: 45, mom12_1: 5, rsVsSector: 0, rsVsSpy: 1, rsi14: 50, pctFrom200dma: 0 },
    ];
    for (const p of probes) {
      const v = buildVerdict({ ...base, regime: p.regime, riskOn: p.riskOn, technicals: { mom12_1: p.mom12_1, rsVsSector: p.rsVsSector, rsVsSpy: p.rsVsSpy, rsi14: p.rsi14, pctFrom200dma: p.pctFrom200dma } });
      seen.add(v.confluence);
      ok(typeof v.whatWouldChangeIt === "string" && v.whatWouldChangeIt.length > 10, `verdict falsifier present for confluence "${v.confluence}"`);
      ok(states.includes(v.confluence), `verdict: confluence is a known state (${v.confluence})`);
    }
    ok(seen.size >= 3, `verdict probes exercise multiple confluence states (${seen.size})`);
  }

  // — Monotonic in the score, timeframes held fixed. —
  {
    const lo = buildVerdict({ ...base, icScore: 30 });
    const hi = buildVerdict({ ...base, icScore: 90 });
    ok(hi.directional > lo.directional, `verdict: directional monotonic in score (${lo.directional} → ${hi.directional})`);
  }

  // — corrRegimeFrom delegates to stockPickingRegime; check the boundaries agree. —
  {
    ok(corrRegimeFrom(null) === "mid", "corrRegime: null → mid");
    ok(corrRegimeFrom(10) === "low", "corrRegime: 10 → low (dispersion favors selection)");
    ok(corrRegimeFrom(19.9) === "low", "corrRegime: 19.9 → low");
    ok(corrRegimeFrom(20) === "mid", "corrRegime: 20 → mid (boundary)");
    ok(corrRegimeFrom(40) === "mid", "corrRegime: 40 → mid (boundary)");
    ok(corrRegimeFrom(40.1) === "high", "corrRegime: 40.1 → high (macro tape)");
    // Delegation is real, not a copied threshold table.
    for (const c of [null, 5, 19.9, 20, 33, 40, 40.1, 80]) {
      const expect = stockPickingRegime(c).regime === "favorable" ? "low" : stockPickingRegime(c).regime === "unfavorable" ? "high" : "mid";
      ok(corrRegimeFrom(c) === expect, `corrRegime delegates for impliedCorr=${c}`);
    }
    // High correlation must not produce more conviction than low correlation.
    const low = buildVerdict({ ...base, impliedCorr: 10 });
    const high = buildVerdict({ ...base, impliedCorr: 70 });
    ok(high.convictionPct <= low.convictionPct, `verdict: high correlation caps conviction (${high.convictionPct} ≤ ${low.convictionPct})`);
  }

  // — factorTiltsFromScores: the documented mapping, exactly. —
  {
    const ft = factorTiltsFromScores({ value: 25, health: 30, momentum: 25, growth: 14, total: 70 });
    approx(ft.value, 20, 1e-9, "factorTilts: value 25/25 → 20");
    approx(ft.quality, 20, 1e-9, "factorTilts: health 30/30 → 20");
    approx(ft.momentum, 20, 1e-9, "factorTilts: momentum 25/25 → 20");
    ok(ft.growth === 14 && ft.size === 10, "factorTilts: growth passes through, size fixed at 10");
  }

  // — Technical helpers. —
  {
    ok(smaOf([10, 20, 30], 3) === 20, "smaOf: mean of the window");
    ok(smaOf([10, 20], 3) === null, "smaOf: too short → null");
    ok(smaOf([10, 20, 30], 0) === null, "smaOf: non-positive period → null");

    // Strictly rising newest-first series: every step was a gain → RSI 100.
    ok(rsiOf([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14) === 100, "rsiOf: all gains → 100");
    // Flat series has neither gains nor losses — 50 (neutral), not a divide-by-zero 100.
    ok(rsiOf(new Array(15).fill(7), 14) === 50, "rsiOf: flat series → 50 (neutral, guarded)");
    ok(rsiOf([1, 2, 3], 14) === null, "rsiOf: too short → null");

    approx(periodReturn([110, 100], 1), 10, 1e-9, "periodReturn: +10%");
    ok(periodReturn([110, 100], 5) === null, "periodReturn: horizon beyond history → null");
    ok(periodReturn([110, 0], 1) === null, "periodReturn: zero base → null (no divide-by-zero)");
    ok(periodReturn([110, 100], -1) === null, "periodReturn: negative horizon → null");
  }

  // — deriveTechnicals: degrades to nulls instead of NaN when history is thin. —
  {
    const thin = deriveTechnicals({ stockCloses: [10, 9, 8], spyCloses: [5, 4], sectorCloses: [], price: 10 });
    ok(thin.mom12_1 === null && thin.rsVsSector === null && thin.rsVsSpy === null, "deriveTechnicals: thin history → nulls");
    ok(thin.rsi14 === null && thin.pctFrom200dma === null, "deriveTechnicals: thin history → null rsi/200dma");
    ok(Object.values(thin).every((v) => v === null || Number.isFinite(v)), "deriveTechnicals: never emits NaN");

    // Full history: values are finite and the relative-strength legs are consistent.
    const n = 300;
    const stockCloses = Array.from({ length: n }, (_, i) => 100 * Math.pow(1.0008, n - i));
    const spyCloses = Array.from({ length: n }, (_, i) => 400 * Math.pow(1.0004, n - i));
    const sectorCloses = Array.from({ length: n }, (_, i) => 200 * Math.pow(1.0006, n - i));
    const full = deriveTechnicals({ stockCloses, spyCloses, sectorCloses, price: stockCloses[0] });
    ok(Object.values(full).every((v) => v !== null && Number.isFinite(v)), "deriveTechnicals: full history → all finite");
    ok(full.rsVsSpy > full.rsVsSector, `deriveTechnicals: outperforms SPY more than its sector (${full.rsVsSpy.toFixed(2)} > ${full.rsVsSector.toFixed(2)})`);
    ok(full.pctFrom200dma > 0, "deriveTechnicals: rising series sits above its 200-day average");
    ok(full.mom12_1 > 0, "deriveTechnicals: rising series has positive 12-1 momentum");
    // Falls back to the latest close when no live price is supplied.
    const noPrice = deriveTechnicals({ stockCloses, spyCloses, sectorCloses, price: null });
    approx(noPrice.pctFrom200dma, full.pctFrom200dma, 1e-9, "deriveTechnicals: null price falls back to latest close");
  }

  // — Horizon: the reader's holding period reshapes the blend. —
  {
    // Every row must be a proper weighting.
    for (const [h, w] of Object.entries(HORIZON_WEIGHTS)) {
      approx(w.s + w.w + w.m + w.d, 1, 1e-9, `horizon weights sum to 1 (${h})`);
      ok([w.s, w.w, w.m, w.d].every((x) => x >= 0), `horizon weights non-negative (${h})`);
    }
    // "months" IS the historical blend — omitting horizon must not change a thing.
    {
      const tf = timeframeReads({ regime: "expansion", riskOn: 60, sector: "Technology", factorTilts: factorTiltsFromScores(scores), ...tech });
      const implicit = ratingFrom(68, tf, { corrRegime: "low" });
      const explicit = ratingFrom(68, tf, { corrRegime: "low", horizon: "months" });
      ok(JSON.stringify(implicit) === JSON.stringify(explicit), "horizon: omitted === months (backward compatible)");
      ok(HORIZON_WEIGHTS.months.s === 0.40 && HORIZON_WEIGHTS.months.w === 0.30 && HORIZON_WEIGHTS.months.m === 0.20 && HORIZON_WEIGHTS.months.d === 0.10, "horizon: months preserves the original 40/30/20/10 blend");
    }
    // Labels exist for every horizon (no undefined leaking into the selector).
    for (const h of ["days", "months", "years"]) {
      ok(typeof HORIZON_LABEL[h] === "string" && HORIZON_LABEL[h].length > 0, `horizon label present (${h})`);
      const v = buildVerdict({ ...base, horizon: h });
      ok(v.horizon === h, `verdict echoes the horizon it was computed for (${h})`);
    }

    // The emblematic case: strong fundamentals, wrecked short-term timing.
    // A years reader should see a different call than a days reader — and saying so is
    // more honest than averaging them into a number that describes nobody.
    {
      const strongFundamentals = { value: 22, health: 28, momentum: 8, growth: 16, total: 82 };
      const badTiming = { mom12_1: -6, rsVsSector: -3, rsVsSpy: -4, rsi14: 22, pctFrom200dma: -14 };
      const shared = { scores: strongFundamentals, icScore: 84, regime: "expansion", riskOn: 60, impliedCorr: 15, sector: "Technology", technicals: badTiming };
      const years = buildVerdict({ ...shared, horizon: "years" });
      const days = buildVerdict({ ...shared, horizon: "days" });
      ok(years.directional > days.directional, `horizon: long view scores higher than short view on strong-fundamentals/bad-timing (${years.directional} vs ${days.directional})`);
      // Same inputs, same timeframe reads — only the blend differs.
      ok(JSON.stringify(years.timeframes) === JSON.stringify(days.timeframes), "horizon: timeframe reads are shared, only the blend changes");
      ok(years.confluence === days.confluence, "horizon: confluence is horizon-independent");
    }

    // Mirror case: weak fundamentals but an excellent short-term setup.
    {
      const weakFundamentals = { value: 6, health: 9, momentum: 22, growth: 4, total: 30 };
      const goodTiming = { mom12_1: 35, rsVsSector: 12, rsVsSpy: 14, rsi14: 52, pctFrom200dma: 6 };
      const shared = { scores: weakFundamentals, icScore: 32, regime: "expansion", riskOn: 65, impliedCorr: 15, sector: "Technology", technicals: goodTiming };
      const years = buildVerdict({ ...shared, horizon: "years" });
      const days = buildVerdict({ ...shared, horizon: "days" });
      ok(days.directional > years.directional, `horizon: short view scores higher on weak-fundamentals/good-setup (${days.directional} vs ${years.directional})`);
    }

    // Sensitivity: the days blend must react to the daily read; the years blend must not.
    {
      const mk = (rsi, pct) => ({ ...base, technicals: { ...tech, rsi14: rsi, pctFrom200dma: pct } });
      const dOversold = ratingFrom(68, timeframeReads({ regime: "expansion", riskOn: 60, sector: "Technology", factorTilts: factorTiltsFromScores(scores), ...tech, rsi14: 20, pctFrom200dma: -15 }), { horizon: "years" });
      const dOverbought = ratingFrom(68, timeframeReads({ regime: "expansion", riskOn: 60, sector: "Technology", factorTilts: factorTiltsFromScores(scores), ...tech, rsi14: 85, pctFrom200dma: 25 }), { horizon: "years" });
      // years has zero weight on the daily read, so any difference must come from the
      // monthly/weekly reads those inputs also feed — never from the daily leg itself.
      ok(HORIZON_WEIGHTS.years.d === 0, "horizon: years puts no weight on the daily entry read");
      ok(Number.isFinite(dOversold.directional) && Number.isFinite(dOverbought.directional), "horizon: years blend stays finite across timing extremes");
      ok(buildVerdict(mk(20, -15)).horizon === "months", "horizon: default remains months when unspecified");
    }
  }

  // — A verdict survives entirely-missing technicals (new listing, no history). —
  {
    const v = buildVerdict({ ...base, technicals: { mom12_1: null, rsVsSector: null, rsVsSpy: null, rsi14: null, pctFrom200dma: null } });
    ok(["Strong Buy", "Buy", "Sell", "Strong Sell"].includes(v.rating), "verdict: still produces a call with no technicals");
    ok(Number.isFinite(v.directional) && Number.isFinite(v.convictionPct), "verdict: no NaN with no technicals");
  }
}

// ── Shared horizon store (2026-08-17) ────────────────────────────────────────
{
  __resetHorizonForTests();
  // No localStorage in Node — the store must fall back to the default, not throw.
  ok(readHorizon() === "months", `horizon store: defaults to months without storage (${readHorizon()})`);

  let fired = 0;
  const unsub = subscribeHorizon(() => { fired++; });

  setHorizon("years");
  ok(readHorizon() === "years", "horizon store: accepts a valid value");
  ok(fired === 1, `horizon store: notifies subscribers on change (${fired})`);

  // Re-setting the same value must not churn every subscribed component.
  setHorizon("years");
  ok(fired === 1, `horizon store: no notification when the value is unchanged (${fired})`);

  // Garbage must not become state — this value drives a rating blend.
  setHorizon("bogus");
  ok(readHorizon() === "years", `horizon store: rejects an invalid value (${readHorizon()})`);
  setHorizon(null);
  setHorizon(undefined);
  ok(readHorizon() === "years", "horizon store: rejects null/undefined");
  ok(fired === 1, `horizon store: invalid values do not notify (${fired})`);

  setHorizon("days");
  ok(readHorizon() === "days" && fired === 2, "horizon store: switches again and notifies");

  unsub();
  setHorizon("months");
  ok(fired === 2, "horizon store: unsubscribed listener stops receiving");
  ok(readHorizon() === "months", "horizon store: value still updates after unsubscribe");

  // Every value the store can hold must be a value the rating blend knows.
  for (const h of ["days", "months", "years"]) {
    __resetHorizonForTests();
    setHorizon(h);
    ok(HORIZON_WEIGHTS[readHorizon()] !== undefined, `horizon store: "${h}" maps to a known weight row`);
  }
  __resetHorizonForTests();
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n${failed === 0 ? "✓" : "✗"} golden: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of fails) console.error("  ✗ " + f); process.exit(1); }
