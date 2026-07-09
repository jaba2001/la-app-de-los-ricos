// ─────────────────────────────────────────────────────────────────────────────
// Position sizing (Phase 6) — the Kelly criterion, honestly framed. Kelly maximizes
// long-run growth but is famously aggressive and hyper-sensitive to the (subjective) win
// probability, so practitioners bet a FRACTION of it. This is a calculator, not advice:
// the user supplies their own edge estimate; we return full/half/quarter Kelly and cap it.
// f* = p − (1−p)/b, where b = upside/downside (the payoff ratio).
// ─────────────────────────────────────────────────────────────────────────────

export interface KellyResult {
  b: number;              // payoff ratio (upside/downside)
  edge: number;           // expected value per unit staked, as a fraction
  full: number;           // full-Kelly fraction of capital (0-1, clamped ≥0)
  half: number;           // half-Kelly (the common practical choice)
  quarter: number;        // quarter-Kelly (conservative)
  capped: number;         // half-Kelly capped at MAX_POSITION
  favorable: boolean;     // is there a positive edge?
}

export const MAX_POSITION = 0.25; // sanity cap — never suggest more than 25% in one name

export function kelly(winProb: number, upsidePct: number, downsidePct: number): KellyResult | null {
  const p = Math.max(0, Math.min(1, winProb));
  const up = Math.abs(upsidePct), down = Math.abs(downsidePct);
  if (up <= 0 || down <= 0) return null;
  const b = up / down;
  const q = 1 - p;
  const full = Math.max(0, p - q / b);       // negative → no bet
  const edge = p * (up / 100) - q * (down / 100);
  const half = full / 2, quarter = full / 4;
  return {
    b: Number(b.toFixed(2)),
    edge: Number(edge.toFixed(3)),
    full: Number(full.toFixed(3)),
    half: Number(half.toFixed(3)),
    quarter: Number(quarter.toFixed(3)),
    capped: Number(Math.min(MAX_POSITION, half).toFixed(3)),
    favorable: full > 0,
  };
}
