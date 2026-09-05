"use client";
import type { MacroState } from "@/lib/types";
import { secularRegime, secularCyclePosition } from "@/lib/secular";

interface Props { macro: MacroState | null; }

export default function SecularClock({ macro }: Props) {
  if (!macro) return null;
  const s = secularRegime(macro.buffett_indicator ?? null, macro.cape ?? null, macro.expected_return_10y ?? null);
  const cycle = secularCyclePosition(new Date(), macro.cape ?? null);
  const cyclePct = Math.max(4, Math.min(100, (cycle.yearsElapsed / (cycle.typicalYears + 2)) * 100));

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Secular Clock · Layer 1</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 460, lineHeight: 1.5 }}>
            Where we are in the long valuation cycle. Sets the <em>baseline</em> equity exposure that the tactical allocator tilts around.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Valuation</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.phase}</div>
        </div>
      </div>

      {/* Valuation percentile bar (cheap → extreme) */}
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "linear-gradient(90deg, color-mix(in srgb, var(--sr-pos) 45%, transparent), color-mix(in srgb, var(--sr-warn) 40%, transparent), color-mix(in srgb, var(--sr-neg) 48%, transparent))" }}>
        <div style={{ position: "absolute", top: -3, left: `calc(${Math.max(0, Math.min(100, s.percentile))}% - 7px)`, width: 14, height: 14, borderRadius: "50%", background: s.color, border: "2px solid var(--sr-surface)", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: "9px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <span>Cheap</span><span>Fair</span><span>Elevated</span><span>Expensive</span><span>Extreme</span>
      </div>

      {/* Gauges + baseline equity */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-4)", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Buffett Ind.</div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: "var(--sr-text)" }} className="num">{macro.buffett_indicator != null ? macro.buffett_indicator.toFixed(0) + "%" : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>CAPE</div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: "var(--sr-text)" }} className="num">{macro.cape != null ? macro.cape.toFixed(1) : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Fwd 10y ret.</div>
          <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: "var(--sr-text)" }} className="num">{macro.expected_return_10y != null ? macro.expected_return_10y.toFixed(1) + "%" : "—"}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Secular equity baseline</div>
          <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: s.color }} className="num">{s.baselineEquity}%</div>
        </div>
      </div>

      <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.55 }}>
        {s.detail}
      </div>

      {/* ── Secular cycle position (v2) — narrative, not prediction ── */}
      <div style={{ marginTop: "var(--sr-sp-4)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)" }}>
          <span style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Long cycle · secular {cycle.phase.toLowerCase()}</span>
          <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: cycle.stage === "mature" ? "var(--sr-neg)" : cycle.stage === "late" ? "var(--sr-warn)" : "var(--sr-text-2)" }}>{cycle.stage}-stage · ~{cycle.yearsElapsed}y in</span>
        </div>
        {/* timeline bar: elapsed vs typical bull length */}
        <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--sr-surface-3)" }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${cyclePct}%`, borderRadius: 4, background: cycle.stage === "mature" ? "var(--sr-neg)" : cycle.stage === "late" ? "var(--sr-warn)" : "var(--sr-pos)" }} />
          {/* typical-length marker */}
          <div style={{ position: "absolute", left: `${Math.min(100, (cycle.typicalYears / (cycle.typicalYears + 2)) * 100)}%`, top: -2, width: 2, height: 12, background: "var(--sr-text-3)" }} title={`~${cycle.typicalYears}y typical`} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: "9px", color: "var(--sr-text-3)" }}>
          <span>{cycle.startYear} start</span><span>~{cycle.typicalYears}y avg</span>
        </div>
        <div style={{ marginTop: "var(--sr-sp-2)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>{cycle.note}</div>
      </div>
    </div>
  );
}
