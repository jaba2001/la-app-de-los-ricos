// ─────────────────────────────────────────────────────────────────────────────
// Multi-asset allocation (Layer 2) — the validated Phase-0B/1 design, shared between
// the research backtest (research/allocate.mjs) and the app. A continuous, liquidity-led
// RISK-ON tilt blends a risk-on and a risk-off ETF basket; then Antonacci ABSOLUTE
// momentum moves any risk sleeve with negative 12-1m trend to cash.
//
// Validated out-of-sample over 2007-2026 (research/backtest_assets.mjs, REGIME=stationary):
// RiskOn tilt + dual-momentum → Sharpe 1.02, max drawdown −10.1%, beating a regime-free
// dual-momentum control (0.89) and SPY buy&hold (0.72 / −50.7%) in BOTH sub-periods.
// Keep this file in lock-step with research/allocate.mjs (same constants & rules).
// ─────────────────────────────────────────────────────────────────────────────

export const ALLOC_ASSETS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"] as const;
export type AllocAsset = (typeof ALLOC_ASSETS)[number];
export type Weights = Record<AllocAsset, number>;

// Grayscale/CAIA: a small (~5%) Bitcoin sleeve historically maximized a portfolio's Sharpe.
// Scora holds BTC ONLY in the Growth profile, ONLY when risk-on and BTC's own 12-1m trend is
// up, capped at this weight, carved FROM equities (so the book always sums to 1 — never
// leverage). It is a small diversifier, not a return bet; crypto's past magnitude won't repeat.
export const BTC_SLEEVE = 0.05;

export const ASSET_META: Record<AllocAsset, { label: string; role: string; color: string }> = {
  SPY: { label: "US Equities",        role: "Growth",     color: "var(--sr-pos)" },
  TLT: { label: "Long Treasuries",    role: "Duration",   color: "#6A54B8" },
  IEF: { label: "7–10y Treasuries",   role: "Duration",   color: "#9C87E8" },
  GLD: { label: "Gold",               role: "Real asset", color: "var(--sr-amber)" },
  DBC: { label: "Commodities",        role: "Real asset", color: "#C77D16" },
  BIL: { label: "T-Bills (cash)",     role: "Cash",       color: "var(--sr-text-3)" },
  BTCUSD: { label: "Bitcoin",         role: "Digital",    color: "#F7931A" },
};

// Risk-on / risk-off baskets (sum to 1). Blended continuously by the risk-on gauge.
// BTC is 0 here — the Defensive blend never holds crypto; the sleeve lives only in Growth.
const RISK_ON:  Weights = { SPY: 0.55, TLT: 0.10, IEF: 0.10, GLD: 0.05, DBC: 0.15, BIL: 0.05, BTCUSD: 0 };
const RISK_OFF: Weights = { SPY: 0.15, TLT: 0.25, IEF: 0.20, GLD: 0.20, DBC: 0.05, BIL: 0.15, BTCUSD: 0 };
// Risk sleeves subject to absolute-momentum gating (BIL/IEF are the safe ballast).
const MOM_GATED: AllocAsset[] = ["SPY", "TLT", "GLD", "DBC"];

// Capture-tuned risk-off basket (2026-07-12 capture_lab.mjs): a 60% equity FLOOR when the
// gauge is risk-off, instead of the old full-defensive switch (SPY 15%). The absolute-
// momentum gate still moves that equity to cash in a sustained downtrend, so the tail is
// covered — but in ordinary risk-off chop we stay largely invested and capture the upside
// the old beta-0.32 default gave away. Measured: ~74pp more total return at essentially the
// same Sharpe and a slightly shallower drawdown (the old default was over-tuned for min DD).
const GROWTH_RISKOFF: Weights = { SPY: 0.60, TLT: 0.15, IEF: 0.10, GLD: 0.15, DBC: 0, BIL: 0, BTCUSD: 0 };

/**
 * Liquidity-led risk-on gauge (0-100). Composites are 0-100 (production values live, or
 * stationary percentiles in the backtest): liquidity up = risk-on; recession & stress = risk-off.
 */
export function computeRiskOn(c: { lcc: number | null; rpc: number | null; csc: number | null }): number {
  const lcc = c.lcc ?? 50, rpc = c.rpc ?? 50, csc = c.csc ?? 50;
  return Math.max(0, Math.min(100, 0.5 * lcc + 0.25 * (100 - rpc) + 0.25 * (100 - csc)));
}

// ── Risk profiles (2026-07-12 capture retune, research/capture_lab.mjs) ────────────────
// GROWTH is the default product profile: 100% equities when the gauge is risk-on (≥50), a
// 60% equity FLOOR + light defensive ballast otherwise, then the same 12-1m trend gate — NO
// risk-parity (it dilutes the return engine). Measured 2007-2026: +636.7% (CAGR 10.78%) ·
// Sharpe 1.00 · maxDD −16.2% — nearly matches SPY's total return (+652%/10.9%) at ⅓ the
// drawdown, and BEAT it outright in 2007-2019 (+204% vs +196%). The old min-drawdown switch
// (β0.32, +506%) left ~130pp of return on the table. Leverage (2× SSO), short hedges (SH),
// long-vol (VXX), CPPI and capture variants past β~0.5 all measured and REJECTED
// (aggressive_lab/capture_lab.json). DEFENSIVE = low-vol blend + risk-parity (Sharpe 1.02 · maxDD −10.1%).
export type RiskProfile = "growth" | "defensive";

