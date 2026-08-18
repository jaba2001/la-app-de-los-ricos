// P2 math self-tests — BSM greeks, trend forecast, mean-variance optimizer.
// Run: node --experimental-strip-types --no-warnings scripts/p2.test.mjs
import { blackScholes, breakEven, payoffAtExpiry, analyzeStrategy, buildStrategy, volRank, rollingRealizedVol, buildIncomePlan, incomeGate, realizedVolFromCloses } from "../lib/greeks.ts";
import { forecastSeries } from "../lib/forecast.ts";
import { minVariance, maxSharpe, portfolioStats, covariance, invert } from "../lib/optimize.ts";
import { calcSubScores } from "../lib/scoring.ts";
import { smaLast, trendStage, detectBaseBreakout } from "../lib/technicalIndicators.ts";
import { equalWeightPlan } from "../lib/kelly.ts";
import { computeExposure, detectTheme } from "../lib/exposure.ts";
import { netManagedMoney, wowChange, netAsPctOfOI, goldSilverRatio, positioningRead } from "../lib/metals.ts";
import { getEtf, overlap, cheaperAlternatives } from "../lib/etf.ts";
import { altmanZ, accrualsRatio, dupont, mertonPD, piotroskiF, beneishM, normCdf } from "../lib/quality.ts";
import { waccBridge, dcfMatrix, sectorComps } from "../lib/valuation.ts";
import { effectiveDuration, impliedCreditLoss, bondMetrics } from "../lib/bonds.ts";
import { difference, fitAR, forecastARIMA } from "../lib/arima.ts";
import { esgLite } from "../lib/esg.ts";

let pass = 0, fail = 0;
function approx(name, got, want, tol = 1e-3) {
  if (Math.abs(got - want) <= tol) { pass++; }
  else { fail++; console.error(`✗ ${name}: got ${got}, want ${want} (tol ${tol})`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`✗ ${name}`); } }

// ── Black-Scholes (textbook: S=K=100, T=1, σ=20%, r=5%, q=0) ──
const call = blackScholes(100, 100, 1, 0.2, 0.05, 0, "call");
const put  = blackScholes(100, 100, 1, 0.2, 0.05, 0, "put");
approx("BSM call price", call.price, 10.4506, 2e-3);
approx("BSM put price",  put.price,  5.5735, 2e-3);
approx("BSM call delta", call.delta, 0.6368, 2e-3);
approx("BSM put delta",  put.delta, -0.3632, 2e-3);
approx("BSM gamma",      call.gamma, 0.018762, 1e-4);
approx("BSM vega(1%)",   call.vega / 100, 0.375240, 1e-3);
// Put-call parity: C − P = S − K·e^(−rT)
approx("put-call parity", call.price - put.price, 100 - 100 * Math.exp(-0.05), 1e-3);
// Expiry degenerate case → intrinsic
approx("BSM at expiry (ITM call)", blackScholes(110, 100, 0, 0.2, 0.05, 0, "call").price, 10, 1e-9);
approx("breakeven call", breakEven(100, 5, "call"), 105, 1e-9);
approx("payoff call ITM net", payoffAtExpiry(120, 100, 5, "call"), 15, 1e-9);

// ── Forecast ──
const geo = forecastSeries([100, 110, 121, 133.1], 2); // perfect +10%/period
ok("forecast geometric method", geo?.method === "geometric");
approx("forecast growth rate", geo.growthRate, 0.10, 1e-3);
approx("forecast next point", geo.points[0], 146.41, 0.05);
approx("forecast r2 ~1", geo.r2, 1, 1e-3);
// non-positive value forces the LINEAR branch: y = 4 − 2·i → next (i=4) = −4
const lin = forecastSeries([4, 2, 0, -2], 1);
ok("forecast linear method", lin?.method === "linear");
approx("forecast linear next", lin.points[0], -4, 1e-6);
ok("forecast too-short → null", forecastSeries([1, 2], 4) === null);

// ── Optimizer ──
const inv = invert([[2, 0], [0, 4]]);
approx("invert diag [0][0]", inv[0][0], 0.5, 1e-9);
approx("invert diag [1][1]", inv[1][1], 0.25, 1e-9);
ok("invert singular → null", invert([[1, 1], [1, 1]]) === null);

