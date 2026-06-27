"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

type SeriesEntry = {
  label: string; key: string; suffix?: string; prefix?: string; decimals?: number;
  signed?: boolean; text?: boolean; higherIsBad?: boolean;
  threshold?: { warn: number; bad: number }; derived?: (m: MacroState) => number | null;
};

// ─── 43-series definitions across 8 categories ──────────────────────────────

const RATES: SeriesEntry[] = [
  { label: "Fed Funds Rate",       key: "fedfunds",       suffix: "%", threshold: { warn: 3, bad: 5 }, higherIsBad: false },
  { label: "1Y Treasury",          key: "dgs1",           suffix: "%" },
  { label: "2Y Treasury",          key: "dgs2",           suffix: "%" },
  { label: "5Y Treasury",          key: "dgs5",           suffix: "%" },
  { label: "10Y Treasury",         key: "dgs10",          suffix: "%" },
  { label: "30Y Treasury",         key: "dgs30",          suffix: "%" },
  { label: "Curve 10Y−2Y",        key: "curve_steepener", suffix: "bp", signed: true, threshold: { warn: 0, bad: -25 } },
  { label: "Curve 10Y−3M",        key: "t10y3m",         suffix: "bp", signed: true, threshold: { warn: 0, bad: -25 } },
  { label: "Real Yield 10Y",       key: "real_yield_10y", suffix: "%",
    derived: m => m.dgs10 != null && m.core_pce_yoy != null ? Number(m.dgs10) - Number(m.core_pce_yoy) : null },
  { label: "Breakeven Inflation",  key: "breakeven_10y",  suffix: "%" },
  { label: "Term Premium 10Y",     key: "term_premium_10y", suffix: "%" },
];

const CREDIT: SeriesEntry[] = [
  { label: "HY OAS (All)",         key: "hy_oas",          suffix: "bp", threshold: { warn: 400, bad: 600 }, higherIsBad: true },
  { label: "HY OAS Momentum",      key: "hy_oas_momentum", suffix: "bp/m", signed: true, higherIsBad: true },
  { label: "TED Spread",           key: "ted_spread",      suffix: "bp", threshold: { warn: 30, bad: 60 }, higherIsBad: true },
  { label: "Credit Stress (CSC)",  key: "credit_stress",   suffix: "",   threshold: { warn: 50, bad: 70 }, higherIsBad: true },
];

const LIQUIDITY: SeriesEntry[] = [
  { label: "Fed Balance Sheet ($T)", key: "walcl",          suffix: "T", prefix: "$" },
  { label: "Reverse Repo ($B)",      key: "rrpontsyd",      suffix: "B", prefix: "$" },
  { label: "M2 YoY Growth",          key: "m2_growth",      suffix: "%" },
  { label: "Net Liquidity ($T)",      key: "net_liquidity_t",suffix: "T", prefix: "$" },
  { label: "Net Liquidity Direction", key: "net_liquidity_dir", text: true },
  { label: "Global Liquidity",        key: "global_liquidity_dir", text: true },
  { label: "Liquidity Cycle (LCC)",   key: "liquidity_cycle", suffix: "", threshold: { warn: 40, bad: 25 }, higherIsBad: false },
];

const LABOR: SeriesEntry[] = [
  { label: "Unemployment Rate",    key: "unrate",  suffix: "%",  threshold: { warn: 5, bad: 7   }, higherIsBad: true },
  { label: "Nonfarm Payrolls Δ",  key: "payems",  suffix: "K",  signed: true },
  { label: "Initial Jobless Claims",key:"icsa",    suffix: "K",  threshold: { warn: 250, bad: 300 }, higherIsBad: true },
  { label: "Recession Prob (RPC)", key: "recession_prob", suffix: "", threshold: { warn: 40, bad: 60 }, higherIsBad: true },
];

const INFLATION: SeriesEntry[] = [
  { label: "Core PCE YoY",        key: "core_pce_yoy",   suffix: "%", threshold: { warn: 2.5, bad: 3.5 }, higherIsBad: true },
  { label: "Core CPI YoY",        key: "core_cpi_yoy",   suffix: "%", threshold: { warn: 2.5, bad: 3.5 }, higherIsBad: true },
  { label: "Buffett Indicator",    key: "buffett_indicator", suffix: "%", threshold: { warn: 150, bad: 180 }, higherIsBad: true },
  { label: "Expected Return 10Y",  key: "expected_return_10y", suffix: "%" },
];

const HOUSING: SeriesEntry[] = [
  { label: "Housing Stress (HSC)", key: "housing_stress",   suffix: "", threshold: { warn: 45, bad: 65 }, higherIsBad: true },
  { label: "Housing Starts (K)",   key: "house_starts",     suffix: "K" },
  { label: "Existing Home Sales",  key: "home_sales",       suffix: "K" },
  { label: "Building Permits (K)", key: "building_permits", suffix: "K" },
  { label: "Median Price Δ YoY",   key: "median_home_price_chg", suffix: "%", signed: true },
];

