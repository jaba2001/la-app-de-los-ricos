// ─────────────────────────────────────────────────────────────────────────────
// Canonical fundamentals normalizer.
//
// FMP migrated its API from the legacy `/api/v3/` namespace to `stable/`, which
// RENAMED most fields (e.g. `peRatioTTM` → `priceToEarningsRatioTTM`,
// `enterpriseValueOverEBITDATTM` → `evToEBITDATTM`, `roicTTM` →
// `returnOnInvestedCapitalTTM`) and MOVED some between key-metrics-ttm and
// ratios-ttm. The scoring engine and every stock component still read the legacy
// names, so ~10 of 13 score inputs silently resolved to `undefined` even when FMP
// returned a full 200 payload — producing a false VALUE=0 / GROWTH=0 score.
//
// This module maps BOTH the FMP-stable response AND the Finnhub `stock/metric`
// response into ONE canonical shape keyed by the legacy names the app already
// reads, filling each field with the first non-null source (FMP first, Finnhub as
// a free fallback when FMP's daily quota is exhausted). Downstream components and
// scoring.ts need no changes — they keep reading `peRatioTTM`, `roicTTM`, etc.,
// now correctly populated.
//
// Ratio conventions preserved for the callers:
//   • margins / ROE / ROIC / ROA / growth are FRACTIONS (0.41 = 41%), because the
//     callers multiply by 100. Finnhub returns these as percents, so we ÷100.
//   • multiples (P/E, EV/EBITDA, P/FCF, D/E, current ratio, interest coverage)
//     are plain numbers on both sides.
// ─────────────────────────────────────────────────────────────────────────────

import type { FinvizData } from "./types";

type Dict = Record<string, unknown>;

export interface RawFundamentalSources {
  fmpKeyMetrics?: Dict | null; // stable/key-metrics-ttm[0]
  fmpRatios?: Dict | null;     // stable/ratios-ttm[0]
  fmpGrowth?: Dict | null;     // stable/financial-growth[0]
  finnhubMetric?: Record<string, number> | null; // finnhub stock/metric .metric
  profile?: Dict | null;       // stable/profile[0]
}

/** First finite number among the candidates, else null. `undefined`/`null`/NaN skip. */
function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null) continue;
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Divide a percent by 100 into a fraction, preserving null. */
function pctToFrac(v: number | null): number | null {
  return v == null ? null : v / 100;
}

/**
 * Merge FMP-stable + Finnhub fundamentals into canonical `metrics` and `ratios`
 * objects keyed by the legacy names the app reads. Native stable fields are
 * preserved by spreading the raw objects first; renamed/moved fields are then
 * overlaid so the legacy keys always resolve when the data exists anywhere.
 */