const mv = minVariance([[0.04, 0], [0, 0.09]]);
approx("min-var w0", mv[0], 0.6923, 1e-3);
approx("min-var w1", mv[1], 0.3077, 1e-3);
approx("min-var sums to 1", mv[0] + mv[1], 1, 1e-9);

const ms = maxSharpe([0.10, 0.15], [[0.04, 0], [0, 0.09]], 0.02);
approx("max-sharpe w0", ms[0], 0.5806, 1e-3);
approx("max-sharpe w1", ms[1], 0.4194, 1e-3);

const stats = portfolioStats([0.5, 0.5], [0.10, 0.15], [[0.04, 0], [0, 0.09]], 0.02);
approx("port return", stats.ret, 0.125, 1e-9);
approx("port vol", stats.vol, Math.sqrt(0.25 * 0.04 + 0.25 * 0.09), 1e-9);
ok("port sharpe > 0", stats.sharpe > 0);

// covariance sanity: two identical series → equal variances, equal covariance
const cv = covariance([[1, 2, 3, 4], [2, 4, 6, 8]]);
ok("cov symmetric", Math.abs(cv[0][1] - cv[1][0]) < 1e-12);
ok("cov positive var", cv[0][0] > 0 && cv[1][1] > 0);

// ── T1.1 · Moat & Cash-Flow sub-scores ──
const subHi = calcSubScores({ grossProfitability: 50, roic: 25, grossMargin: 65, capexToRevenue: 0.03, fcfYield: 0.09, fcfGrowthYoy: 30, epsGrowth: 10, pfcf: 12 });
approx("moat top-tier", subHi.moat.score, 10, 1e-9);
approx("cashflow top-tier", subHi.cashFlow.score, 10, 1e-9);
const subNull = calcSubScores({});
ok("moat null when no inputs", subNull.moat === null);
ok("cashflow null when no inputs", subNull.cashFlow === null);
const subPartial = calcSubScores({ grossProfitability: 30 });
approx("moat partial normalized", subPartial.moat.score, 7.5, 1e-9);
ok("moat partial one factor", subPartial.moat.factors.length === 1);

// ── T1.2 · SMA / stage / base breakout ──
approx("smaLast basic", smaLast([1, 2, 3, 4, 5], 5), 3, 1e-9);
ok("smaLast too short → null", smaLast([1, 2], 5) === null);
const upBars = Array.from({ length: 180 }, (_, i) => { const c = 100 + i; return { open: c, high: c, low: c, close: c, volume: 100 }; });
const upStage = trendStage(upBars);
ok("uptrend → stage 2", upStage.stage === 2);
ok("uptrend above sma150", upStage.aboveSma150 === true);
ok("uptrend positive slope", upStage.slopePct > 0);
const downBars = Array.from({ length: 180 }, (_, i) => { const c = 300 - i; return { open: c, high: c, low: c, close: c, volume: 100 }; });
ok("downtrend → stage 4", trendStage(downBars).stage === 4);
const flat = Array.from({ length: 160 }, () => ({ open: 100, high: 100, low: 100, close: 100, volume: 100 }));
const brkData = [...flat.slice(0, 159), { open: 100, high: 110, low: 100, close: 110, volume: 300 }];
const brk = detectBaseBreakout(brkData);
ok("base breakout detected", brk.status === "base-breakout");
ok("base breakout volume confirmed", brk.volumeConfirmed === true);
ok("base breakout above trend", brk.aboveTrend === true);
ok("flat base → in-base", detectBaseBreakout(flat).status === "in-base");

// ── T1.4 · equal-weight sizing ──
const plan10 = equalWeightPlan(100000, 10, 0);
approx("equal-weight full", plan10.fullWeight, 0.1, 1e-9);
approx("equal-weight $/full", plan10.fullDollars, 10000, 1e-9);
approx("equal-weight dd20", plan10.drawdownImpact20, 2, 1e-9);
ok("equal-weight within cap", plan10.exceedsCap === false);
ok("2 names exceed cap", equalWeightPlan(100000, 2, 0).exceedsCap === true);
const planMix = equalWeightPlan(100000, 4, 2);
approx("mixed full weight", planMix.fullWeight, 0.2, 1e-9);
approx("mixed half weight", planMix.halfWeight, 0.1, 1e-9);
ok("sizing null on zero pv", equalWeightPlan(0, 10) === null);
ok("sizing null on zero names", equalWeightPlan(100000, 0, 0) === null);

