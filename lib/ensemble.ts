// ─────────────────────────────────────────────────────────────────────────────
// A5 — IC-weighted signal ensemble (the Renaissance core, made honest). Instead of one
// monolithic score with hand-set weights, we combine the production factors weighted by
// their MEASURED Information Coefficient in the CURRENT correlation regime (A0). A factor
// only counts where its IC was positive; the more predictive it was, the more it weighs.
// This is a transparent read that sits ALONGSIDE the validated score — it does not overwrite
// it (replacing the core score needs its own out-of-sample proof). Weights below are the
// measured IC structure from research/backtest.mjs (A0); refresh from a survivorship-free
// --full run before ever letting this drive allocation.
// ─────────────────────────────────────────────────────────────────────────────

export type CorrRegime = "low" | "mid" | "high";

// Measured IC-proportional weights per correlation regime (research/out/signals_ic.json).
// low correlation = a stock-picker's tape (momentum dominates); high = a macro tape.
export const ENSEMBLE_WEIGHTS: Record<CorrRegime, Partial<Record<"value" | "health" | "momentum" | "growth" | "mom12_1", number>>> = {
  low:  { mom12_1: 0.59, value: 0.16, momentum: 0.15, growth: 0.11 },
  mid:  { health: 0.33, momentum: 0.29, growth: 0.29, value: 0.09 },
  high: { momentum: 0.84, growth: 0.16 },
};

// ^COR3M (CBOE implied correlation) thresholds — same cut points as stockPickingRegime.
export function corrRegime(impliedCorr: number | null | undefined): CorrRegime {
  const c = impliedCorr == null ? null : Number(impliedCorr);
  if (c == null || isNaN(c)) return "mid";
  return c < 20 ? "low" : c <= 40 ? "mid" : "high";
}

export interface EnsembleInput {
  value: number | null;      // /25
  health: number | null;     // /30
  momentum: number | null;   // /25
  growth: number | null;     // /20
  mom12_1: number | null;    // %
}
export interface EnsembleResult {
  composite: number;         // 0-100, IC-weighted for the current regime
  regime: CorrRegime;
  weights: Partial<Record<string, number>>;
  contributions: { factor: string; weight: number; norm: number; add: number }[];
  topFactor: string | null;
  label: string;
  color: string;
}

// Normalize each factor to 0-1 so IC-weights (rank-based, scale-free) combine cleanly.
const NORM: Record<string, (v: number) => number> = {
  value:    (v) => clamp01(v / 25),
  health:   (v) => clamp01(v / 30),
  momentum: (v) => clamp01(v / 25),
  growth:   (v) => clamp01(v / 20),
  mom12_1:  (v) => clamp01((v + 30) / 60), // map −30%..+30% → 0..1
};
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

/** IC-weighted composite for the current correlation regime. Transparent, not a score override. */
export function ensembleScore(inp: EnsembleInput, impliedCorr: number | null | undefined): EnsembleResult {
  const regime = corrRegime(impliedCorr);
  const weights = ENSEMBLE_WEIGHTS[regime];
  const vals: Record<string, number | null> = { value: inp.value, health: inp.health, momentum: inp.momentum, growth: inp.growth, mom12_1: inp.mom12_1 };

  let wsum = 0, acc = 0;
  const contributions: EnsembleResult["contributions"] = [];
  for (const [f, w] of Object.entries(weights) as [string, number][]) {
    const raw = vals[f];
    if (raw == null || isNaN(raw)) continue;
    const norm = NORM[f](raw);
    contributions.push({ factor: f, weight: w, norm, add: w * norm });
    acc += w * norm; wsum += w;
  }
  const composite = wsum > 0 ? Math.round((acc / wsum) * 100) : 0;
  contributions.sort((a, b) => b.add - a.add);
  const topFactor = contributions[0]?.factor ?? null;
  const label = composite >= 66 ? "Strong (this regime)" : composite >= 45 ? "Moderate" : "Weak";
  const color = composite >= 66 ? "var(--sr-pos)" : composite >= 45 ? "var(--sr-warn)" : "var(--sr-neg)";
  return { composite, regime, weights, contributions, topFactor, label, color };
}

export const FACTOR_LABEL: Record<string, string> = {
  value: "Value", health: "Health", momentum: "Momentum", growth: "Growth", mom12_1: "12-1m momentum",
};
