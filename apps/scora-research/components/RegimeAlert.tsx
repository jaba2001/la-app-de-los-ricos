"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { computeRiskOn } from "@/lib/allocation";
import { regimeConfirmation } from "@/lib/regimeLoop";

// Retention / alerts (B6) — a conditional, actionable notice, NOT an always-on panel.
// It surfaces only when the top-down↔bottom-up loop diverges (the early warning) or when the
// backdrop turns risk-off — the moments worth coming back for. When everything's confirmed it
// stays silent (no false alarms). This is the in-app content of what a weekly digest / Web
// Push would deliver; the async delivery layer needs VAPID keys (a free, separate add-on).
export default function RegimeAlert({ macro }: { macro: MacroState | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (!macro || dismissed) return null;

  const riskOn = macro.risk_on != null ? Number(macro.risk_on)
    : computeRiskOn({ lcc: macro.liquidity_cycle ?? null, rpc: macro.recession_prob ?? null, csc: macro.credit_stress ?? null });
  const conf = regimeConfirmation(riskOn, macro.breadth_200dma ?? null);

  const isDivergent = conf.state.startsWith("divergent");
  const isRiskOff = riskOn < 40;
  if (!isDivergent && !isRiskOff) return null; // nothing actionable → stay silent

  const color = conf.state === "divergent-bearish" || isRiskOff ? "var(--sr-neg)" : "var(--sr-warn)";
  const headline = conf.state === "divergent-bearish"
    ? "Early warning — participation is narrowing"
    : isRiskOff ? "Backdrop turned risk-off" : conf.label;
  const detail = isDivergent ? conf.detail
    : `The liquidity-led risk-on gauge is at ${riskOn.toFixed(0)}/100 — a defensive backdrop. The validated allocator tilts toward duration, gold and cash.`;

  return (
    <div style={{ marginBottom: "var(--sr-sp-4)", padding: "var(--sr-sp-3) var(--sr-sp-4)", borderRadius: "var(--sr-radius-lg, 14px)", background: `color-mix(in srgb, ${color} 10%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`, display: "flex", alignItems: "flex-start", gap: "var(--sr-sp-3)" }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>⚠</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }}>{headline}</span>
          <span style={{ fontSize: "9px", fontWeight: 700, color, padding: "1px 6px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${color} 14%, transparent)` }}>REGIME ALERT</span>
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", marginTop: 3, lineHeight: 1.5 }}>{detail}</div>
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" style={{ background: "none", border: "none", color: "var(--sr-text-3)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 2 }}>×</button>
    </div>
  );
}
