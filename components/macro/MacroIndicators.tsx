"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

const RATE_SERIES = [
  { label: "2Y Treasury",       key: "dgs2",             suffix: "%" },
  { label: "10Y Treasury",      key: "dgs10",            suffix: "%" },
  { label: "30Y Treasury",      key: "dgs30",            suffix: "%" },
  { label: "Term Premium 10Y",  key: "term_premium_10y", suffix: "%" },
  { label: "Curve (10Y-2Y)",    key: "curve_steepener",  suffix: "bp" },
  { label: "Net Liquidity ($T)",key: "net_liquidity_t",  suffix: "T" },
];

const MACRO_SERIES = [
  { label: "Core PCE YoY",        key: "core_pce_yoy",       suffix: "%",  threshold: { warn: 2.5, bad: 3.5 }, higherIsBad: true },
  { label: "Unemployment Rate",   key: "unrate",             suffix: "%",  threshold: { warn: 5,   bad: 7   }, higherIsBad: true },
  { label: "Buffett Indicator",   key: "buffett_indicator",  suffix: "%",  threshold: { warn: 150, bad: 180 }, higherIsBad: true },
  { label: "Expected Return 10Y", key: "expected_return_10y", suffix: "%" },
  { label: "Fed Room (bps)",      key: "fed_room",           suffix: "bp" },
  { label: "Melt-up Score",       key: "meltup_score",       suffix: "",   threshold: { warn: 60, bad: 80 }, higherIsBad: true },
];

const SENTIMENT_SERIES = [
  { label: "Fear & Greed Index",  key: "fear_greed",          suffix: "",   sub: "fear_greed_rating" },
  { label: "Put/Call Ratio",      key: "put_call_ratio",      suffix: "",   decimals: 2 },
  { label: "Sentiment Signal",    key: "sentiment_signal",    suffix: "",   text: true },
  { label: "WTI Oil",             key: "wti_level",           suffix: "",   prefix: "$" },
  { label: "WTI Change 1M",       key: "wti_chg_1m",          suffix: "%",  signed: true },
  { label: "Global Liquidity",    key: "global_liquidity_dir",suffix: "",   text: true },
];

const STRESS_SERIES = [
  { label: "VIX",            key: "vix",         suffix: "",  threshold: { warn: 20, bad: 35 },  higherIsBad: true },
  { label: "MOVE Index",     key: "move_index",  suffix: "",  threshold: { warn: 100, bad: 140 }, higherIsBad: true },
  { label: "Credit Stress",  key: "credit_stress",  suffix: "", threshold: { warn: 50, bad: 70 }, higherIsBad: true },
  { label: "Bubble — Debt",  key: "bubble_debt", suffix: "",  threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Bubble — AI/Tech",key:"bubble_ai",   suffix: "",  threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Geopolitical Risk",key:"geopolitical_risk",suffix:"",threshold:{ warn:50, bad:70 }, higherIsBad:true },
];

const CATEGORIES = [
  { id: "rates",    label: "Rates & Curve",   series: RATE_SERIES },
  { id: "macro",    label: "Macro & Fed",     series: MACRO_SERIES },
  { id: "stress",   label: "Stress & Vol",    series: STRESS_SERIES },
  { id: "sentiment",label: "Sentiment",       series: SENTIMENT_SERIES },
];

type SeriesItem = {
  label: string; key: string; suffix?: string; prefix?: string; decimals?: number;
  signed?: boolean; sub?: string; text?: boolean; higherIsBad?: boolean;
  threshold?: { warn: number; bad: number };
};

function SeriesRow({ item, macro, loading }: { item: SeriesItem; macro: MacroState | null; loading: boolean }) {
  const raw     = macro ? (macro as unknown as Record<string, unknown>)[item.key] : null;
  const val: number | null = (() => {
    if (item.text || raw == null) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  })();
  const textVal = typeof raw === "string" ? raw : null;

  let display = "—";
  let color   = "var(--sr-text)";

  if (item.text && textVal) {
    display = textVal;
    color = textVal === "expansion" || textVal.includes("up") || textVal === "bullish"
      ? "var(--sr-pos)"
      : textVal === "contraction" || textVal.includes("down") || textVal === "bearish"
        ? "var(--sr-neg)"
        : "var(--sr-warn)";
  } else if (val != null) {
    const decimals = item.decimals ?? (Math.abs(val) < 10 ? 2 : 1);
    display = `${item.prefix ?? ""}${val.toFixed(decimals)}${item.suffix ?? ""}`;
    if (item.signed && val > 0) display = `+${display}`;
    if (item.threshold) {
      const { warn, bad } = item.threshold;
      if (item.higherIsBad) {
        color = val > bad ? "var(--sr-neg)" : val > warn ? "var(--sr-warn)" : "var(--sr-pos)";
      } else {
        color = val < bad ? "var(--sr-neg)" : val < warn ? "var(--sr-warn)" : "var(--sr-pos)";
      }
    }
    if (item.signed) color = val >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";
  }

  const subKey = item.sub ? (macro as unknown as Record<string, unknown> | null)?.[item.sub] as string | null : null;

  return (
    <div className="stat-row">
      <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{item.label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {subKey && <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{subKey}</span>}
        {loading ? <Sk w={50} h={14} /> : (
          <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color }} className="num">{display}</span>
        )}
      </div>
    </div>
  );
}

