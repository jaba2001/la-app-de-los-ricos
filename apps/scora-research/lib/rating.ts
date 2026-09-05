// ─────────────────────────────────────────────────────────────────────────────
// DIRECTIONAL RATING (2026-07-12) — turns the Scora score + the three timeframe reads into
// a decisive Strong Buy / Buy / Sell / Strong Sell call, per timeframe and overall. NO HOLD
// by design (a deliberate product choice: every name gets a lean). Honesty is preserved via
// CONVICTION, not via a wishy-washy middle: the label is always decisive, but the conviction
// is truthful — it falls near the median, when the timeframes disagree, and when we are NOT
// in a correlation regime where our selection signal has measured IC (momentum earns IC only
// in LOW correlation — research/signals_ic.json: +0.07 low-corr, −0.09 high-corr; the full
// score's cross-sectional IC is ~0, so a directional label leans on the trend/regime reads,
// not the raw score). A "Strong Sell" is therefore never dressed as high-confidence when the
// underlying signal is weak. Pure module (type-only import) so the golden test runs it headless.
// ─────────────────────────────────────────────────────────────────────────────
import type { Timeframes } from "./timeframes";

export type Rating = "Strong Buy" | "Buy" | "Sell" | "Strong Sell";
export type Conviction = "Low" | "Medium" | "High";
export type CorrRegime = "low" | "mid" | "high" | null;

export interface RatingResult {
  rating: Rating;                 // overall directional call — never Hold
  directional: number;            // 0-100 blended directional score (basis of the call)
  conviction: Conviction;
  convictionPct: number;          // 0-100
  perTimeframe: { monthly: Rating; weekly: Rating; daily: Rating };
  color: string;
  note: string;                   // honest one-liner on why conviction is where it is
}

export const RATING_COLOR: Record<Rating, string> = {
  "Strong Buy": "var(--sr-pos)",
  "Buy": "#34D399",
  "Sell": "#F59E0B",
  "Strong Sell": "var(--sr-neg)",
};

/** Cut a 0-100 read into a 4-way directional call — NO neutral band. The median (50) splits
 *  Buy vs Sell; the extremes earn "Strong". Deliberately leaves no Hold. */
export function toRating(x: number): Rating {
  if (x >= 60) return "Strong Buy";
  if (x >= 50) return "Buy";
  if (x >= 40) return "Sell";
  return "Strong Sell";
}

const CONFLUENCE_NUDGE: Record<Timeframes["confluence"], number> = {
  "structural-buy": 6, "leader-extended": 3, "improving": 2, "mixed": 0, "bounce-vs-macro": -5, "avoid": -8,
};

/** The holding period the reader actually has. It is the first thing that decides whether
 *  a name is a good idea, and almost no tool asks — so the same stock can honestly be a
 *  Buy on a multi-year view and a Sell on a three-week one. Saying that out loud beats
 *  averaging the two into a number that describes nobody. */
export type Horizon = "days" | "months" | "years";

/** Blend weights over (score, weekly, monthly, daily). Each row sums to 1.
 *  `months` reproduces the historical fixed blend exactly, so it stays the default and
 *  nothing that omits `horizon` changes behavior. */
export const HORIZON_WEIGHTS: Record<Horizon, { s: number; w: number; m: number; d: number }> = {
  // Trading horizon: fundamentals barely matter inside days; entry timing dominates.
  days:   { s: 0.10, w: 0.30, m: 0.10, d: 0.50 },
  // Swing/position horizon — the historical default blend.
  months: { s: 0.40, w: 0.30, m: 0.20, d: 0.10 },
  // Investing horizon: the score and the structural macro read carry it; today's
  // overbought/oversold reading is noise at this distance.
  years:  { s: 0.55, w: 0.10, m: 0.35, d: 0.00 },
};

export const HORIZON_LABEL: Record<Horizon, string> = {
  days: "Days", months: "Months", years: "Years",
};

/** Overall + per-timeframe directional rating from the macro-tilted Scora Score (0-100) and
 *  the three timeframe reads. `corrRegime` (from implied correlation) modulates conviction. */
export function ratingFrom(overallScore: number, tf: Timeframes, opts?: { corrRegime?: CorrRegime; horizon?: Horizon }): RatingResult {
  const m = tf.monthly.score, w = tf.weekly.score, d = tf.daily.score;
  const s = Math.max(0, Math.min(100, overallScore));
  // Directional blend: the Scora score anchors; the WEEKLY trend (12-1m + relative strength —
  // where the measured cross-sectional IC actually lives) is weighted heavily; MONTHLY gates;
  // DAILY nudges entry timing. The mix shifts with the reader's holding period; omitting
  // `horizon` keeps the original fixed blend.
  const kw = HORIZON_WEIGHTS[opts?.horizon ?? "months"];
  let D = kw.s * s + kw.w * w + kw.m * m + kw.d * d;
  D = Math.max(0, Math.min(100, D + CONFLUENCE_NUDGE[tf.confluence]));
  const rating = toRating(D);

  // Conviction — decisive label, honest certainty.
  const dist = Math.abs(D - 50) / 50;                                        // 0 at median → 1 at extremes
  const corr = opts?.corrRegime ?? null;
  const regimeConf = corr === "low" ? 1 : corr === "high" ? 0.7 : 0.85;
  const convictionPct = Math.round(100 * Math.min(1, tf.convictionMult * (0.35 + 0.65 * dist) * regimeConf));
  const conviction: Conviction = convictionPct >= 66 ? "High" : convictionPct >= 40 ? "Medium" : "Low";

  const note = dist < 0.15
    ? "Near the median — the call is a lean, not a conviction bet."
    : corr === "high"
      ? "High correlation regime — names move together and selection signal is weak here; conviction capped."
      : tf.convictionMult < 0.8
        ? "Timeframes disagree — the read is mixed, so conviction is trimmed."
        : corr === "low"
          ? "Low correlation — dispersion is high and selection has measured IC; conviction earned."
          : "Trend and macro reads set the direction; conviction scaled to their agreement.";

  return {
    rating,
    directional: Math.round(D),
    conviction,
    convictionPct,
    perTimeframe: { monthly: toRating(m), weekly: toRating(w), daily: toRating(d) },
    color: RATING_COLOR[rating],
    note,
  };
}
