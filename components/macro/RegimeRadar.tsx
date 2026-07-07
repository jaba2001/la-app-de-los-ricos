"use client";
import type { MacroState } from "@/lib/types";
import { computeRiskOn } from "@/lib/allocation";
import { stockPickingRegime } from "@/lib/microScore";

interface Props { macro: MacroState | null; }

// A driver of the risk-on gauge. `bad` = higher value is risk-off (recession/stress).
interface Driver { key: string; label: string; value: number | null; bad: boolean; hint: string; }

function driverColor(v: number | null, bad: boolean): string {
  if (v == null) return "var(--sr-text-3)";
  const risk = bad ? v : 100 - v; // 0 = benign, 100 = risk-off
  return risk >= 66 ? "var(--sr-neg)" : risk >= 40 ? "var(--sr-warn)" : "var(--sr-pos)";
}

// Cross-asset context chip with a simple risk tint (descriptive, not a signal).
function CrossChip({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone: "on" | "off" | "neutral" }) {
  const color = tone === "off" ? "var(--sr-neg)" : tone === "on" ? "var(--sr-pos)" : "var(--sr-text-2)";
  return (
    <div style={{ flex: "1 1 92px", minWidth: 92, padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: `1px solid color-mix(in srgb, ${color} 22%, transparent)` }}>
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }} className="num">{value}<span style={{ fontSize: "10px", fontWeight: 500, color: "var(--sr-text-3)" }}>{unit}</span></div>
    </div>
  );
}

export default function RegimeRadar({ macro }: Props) {
  if (!macro) return null;

  const riskOn = macro.risk_on != null ? macro.risk_on
    : computeRiskOn({ lcc: macro.liquidity_cycle, rpc: macro.recession_prob, csc: macro.credit_stress });

  // Prefer the stationary drivers; fall back to production composites so the radar
  // always renders (clearly the same 0-100 scale).
  const drivers: Driver[] = [
    { key: "lcc", label: "Liquidity impulse", value: macro.risk_on_lcc ?? macro.liquidity_cycle, bad: false, hint: "6-month net-liquidity change, percentile-ranked. Higher = liquidity expanding → supportive." },
    { key: "rpc", label: "Recession risk",    value: macro.risk_on_rpc ?? macro.recession_prob, bad: true,  hint: "Inverted yield curve + Sahm rule, percentile-ranked. Higher = recession risk rising." },
    { key: "csc", label: "Financial stress",  value: macro.risk_on_csc ?? macro.credit_stress,  bad: true,  hint: "St. Louis Fed Financial Stress Index, percentile-ranked. Higher = tighter conditions." },
  ];

  const tiltLabel = riskOn >= 60 ? "Risk-on" : riskOn >= 40 ? "Neutral" : "Risk-off";
  const tiltColor = riskOn >= 60 ? "var(--sr-pos)" : riskOn >= 40 ? "var(--sr-warn)" : "var(--sr-neg)";

  // Cross-asset context (from macro_state; descriptive tints)
  const hy = macro.hy_oas ?? null;                 // bps
  const curve = macro.t10y3m ?? null;              // %
  const vix = macro.vix ?? null;
  const dxy = macro.dxy ?? null;

  // Stock-picking regime (Phase 4, VALIDATED as predictive — unlike the risk-on gauge).
  const picking = stockPickingRegime(macro.implied_corr ?? null);

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Regime Radar</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 470, lineHeight: 1.5 }}>
            The macro context behind your allocation — a read of <em>where we are</em>, decomposed into the three drivers of the risk-on gauge. Not a forecast.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Risk-on</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: tiltColor, lineHeight: 1 }} className="num">{riskOn.toFixed(0)}</div>
          <div style={{ fontSize: "10px", fontWeight: 700, color: tiltColor }}>{tiltLabel}</div>
        </div>
      </div>

      {/* Stock-picking regime — VALIDATED switch (momentum selection pays when correlation is low) */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", marginBottom: "var(--sr-sp-3)", background: `color-mix(in srgb, ${picking.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${picking.color} 30%, transparent)` }}>
        <div style={{ minWidth: 58, textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Corr</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: picking.color, lineHeight: 1 }} className="num">{macro.implied_corr != null ? macro.implied_corr.toFixed(0) : "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-text)" }}>Stock-picking: </span>
            <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: picking.color }}>{picking.label}</span>
            <span style={{ fontSize: "9px", fontWeight: 700, color: "var(--sr-pos)", padding: "1px 6px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-pos) 12%, transparent)" }}>VALIDATED</span>
          </div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 3, lineHeight: 1.45 }}>{picking.detail}</div>
        </div>
      </div>

      {/* Three drivers */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
        {drivers.map((d) => {
          const col = driverColor(d.value, d.bad);
          const v = d.value;
          return (
            <div key={d.key} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)" }} title={d.hint}>
              <div style={{ minWidth: 128, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{d.label}</div>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--sr-surface-3)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${v == null ? 0 : Math.max(0, Math.min(100, v))}%`, background: col, borderRadius: 4, transition: "width 500ms ease" }} />
              </div>
              <div style={{ minWidth: 68, textAlign: "right", fontSize: "var(--sr-t-sm)", fontWeight: 700, color: col }} className="num">
                {v == null ? "—" : v.toFixed(0)}
                <span style={{ fontSize: "9px", fontWeight: 600, color: "var(--sr-text-3)", marginLeft: 4 }}>{d.bad ? (v != null && v >= 60 ? "HIGH" : "") : (v != null && v >= 60 ? "STRONG" : "")}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cross-asset context strip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)", marginTop: "var(--sr-sp-3)" }}>
        <CrossChip label="HY credit" value={hy != null ? hy.toFixed(0) : "—"} unit=" bps" tone={hy == null ? "neutral" : hy > 450 ? "off" : hy < 350 ? "on" : "neutral"} />
        <CrossChip label="Curve 10y-3m" value={curve != null ? curve.toFixed(2) : "—"} unit="%" tone={curve == null ? "neutral" : curve < 0 ? "off" : "on"} />
        <CrossChip label="VIX" value={vix != null ? vix.toFixed(0) : "—"} tone={vix == null ? "neutral" : vix > 25 ? "off" : vix < 18 ? "on" : "neutral"} />
        <CrossChip label="Dollar (DXY)" value={dxy != null ? dxy.toFixed(0) : "—"} tone="neutral" />
      </div>

      <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
        The gauge is validated for <strong>allocation</strong> (risk-adjusted), not directional market-timing — a high reading does not predict higher equity returns; its edge is the asset mix it drives above.
      </div>
    </div>
  );
}