export function normalizeFundamentals(s: RawFundamentalSources): { metrics: Dict; ratios: Dict } {
  const km = s.fmpKeyMetrics ?? {};
  const ra = s.fmpRatios ?? {};
  const gr = s.fmpGrowth ?? {};
  const fh = s.finnhubMetric ?? {};
  const pr = s.profile ?? {};

  const n = (o: Dict, k: string): number | null => firstNum(o[k]);
  const f = (k: string): number | null => firstNum(fh[k]);

  // ── metrics (legacy keys read from `data.metrics`) ──────────────────────────
  const metrics: Dict = {
    ...km,
    // valuation multiples
    peRatioTTM:                   firstNum(n(ra, "priceToEarningsRatioTTM"), f("peTTM")),
    priceToBookRatioTTM:          firstNum(n(ra, "priceToBookRatioTTM"), n(km, "priceToBookRatioTTM"), f("pbQuarterly"), f("pbAnnual")),
    enterpriseValueOverEBITDATTM: firstNum(n(km, "evToEBITDATTM"), f("evEbitdaTTM"), f("evEbitdaAnnual")),
    priceToFreeCashFlowsRatioTTM: firstNum(n(ra, "priceToFreeCashFlowRatioTTM"), n(km, "priceToFreeCashFlowRatioTTM"), f("pfcfShareTTM"), f("pfcfShareAnnual")),
    evToSalesTTM:                 firstNum(n(km, "evToSalesTTM"), f("evSalesTTM")),
    freeCashFlowYieldTTM:         firstNum(n(km, "freeCashFlowYieldTTM"), n(km, "freeCashFlowToFirmTTM")),
    dividendYieldTTM:             firstNum(n(ra, "dividendYieldTTM"), f("dividendYieldIndicatedAnnual") != null ? f("dividendYieldIndicatedAnnual")! / 100 : null),
    // returns (fractions — callers ×100)
    netDebtToEBITDATTM:           firstNum(n(km, "netDebtToEBITDATTM")),
    roicTTM:                      firstNum(n(km, "returnOnInvestedCapitalTTM"), pctToFrac(f("roiTTM"))),
    roeTTM:                       firstNum(n(km, "returnOnEquityTTM"), pctToFrac(f("roeTTM"))),
    // beta for RDCF / display — unify on one source (profile, then Finnhub)
    beta:                         firstNum(pr["beta"], f("beta")),
  };

  // ── ratios (legacy keys read from `data.ratios`) ────────────────────────────
  const ratios: Dict = {
    ...ra,
    // margins (fractions)
    grossProfitMarginTTM:      firstNum(n(ra, "grossProfitMarginTTM"), pctToFrac(f("grossMarginTTM"))),
    operatingProfitMarginTTM:  firstNum(n(ra, "operatingProfitMarginTTM"), pctToFrac(f("operatingMarginTTM"))),
    netProfitMarginTTM:        firstNum(n(ra, "netProfitMarginTTM"), pctToFrac(f("netMarginTTM"))),
    // leverage / liquidity / coverage
    debtEquityRatioTTM:        firstNum(n(ra, "debtToEquityRatioTTM"), f("totalDebt/totalEquityAnnual"), f("totalDebt/totalEquityQuarterly")),
    currentRatioTTM:           firstNum(n(ra, "currentRatioTTM"), n(km, "currentRatioTTM"), f("currentRatioAnnual"), f("currentRatioQuarterly")),
    interestCoverageTTM:       firstNum(n(ra, "interestCoverageRatioTTM"), f("netInterestCoverageAnnual")),
    // returns duplicated here because StockFundamentals reads them from `ratios`
    returnOnInvestedCapitalTTM: firstNum(n(km, "returnOnInvestedCapitalTTM"), pctToFrac(f("roiTTM"))),
    returnOnCapitalEmployedTTM: firstNum(n(km, "returnOnCapitalEmployedTTM")),
    returnOnEquityTTM:          firstNum(n(km, "returnOnEquityTTM"), pctToFrac(f("roeTTM"))),
    returnOnAssetsTTM:          firstNum(n(km, "returnOnAssetsTTM"), pctToFrac(f("roaTTM"))),
    freeCashFlowPerShareTTM:    firstNum(n(ra, "freeCashFlowPerShareTTM"), f("cashFlowPerShareTTM")),
    // growth (fractions — from financial-growth endpoint, Finnhub TTM-YoY fallback)
    revenueGrowthTTM:          firstNum(n(gr, "revenueGrowth"), pctToFrac(f("revenueGrowthTTMYoy"))),
    netIncomeGrowthTTM:        firstNum(n(gr, "netIncomeGrowth"), n(gr, "epsgrowth"), pctToFrac(f("epsGrowthTTMYoy"))),
  };

  return { metrics, ratios };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentiment tab fallback. The tab was built entirely on Finviz, which Finviz
// blocks from datacenter IPs (Vercel edge) → every field showed "—". Finnhub's
// free stock/metric + recommendation + price-target cover most of it. We build a
// Finviz-shaped object from those so the tab lights up; real Finviz data (when it
// does come through) still wins per-field via mergeFinviz.
// Short interest / ownership flows remain null — no free source exists for them.
// ─────────────────────────────────────────────────────────────────────────────

interface RecommendationCounts { strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }

export function finnhubToFinvizFallback(
  fh: Record<string, number> | null | undefined,
  recommendation: RecommendationCounts | null | undefined,
  priceTarget: { targetMean?: number } | null | undefined,
): Partial<FinvizData> {
  const f = (k: string): number | null => firstNum(fh?.[k]);
  const frac = (k: string): number | null => pctToFrac(f(k));

  // Weighted analyst score on Finviz's 1(buy)–5(sell) scale.
  let recom: number | null = null;
  if (recommendation) {
    const sB = recommendation.strongBuy ?? 0, b = recommendation.buy ?? 0, h = recommendation.hold ?? 0;
    const s = recommendation.sell ?? 0, sS = recommendation.strongSell ?? 0;
    const total = sB + b + h + s + sS;
    if (total > 0) recom = (1 * sB + 2 * b + 3 * h + 4 * s + 5 * sS) / total;
  }

  return {
    grossMarginFv:   frac("grossMarginTTM"),
    operatingMargin: frac("operatingMarginTTM"),
    profitMargin:    frac("netProfitMarginTTM") ?? frac("netMargin"),
    roe:             frac("roeTTM"),
    roa:             frac("roaTTM"),
    betaFv:          f("beta"),
    forwardPe:       f("forwardPE"),
    ps:              f("psAnnual"),
    perfYear:        frac("52WeekPriceReturnDaily"),
    epsQoQ:          frac("epsGrowthQuarterlyYoy"),
    salesQoQ:        frac("revenueGrowthQuarterlyYoy"),
    salesGrowth3Y:   frac("revenueGrowth3Y"),
    recom,
    targetPrice:     firstNum(priceTarget?.targetMean),
  };
}

/** Real Finviz data wins per-field; the Finnhub fallback fills only the gaps. */
export function mergeFinviz(real: FinvizData | null | undefined, fallback: Partial<FinvizData>): FinvizData | null {
  const hasReal = real != null && Object.values(real).some(v => v != null);
  const hasFallback = Object.values(fallback).some(v => v != null);
  if (!hasReal && !hasFallback) return null;
  const out: Dict = { ...(real ?? {}) };
  for (const [k, v] of Object.entries(fallback)) {
    if (out[k] == null && v != null) out[k] = v;
  }
  return out as unknown as FinvizData;
}