const COMMODITIES: SeriesEntry[] = [
  { label: "WTI Crude Oil",       key: "wti_level",  suffix: "", prefix: "$", threshold: { warn: 85, bad: 100 }, higherIsBad: true },
  { label: "WTI Change 1M",       key: "wti_chg_1m", suffix: "%", signed: true },
  { label: "Brent Crude",         key: "brent",      suffix: "", prefix: "$" },
  { label: "Gold (FRED $oz)",     key: "gold_price", suffix: "", prefix: "$" },
  { label: "Oil Volatility (OVX)",key: "ovx",        suffix: "", threshold: { warn: 35, bad: 55 }, higherIsBad: true },
  { label: "Oil Shock",           key: "oil_shock",  text: true },
];

const CONDITIONS: SeriesEntry[] = [
  { label: "VIX",              key: "vix",         suffix: "", threshold: { warn: 20, bad: 35 }, higherIsBad: true },
  { label: "MOVE Index",       key: "move_index",  suffix: "", threshold: { warn: 100, bad: 140 }, higherIsBad: true },
  { label: "SKEW Index",       key: "skew_index",  suffix: "", threshold: { warn: 130, bad: 145 }, higherIsBad: true },
  { label: "Fin. Stress (STLFSI4)", key: "stlfsi4", suffix: "", threshold: { warn: 0.5, bad: 1.5 }, higherIsBad: true },
  { label: "Geopolitical (GRC)",key: "geopolitical_risk", suffix: "", threshold: { warn: 45, bad: 65 }, higherIsBad: true },
  { label: "Melt-up Score",    key: "meltup_score", suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Bubble — Debt",    key: "bubble_debt",  suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Bubble — AI/Tech", key: "bubble_ai",    suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
];

const ALL_CATS = [
  { id: "rates",      label: "Rates",       series: RATES      },
  { id: "credit",     label: "Credit",      series: CREDIT     },
  { id: "liquidity",  label: "Liquidity",   series: LIQUIDITY  },
  { id: "labor",      label: "Labor",       series: LABOR      },
  { id: "inflation",  label: "Inflation",   series: INFLATION  },
  { id: "housing",    label: "Housing",     series: HOUSING    },
  { id: "commodities",label: "Commodities", series: COMMODITIES},
  { id: "conditions", label: "Conditions",  series: CONDITIONS },
];

const SAHM_BANDS = [
  { range: "≥ 0.80",    label: "RECESSION CONFIRMED", color: "var(--sr-neg)" },
  { range: "0.50–0.79", label: "Probable recession",  color: "#FB923C" },
  { range: "0.25–0.49", label: "Elevated risk",        color: "var(--sr-warn)" },
  { range: "0.10–0.24", label: "Monitor",              color: "var(--sr-text-3)" },
  { range: "< 0.10",    label: "Benign",               color: "var(--sr-pos)" },
];

function getValue(item: SeriesEntry, macro: MacroState | null): number | string | null {
  if (!macro) return null;
  if (item.derived) return item.derived(macro);
  const raw = (macro as unknown as Record<string, unknown>)[item.key];
  if (raw == null) return null;
  if (item.text) return typeof raw === "string" ? raw : String(raw);
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

function SeriesRow({ item, macro, loading }: { item: SeriesEntry; macro: MacroState | null; loading: boolean }) {
  const rawVal = getValue(item, macro);
  const val: number | null = typeof rawVal === "number" ? rawVal : null;
  const textVal: string | null = typeof rawVal === "string" ? rawVal : null;
  const missing = rawVal == null;

  let display = "—";
  let color   = "var(--sr-text)";

  if (textVal) {
    display = textVal;
    const lc = textVal.toLowerCase();
    color = lc.includes("expand") || lc.includes("up") || lc.includes("bull") || lc.includes("low") ? "var(--sr-pos)"
          : lc.includes("contract") || lc.includes("down") || lc.includes("bear") || lc.includes("high") || lc.includes("shock") ? "var(--sr-neg)"
          : "var(--sr-warn)";
  } else if (val != null) {
    const dec = item.decimals ?? (Math.abs(val) >= 1000 ? 0 : Math.abs(val) >= 100 ? 1 : 2);
    display = `${item.prefix ?? ""}${val.toFixed(dec)}${item.suffix ?? ""}`;
    if (item.signed && val > 0) display = `+${display}`;
    if (item.threshold) {
      const { warn, bad } = item.threshold;
      color = item.higherIsBad
        ? (val > bad ? "var(--sr-neg)" : val > warn ? "var(--sr-warn)" : "var(--sr-pos)")
        : (val < bad ? "var(--sr-neg)" : val < warn ? "var(--sr-warn)" : "var(--sr-pos)");
    }
    if (item.signed) color = val >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";
  }

  return (
    <div className="stat-row" style={{ opacity: missing ? 0.45 : 1 }}>
      <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{item.label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {loading ? <Sk w={50} h={14} /> : (
          <>
            <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: missing ? 400 : 600, color: missing ? "var(--sr-text-3)" : color }} className="num">
              {display}
            </span>
            {missing && (
              <span style={{ fontSize: "9px", color: "var(--sr-text-3)", background: "var(--sr-surface-3)", padding: "1px 4px", borderRadius: 3 }}>
                pending
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function MacroIndicators({ macro, loading }: Props) {
  const [active, setActive] = useState("rates");
  const cat = ALL_CATS.find(c => c.id === active)!;

  const liveCount = (series: SeriesEntry[]) => series.filter(s => getValue(s, macro) != null).length;

  return (
    <div className="animate-fade-in">
      {/* 8 category tabs */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-5)", flexWrap: "wrap" }}>
        {ALL_CATS.map(c => {
          const live = liveCount(c.series);
          const total = c.series.length;
          return (
            <button key={c.id} className={`subtab ${active === c.id ? "active" : ""}`} onClick={() => setActive(c.id)}>
              {c.label}
              <span style={{
                marginLeft: 6, fontSize: "9px", padding: "1px 5px", borderRadius: "var(--sr-radius-pill)", fontWeight: 700,
                background: live > 0 ? "color-mix(in srgb, var(--sr-pos) 18%, transparent)" : "var(--sr-surface-3)",
                color: live > 0 ? "var(--sr-pos)" : "var(--sr-text-3)",
              }}>{live}/{total}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        {/* Left: series list */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--sr-sp-3)" }}>
            <div className="section-label">{cat.label}</div>
            <span style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{liveCount(cat.series)}/{cat.series.length} live</span>
          </div>
          {cat.series.map(s => (
            <SeriesRow key={s.key} item={s} macro={macro} loading={loading} />
          ))}
          <div style={{ marginTop: "var(--sr-sp-4)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.6, borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
            "pending" = field not yet written by ic-proxy/lib/macro.js to macro_state. Add FRED series ID to the macro pipeline to activate.
          </div>
        </div>

        {/* Right: Data health + Sahm + Dalio */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
          {/* Coverage per category */}
          <div className="card">
            <div className="section-label">FRED Coverage — All 8 Categories</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ALL_CATS.map(c => {
                const live = liveCount(c.series), total = c.series.length;
                const pct = total > 0 ? live / total : 0;
                return (
                  <div key={c.id} style={{ cursor: "pointer" }} onClick={() => setActive(c.id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: "var(--sr-t-xs)", color: active === c.id ? "var(--sr-amber)" : "var(--sr-text-2)" }}>{c.label}</span>
                      <span style={{ fontSize: "10px", color: pct === 1 ? "var(--sr-pos)" : pct > 0.5 ? "var(--sr-warn)" : "var(--sr-text-3)" }} className="num">
                        {live}/{total}
                      </span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "var(--sr-surface-3)" }}>
                      <div style={{ height: "100%", width: `${pct * 100}%`, borderRadius: 2, background: pct === 1 ? "var(--sr-pos)" : pct > 0.5 ? "var(--sr-warn)" : "var(--sr-text-3)", transition: "width 400ms" }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>Total FRED series</span>
              <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }} className="num">
                {ALL_CATS.reduce((s, c) => s + liveCount(c.series), 0)}
                <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}> / {ALL_CATS.reduce((s, c) => s + c.series.length, 0)}</span>
              </span>
            </div>
          </div>

          {/* Sahm Rule bands */}
          <div className="card">
            <div className="section-label">Sahm Rule — Recession Trigger</div>
            <div style={{ marginBottom: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>SAHMREALTIME</div>
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }}>
                {loading ? <Sk w={60} h={20} /> : "—"}
              </div>
              <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 4 }}>
                Pending: add FRED SAHMREALTIME to macro pipeline
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {SAHM_BANDS.map(b => (
                <div key={b.range} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", borderRadius: 4, background: "var(--sr-surface-2)" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: b.color }} className="num">{b.range}</span>
                  <span style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dalio Debt Cycle */}
          <div className="card">
            <div className="section-label">Dalio Debt Cycle</div>
            <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
              <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, marginBottom: 4 }}>Stage 4/5 — Political Fracture</div>
              {[
                ["USD Reserve Share", "58% (↓ from 72%)"],
                ["Debt / GDP",        "~130%"],
                ["Fed Balance Sheet", macro?.walcl != null ? `$${Number(macro.walcl).toFixed(1)}T` : "Pending"],
                ["Policy Stance",     macro?.fed_room ?? "Pending"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--sr-text-3)", marginTop: 4 }}>
                  <span>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