// ── T1.3 · exposure & theme ──
ok("theme AI", detectTheme("AI infrastructure play") === "AI");
ok("theme energy", detectTheme("oil and gas midstream") === "Energy / Oil & Gas");
ok("theme none", detectTheme("miscellaneous idea") === null);
ok("theme null input", detectTheme(null) === null);
const exp = computeExposure([{ ticker: "A", value: 60, sector: "Tech" }, { ticker: "B", value: 40, sector: "Tech" }]);
approx("exposure top weight", exp.topWeight, 0.6, 1e-9);
approx("exposure sector weight", exp.bySector[0].weight, 1, 1e-9);
approx("exposure hhi", exp.hhi, 0.52, 1e-9);
ok("exposure flags concentration", exp.flags.length >= 2);

// ── T2.1 · metals COT math ──
approx("managed-money net", netManagedMoney({ managedLong: 141060, managedShort: 17474 }), 123586, 1e-9);
approx("gold/silver ratio", goldSilverRatio(300, 30), 100, 1e-9);
ok("gsr null guard", goldSilverRatio(null, 30) === null);
approx("cot wow change", wowChange([
  { date: "2026-07-14", managedLong: 100, managedShort: 20, openInterest: 1000 },
  { date: "2026-07-21", managedLong: 150, managedShort: 20, openInterest: 1000 },
]), 50, 1e-9);
approx("net as pct of OI", netAsPctOfOI({ date: "x", managedLong: 200, managedShort: 0, openInterest: 1000 }), 0.2, 1e-9);
ok("positioning tone pos", positioningRead({ date: "x", managedLong: 300, managedShort: 0, openInterest: 1000 }, 10).tone === "pos");

// ── T2.2 · ETF overlap & cost ──
const ovSame = overlap(getEtf("SPY"), getEtf("VOO"));
ok("SPY/VOO overlap measurable", ovSame.measurable === true);
ok("SPY/VOO overlap high", ovSame.overlapPct > 30);
ok("SPY/VOO shares 10", ovSame.shared.length === 10);
ok("SPY/AGG not measurable", overlap(getEtf("SPY"), getEtf("AGG")).measurable === false);
ok("SCHD/QQQ zero overlap", overlap(getEtf("SCHD"), getEtf("QQQ")).overlapPct === 0);
const alts = cheaperAlternatives("SPY");
ok("SPY has cheaper alts", alts.length >= 2);
ok("cheapest alt first", alts[0].expenseRatio <= alts[alts.length - 1].expenseRatio);

