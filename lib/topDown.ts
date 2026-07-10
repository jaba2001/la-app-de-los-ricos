// ─────────────────────────────────────────────────────────────────────────────
// A4 — the cascade, composed. The four layers used to be shown separately; here they're
// CHAINED into one explainable context for a single name: Secular baseline (L1) → risk-on
// backdrop (L2) → the top-down↔bottom-up loop (A3) → selection regime + IC-weighted
// ensemble (L4/A5). It reads top-down but doesn't secretly rewrite the score — it surfaces
// the layered reasoning and a single conviction modulator (from the loop) the UI can apply.
// ─────────────────────────────────────────────────────────────────────────────
import type { MacroState } from "./types";
import { secularRegime } from "./secular";
import { stockPickingRegime } from "./microScore";
import { regimeConfirmation } from "./regimeLoop";
import { ensembleScore, type EnsembleResult } from "./ensemble";
import { computeRiskOn } from "./allocation";

export interface TopDownLayer { code: string; label: string; value: string; tone: "pos" | "neg" | "warn" | "neutral"; note: string; }
export interface TopDownContext {
  layers: TopDownLayer[];
  ensemble: EnsembleResult | null;
  convictionMult: number;      // 0.6–1.0, from the loop (divergence lowers it)
  summary: string;
}

export interface TopDownInput {
  macro: MacroState | null;
  sector: string | null;
  subScores: { value: number | null; health: number | null; momentum: number | null; growth: number | null } | null;
  mom12_1: number | null;
  sectorLeader?: boolean | null; // optional L3 (is the name's sector a momentum leader?)
}

const GROWTH = ["Technology", "Consumer Cyclical", "Communication Services", "Real Estate"];
const DEFENSIVE = ["Utilities", "Consumer Defensive", "Healthcare"];

export function topDownContext(inp: TopDownInput): TopDownContext {
  const m = inp.macro;
  const layers: TopDownLayer[] = [];

  // L1 — Secular baseline
  const sec = secularRegime(m?.buffett_indicator ?? null, m?.cape ?? null, m?.expected_return_10y ?? null);
  layers.push({
    code: "L1", label: "Secular", value: `${sec.phase} · baseline ${sec.baselineEquity}%`,
    tone: sec.percentile >= 82 ? "neg" : sec.percentile >= 64 ? "warn" : "pos",
    note: `Long valuation cycle sets the equity baseline the tactical layers tilt around.`,
  });

  // L2 — Risk-on backdrop (the unified voice)
  const riskOn = m?.risk_on != null ? Number(m.risk_on)
    : computeRiskOn({ lcc: m?.liquidity_cycle ?? null, rpc: m?.recession_prob ?? null, csc: m?.credit_stress ?? null });
  const roLabel = riskOn >= 60 ? "Risk-on" : riskOn >= 40 ? "Neutral" : "Risk-off";
  layers.push({
    code: "L2", label: "Allocation", value: `${roLabel} · risk-on ${riskOn.toFixed(0)}`,
    tone: riskOn >= 60 ? "pos" : riskOn >= 40 ? "warn" : "neg",
    note: `Liquidity-led backdrop — the same gauge that drives the validated allocation.`,
  });

  // Loop — top-down ↔ bottom-up (A3)
  const conf = regimeConfirmation(riskOn, m?.breadth_200dma ?? null);
  if (conf.state !== "unknown") {
    layers.push({
      code: "◆", label: "Loop", value: conf.label,
      tone: conf.state === "confirmed" ? "pos" : conf.state === "divergent-bearish" ? "neg" : "warn",
      note: conf.detail,
    });
  }

  // L3 — Sector rotation (optional)
  if (inp.sector) {
    const isLeader = inp.sectorLeader === true;
    const known = inp.sectorLeader != null;
    layers.push({
      code: "L3", label: "Sector", value: known ? (isLeader ? `${inp.sector} — leading` : `${inp.sector} — lagging`) : `${inp.sector}`,
      tone: known ? (isLeader ? "pos" : "warn") : "neutral",
      note: known ? `Momentum rotation ${isLeader ? "favors" : "does not favor"} this sleeve right now.` : `Sector momentum context.`,
    });
  }

  // L4 — Selection regime + IC-weighted ensemble (A5)
  const pick = stockPickingRegime(m?.implied_corr ?? null);
  const ensemble = inp.subScores
    ? ensembleScore({ value: inp.subScores.value, health: inp.subScores.health, momentum: inp.subScores.momentum, growth: inp.subScores.growth, mom12_1: inp.mom12_1 }, m?.implied_corr ?? null)
    : null;
  layers.push({
    code: "L4", label: "Selection", value: `${pick.label}${ensemble ? ` · composite ${ensemble.composite}` : ""}`,
    tone: pick.label.toLowerCase().includes("favor") ? "pos" : pick.label.toLowerCase().includes("unfavor") ? "neg" : "warn",
    note: `${pick.detail} The composite weights factors by their measured IC in this regime.`,
  });

  // Conviction modulator comes from the loop — a divergence means trust the tilt less.
  const convictionMult = conf.convictionMult;
  const growthTape = inp.sector && GROWTH.includes(inp.sector);
  const defTape = inp.sector && DEFENSIVE.includes(inp.sector);
  const fit = riskOn >= 60 ? (growthTape ? "fits the risk-on tape" : defTape ? "is a laggard in this tape" : "is neutral to the tape")
            : riskOn < 40 ? (defTape ? "fits the defensive tape" : growthTape ? "fights the risk-off tape" : "is neutral to the tape")
            : "sits in a neutral backdrop";
  const summary = `${sec.phase} valuations, a ${roLabel.toLowerCase()} backdrop ${conf.state.startsWith("divergent") ? "with a breadth divergence (lower conviction)" : "confirmed by breadth"}; ${inp.sector ?? "the name"} ${fit}. Selection ${pick.label.toLowerCase()}.`;

  return { layers, ensemble, convictionMult, summary };
}
