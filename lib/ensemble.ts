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

// Measured IC-proportional weights per correlation regime — from the SURVIVORSHIP-FREE
// --full 120 run (research/out/signals_ic.json, incl. point-in-time removed members). More
// conservative than a curated universe (which inflates momentum). Only factors with positive
// measured IC in a regime get weight. low = a stock-picker's tape (12-1m momentum leads);
// mid = value earns its keep; high = quality/health (a macro tape rewards balance sheets).
// A golden test compares these against the latest signals_ic.json so they can't silently drift.
//
// F4.2 OOS GATE (2026-07-10, train <2023-11 / test ≥2023-11): the frozen train-window
// ensemble earned OOS IC −0.047 vs the monolithic score's −0.002 over 32 test months →
// KEEP INFORMATIONAL. This composite is a transparent read, NOT a score input; promoting
// it requires re-running the gate in research/backtest.mjs and clearing it (>0 AND > score).
export type EnsembleFactor =
  | "value" | "health" | "momentum" | "growth" | "mom12_1"
  // Rankers de calidad/crédito de la Fase 7 (mayor = mejor). Los medía el backtest desde
  // hace tiempo, pero este módulo los ignoraba: el "read ponderado por IC" no estaba
  // ponderando por todo el IC que se mide. Corregido 2026-08-18.
  | "altmanZ" | "accrualsQ" | "dupontRoe" | "piotroski";

// REFRESCADO 2026-08-18 desde `research/backtest.mjs --full 120` (79 rebalanceos
// 2020-01→2026-07, membresía point-in-time del S&P 500). El artefacto que las justifica
// está COMMITEADO en research/out/signals_ic.json y el golden test falla si falta o si
// estas constantes se separan de él — antes el fichero estaba en .gitignore y la
// comprobación se saltaba en silencio, así que los pesos llevaban meses a la deriva sin
// que nadie lo viera (mid.value 0.99 medido 0.634, high.health 0.83 medido 0.359).
export const ENSEMBLE_WEIGHTS: Record<CorrRegime, Partial<Record<EnsembleFactor, number>>> = {
  low:  { mom12_1: 0.532, growth: 0.268, value: 0.121, accrualsQ: 0.052, momentum: 0.027 },
  mid:  { value: 0.634, accrualsQ: 0.185, altmanZ: 0.181 },
  high: { altmanZ: 0.363, health: 0.359, dupontRoe: 0.201, momentum: 0.076 },
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
  // Fase 7 — opcionales: quien no los tenga sigue compilando y el composite se normaliza
  // sobre los factores realmente presentes (ver `wsum` en ensembleScore).
  altmanZ?: number | null;   // Z de Altman en crudo (mayor = más seguro)
  accrualsQ?: number | null; // ratio de accruals NEGADO (mayor = beneficio de más calidad)
  dupontRoe?: number | null; // ROE de DuPont a 3 factores
  piotroski?: number | null; // F-score 0-9
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
// DEBE seguir siendo idéntico a NORM_F en research/backtest.mjs (el bloque marcado
// "same normalization as lib/ensemble.ts"): un solo significado, dos copias pequeñas,
// igual que la disciplina de paridad del asignador TS/MJS.
const NORM: Record<string, (v: number) => number> = {
  value:    (v) => clamp01(v / 25),
  health:   (v) => clamp01(v / 30),
  momentum: (v) => clamp01(v / 25),
  growth:   (v) => clamp01(v / 20),
  mom12_1:  (v) => clamp01((v + 30) / 60), // map −30%..+30% → 0..1
  altmanZ:   (v) => clamp01(v / 6),
  accrualsQ: (v) => clamp01((v + 0.15) / 0.3),
  dupontRoe: (v) => clamp01((v + 0.1) / 0.4),
  piotroski: (v) => clamp01(v / 9),
};
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

/** IC-weighted composite for the current correlation regime. Transparent, not a score override. */
export function ensembleScore(inp: EnsembleInput, impliedCorr: number | null | undefined): EnsembleResult {
  const regime = corrRegime(impliedCorr);
  const weights = ENSEMBLE_WEIGHTS[regime];
  const vals: Record<string, number | null | undefined> = {
    value: inp.value, health: inp.health, momentum: inp.momentum, growth: inp.growth, mom12_1: inp.mom12_1,
    altmanZ: inp.altmanZ, accrualsQ: inp.accrualsQ, dupontRoe: inp.dupontRoe, piotroski: inp.piotroski,
  };

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
  altmanZ: "Altman Z", accrualsQ: "Accruals quality", dupontRoe: "DuPont ROE", piotroski: "Piotroski F",
};
