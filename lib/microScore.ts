// ─────────────────────────────────────────────────────────────────────────────
// Micro score 2.0 (Phase 4) — momentum/trajectory, gated by market correlation.
//
// 0A proved (survivorship-free) that the value/quality score reads dispersion
// BACKWARDS: in low-correlation months (a stock-picker's tape) it has IC −0.005, while
// a MOMENTUM score has IC +0.070 and a +4.3% top-minus-bottom decile spread. And the
// same momentum score has IC −0.088 in HIGH correlation (momentum crashes when the tape
// moves as one — Daniel-Moskowitz). So the micro edge is momentum/trajectory, switched
// on only when correlation is low. This module is the shared, validated logic.
//
// trajectoryScore mirrors research/backtest.mjs exactly:
//   traj = mom12_1 + 0.4·(6m price change) + 1.2·(growth sub-score from calcScores)
// The correlation gate is the "stock-picking regime": favorable when dispersion is high.
// ─────────────────────────────────────────────────────────────────────────────
import type { ScoreInputs } from "./types";
// Explicit .ts extension so the golden-test runner (`node --experimental-strip-types`,
// which resolves specifiers literally) can load this module. tsconfig has
// `allowImportingTsExtensions`; tsc and the bundler are unaffected.
import { calcScores } from "./scoring.ts";

/**
 * Momentum/trajectory ranker. Higher = stronger price + earnings trajectory.
 * `mom12_1` = 12-1 month total return (%); pass null when unavailable (contributes 0).
 * Reconciles with the research engine's `traj` (research/backtest.mjs).
 */
export function trajectoryScore(inputs: ScoreInputs, mom12_1: number | null): number {
  const growth = calcScores(inputs).growth; // 0-20 sub-score (revenue/EPS growth + accel)
  return (mom12_1 ?? 0) + 0.4 * (inputs.priceChange6M ?? 0) + 1.2 * (growth ?? 0);
}

/**
 * Displayable 0-100 momentum/trajectory rating for a single name (bounded, so it can be
 * shown on the stock page — distinct from the unbounded cross-sectional `trajectoryScore`
 * used for ranking). Built from 12-1m momentum (primary) + 6m + the growth sub-score.
 */
export function trajectoryRating(mom12_1: number | null, priceChange6M: number | null, growth: number | null): { score: number; label: string; color: string } {
  let s = 0;
  if (mom12_1 != null) s += mom12_1 > 40 ? 45 : mom12_1 > 20 ? 38 : mom12_1 > 10 ? 30 : mom12_1 > 0 ? 20 : mom12_1 > -15 ? 8 : 0;
  if (priceChange6M != null) s += priceChange6M > 20 ? 25 : priceChange6M > 8 ? 18 : priceChange6M > 0 ? 12 : priceChange6M > -15 ? 5 : 0;
  s += Math.min(30, Math.max(0, (growth ?? 0)) * 1.5); // growth sub-score (0-20) → 0-30
  const score = Math.round(Math.min(100, s));
  const label = score >= 66 ? "Strong" : score >= 40 ? "Moderate" : "Weak";
  const color = score >= 66 ? "var(--sr-pos)" : score >= 40 ? "var(--sr-warn)" : "var(--sr-neg)";
  return { score, label, color };
}

export type PickingRegime = "favorable" | "mixed" | "unfavorable";

export interface StockPickingRegime {
  regime: PickingRegime;
  gate: number;    // 1 = trust momentum selection · 0.5 = mixed · 0 = defer to allocation
  label: string;
  detail: string;
  color: string;
}

/**
 * Does stock selection (momentum) pay right now? Driven by the CBOE 3-month implied
 * correlation index (^COR3M, ~10-90). Low correlation = high dispersion = momentum
 * selection works; high correlation = macro tape = momentum crashes → allocation wins.
 * Thresholds are priors on the COR3M scale, calibratable. `impliedCorr` null → mixed.
 * (The backtest used realized single-stock correlation (0-1); the live product uses the
 * implied index — same signal, different vintage, as documented in the plan.)
 */
/** Umbrales del gate. NO se estiman de los datos, y ahí está la gracia: son los mismos que
 *  ya usaba el producto, y resultaron ser lo único que aguantó fuera de muestra. Cada vez
 *  que se probó un umbral calculado a partir de la propia muestra (terciles in-sample), la
 *  mejora se evaporaba al recalcularla con sólo el pasado: +44 pp → −2 pp. */
export const GATE_CORR_LOW = 20;    // por debajo: dispersión alta, la selección respira
export const GATE_CORR_HIGH = 40;   // por encima: el mercado se mueve como uno

/**
 * Escala la exposición a la selección de forma CONTINUA entre los dos umbrales, en vez de
 * a saltos (1 / 0,5 / 0 como antes). Medido en `research/momentum_retry.mjs` sobre DOS
 * ventanas independientes:
 *
 *              sin gate   con gate continuo
 *   2019-2026   Sharpe 0,78 → 0,86
 *   2010-2018   Sharpe 1,08 → 1,14
 *
 * Lo que replica es el SHARPE, no el retorno: el gate no genera alfa —el retorno extra de
 * +18 pp en una ventana se volvió −7 pp en la otra— pero mejora el rendimiento ajustado por
 * riesgo de forma reproducible. Que es exactamente lo que la teoría (Daniel-Moskowitz sobre
 * crashes de momentum) predice que hace un gate: no te hace ganar más, te evita el desastre.
 *
 * Escalonar tiraba información —no es lo mismo una correlación de 21 que una de 39— y
 * concentraba todo el resultado en acertar el corte exacto.
 */
export function stockPickingRegime(impliedCorr: number | null): StockPickingRegime {
  if (impliedCorr == null) {
    return { regime: "mixed", gate: 0.5, label: "Unknown", detail: "No correlation reading — showing momentum ungated.", color: "var(--sr-text-2)" };
  }
  // Rampa continua: 1 en GATE_CORR_LOW o menos, 0 en GATE_CORR_HIGH o más, lineal entre medias.
  const gate = Math.max(0, Math.min(1, (GATE_CORR_HIGH - impliedCorr) / (GATE_CORR_HIGH - GATE_CORR_LOW)));
  const pct = Math.round(gate * 100);

  // Las ETIQUETAS conservan los cortes de siempre (< 20 favorable · [20, 40] mixto · > 40
  // desfavorable) porque lo que la medición respalda es el `gate` CONTINUO, no mover las
  // fronteras del texto. Cambiar ambas cosas a la vez habría alterado en silencio lo que
  // lee el usuario en los bordes exactos, y los golden lo cazaron: bien cazado.
  if (impliedCorr < GATE_CORR_LOW) {
    return { regime: "favorable", gate, label: "Favors selection", detail: `Low correlation — dispersion is high, and this is historically where selection has carried more signal. Selection weight ${pct}%.`, color: "var(--sr-pos)" };
  }
  if (impliedCorr <= GATE_CORR_HIGH) {
    return { regime: "mixed", gate, label: "Mixed", detail: `Middling correlation — the selection edge is muted, so exposure is scaled back rather than switched off. Selection weight ${pct}%.`, color: "var(--sr-warn)" };
  }
  return { regime: "unfavorable", gate, label: "Macro tape", detail: `High correlation — names move as one and momentum crashes here. Selection weight ${pct}%; lean on allocation.`, color: "var(--sr-neg)" };
}
