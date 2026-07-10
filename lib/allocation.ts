// ─────────────────────────────────────────────────────────────────────────────
// Multi-asset allocation (Layer 2) — the validated Phase-0B/1 design, shared between
// the research backtest (research/allocate.mjs) and the app. A continuous, liquidity-led
// RISK-ON tilt blends a risk-on and a risk-off ETF basket; then Antonacci ABSOLUTE
// momentum moves any risk sleeve with negative 12-1m trend to cash.
//
// Validated out-of-sample over 2007-2026 (research/backtest_assets.mjs, REGIME=stationary):
// RiskOn tilt + dual-momentum → Sharpe 1.01, max drawdown −10.1%, beating a regime-free
// dual-momentum control (0.88) and SPY buy&hold (0.71 / −50.7%) in BOTH sub-periods.
// Keep this file in lock-step with research/allocate.mjs (same constants & rules).
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOC_ASSETS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL"] as const;
export type AllocAsset = (typeof ALLOC_ASSETS)[number];
export type Weights = Record<AllocAsset, number>;

export const ASSET_META: Record<AllocAsset, { label: string; role: string; color: string }> = {
  SPY: { label: "US Equities",        role: "Growth",     color: "var(--sr-pos)" },
  TLT: { label: "Long Treasuries",    role: "Duration",   color: "#6A54B8" },
  IEF: { label: "7–10y Treasuries",   role: "Duration",   color: "#9C87E8" },
  GLD: { label: "Gold",               role: "Real asset", color: "var(--sr-amber)" },
  DBC: { label: "Commodities",        role: "Real asset", color: "#C77D16" },
  BIL: { label: "T-Bills (cash)",     role: "Cash",       color: "var(--sr-text-3)" },
};

// Risk-on / risk-off baskets (sum to 1). Blended continuously by the risk-on gauge.
const RISK_ON:  Weights = { SPY: 0.55, TLT: 0.10, IEF: 0.10, GLD: 0.05, DBC: 0.15, BIL: 0.05 };
const RISK_OFF: Weights = { SPY: 0.15, TLT: 0.25, IEF: 0.20, GLD: 0.20, DBC: 0.05, BIL: 0.15 };
// Risk sleeves subject to absolute-momentum gating (BIL/IEF are the safe ballast).
const MOM_GATED: AllocAsset[] = ["SPY", "TLT", "GLD", "DBC"];

/**
 * Liquidity-led risk-on gauge (0-100). Composites are 0-100 (production values live, or
 * stationary percentiles in the backtest): liquidity up = risk-on; recession & stress = risk-off.
 */
export function computeRiskOn(c: { lcc: number | null; rpc: number | null; csc: number | null }): number {
  const lcc = c.lcc ?? 50, rpc = c.rpc ?? 50, csc = c.csc ?? 50;
  return Math.max(0, Math.min(100, 0.5 * lcc + 0.25 * (100 - rpc) + 0.25 * (100 - csc)));
}

/** Blend RISK_ON/RISK_OFF baskets by the 0-100 risk-on gauge. */
export function blendWeights(riskOn: number): Weights {
  const t = Math.max(0, Math.min(1, (riskOn ?? 50) / 100));
  const w = {} as Weights;
  for (const a of ALLOC_ASSETS) w[a] = t * RISK_ON[a] + (1 - t) * RISK_OFF[a];
  return w;
}

/** Absolute momentum: gated sleeves with 12-1m return ≤ 0 move to cash (BIL). null = unknown → kept. */
export function applyDualMomentum(weights: Weights, mom: Partial<Record<AllocAsset, number | null>>): { weights: Weights; movedToCash: AllocAsset[] } {
  const w = { ...weights };
  const moved: AllocAsset[] = [];
  for (const a of MOM_GATED) {
    if (!w[a]) continue;
    const m = mom[a];
    if (m != null && m <= 0) { w.BIL += w[a]; w[a] = 0; moved.push(a); }
  }
  return { weights: w, movedToCash: moved };
}

/**
 * A6 — inverse-volatility (risk-parity) sizing of the gated risk sleeves. Re-weights the
 * non-cash sleeves ∝ 1/vol (preserving the total risk allocation; BIL/cash untouched), so a
 * low-vol bond and a high-vol commodity don't carry equal risk at equal weight. Validated
 * OOS 2007-2026: Sharpe 1.02 vs 1.01, max drawdown −7.5% vs −10.1% — same return, less pain.
 * `vols` = each asset's recent realized volatility; missing vol → the input weight is kept.
 */
export function riskParity(weights: Weights, vols: Partial<Record<AllocAsset, number | null>>): Weights {
  const risk = ALLOC_ASSETS.filter((a) => a !== "BIL" && (weights[a] || 0) > 0);
  const riskTotal = risk.reduce((s, a) => s + weights[a], 0);
  if (riskTotal <= 0) return { ...weights };
  const inv: Record<string, number> = {};
  let invSum = 0;
  for (const a of risk) { const v = vols[a]; const iv = v != null && v > 0 ? 1 / v : weights[a] / riskTotal; inv[a] = iv; invSum += iv; }
  const out = { ...weights };
  for (const a of risk) out[a] = riskTotal * (inv[a] / invSum);
  return out;
}

export interface Allocation {
  riskOn: number;
  tiltLabel: "Risk-on" | "Neutral" | "Risk-off";
  tiltColor: string;
  weights: Weights;
  movedToCash: AllocAsset[];
  momentumApplied: boolean;
  riskParityApplied: boolean;
  rationale: string[];
}

/** Full target allocation from the risk-on gauge + (optional) 12-1m momentum + (optional)
 *  inverse-vol risk-parity sizing (A6). */
export function buildAllocation(opts: { riskOn: number; momentum?: Partial<Record<AllocAsset, number | null>>; vols?: Partial<Record<AllocAsset, number | null>> }): Allocation {
  const riskOn = Math.max(0, Math.min(100, opts.riskOn));
  const base = blendWeights(riskOn);
  const momentumApplied = !!opts.momentum && Object.values(opts.momentum).some((v) => v != null);
  const gated = applyDualMomentum(base, opts.momentum ?? {});
  const movedToCash = gated.movedToCash;
  const riskParityApplied = !!opts.vols && Object.values(opts.vols).some((v) => v != null);
  const weights = riskParityApplied ? riskParity(gated.weights, opts.vols!) : gated.weights;
  const tiltLabel = riskOn >= 60 ? "Risk-on" : riskOn >= 40 ? "Neutral" : "Risk-off";
  const tiltColor = riskOn >= 60 ? "var(--sr-pos)" : riskOn >= 40 ? "var(--sr-warn)" : "var(--sr-neg)";
  const rationale: string[] = [
    `Liquidity-led risk gauge at ${riskOn.toFixed(0)}/100 → ${tiltLabel}: blend ${riskOn.toFixed(0)}% risk-on basket / ${(100 - riskOn).toFixed(0)}% defensive basket.`,
  ];
  if (momentumApplied) {
    rationale.push(movedToCash.length
      ? `Absolute momentum negative for ${movedToCash.join(", ")} → those sleeves moved to cash (T-bills).`
      : `All risk sleeves have positive 12-1m momentum → none gated to cash.`);
  } else {
    rationale.push(`Momentum data unavailable — showing the risk-on tilt without the trend gate.`);
  }
  if (riskParityApplied) rationale.push(`Inverse-vol (risk-parity) sizing applied — sleeves weighted by 1/volatility (validated: −7.5% max drawdown vs −10.1%).`);
  return { riskOn, tiltLabel, tiltColor, weights, movedToCash, momentumApplied, riskParityApplied, rationale };
}