// ── FASE 1 · quality/credit scores ──
ok("normCdf(0)=0.5", Math.abs(normCdf(0) - 0.5) < 1e-6);
ok("normCdf(1.96)≈0.975", Math.abs(normCdf(1.96) - 0.975) < 1e-3);
// Altman Z (manufacturing): TA1000 WC200 RE300 EBIT150 MktEq1200 TL400 Sales900
const az = altmanZ({ workingCapital: 200, retainedEarnings: 300, ebit: 150, marketCap: 1200, bookEquity: 500, totalLiabilities: 400, sales: 900, totalAssets: 1000 });
approx("altman Z", az.z, 3.86, 1e-2);
ok("altman Z safe", az.band === "safe" && az.model === "Z");
const azp = altmanZ({ workingCapital: 200, retainedEarnings: 300, ebit: 150, marketCap: 1200, bookEquity: 500, totalLiabilities: 400, sales: 900, totalAssets: 1000, serviceOrFinancial: true });
approx("altman Z''", azp.z, 7.86, 2e-2);
ok("altman Z'' model", azp.model === "Z''");
ok("altman null on no TA", altmanZ({ workingCapital: 1, retainedEarnings: 1, ebit: 1, marketCap: 1, bookEquity: 1, totalLiabilities: 1, sales: 1, totalAssets: 0 }) === null);
// Accruals
approx("accruals ratio", accrualsRatio(100, 150, 1000).ratio, -0.05, 1e-9);
ok("accruals high quality", accrualsRatio(100, 150, 1000).quality === "high");
ok("accruals low quality", accrualsRatio(200, 50, 1000).quality === "low");
// DuPont — both decompositions reconstruct ROE = NI/equity = 0.2
const dp = dupont({ netIncome: 100, sales: 900, totalAssets: 1000, totalEquity: 500, pretaxIncome: 130, ebit: 150 });
approx("dupont roe3 = ROE", dp.roe3, 0.2, 1e-3);
approx("dupont roe5 = ROE", dp.roe5, 0.2, 1e-3);
approx("dupont asset turnover", dp.assetTurnover, 0.9, 1e-3);
ok("dupont null missing", dupont({ netIncome: 1, sales: 0, totalAssets: 1, totalEquity: 1 }) === null);
// Merton — E100 F100 σE0.6 rf2%
const mt = mertonPD({ marketCap: 100, totalDebt: 100, equityVol: 0.6, riskFreePct: 2 });
approx("merton assetVol", mt.assetVol, 0.4, 1e-2);
approx("merton dd", mt.distanceToDefault, 1.58, 5e-2);
ok("merton pd in range", mt.pd > 0.04 && mt.pd < 0.07);
ok("merton null no vol", mertonPD({ marketCap: 100, totalDebt: 100, equityVol: null, riskFreePct: 2 }) === null);
// Piotroski — all 9 true
const pf = piotroskiF({ roa: 0.1, roaPrev: 0.05, cfo: 100, netIncome: 80, totalAssets: 1000, leverage: 0.2, leveragePrev: 0.3, currentRatio: 2, currentRatioPrev: 1.5, shares: 100, sharesPrev: 100, grossMargin: 0.4, grossMarginPrev: 0.35, assetTurnover: 0.9, assetTurnoverPrev: 0.8 });
ok("piotroski 9/9", pf.score === 9 && pf.max === 9);
const pfPartial = piotroskiF({ roa: 0.1, roaPrev: null, cfo: null, netIncome: null, totalAssets: null, leverage: null, leveragePrev: null, currentRatio: null, currentRatioPrev: null, shares: null, sharesPrev: null, grossMargin: null, grossMarginPrev: null, assetTurnover: null, assetTurnoverPrev: null });
ok("piotroski partial max scales", pfPartial.score === 1 && pfPartial.max === 1);
// Beneish — clean case → M low, unlikely
const bm = beneishM({ receivables: 100, receivablesPrev: 100, sales: 1000, salesPrev: 1000, grossProfit: 400, grossProfitPrev: 400, totalAssets: 2000, totalAssetsPrev: 2000, currentAssets: 800, currentAssetsPrev: 800, ppe: 600, ppePrev: 600, depreciation: 100, depreciationPrev: 100, sga: 200, sgaPrev: 200, totalDebt: 500, totalDebtPrev: 500, netIncome: 100, operatingCashFlow: 120 });
approx("beneish M clean", bm.m, -2.53, 3e-2);
ok("beneish unlikely", bm.flag === "unlikely");
ok("beneish null incomplete", beneishM({ receivables: null, receivablesPrev: 100, sales: 1000, salesPrev: 1000, grossProfit: 400, grossProfitPrev: 400, totalAssets: 2000, totalAssetsPrev: 2000, currentAssets: 800, currentAssetsPrev: 800, ppe: 600, ppePrev: 600, depreciation: 100, depreciationPrev: 100, sga: 200, sgaPrev: 200, totalDebt: 500, totalDebtPrev: 500, netIncome: 100, operatingCashFlow: 120 }) === null);

// ── FASE 2 · valuation ──
const wb = waccBridge({ rf: 4, beta: 1.2, erp: 5.5, taxRate: 0.21, marketCap: 800, totalDebt: 200, interestExpense: 10 });
approx("wacc cost of equity", wb.costOfEquity, 10.6, 1e-2);
approx("wacc cost of debt AT", wb.costOfDebtAfterTax, 3.95, 1e-2);
approx("wacc weight equity", wb.weightEquity, 0.8, 1e-3);
approx("wacc blended", wb.wacc, 9.27, 2e-2);
ok("wacc null no mcap", waccBridge({ rf: 4, beta: 1, marketCap: 0, totalDebt: 1, interestExpense: 1 }) === null);
const dm = dcfMatrix({ revenueTTM: 1000, fcfMarginTTM: 0.15, netDebt: 0, sharesOut: 100 }, [8, 10], [5, 10]);
ok("dcf matrix dims", dm.grid.length === 2 && dm.grid[0].length === 2);
ok("dcf matrix cell positive", typeof dm.grid[0][0] === "number" && dm.grid[0][0] > 0);
ok("dcf matrix higher g → higher value", dm.grid[0][1] > dm.grid[0][0]);
const cmp = sectorComps({ sector: "Technology", eps: 5, ebitda: 200, netDebt: 100, sharesOut: 50 });
approx("comps PE-based", cmp.peBased, 140, 1e-9);
approx("comps EV-based", cmp.evBased, 86, 1e-9);
approx("comps mid", cmp.mid, 113, 1e-9);
ok("comps null no sector", sectorComps({ sector: null, eps: 5, ebitda: 200, netDebt: 100, sharesOut: 50 }) === null);

