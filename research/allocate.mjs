// ─────────────────────────────────────────────────────────────────────────────
// Multi-asset allocation by regime (Layer 2). Maps the production regime → target
// weights across liquid, free ETFs, then applies Antonacci-style ABSOLUTE momentum:
// any risk sleeve whose 12-1m total return is ≤ 0 is moved to cash (BIL). This is the
// "big alpha, free with ETFs" layer — validated in backtest_assets.mjs before it ever
// touches the app.
//
// Assets (all on Yahoo, long history):
//   SPY  US equities        TLT  long Treasuries     IEF  7-10y Treasuries
//   GLD  gold               DBC  broad commodities   BIL  T-bills (cash proxy)
//
// The regime ids come straight from classifyRegime (ic-proxy/lib/macro.js):
//   expansion · reflation · stagflation · contraction · neutral
// ─────────────────────────────────────────────────────────────────────────────

export const ASSETS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
// Grayscale/CAIA small-BTC-sleeve constant (Growth only, carved from equities, never leverage).
export const BTC_SLEEVE = 0.05;

// Regime → target weights (sum to 1). Grounded in the regime-rotation literature:
// expansion = risk-on equities; reflation = equities + real assets (commodities);
// stagflation = gold/commodities/cash defensive, equities light; contraction =
// duration (bonds) + cash + gold, equities minimal. Neutral = balanced.
export const REGIME_WEIGHTS = {
  expansion:   { SPY: 0.70, TLT: 0.05, IEF: 0.05, GLD: 0.05, DBC: 0.10, BIL: 0.05 },
  reflation:   { SPY: 0.45, TLT: 0.00, IEF: 0.05, GLD: 0.10, DBC: 0.25, BIL: 0.15 },
  stagflation: { SPY: 0.15, TLT: 0.00, IEF: 0.05, GLD: 0.30, DBC: 0.25, BIL: 0.25 },
  contraction: { SPY: 0.10, TLT: 0.25, IEF: 0.15, GLD: 0.20, DBC: 0.05, BIL: 0.25 },
  neutral:     { SPY: 0.40, TLT: 0.10, IEF: 0.15, GLD: 0.10, DBC: 0.10, BIL: 0.15 },
};

// Sleeves subject to absolute-momentum gating. BIL (cash) is the safe harbor and is
// never gated; IEF is kept as a mild duration ballast even in bad-momentum tape.
const MOM_GATED = new Set(["SPY", "TLT", "GLD", "DBC"]);

/** Target weights for a regime, defaulting to neutral for unknown ids. */
export function targetWeights(regimeId) {
  return { ...(REGIME_WEIGHTS[regimeId] || REGIME_WEIGHTS.neutral) };
}

// Continuous risk-on tilt (Phase 1 recalibration): blend between a risk-on and a
// risk-off basket by a 0-100 gauge. Smooth → no brittle regime thresholds.
const RISK_ON  = { SPY: 0.55, TLT: 0.10, IEF: 0.10, GLD: 0.05, DBC: 0.15, BIL: 0.05 };
const RISK_OFF = { SPY: 0.15, TLT: 0.25, IEF: 0.20, GLD: 0.20, DBC: 0.05, BIL: 0.15 };

/** Growth profile (2026-07 lab): regime SWITCH, not a blend — equities when risk-on (≥50),
 *  defensive basket otherwise. A small BTC sleeve (carved from equities, never leverage) is
 *  held when risk-on AND BTC's 12-1m trend is up. Lock-step with lib/allocation.ts. */
export function growthWeights(riskOn, btcMom12_1) {
  if (riskOn < 50) return { ...RISK_OFF, BTCUSD: 0 };
  const btc = btcMom12_1 != null && btcMom12_1 > 0 ? BTC_SLEEVE : 0;
  return { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
}

/** Blend RISK_ON/RISK_OFF baskets by riskOn (0-100). */
export function blendWeights(riskOn) {
  const t = Math.max(0, Math.min(1, (riskOn ?? 50) / 100));
  const w = {};
  for (const a of ASSETS) w[a] = t * (RISK_ON[a] || 0) + (1 - t) * (RISK_OFF[a] || 0);
  return w;
}

/**
 * Apply absolute momentum: for each gated sleeve whose 12-1m return ≤ 0, move its
 * weight to BIL. `mom` is a map asset → 12-1m total return (%), null = unknown (kept).
 * Returns { weights, movedToCash: [assets] }.
 */
export function applyDualMomentum(weights, mom) {
  const w = { ...weights };
  const moved = [];
  for (const a of MOM_GATED) {
    if (!w[a]) continue;
    const m = mom[a];
    if (m != null && m <= 0) { w.BIL = (w.BIL || 0) + w[a]; w[a] = 0; moved.push(a); }
  }
  return { weights: w, movedToCash: moved };
}

/**
 * A6 — inverse-volatility (risk-parity) sizing of the gated risk sleeves (BIL untouched).
 * Validated OOS 2007-2026: Sharpe 1.01 vs 1.02, max drawdown −7.5% vs −10.1%. Kept in
 * lock-step with lib/allocation.ts. `vols` = each asset's recent realized volatility.
 */
export function riskParity(weights, vols) {
  const risk = ASSETS.filter((a) => a !== "BIL" && (weights[a] || 0) > 0);
  const riskTotal = risk.reduce((s, a) => s + weights[a], 0);
  if (riskTotal <= 0) return { ...weights };
  // A sleeve with no vol reading gets the MEAN inverse-vol of the available sleeves
  // (neutral sizing) — mixing a weight-share with 1/vol values would crush or inflate it
  // depending on the vol scale. No vols at all → weights unchanged.
  const avail = risk.filter((a) => vols[a] != null && vols[a] > 0);
  if (avail.length === 0) return { ...weights };
  const meanInv = avail.reduce((s, a) => s + 1 / vols[a], 0) / avail.length;
  const inv = {}; let invSum = 0;
  for (const a of risk) { const v = vols[a]; const iv = v != null && v > 0 ? 1 / v : meanInv; inv[a] = iv; invSum += iv; }
  const out = { ...weights };
  for (const a of risk) out[a] = riskTotal * (inv[a] / invSum);
  return out;
}
