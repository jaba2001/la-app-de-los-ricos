"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

const RATE_SERIES = [
  { label: "2Y Treasury",      key: "dgs2",            suffix: "%" },
  { label: "10Y Treasury",     key: "dgs10",           suffix: "%" },
  { label: "30Y Treasury",     key: "dgs30",           suffix: "%" },
  { label: "Term Premium 10Y", key: "term_premium_10y", suffix: "%" },
  { label: "Curve Steepener",  key: "curve_steepener", suffix: "bp" },
  { label: "Net Liquidity",    key: "net_liquidity_t",  suffix: "T" },
];

const MACRO_SERIES = [
  { label: "Core PCE YoY",       key: "core_pce_yoy",       suffix: "%",  threshold: { warn: 2.5, bad: 3.5 } },
  { label: "Unemployment Rate",  key: "unrate",             suffix: "%",  threshold: { warn: 5,   bad: 7   } },
  { label: "Buffett Indicator",  key: "buffett_indicator",  suffix: "%",  threshold: { warn: 150, bad: 180 } },
  { label: "Expected Return 10Y",key: "expected_return_10y", suffix: "%",  threshold: { warn: 3,   bad: 1   } },
];

const SENTIMENT_SERIES = [
  { label: "Fear & Greed Index", key: "fear_greed",       suffix: "",  sub: "fear_greed_rating" },
  { label: "Put/Call Ratio",     key: "put_call_ratio",   suffix: "",  decimals: 2 },
  { label: "WTI Oil",            key: "wti_level",        suffix: "", prefix: "$" },
  { label: "WTI Change 1M",      key: "wti_chg_1m",       suffix: "%", signed: true },
  { label: "Global Liquidity",   key: "global_liquidity_dir", suffix: "", text: true },
  { label: "Net Liquidity Dir",  key: "net_liquidity_dir",suffix: "", text: true },
];

const CATEGORIES = [
  { id: "rates",   label: "Rates & Curve",   series: RATE_SERIES },
  { id: "macro",   label: "Macro & Fed",     series: MACRO_SERIES },
  { id: "sentiment", label: "Sentiment",     series: SENTIMENT_SERIES },
];

type SeriesItem = { label: string; key: string; suffix?: string; prefix?: string; decimals?: number; signed?: boolean; sub?: string; text?: boolean; threshold?: { warn: number; bad: number } };

function SeriesRow({ item, macro, loading }: { item: SeriesItem; macro: MacroState | null; loading: boolean }) {
  const raw = macro ? (macro as unknown as Record<string, unknown>)[item.key] : null;
  const val: number | null = (() => {
    if (item.text || raw == null) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  })();
  const textVal = typeof raw === "string" ? raw : null;

  let display = "—";
  let color = "var(--sr-text)";

  if (item.text && textVal) {
    display = textVal;
    color = textVal === "expansion" ? "var(--sr-pos)" : textVal === "contraction" ? "var(--sr-neg)" : "var(--sr-warn)";
  } else if (val != null) {
    const decimals = item.decimals ?? 2;
    display = `${item.prefix ?? ""}${val.toFixed(decimals)}${item.suffix ?? ""}`;
    if (item.signed && val > 0) display = `+${display}`;
    if (item.threshold) {
      const { warn, bad } = item.threshold;
      color = val > bad ? "var(--sr-neg)" : val > warn ? "var(--sr-warn)" : "var(--sr-pos)";
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

export default function MacroIndicators({ macro, loading }: Props) {
  const [active, setActive] = useState("rates");
  const cat = CATEGORIES.find(c => c.id === active)!;

  return (
    <div className="animate-fade-in">
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-5)" }}>
        {CATEGORIES.map(c => (
          <button key={c.id} className={`subtab ${active === c.id ? "active" : ""}`} onClick={() => setActive(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        <div className="card">
          <div className="section-label">{cat.label}</div>
          {cat.series.map(s => <SeriesRow key={s.key + s.label} item={s as SeriesItem} macro={macro} loading={loading} />)}
        </div>

        {/* FRED health summary */}
        <div className="card">
          <div className="section-label">Data Health</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
            {["Rates", "Credit", "Liquidity", "Macro", "Commodities", "Housing"].map(catName => (
              <div key={catName} style={{
                background: "var(--sr-surface-2)",
                borderRadius: "var(--sr-radius)",
                padding: "var(--sr-sp-3)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{catName}</span>
                <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-pos)" }}>LIVE</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>FRED Series</div>
            <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>43 <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-pos)", fontWeight: 600 }}>active</span></div>
          </div>

          <div className="divider" />

          <div className="section-label">Sahm Rule & Labor</div>
          <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", marginBottom: "var(--sr-sp-3)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Sahm Indicator</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700 }}>
              {loading ? <Sk w={60} h={20} /> : "—"}
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }}>
              Threshold: ≥0.50 = Recession probable
            </div>
          </div>
          <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>Dalio Debt Cycle</div>
            <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>Stage 4/5 — Political Fracture</div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }}>USD Reserve Share: 58% (↓ from 72%)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
