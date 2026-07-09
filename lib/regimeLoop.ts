// ─────────────────────────────────────────────────────────────────────────────
// The loop (Phase A3) — closes the top-down ↔ bottom-up circuit. It compares the macro
// direction (risk_on, top-down, 0-100) against market breadth (% of the universe above
// its 200-day average, bottom-up, 0-100). When they AGREE, conviction is high. When they
// DIVERGE, that's the most valuable signal in the whole system: the market can keep rising
// on a shrinking number of names — risk-on macro with deteriorating participation is a
// classic early warning. Level-based (no history needed); pure + testable.
// ─────────────────────────────────────────────────────────────────────────────

export type ConfirmState = "confirmed" | "divergent-bearish" | "divergent-bullish" | "neutral" | "unknown";

export interface RegimeConfirmation {
  state: ConfirmState;
  gap: number | null;      // risk_on − breadth (points). +ve = macro ahead of participation
  label: string;
  detail: string;
  color: string;           // semantic (theme token)
  convictionMult: number;  // 0.6–1.0 — how much to trust the macro tilt right now
}

const GAP_DIVERGE = 12; // points of risk_on-vs-breadth gap that flags a divergence

export function regimeConfirmation(riskOn: number | null | undefined, breadth200: number | null | undefined): RegimeConfirmation {
  const ro = riskOn == null ? null : Number(riskOn);
  const bd = breadth200 == null ? null : Number(breadth200);
  if (ro == null || bd == null || isNaN(ro) || isNaN(bd)) {
    return { state: "unknown", gap: null, label: "No breadth read", detail: "Breadth data not available yet — the aggregator populates it weekly.", color: "var(--sr-text-3)", convictionMult: 1 };
  }
  const gap = Math.round(ro - bd);

  if (gap >= GAP_DIVERGE) {
    // Macro is risk-on but fewer names are participating → narrowing → early warning.
    return {
      state: "divergent-bearish", gap,
      label: "Divergence — participation narrowing",
      detail: `The macro read (risk-on ${ro.toFixed(0)}) is running ahead of breadth (${bd.toFixed(0)}% of names above their 200-day). Rallies on shrinking participation are fragile — treat the risk-on tilt with less conviction.`,
      color: "var(--sr-neg)", convictionMult: 0.6,
    };
  }
  if (gap <= -GAP_DIVERGE) {
    // Breadth is broad but the macro read is cautious → broadening → constructive divergence.
    return {
      state: "divergent-bullish", gap,
      label: "Divergence — participation broadening",
      detail: `Breadth (${bd.toFixed(0)}% above 200-day) is stronger than the cautious macro read (risk-on ${ro.toFixed(0)}). Broadening participation ahead of the macro gauge is constructive.`,
      color: "var(--sr-warn)", convictionMult: 0.85,
    };
  }
  // Aligned within the band.
  const strong = ro >= 55 && bd >= 55, weak = ro <= 45 && bd <= 45;
  return {
    state: "confirmed", gap,
    label: strong ? "Confirmed · risk-on" : weak ? "Confirmed · risk-off" : "Confirmed · neutral",
    detail: `Top-down (risk-on ${ro.toFixed(0)}) and bottom-up breadth (${bd.toFixed(0)}%) agree${strong ? " — broad risk-on, high conviction" : weak ? " — broad risk-off, defensive with conviction" : ""}.`,
    color: strong ? "var(--sr-pos)" : weak ? "var(--sr-neg)" : "var(--sr-text-2)",
    convictionMult: 1,
  };
}