/** Growth profile weights: regime switch, not a blend. When risk-on and BTC's 12-1m trend
 *  is up, a small BTC_SLEEVE is carved FROM equities (still sums to 1 — never leverage). */
export function growthWeights(riskOn: number, btcMom12_1?: number | null): Weights {
  if (riskOn < 50) return { ...GROWTH_RISKOFF };
  const holdBtc = btcMom12_1 != null && btcMom12_1 > 0;
  const btc = holdBtc ? BTC_SLEEVE : 0;
  return { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
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
 * OOS 2007-2026: Sharpe 1.01 vs 1.02, max drawdown −7.5% vs −10.1% — a hair of Sharpe
 * traded for a materially shallower drawdown.
 * `vols` = each asset's recent realized volatility; missing vol → the input weight is kept.
 */
export function riskParity(weights: Weights, vols: Partial<Record<AllocAsset, number | null>>): Weights {
  const risk = ALLOC_ASSETS.filter((a) => a !== "BIL" && (weights[a] || 0) > 0);
  const riskTotal = risk.reduce((s, a) => s + weights[a], 0);
  if (riskTotal <= 0) return { ...weights };
  // A sleeve with no vol reading gets the MEAN inverse-vol of the available sleeves
  // (neutral sizing) — mixing a weight-share with 1/vol values would crush or inflate it
  // depending on the vol scale. No vols at all → weights unchanged.
  const avail = risk.filter((a) => vols[a] != null && (vols[a] as number) > 0);
  if (avail.length === 0) return { ...weights };
  const meanInv = avail.reduce((s, a) => s + 1 / (vols[a] as number), 0) / avail.length;
  const inv: Record<string, number> = {};
  let invSum = 0;
  for (const a of risk) { const v = vols[a]; const iv = v != null && v > 0 ? 1 / v : meanInv; inv[a] = iv; invSum += iv; }
  const out = { ...weights };
  for (const a of risk) out[a] = riskTotal * (inv[a] / invSum);
  return out;
}

export interface Allocation {
  riskOn: number;
  profile: RiskProfile;
  tiltLabel: "Risk-on" | "Neutral" | "Risk-off";
  tiltColor: string;
  weights: Weights;
  movedToCash: AllocAsset[];
  momentumApplied: boolean;
  riskParityApplied: boolean;
  rationale: string[];
}

/** Full target allocation from the risk-on gauge + (optional) 12-1m momentum + (optional)
 *  inverse-vol risk-parity sizing (A6, defensive profile only). Default profile: growth. */
export function buildAllocation(opts: { riskOn: number; momentum?: Partial<Record<AllocAsset, number | null>>; vols?: Partial<Record<AllocAsset, number | null>>; profile?: RiskProfile }): Allocation {
  const riskOn = Math.max(0, Math.min(100, opts.riskOn));
  const profile: RiskProfile = opts.profile ?? "growth";
  const base = profile === "growth" ? growthWeights(riskOn, opts.momentum?.BTCUSD) : blendWeights(riskOn);
  const momentumApplied = !!opts.momentum && Object.values(opts.momentum).some((v) => v != null);
  const gated = applyDualMomentum(base, opts.momentum ?? {});
  const movedToCash = gated.movedToCash;
  // Risk-parity is part of the DEFENSIVE mandate only — on growth it dilutes the engine.
  const riskParityApplied = profile === "defensive" && !!opts.vols && Object.values(opts.vols).some((v) => v != null);
  const weights = riskParityApplied ? riskParity(gated.weights, opts.vols!) : gated.weights;
  const tiltLabel = riskOn >= 60 ? "Risk-on" : riskOn >= 40 ? "Neutral" : "Risk-off";
  const tiltColor = riskOn >= 60 ? "var(--sr-pos)" : riskOn >= 40 ? "var(--sr-warn)" : "var(--sr-neg)";
  const rationale: string[] = [
    profile === "growth"
      ? `Liquidity-led risk gauge at ${riskOn.toFixed(0)}/100 → ${tiltLabel}: Growth mandate holds ${riskOn >= 50 ? "100% equities" : "a 60% equity floor + defensive ballast"} (floor at 50).`
      : `Liquidity-led risk gauge at ${riskOn.toFixed(0)}/100 → ${tiltLabel}: blend ${riskOn.toFixed(0)}% risk-on basket / ${(100 - riskOn).toFixed(0)}% defensive basket.`,
  ];
  if (momentumApplied) {
    rationale.push(movedToCash.length
      ? `Absolute momentum negative for ${movedToCash.join(", ")} → those sleeves moved to cash (T-bills).`
      : `All risk sleeves have positive 12-1m momentum → none gated to cash.`);
  } else {
    rationale.push(`Momentum data unavailable — showing the risk-on tilt without the trend gate.`);
  }
  if (riskParityApplied) rationale.push(`Inverse-vol (risk-parity) sizing applied — sleeves weighted by 1/volatility (validated: −7.5% max drawdown vs −10.1%).`);
  if ((weights.BTCUSD || 0) > 0) rationale.push(`Small ${(weights.BTCUSD * 100).toFixed(0)}% Bitcoin sleeve (risk-on + BTC uptrend) carved from equities — a diversifier per CAIA/Grayscale, never leverage. Crypto's past magnitude won't repeat.`);
  return { riskOn, profile, tiltLabel, tiltColor, weights, movedToCash, momentumApplied, riskParityApplied, rationale };
}
