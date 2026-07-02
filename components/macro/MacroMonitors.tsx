"use client";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

interface Props { macro: MacroState | null; loading: boolean; }

function MonitorCard({ title, score, color, status, signals, children }: {
  title: string;
  score?: number | null;
  color: string;
  status: string;
  signals?: string[];
  children?: React.ReactNode;
}) {
  const pct = score ?? 0;
  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-4)" }}>
        <div>
          <div className="section-label">{title}</div>
          {score != null && (
            <span style={{ fontSize: "var(--sr-t-hero)", fontWeight: 700, color, lineHeight: 1 }} className="num">
              {score.toFixed(0)}
            </span>
          )}
        </div>
        <Pill label={status} color={color} />
      </div>
      {score != null && (
        <div className="score-bar-track" style={{ height: 6, marginBottom: "var(--sr-sp-4)" }}>
          <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
      {signals && signals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
          {signals.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
              <span style={{ color, flexShrink: 0 }}>▸</span>
              {s}
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

const DALIO_STAGES = [
  { n: 1, label: "Accumulation",          desc: "Normal debt cycle, productive borrowing" },
  { n: 2, label: "Currency as Tool",       desc: "Monetary policy drives growth" },
  { n: 3, label: "Creditors Diversify",    desc: "Foreign holders reduce exposure" },
  { n: 4, label: "Political Fracture",     desc: "Debt servicing crowding out defense/social" },
  { n: 5, label: "Extraordinary Measures", desc: "Debt monetization, currency debasement" },
];

// ⚠ Update quarterly — source: BIS/Treasury/Fed.gov/CBO
// dalio_stage (which stage is highlighted) comes from macro_state.dalio_stage (updatable via dashboard)
const DALIO_KPIS = [
  { label: "Interest % of Income", val: "18%",    warn: "Critical threshold: 22%" },
  { label: "Interest vs Defense",  val: "1.2×",   warn: "Crossed parity in 2024" },
  { label: "USD Reserve Share",    val: "58%",     warn: "Was 72% in 2001" },
  { label: "China Treasuries Δ",   val: "−$380B",  warn: "Cumulative since 2021" },
];

export default function MacroMonitors({ macro, loading }: Props) {
  if (loading) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        {[0,1,2,3].map(i => <div key={i} className="card" style={{ height: 200 }}><Sk w="100%" h={180} /></div>)}
      </div>
    );
  }

  const meltup = macro?.meltup_score != null ? Number(macro.meltup_score) : null;
  const meltupColor = (meltup ?? 0) >= 70 ? "var(--sr-pos)" : (meltup ?? 0) >= 45 ? "var(--sr-warn)" : "var(--sr-text-2)";
  const meltupStatus = (meltup ?? 0) >= 70 ? "BULLISH" : (meltup ?? 0) >= 45 ? "CAUTION" : "NEUTRAL";

  const bubble = macro?.bubble_debt != null ? Number(macro.bubble_debt) : null;
  const bubbleAI = macro?.bubble_ai != null ? Number(macro.bubble_ai) : null;
  const bubbleAvg = bubble != null && bubbleAI != null ? (bubble + bubbleAI) / 2 : bubble ?? bubbleAI ?? null;
  const bubbleColor = bubbleAvg == null ? "var(--sr-text-3)" : bubbleAvg >= 70 ? "var(--sr-neg)" : bubbleAvg >= 45 ? "var(--sr-warn)" : "var(--sr-pos)";
  const bubbleStatus = bubbleAvg == null ? "—" : bubbleAvg >= 70 ? "HIGH RISK" : bubbleAvg >= 45 ? "ELEVATED" : "CONTAINED";

  const rpc = macro?.recession_prob != null ? Number(macro.recession_prob) : 0;
  const rpcColor = rpc >= 60 ? "var(--sr-neg)" : rpc >= 40 ? "var(--sr-warn)" : "var(--sr-pos)";
  const rpcStatus = rpc >= 60 ? "HIGH" : rpc >= 40 ? "ELEVATED" : "LOW";

  return (
    <div className="animate-fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* Meltup Monitor */}
        <MonitorCard
          title="Meltup Monitor"
          score={meltup}
          color={meltupColor}
          status={meltupStatus}
          signals={[
            macro?.buffett_indicator != null ? `Buffett Indicator: ${Number(macro.buffett_indicator).toFixed(0)}%${Number(macro.buffett_indicator) > 170 ? " ⚠" : ""}` : "Buffett Indicator: —",
            macro?.put_call_ratio != null ? `Put/Call: ${Number(macro.put_call_ratio).toFixed(2)}${Number(macro.put_call_ratio) < 0.7 ? " (bullish skew)" : Number(macro.put_call_ratio) > 1.2 ? " (bearish skew)" : ""}` : "Put/Call: —",
            macro?.fear_greed != null ? `Fear & Greed: ${Number(macro.fear_greed).toFixed(0)}${macro.fear_greed_rating ? ` (${macro.fear_greed_rating})` : ""}` : "Fear & Greed: —",
          ]}
        />

        {/* Bubble Risk Monitor */}
        <MonitorCard
          title="Bubble Risk Monitor"
          score={bubbleAvg}
          color={bubbleColor}
          status={bubbleStatus}
          signals={[
            "Debt Bubble score: " + (bubble?.toFixed(0) ?? "—"),
            "AI Valuation bubble: " + (bubbleAI?.toFixed(0) ?? "—"),
            macro?.vix != null ? `VIX: ${Number(macro.vix).toFixed(1)} ${Number(macro.vix) > 35 ? "⚠ TRIGGER" : ""}` : "VIX: —",
          ]}
        />

        {/* Recession Monitor */}
        <MonitorCard
          title="Recession Monitor"
          score={rpc}
          color={rpcColor}
          status={rpcStatus}
          signals={[
            `Core PCE YoY: ${macro?.core_pce_yoy != null ? Number(macro.core_pce_yoy).toFixed(1) : "—"}% (target: 2%)`,
            `Unemployment: ${macro?.unrate != null ? Number(macro.unrate).toFixed(1) : "—"}%`,
            `Fed Room: ${macro?.fed_room ?? "—"}`,
            `Curve Steepener: ${macro?.curve_steepener ?? "—"}`,
          ]}
        />

        {/* Feature 9: Stock/Bond Correlation Badge */}
        <div className="card">
          <div className="section-label">Stock / Bond Correlation Regime</div>
          {(() => {
            const pce = macro?.core_pce_yoy != null ? Number(macro.core_pce_yoy) : null;
            const cpi = macro?.core_cpi_yoy != null ? Number(macro.core_cpi_yoy) : null;
            const infl = pce ?? cpi;
            const dgs10 = macro?.dgs10 != null ? Number(macro.dgs10) : null;
            if (infl == null) return <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>Inflation data unavailable</div>;

            const inflColor = infl >= 3.5 ? "var(--sr-neg)" : infl >= 2.5 ? "var(--sr-warn)" : "var(--sr-pos)";
            const corrLabel = infl >= 3.5 ? "Positive (High Inflation)" : infl >= 2.5 ? "Borderline" : "Negative (Low Inflation)";
            const corrIcon  = infl >= 3.5 ? "⚠" : infl >= 2.5 ? "◆" : "✓";
            const corrDesc  = infl >= 3.5
              ? "With PCE above 3.5%, stocks and bonds historically fall together — 60/40 diversification benefit collapses"
              : infl >= 2.5
              ? "Borderline — correlation can swing positive; monitor inflation trajectory"
              : "Sub-2.5% inflation historically supports negative stock/bond correlation — 60/40 logic holds";
            const implication = infl >= 3.5
              ? "Consider satellite hedges: gold (GLD), short-term bills (SHV), commodities"
              : infl >= 2.5
              ? "Diversification benefit uncertain — reduce duration in bond allocation"
              : "Bond allocation provides meaningful portfolio diversification at current inflation levels";

            return (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
                  {[
                    { label: "Core PCE / CPI", val: `${infl.toFixed(1)}%`, color: inflColor, sub: "Inflation driver" },
                    { label: "Correlation Mode", val: `${corrIcon} ${corrLabel}`, color: inflColor, sub: "Stocks vs Bonds" },
                    { label: "10Y Rate", val: dgs10 != null ? `${dgs10.toFixed(2)}%` : "—", color: dgs10 != null && dgs10 > 4.5 ? "var(--sr-warn)" : "var(--sr-text-2)", sub: "Higher = more pressure" },
                  ].map(({ label, val, color, sub }) => (
                    <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                      <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color }} className="num">{val}</div>
                      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${inflColor} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${inflColor} 25%, transparent)` }}>
                  <div style={{ fontSize: "var(--sr-t-sm)", color: inflColor, fontWeight: 600, marginBottom: 4 }}>{corrDesc}</div>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{implication}</div>
                </div>
              </div>
            );
          })()}
        </div>

      {/* Commodity Supercycle */}
        <div className="card">
          <div className="section-label">Commodity Supercycle</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
            {[
              { label: "WTI Oil",   val: macro?.wti_level != null ? `$${Number(macro.wti_level).toFixed(1)}` : "—" },
              { label: "1M Change", val: macro?.wti_chg_1m != null ? `${Number(macro.wti_chg_1m) >= 0 ? "+" : ""}${Number(macro.wti_chg_1m).toFixed(1)}%` : "—",
                color: Number(macro?.wti_chg_1m ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" },
              { label: "Oil Shock", val: macro?.oil_shock ? String(macro.oil_shock) : "—" },
              { label: "Real Rate", val: macro?.dgs10 != null && macro?.core_pce_yoy != null
                ? `${(Number(macro.dgs10) - Number(macro.core_pce_yoy)).toFixed(2)}%` : "—" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: color ?? "var(--sr-text)" }} className="num">{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Dalio Debt Cycle */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sr-sp-3)" }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Dalio Long-Term Debt Cycle</div>
          {macro?.dalio_stage != null && (
            <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
              Stage {macro.dalio_stage} — updated from macro_state
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sr-sp-3)" }}>
          {DALIO_STAGES.map(stage => {
            const isCurrent = stage.n === (macro?.dalio_stage ?? 4);
            return (
              <div key={stage.n} style={{
                padding: "var(--sr-sp-3)",
                borderRadius: "var(--sr-radius)",
                background: isCurrent ? "color-mix(in srgb, var(--sr-warn) 12%, var(--sr-surface-2))" : "var(--sr-surface-2)",
                border: isCurrent ? "1px solid color-mix(in srgb, var(--sr-warn) 40%, transparent)" : "1px solid transparent",
              }}>
                <div style={{
                  fontSize: "var(--sr-t-xs)", fontWeight: 700, color: isCurrent ? "var(--sr-warn)" : "var(--sr-text-3)",
                  marginBottom: 4,
                }}>
                  Stage {stage.n}{isCurrent ? " ← CURRENT" : ""}
                </div>
                <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: isCurrent ? "var(--sr-text)" : "var(--sr-text-2)", marginBottom: 4 }}>
                  {stage.label}
                </div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{stage.desc}</div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "var(--sr-sp-4)", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)" }}>
          {DALIO_KPIS.map(({ label, val, warn }) => (
            <div key={label} style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }} className="num">{val}</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-warn)", marginTop: 2 }}>⚠ {warn}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