// ── FASE 3 · bonds ──
const bmMod = bondMetrics(5, 5, 10).modified;
approx("effective ≈ modified (bullet)", effectiveDuration(5, 5, 10), bmMod, 5e-2);
const cl = impliedCreditLoss(300, 0.6);
approx("credit PD 1y", cl.impliedPD1y, 0.05, 1e-4);
approx("credit PD 5y", cl.impliedPD5y, 0.2262, 1e-3);
ok("credit PD zero spread", impliedCreditLoss(0).impliedPD1y === 0);

// ── FASE 4 · option strategies ──
// Bull call spread: long 100c @6, short 110c @2 → debit 4, max profit 6, max loss −4, BE 104.
const bcs = analyzeStrategy([{ kind: "call", qty: 1, strike: 100, premium: 6 }, { kind: "call", qty: -1, strike: 110, premium: 2 }], 100);
approx("bull-call net premium", bcs.netPremium, 4, 1e-9);
approx("bull-call max profit", bcs.maxProfit, 6, 0.2);
approx("bull-call max loss", bcs.maxLoss, -4, 0.1);
ok("bull-call one breakeven ≈104", bcs.breakevens.length === 1 && Math.abs(bcs.breakevens[0] - 104) < 0.6);
// Long call: unbounded profit, loss capped at premium.
const lc = analyzeStrategy([{ kind: "call", qty: 1, strike: 100, premium: 5 }], 100);
ok("long call unbounded profit", lc.maxProfit === null);
approx("long call max loss", lc.maxLoss, -5, 0.1);
// Short call: unbounded loss, profit capped at credit.
const sc = analyzeStrategy([{ kind: "call", qty: -1, strike: 100, premium: 5 }], 100);
ok("short call unbounded loss", sc.maxLoss === null);
approx("short call max profit", sc.maxProfit, 5, 0.1);
// buildStrategy: straddle ~ delta-neutral, unbounded up, bounded loss.
const strad = buildStrategy("straddle", 100, { vol: 0.3, rate: 0.04, t: 0.5 });
ok("straddle built", strad != null && strad.legs.length === 2);
ok("straddle ~delta-neutral", Math.abs(strad.netDelta) < 0.2);
ok("straddle unbounded up", strad.maxProfit === null && strad.maxLoss < 0);
ok("collar built with 3 legs", buildStrategy("collar", 100, { vol: 0.3, rate: 0.04, t: 0.5 }).legs.length === 3);

// ── FASE 5 · ARIMA ──
const df = difference([1, 2, 4, 7], 1);
ok("difference length", df.length === 3);
approx("difference last", df[2], 3, 1e-9);
// AR(1): yₜ = 0.5·yₜ₋₁ + 10, y₀=0 → perfect recovery
const ar1 = [0]; for (let i = 1; i < 30; i++) ar1.push(0.5 * ar1[i - 1] + 10);
const arfit = fitAR(ar1, 1);
approx("fitAR coef ≈0.5", arfit.coef[0], 0.5, 1e-4);
approx("fitAR intercept ≈10", arfit.intercept, 10, 1e-3);
// Linear trend → forecast continues +1
const linTrend = Array.from({ length: 20 }, (_, i) => i + 1);
const af = forecastARIMA(linTrend, 3);
ok("arima method", af.method === "arima" && af.points.length === 3);
approx("arima next", af.points[0], 21, 0.6);
approx("arima next+1", af.points[1], 22, 0.6);
ok("arima too short → null", forecastARIMA([1, 2, 3, 4, 5], 3) === null);

