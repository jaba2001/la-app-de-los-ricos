// ─────────────────────────────────────────────────────────────────────────────
// REGIME → SECTOR / FACTOR ROTATION (2026-07-11) — Scora's differentiator, measured and
// validated: the macro regime predicts which SECTORS and FACTORS (baskets) have tailwinds.
// Sources (measured, survivorship-aware, avg fwd-1m EXCESS return vs SPY):
//   • research/regime_sector_lab.mjs (1999-2026, 244 months) — the sector/factor excess.
//   • research/regime_factor_validate.mjs (2000-2026, 312 months) — a regime growth/value
//     rotation earned Sharpe 1.24 vs SPY 0.74 / static-50/50 0.83 / always-growth 0.93 →
//     the regime→factor signal is real and robust across the dot-com bust and the GFC.
// This is the SINGLE SOURCE for the regime→factor/sector maps; lib/timeframes.ts and
// lib/scoring.ts's getMacroTilt both read from here. A golden anti-drift test pins the
// factor-favored map to the measured sign structure.
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeId = "expansion" | "reflation" | "stagflation" | "contraction" | "neutral";
export type Style = "value" | "growth" | "momentum" | "quality" | "size";

// Which STYLE the regime rewards (from the measured growth↔value rotation). Growth leads in
// risk-on/reflationary regimes; value leads in contraction/neutral. Validated Sharpe 1.24.
export const REGIME_FAVORED_STYLE: Record<RegimeId, "growth" | "value"> = {
  expansion: "growth", reflation: "growth", stagflation: "growth",
  contraction: "value", neutral: "value",
};

// Full style bias per regime: +1 favored / −1 disfavored / 0 neutral (measured excess signs).
export const REGIME_FACTOR: Record<RegimeId, Record<Style, number>> = {
  expansion:   { growth: +1, value: -1, momentum:  0, quality:  0, size: -1 },
  reflation:   { growth: +1, value: -1, momentum: +1, quality:  0, size:  0 },
  stagflation: { growth: +1, value: -1, momentum:  0, quality: +1, size: -1 },
  contraction: { growth: -1, value: +1, momentum:  0, quality: +1, size:  0 },
  neutral:     { growth: -1, value: +1, momentum:  0, quality: -1, size:  0 },
};

// Measured regime→sector ranked by fwd-1m excess vs SPY (positive = macro tailwind). Note
// Technology carries a positive excess in EVERY regime (a secular trend, not a regime signal)
// — the regime-DISTINCTIVE leaders are the others (materials/energy in reflation/contraction,
// financials in stagflation, defensives/utilities in contraction/neutral). Neutral's energy
// figure rests on a small sample (n≈12) — flagged, not over-weighted.
export interface SectorLean { etf: string; name: string; excess: number; }
export const REGIME_SECTORS: Record<RegimeId, SectorLean[]> = {
  expansion:   [{ etf: "XLK", name: "Technology", excess: 0.49 }, { etf: "XLY", name: "Discretionary", excess: 0.25 }, { etf: "XLV", name: "Health Care", excess: 0.08 }, { etf: "XLI", name: "Industrials", excess: 0.06 }],
  reflation:   [{ etf: "XLK", name: "Technology", excess: 0.64 }, { etf: "XLB", name: "Materials", excess: 0.48 }, { etf: "XLY", name: "Discretionary", excess: 0.18 }, { etf: "XLU", name: "Utilities", excess: 0.13 }],
  stagflation: [{ etf: "XLK", name: "Technology", excess: 0.44 }, { etf: "XLF", name: "Financials", excess: 0.27 }, { etf: "XLI", name: "Industrials", excess: 0.02 }],
  contraction: [{ etf: "XLE", name: "Energy", excess: 0.64 }, { etf: "XLB", name: "Materials", excess: 0.52 }, { etf: "XLK", name: "Technology", excess: 0.39 }, { etf: "XLP", name: "Staples", excess: 0.34 }, { etf: "XLY", name: "Discretionary", excess: 0.29 }],
  neutral:     [{ etf: "XLU", name: "Utilities", excess: 0.91 }, { etf: "XLF", name: "Financials", excess: 0.58 }, { etf: "XLI", name: "Industrials", excess: 0.33 }, { etf: "XLK", name: "Technology", excess: 0.24 }],
};

export const REGIME_FACTOR_STATS = {
  period: "2000–2026", months: 312,
  rotationSharpe: 1.24, spySharpe: 0.74, staticSharpe: 0.83, alwaysGrowthSharpe: 0.93,
  note: "Regime growth/value rotation (IWF/IWD) beat every static approach on Sharpe over 26 years incl. the dot-com bust and GFC.",
};

const isRegime = (r: string | null | undefined): r is RegimeId => r != null && r in REGIME_FACTOR;

/** Top-K sectors with the measured macro tailwind for a regime. */
export function favoredSectors(regime: string | null | undefined, topK = 3): SectorLean[] {
  return isRegime(regime) ? REGIME_SECTORS[regime].slice(0, topK) : [];
}

/** The style the regime rewards + its disfavored opposite. */
export function favoredStyle(regime: string | null | undefined): { favored: "growth" | "value"; label: string } | null {
  if (!isRegime(regime)) return null;
  const fav = REGIME_FAVORED_STYLE[regime];
  return { favored: fav, label: fav === "growth" ? "Growth" : "Value" };
}

/**
 * Score tilt (points) for a name given the regime and its DOMINANT style. Positive when the
 * name's style matches what the regime rewards (measured). Small and capped — the rotation is
 * validated at the basket level; at single-name level it's a modest, directionally-correct
 * nudge. `dominantStyle` = the name's highest factor tilt (from calcFactorTilts). `strength`
 * 0-1 scales how dominant that style is.
 */
export function regimeFactorTilt(regime: string | null | undefined, dominantStyle: Style | null, strength = 1): number {
  if (!isRegime(regime) || !dominantStyle) return 0;
  const bias = REGIME_FACTOR[regime][dominantStyle] ?? 0;
  return Math.round(bias * 4 * Math.max(0, Math.min(1, strength))); // ±4 pts max
}
