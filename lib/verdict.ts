// Verdict — the answer-first read of a name.
//
// Scora already computes everything needed to say "here is the call, here is why, and
// here is what would change it" — but it was assembled inline inside the Overview tab,
// three screens down. This module is the single source of that decision so the headline
// card and the detailed panel can never disagree: same inputs, same function, same call.
//
// No new model. It composes the existing ones (`timeframeReads` → `ratingFrom`) and adds
// the plain-language layer: three reasons and a falsifier.

import type { Scores } from "./types";
import { timeframeReads, type RegimeId, type Timeframes } from "./timeframes.ts";
import { ratingFrom, type Rating, type Conviction, type CorrRegime, type Horizon } from "./rating.ts";
import { stockPickingRegime } from "./microScore.ts";

/** Technical inputs the timeframe reads need, all already in % units. */
export interface VerdictTechnicals {
  mom12_1: number | null;
  rsVsSector: number | null;
  rsVsSpy: number | null;
  rsi14: number | null;
  pctFrom200dma: number | null;
}

export interface VerdictInput {
  scores: Scores;
  /** Macro-tilted Scora score; falls back to `scores.total` when absent. */
  icScore: number | null;
  regime: RegimeId | string | null;
  riskOn: number | null;
  impliedCorr: number | null;
  sector: string | null;
  technicals: VerdictTechnicals;
  /** The reader's holding period. Defaults to "months" (the historical fixed blend). */
  horizon?: Horizon;
}

export interface Verdict {
  rating: Rating;
  color: string;
  directional: number;
  conviction: Conviction;
  convictionPct: number;
  /** Honest one-liner on why conviction sits where it does. */
  note: string;
  /** Confluence summary across the three timeframes. */
  summary: string;
  confluence: Timeframes["confluence"];
  timeframes: Timeframes;
  /** Per-timeframe directional calls, for the detailed panel. */
  perTimeframe: { monthly: Rating; weekly: Rating; daily: Rating };
  /** Up to three plain-language reasons — structural, trend, timing. */
  reasons: string[];
  /** The falsifier: what would have to happen for this call to be wrong. */
  whatWouldChangeIt: string;
  /** The holding period this call was computed for. */
  horizon: Horizon;
}

/** Style profile the monthly read expects (each roughly 0-20), derived from the sub-scores.
 *  Mirrors the mapping the Overview tab has used since the timeframe reads shipped. */
export function factorTiltsFromScores(scores: Scores) {
  return {
    value: (scores.value / 25) * 20,
    growth: scores.growth,
    momentum: (scores.momentum / 25) * 20,
    quality: (scores.health / 30) * 20,
    size: 10,
  };
}

/** Implied correlation → the conviction regime `ratingFrom` expects. Delegates the
 *  thresholds to `stockPickingRegime` so there is only one place that decides when
 *  selection is worth conviction. */
export function corrRegimeFrom(impliedCorr: number | null): CorrRegime {
  const r = stockPickingRegime(impliedCorr).regime;
  return r === "favorable" ? "low" : r === "unfavorable" ? "high" : "mid";
}

/** What would have to change for the call to flip. Deterministic per confluence state —
 *  a verdict you cannot falsify is marketing, not research. */
const FALSIFIER: Record<Timeframes["confluence"], string> = {
  "structural-buy": "A close back below the 200-day average, or the macro regime turning, breaks this.",
  "leader-extended": "Losing the weekly uptrend would invalidate it; until then the risk is entry price, not thesis.",
  "bounce-vs-macro": "The macro regime turning supportive would upgrade this from a bounce to a trend.",
  "improving": "The weekly trend actually turning up is the confirmation this is still missing.",
  "avoid": "It needs both a macro turn and a trend turn — either one alone is not enough.",
  "mixed": "The timeframes aligning — in either direction — is what would make this decisive.",
};

/**
 * Build the headline verdict. Pure: same inputs → same call, no clock, no network.
 */
export function buildVerdict(inp: VerdictInput): Verdict {
  const tf = timeframeReads({
    regime: inp.regime,
    riskOn: inp.riskOn,
    sector: inp.sector,
    factorTilts: factorTiltsFromScores(inp.scores),
    mom12_1: inp.technicals.mom12_1,
    rsVsSector: inp.technicals.rsVsSector,
    rsVsSpy: inp.technicals.rsVsSpy,
    rsi14: inp.technicals.rsi14,
    pctFrom200dma: inp.technicals.pctFrom200dma,
  });

  const horizon: Horizon = inp.horizon ?? "months";
  const rt = ratingFrom(inp.icScore ?? inp.scores.total, tf, { corrRegime: corrRegimeFrom(inp.impliedCorr), horizon });

  // One reason per timeframe, strongest first — structural, then trend, then timing.
  const reasons = [tf.monthly.reasons[0], tf.weekly.reasons[0], tf.daily.reasons[0]]
    .filter((r): r is string => typeof r === "string" && r.length > 0);

  return {
    rating: rt.rating,
    color: rt.color,
    directional: rt.directional,
    conviction: rt.conviction,
    convictionPct: rt.convictionPct,
    note: rt.note,
    summary: tf.summary,
    confluence: tf.confluence,
    timeframes: tf,
    perTimeframe: rt.perTimeframe,
    reasons,
    whatWouldChangeIt: FALSIFIER[tf.confluence],
    horizon,
  };
}

/* ── Technical derivations ────────────────────────────────────────────────────
 * Pure helpers over newest-first close arrays. These mirror the math the Overview
 * tab computed inline; having them here means the headline card and the panel read
 * the same numbers instead of two look-alike copies.
 */

/** Simple moving average of the most recent `period` closes. Null when short. */
export function smaOf(closes: number[], period: number): number | null {
  if (closes.length < period || period <= 0) return null;
  return closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
}

/** Wilder-free 14-period RSI over newest-first closes (same simple form the app uses). */
export function rsiOf(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = closes[i] - closes[i + 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}

/** Return over `days` bars, in %, from newest-first closes. */
export function periodReturn(closes: number[], days: number): number | null {
  if (closes.length <= days || days < 0) return null;
  const past = closes[days];
  if (!(past > 0)) return null;
  return ((closes[0] - past) / past) * 100;
}

export interface DeriveInput {
  /** Newest-first closes. */
  stockCloses: number[];
  spyCloses: number[];
  sectorCloses: number[];
  /** Live price; falls back to the latest close. */
  price: number | null;
}

/** Turn raw close series into the technical inputs `buildVerdict` needs. */
export function deriveTechnicals(inp: DeriveInput): VerdictTechnicals {
  const cl = inp.stockCloses;
  // 12-1 momentum: a year of return excluding the most recent month, the form with
  // measured cross-sectional IC (the last month mean-reverts).
  const mom12_1 = cl.length > 252 && cl[252] > 0 ? ((cl[21] - cl[252]) / cl[252]) * 100 : null;
  const ret6m = periodReturn(cl, 126);
  const sectorRet6m = periodReturn(inp.sectorCloses, 126);
  const spyRet6m = periodReturn(inp.spyCloses, 126);
  const sma200 = smaOf(cl, 200);
  const price = inp.price != null && Number.isFinite(inp.price) ? inp.price : (cl[0] ?? null);

  return {
    mom12_1,
    rsVsSector: ret6m != null && sectorRet6m != null ? ret6m - sectorRet6m : null,
    rsVsSpy: ret6m != null && spyRet6m != null ? ret6m - spyRet6m : null,
    rsi14: rsiOf(cl, 14),
    pctFrom200dma: sma200 != null && sma200 > 0 && price != null ? ((price - sma200) / sma200) * 100 : null,
  };
}