// ── FASE 6 · ESG-lite ──
const esgE = esgLite({ sector: "Energy" });
const esgT = esgLite({ sector: "Technology" });
ok("esg Energy E < Tech E", esgE.e < esgT.e);
ok("esg overall in range", esgE.overall >= 0 && esgE.overall <= 100 && esgT.overall >= 0 && esgT.overall <= 100);
ok("esg governance sweet-spot lifts G", esgLite({ sector: "Financials", insiderOwn: 0.10, instOwn: 0.7, shortFloat: 0.02 }).g > esgLite({ sector: "Financials", insiderOwn: 0.60, shortFloat: 0.25 }).g);
ok("esg null unknown sector", esgLite({ sector: "Nonexistent" }) === null);


// ── Vol rank + income (theta) plans ──────────────────────────────────────────
{
  // volRank: position between own extremes, and share of observations below.
  const hist = Array.from({ length: 100 }, (_, i) => 0.10 + (i / 99) * 0.30); // 10% … 40%
  const mid = volRank(0.25, hist);
  ok("volRank returns a result on a full sample", mid !== null);
  approx("volRank mid of range ~ 50", mid.rank, 50, 1);
  approx("volRank low bound", volRank(0.10, hist).rank, 0, 1e-6);
  approx("volRank high bound", volRank(0.40, hist).rank, 100, 1e-6);
  ok("volRank reports the sample it ranked against", mid.sampleSize === 100);
  approx("volRank low/high echo the range", mid.low + mid.high, 0.50, 1e-9);
  ok("volRank percentile is a share of observations", mid.percentile > 45 && mid.percentile < 55);
  // Rank and percentile disagree when one spike stretches the range — that is the point.
  const spiked = [...Array.from({ length: 99 }, () => 0.15), 1.20];
  const sp = volRank(0.16, spiked);
  ok("volRank: a single spike compresses rank but not percentile", sp.rank < 5 && sp.percentile > 90);
  // Guards.
  ok("volRank: sample below minimum -> null", volRank(0.2, [0.1, 0.2, 0.3]) === null);
  ok("volRank: non-positive current -> null", volRank(0, hist) === null);
  ok("volRank: negative current -> null", volRank(-0.2, hist) === null);
  ok("volRank: filters junk out of history", volRank(0.25, [...hist, NaN, Infinity, -1, 0]) !== null);
  // Out-of-range current clamps instead of leaving the 0-100 scale.
  ok("volRank: current above the historical high clamps to 100", volRank(0.9, hist).rank === 100);
  ok("volRank: current below the historical low clamps to 0", volRank(0.01, hist).rank === 0);
  // Flat history has no range — neither extreme is meaningful, so it sits in the middle.
  approx("volRank: flat history -> 50", volRank(0.2, Array.from({ length: 40 }, () => 0.2)).rank, 50, 1e-9);
  for (const [v, want] of [[0.11, "very low"], [0.19, "low"], [0.25, "average"], [0.33, "high"], [0.39, "very high"]]) {
    ok(`volRank label ${want} at vol ${v}`, volRank(v, hist).label === want);
  }

  // realizedVol is order-invariant (variance ignores the sign flip a reversal causes),
  // so a newest-first slice is safe to hand it.
  const path = Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.0004 * i + 0.01 * Math.sin(i * 2.1)));
  approx("realizedVol is order-invariant", realizedVolFromCloses([...path].reverse()), realizedVolFromCloses(path), 1e-12);

  // rollingRealizedVol: newest-first in, newest-first out.
  const roll = rollingRealizedVol(path, 21);
  ok("rollingRealizedVol produces a series", roll.length > 0);
  ok("rollingRealizedVol length = n - window", roll.length === path.length - 21);
  ok("rollingRealizedVol values all finite and positive", roll.every((v) => isFinite(v) && v > 0));
  ok("rollingRealizedVol: series shorter than the window -> empty", rollingRealizedVol([100, 101, 102], 21).length === 0);
  ok("rollingRealizedVol feeds volRank", volRank(roll[0], roll, 5) !== null);

  // ── Income plans ──
  const mkt = { vol: 0.30, rate: 0.04, t: 30 / 365 };
  const cc = buildIncomePlan("covered-call", 100, 105, mkt);
  const csp = buildIncomePlan("cash-secured-put", 100, 95, mkt);
  ok("covered call plan builds", cc !== null);
  ok("cash-secured put plan builds", csp !== null);

  // Capital committed differs by structure: shares vs secured cash.
  approx("covered call commits the shares", cc.capital, 100, 1e-9);
  approx("cash-secured put commits the strike in cash", csp.capital, 95, 1e-9);

  // Break-even identities.
  approx("covered call break-even = spot - premium", cc.breakEven, 100 - cc.premium, 1e-9);
  approx("cash-secured put break-even = strike - premium", csp.breakEven, 95 - csp.premium, 1e-9);

  // Yield: period -> annualized is a straight 365/days scale-up.
  approx("covered call periodYield = premium/capital", cc.periodYield, (cc.premium / 100) * 100, 1e-9);
  approx("annualized = period x 365/days", cc.annualizedYield, cc.periodYield * (365 / 30), 1e-6);
  ok("annualized exceeds period yield for a sub-year holding", cc.annualizedYield > cc.periodYield);

  // Probabilities are proper and internally consistent.
  for (const p of [cc, csp]) {
    ok("probAssignment in [0,1]", p.probAssignment >= 0 && p.probAssignment <= 1);
    ok("pop in [0,1]", p.pop >= 0 && p.pop <= 1);
  }
  // Break-even sits below the short call strike, so winning is likelier than being assigned.
  ok("covered call: POP > probability of assignment", cc.pop > cc.probAssignment);
  // Further OTM -> less likely to be assigned.
  ok("further-OTM call is less likely assigned", buildIncomePlan("covered-call", 100, 120, mkt).probAssignment < cc.probAssignment);
  ok("further-OTM put is less likely assigned", buildIncomePlan("cash-secured-put", 100, 80, mkt).probAssignment < csp.probAssignment);
  // Richer vol pays more premium.
  ok("higher vol pays a bigger premium", buildIncomePlan("covered-call", 100, 105, { ...mkt, vol: 0.60 }).premium > cc.premium);
  // Selling short-dated repeatedly annualizes higher than one long-dated write
  // (premium grows with sqrt(t), the annualization divides by t) — the theta-seller rationale.
  ok("short-dated writes annualize higher than long-dated", cc.annualizedYield > buildIncomePlan("covered-call", 100, 105, { ...mkt, t: 180 / 365 }).annualizedYield);

  // Downside buffer + assignment return.
  ok("covered call has a positive downside buffer", cc.downsideBufferPct > 0);
  ok("covered call reports the if-assigned return", typeof cc.ifAssignedReturn === "number" && cc.ifAssignedReturn > 0);
  ok("cash-secured put has no if-assigned return", csp.ifAssignedReturn === null);
  ok("short legs carry the expected delta signs", cc.delta > 0 && csp.delta < 0);

  // Guards: bad inputs return null rather than a nonsense plan.
  ok("income plan: zero spot -> null", buildIncomePlan("covered-call", 0, 105, mkt) === null);
  ok("income plan: zero strike -> null", buildIncomePlan("covered-call", 100, 0, mkt) === null);
  ok("income plan: zero time -> null", buildIncomePlan("covered-call", 100, 105, { ...mkt, t: 0 }) === null);
  ok("income plan: zero vol -> null", buildIncomePlan("covered-call", 100, 105, { ...mkt, vol: 0 }) === null);
  ok("income plan: negative vol -> null", buildIncomePlan("covered-call", 100, 105, { ...mkt, vol: -0.3 }) === null);

  // ── The gate: never encourage selling a put on a name the engine dislikes ──
  const bad = incomeGate("cash-secured-put", 30);
  ok("gate blocks selling puts on a poorly scored name", bad.allowed === false && bad.tone === "neg");
  ok("gate warns on a middling score", incomeGate("cash-secured-put", 48).tone === "warn");
  ok("gate approves selling puts on a well-scored name", incomeGate("cash-secured-put", 75).tone === "pos");
  ok("gate warns that covered calls cap a strong name", incomeGate("covered-call", 85).tone === "warn");
  ok("gate is relaxed about capping a weak name", incomeGate("covered-call", 45).tone === "pos");
  ok("gate never blocks a covered call", incomeGate("covered-call", 10).allowed === true);
  ok("gate handles a missing score", incomeGate("cash-secured-put", null).allowed === true && incomeGate("cash-secured-put", null).tone === "warn");
  for (const k of ["covered-call", "cash-secured-put"]) {
    for (const s of [null, 0, 39, 40, 54, 55, 69, 70, 100]) {
      const g = incomeGate(k, s);
      ok(`gate always returns a message (${k}, score ${s})`, typeof g.message === "string" && g.message.length > 0);
    }
  }
}
console.log(`\n${fail === 0 ? "✓" : "✗"} p2 math: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