const SAHM_BANDS = [
  { range: "≥ 0.80",   label: "RECESSION CONFIRMED", color: "var(--sr-neg)" },
  { range: "0.50–0.79",label: "Probable recession",  color: "#FB923C" },
  { range: "0.25–0.49",label: "Elevated risk",        color: "var(--sr-warn)" },
  { range: "0.10–0.24",label: "Monitor",              color: "var(--sr-text-3)" },
  { range: "< 0.10",   label: "Benign",               color: "var(--sr-pos)" },
];

export default function MacroIndicators({ macro, loading }: Props) {
  const [active, setActive] = useState("rates");
  const cat = CATEGORIES.find(c => c.id === active)!;

  // Count how many optional stress fields are populated
  const stressCount = ["vix", "move_index", "bubble_debt", "bubble_ai"].filter(k =>
    macro ? (macro as unknown as Record<string, unknown>)[k] != null : false
  ).length;

  return (
    <div className="animate-fade-in">
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-5)", flexWrap: "wrap" }}>
        {CATEGORIES.map(c => (
          <button key={c.id} className={`subtab ${active === c.id ? "active" : ""}`} onClick={() => setActive(c.id)}>
            {c.label}
            {c.id === "stress" && stressCount > 0 && (
              <span style={{
                marginLeft: 6, fontSize: "9px", background: "color-mix(in srgb, var(--sr-warn) 20%, transparent)",
                color: "var(--sr-warn)", padding: "1px 5px", borderRadius: "var(--sr-radius-pill)", fontWeight: 700,
              }}>{stressCount}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        {/* Left: indicator series */}
        <div className="card">
          <div className="section-label">{cat.label}</div>
          {cat.series.map(s => (
            <SeriesRow key={s.key + s.label} item={s as SeriesItem} macro={macro} loading={loading} />
          ))}

          {active === "stress" && (
            <div style={{ marginTop: "var(--sr-sp-4)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
              <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: 6 }}>STRESS NOTE</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.6 }}>
                VIX & MOVE Index are written by macro.js to macro_state when available. Bubble scores (Debt/AI) are composite indicators computed by IC DataLayer engine. Values shown as "—" indicate the field has not been populated yet.
              </div>
            </div>
          )}
        </div>

        {/* Right: data health + Sahm Rule */}
        <div className="card">
          <div className="section-label">Data Health — FRED Series</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
            {[
              { name: "Rates",       keys: ["dgs2", "dgs10", "dgs30"] },
              { name: "Liquidity",   keys: ["net_liquidity_t", "liquidity_cycle"] },
              { name: "Credit",      keys: ["credit_stress", "vix"] },
              { name: "Labor",       keys: ["unrate", "recession_prob"] },
              { name: "Housing",     keys: ["housing_stress"] },
              { name: "Sentiment",   keys: ["fear_greed", "put_call_ratio"] },
            ].map(({ name, keys }) => {
              const live = keys.some(k => macro != null && (macro as unknown as Record<string, unknown>)[k] != null);
              return (
                <div key={name} style={{
                  background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-2) var(--sr-sp-3)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{name}</span>
                  {loading ? <Sk w={28} h={12} /> : (
                    <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: live ? "var(--sr-pos)" : "var(--sr-text-3)" }}>
                      {live ? "LIVE" : "—"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", marginBottom: "var(--sr-sp-4)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Active FRED Series</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>43 <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-pos)", fontWeight: 600 }}>active</span></div>
          </div>

          <div className="divider" />

          <div className="section-label">Sahm Rule — Recession Trigger</div>
          <div style={{ marginBottom: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Sahm Rule Indicator</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-text)" }}>
              {loading ? <Sk w={60} h={20} /> : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }}>
              Not yet in macro_state — pending FRED SAHM series
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {SAHM_BANDS.map(b => (
              <div key={b.range} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", borderRadius: 4, background: "var(--sr-surface-2)" }}>
                <span style={{ fontSize: "10px", fontWeight: 600, color: b.color }} className="num">{b.range}</span>
                <span style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{b.label}</span>
              </div>
            ))}
          </div>

          <div className="divider" />

          <div className="section-label">Dalio Debt Cycle</div>
          <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
            <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>Stage 4/5 — Political Fracture</div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4, lineHeight: 1.5 }}>
              USD Reserve Share: 58% (↓ from 72%) · Debt / GDP: ~130% · Rate normalization underway
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
