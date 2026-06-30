"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

type BadgeFn = (val: number) => { text: string; color: string } | null;
type SeriesEntry = {
  label: string; key: string; suffix?: string; prefix?: string; decimals?: number;
  signed?: boolean; text?: boolean; higherIsBad?: boolean;
  threshold?: { warn: number; bad: number }; derived?: (m: MacroState) => number | null;
  badge?: BadgeFn;
};

// ─── Series definitions across 8 categories ─────────────────────────────────

const RATES: SeriesEntry[] = [
  { label: "Fed Funds Rate",        key: "fedfunds",         suffix: "%", threshold: { warn: 3, bad: 5 }, higherIsBad: false },
  { label: "SOFR",                  key: "sofr",             suffix: "%" },
  { label: "1Y Treasury",           key: "dgs1",             suffix: "%" },
  { label: "2Y Treasury",           key: "dgs2",             suffix: "%" },
  { label: "5Y Treasury",           key: "dgs5",             suffix: "%" },
  { label: "10Y Treasury",          key: "dgs10",            suffix: "%" },
  { label: "30Y Treasury",          key: "dgs30",            suffix: "%" },
  { label: "Curve 10Y−2Y",         key: "t10y2y",           suffix: "%", signed: true, threshold: { warn: 0, bad: -0.25 },
    badge: v => v > 1 ? { text: "STEEP", color: "var(--sr-pos)" } : v > 0 ? { text: "FLAT", color: "var(--sr-warn)" } : v > -0.25 ? { text: "INVERTED", color: "#FB923C" } : { text: "DEEP INV", color: "var(--sr-neg)" } },
  { label: "Curve 10Y−3M",         key: "t10y3m",           suffix: "%", signed: true, threshold: { warn: 0, bad: -0.25 },
    badge: v => v > 1 ? { text: "NORMAL", color: "var(--sr-pos)" } : v > 0 ? { text: "FLAT", color: "var(--sr-warn)" } : v > -0.5 ? { text: "INVERTED", color: "#FB923C" } : { text: "DEEP INV", color: "var(--sr-neg)" } },
  { label: "Steepener Direction",   key: "curve_steepener",  text: true },
  { label: "Real Yield 10Y",        key: "real_yield_10y",   suffix: "%",
    derived: m => m.dgs10 != null && m.core_pce_yoy != null ? Number(m.dgs10) - Number(m.core_pce_yoy) : null,
    badge: v => v > 2 ? { text: "VERY HIGH", color: "var(--sr-neg)" } : v > 1 ? { text: "HIGH", color: "var(--sr-warn)" } : v > 0 ? { text: "POSITIVE", color: "var(--sr-pos)" } : { text: "NEGATIVE", color: "var(--sr-text-3)" } },
  { label: "Breakeven Inflation",   key: "breakeven_10y",    suffix: "%" },
  { label: "Term Premium 10Y",      key: "term_premium_10y", suffix: "%" },
];

const CREDIT: SeriesEntry[] = [
  { label: "HY OAS (All)",          key: "hy_oas",           suffix: "bp", threshold: { warn: 400, bad: 600 }, higherIsBad: true,
    badge: v => v < 250 ? { text: "LOW", color: "var(--sr-pos)" } : v < 350 ? { text: "ELEVATED", color: "var(--sr-warn)" } : v < 500 ? { text: "HIGH", color: "#FB923C" } : { text: "CRISIS", color: "var(--sr-neg)" } },
  { label: "HY OAS BB-rated",       key: "hy_bb_oas",        suffix: "bp", threshold: { warn: 300, bad: 450 }, higherIsBad: true,
    badge: v => v < 200 ? { text: "LOW", color: "var(--sr-pos)" } : v < 300 ? { text: "WATCH", color: "var(--sr-warn)" } : v < 450 ? { text: "ELEVATED", color: "#FB923C" } : { text: "CRISIS", color: "var(--sr-neg)" } },
  { label: "HY OAS CCC-rated",      key: "hy_ccc_oas",       suffix: "bp", threshold: { warn: 800, bad: 1200 }, higherIsBad: true,
    badge: v => v < 600 ? { text: "LOW", color: "var(--sr-pos)" } : v < 800 ? { text: "WATCH", color: "var(--sr-warn)" } : v < 1200 ? { text: "DISTRESS", color: "#FB923C" } : { text: "CRISIS", color: "var(--sr-neg)" } },
  { label: "BBB OAS",               key: "bbb_oas",          suffix: "bp", threshold: { warn: 150, bad: 200 }, higherIsBad: true,
    badge: v => v < 100 ? { text: "TIGHT", color: "var(--sr-pos)" } : v < 150 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 200 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "WIDE", color: "var(--sr-neg)" } },
  { label: "HY OAS Momentum",       key: "hy_oas_momentum",  suffix: "bp/m", signed: true, higherIsBad: true },
  { label: "TED Spread",            key: "ted_spread",       suffix: "bp", threshold: { warn: 30, bad: 60 }, higherIsBad: true },
  { label: "C&I Loan Tightening",   key: "c_and_i_loans",    suffix: "%", threshold: { warn: 20, bad: 40 }, higherIsBad: true,
    badge: v => v < 0 ? { text: "EASING", color: "var(--sr-pos)" } : v < 20 ? { text: "NEUTRAL", color: "var(--sr-text-3)" } : v < 40 ? { text: "TIGHTENING", color: "var(--sr-warn)" } : { text: "TIGHT", color: "var(--sr-neg)" } },
  { label: "Credit Card Delinq.",   key: "credit_card_delinq", suffix: "%", threshold: { warn: 3.5, bad: 5 }, higherIsBad: true,
    badge: v => v < 2.5 ? { text: "LOW", color: "var(--sr-pos)" } : v < 3.5 ? { text: "NORMAL", color: "var(--sr-text-3)" } : v < 5 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "HIGH", color: "var(--sr-neg)" } },
  { label: "Credit Stress (CSC)",   key: "credit_stress",    suffix: "", threshold: { warn: 50, bad: 70 }, higherIsBad: true },
];

const LIQUIDITY: SeriesEntry[] = [
  { label: "Fed Balance Sheet ($T)", key: "walcl", suffix: "T", prefix: "$",
    derived: m => m.walcl != null ? Number(m.walcl) / 1e6 : null },
  { label: "Reverse Repo ($B)",      key: "rrpontsyd",        suffix: "B", prefix: "$" },
  { label: "Bank Reserves ($T)",     key: "wresbal",          suffix: "T", prefix: "$",
    derived: m => m.wresbal != null ? Number(m.wresbal) / 1000 : null,
    badge: v => v < 2 ? { text: "LOW", color: "var(--sr-neg)" } : v < 3 ? { text: "WATCH", color: "var(--sr-warn)" } : v < 4 ? { text: "NORMAL", color: "var(--sr-text-3)" } : { text: "AMPLE", color: "var(--sr-pos)" } },
  { label: "M2 YoY Growth",          key: "m2_growth",        suffix: "%",
    badge: v => v < -2 ? { text: "CONTRACTING", color: "var(--sr-neg)" } : v < 2 ? { text: "LOW", color: "var(--sr-warn)" } : v < 6 ? { text: "NORMAL", color: "var(--sr-pos)" } : { text: "EXPANDING", color: "var(--sr-warn)" } },
  { label: "Net Liquidity ($T)",      key: "net_liquidity_t",  suffix: "T", prefix: "$",
    badge: v => v < 3 ? { text: "CRITICAL", color: "var(--sr-neg)" } : v < 4 ? { text: "LOW", color: "var(--sr-warn)" } : v < 5 ? { text: "NEUTRAL", color: "var(--sr-text-3)" } : { text: "AMPLE", color: "var(--sr-pos)" } },
  { label: "Net Liquidity Direction", key: "net_liquidity_dir", text: true },
  { label: "Global Liquidity",        key: "global_liquidity_dir", text: true },
  { label: "Liquidity Cycle (LCC)",   key: "liquidity_cycle",  suffix: "", threshold: { warn: 40, bad: 25 }, higherIsBad: false },
];

const LABOR: SeriesEntry[] = [
  { label: "Unemployment Rate",     key: "unrate",         suffix: "%", threshold: { warn: 5, bad: 7 }, higherIsBad: true,
    badge: v => v < 4 ? { text: "TIGHT", color: "var(--sr-pos)" } : v < 5 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 7 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "HIGH", color: "var(--sr-neg)" } },
  { label: "Nonfarm Payrolls (M)",  key: "payems",         suffix: "M", decimals: 1,
    derived: m => m.payems != null ? Number(m.payems) / 1000 : null },
  { label: "Initial Jobless Claims",key: "icsa",           suffix: "K", threshold: { warn: 250, bad: 300 }, higherIsBad: true,
    badge: v => v < 200 ? { text: "LOW", color: "var(--sr-pos)" } : v < 250 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 300 ? { text: "RISING", color: "var(--sr-warn)" } : { text: "HIGH", color: "var(--sr-neg)" } },
  { label: "Claims Trend",          key: "claims_trend",   text: true },
  { label: "Recession Prob (RPC)",  key: "recession_prob", suffix: "", threshold: { warn: 40, bad: 60 }, higherIsBad: true },
];

const INFLATION: SeriesEntry[] = [
  { label: "Core PCE YoY",         key: "core_pce_yoy",        suffix: "%", threshold: { warn: 2.5, bad: 3.5 }, higherIsBad: true,
    badge: v => v < 2 ? { text: "BELOW TGT", color: "var(--sr-text-3)" } : v < 2.5 ? { text: "ON TARGET", color: "var(--sr-pos)" } : v < 3.5 ? { text: "ABOVE TGT", color: "var(--sr-warn)" } : { text: "HOT", color: "var(--sr-neg)" } },
  { label: "Core CPI YoY",         key: "core_cpi_yoy",        suffix: "%", threshold: { warn: 2.5, bad: 3.5 }, higherIsBad: true,
    badge: v => v < 2 ? { text: "BELOW TGT", color: "var(--sr-text-3)" } : v < 2.5 ? { text: "ON TARGET", color: "var(--sr-pos)" } : v < 3.5 ? { text: "ABOVE TGT", color: "var(--sr-warn)" } : { text: "HOT", color: "var(--sr-neg)" } },
  { label: "Buffett Indicator",     key: "buffett_indicator",    suffix: "%", threshold: { warn: 150, bad: 180 }, higherIsBad: true,
    badge: v => v < 100 ? { text: "CHEAP", color: "var(--sr-pos)" } : v < 150 ? { text: "FAIR", color: "var(--sr-text-3)" } : v < 180 ? { text: "RICH", color: "var(--sr-warn)" } : { text: "EXTREME", color: "var(--sr-neg)" } },
  { label: "Expected Return 10Y",   key: "expected_return_10y",  suffix: "%" },
  { label: "UMich Sentiment",       key: "umcsent",              suffix: "", threshold: { warn: 65, bad: 55 }, higherIsBad: false,
    badge: v => v > 80 ? { text: "OPTIMISTIC", color: "var(--sr-pos)" } : v > 65 ? { text: "MODERATE", color: "var(--sr-pos)" } : v > 55 ? { text: "CAUTIOUS", color: "var(--sr-warn)" } : { text: "PESSIMISTIC", color: "var(--sr-neg)" } },
  { label: "Profits Trend",         key: "profits_trend",        text: true },
];

const HOUSING: SeriesEntry[] = [
  { label: "Housing Stress (HSC)", key: "housing_stress",       suffix: "", threshold: { warn: 45, bad: 65 }, higherIsBad: true },
  { label: "Mortgage Rate 30Y",    key: "mortgage_rate",        suffix: "%", threshold: { warn: 6.5, bad: 8 }, higherIsBad: true,
    badge: v => v < 5 ? { text: "EASY", color: "var(--sr-pos)" } : v < 6.5 ? { text: "MODERATE", color: "var(--sr-text-3)" } : v < 8 ? { text: "RESTRICTIVE", color: "var(--sr-warn)" } : { text: "CRISIS", color: "var(--sr-neg)" } },
  { label: "Housing Starts (K)",   key: "house_starts",         suffix: "K", decimals: 0,
    badge: v => v > 1500 ? { text: "STRONG", color: "var(--sr-pos)" } : v > 1200 ? { text: "NORMAL", color: "var(--sr-pos)" } : v > 1000 ? { text: "WEAK", color: "var(--sr-warn)" } : { text: "LOW", color: "var(--sr-neg)" } },
  { label: "Existing Home Sales",  key: "home_sales",           suffix: "K", decimals: 0,
    derived: m => m.home_sales != null ? Number(m.home_sales) / 1000 : null,
    badge: v => v > 5000 ? { text: "HEALTHY", color: "var(--sr-pos)" } : v > 4000 ? { text: "SOFT", color: "var(--sr-warn)" } : v > 3500 ? { text: "LOW", color: "#FB923C" } : { text: "DEPRESSED", color: "var(--sr-neg)" } },
  { label: "Building Permits (K)", key: "building_permits",     suffix: "K", decimals: 0 },
  { label: "Case-Shiller YoY",    key: "case_shiller_yoy",     suffix: "%", signed: true },
  { label: "Median Price Δ YoY",  key: "median_home_price_chg", suffix: "%", signed: true },
];

const COMMODITIES: SeriesEntry[] = [
  { label: "WTI Crude Oil",        key: "wti_level",  suffix: "", prefix: "$", threshold: { warn: 85, bad: 100 }, higherIsBad: true,
    badge: v => v < 60 ? { text: "LOW", color: "var(--sr-pos)" } : v < 85 ? { text: "MODERATE", color: "var(--sr-pos)" } : v < 100 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "SHOCK", color: "var(--sr-neg)" } },
  { label: "WTI Change 1M",        key: "wti_chg_1m", suffix: "%", signed: true },
  { label: "Brent Crude",          key: "brent",      suffix: "", prefix: "$" },
  { label: "Gold (GLD ETF)",       key: "gold_price", suffix: "", prefix: "$" },
  { label: "Oil Volatility (OVX)", key: "ovx",        suffix: "", threshold: { warn: 35, bad: 55 }, higherIsBad: true,
    badge: v => v < 20 ? { text: "CALM", color: "var(--sr-pos)" } : v < 35 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 55 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "STRESS", color: "var(--sr-neg)" } },
  { label: "Oil Shock",            key: "oil_shock",  text: true },
  { label: "DXY (Broad Trade-Wtd)", key: "dxy",       suffix: "", threshold: { warn: 115, bad: 125 }, higherIsBad: true,
    badge: v => v < 96 ? { text: "WEAK USD", color: "var(--sr-warn)" } : v < 106 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 115 ? { text: "STRONG", color: "var(--sr-warn)" } : { text: "VERY STRONG", color: "var(--sr-neg)" } },
  { label: "USD/JPY",              key: "usdjpy",     suffix: "",
    badge: v => v < 135 ? { text: "STRONG JPY", color: "var(--sr-pos)" } : v < 145 ? { text: "NORMAL", color: "var(--sr-text-3)" } : v < 155 ? { text: "WEAK JPY", color: "var(--sr-warn)" } : { text: "INTERVENTION", color: "var(--sr-neg)" } },
];

const CONDITIONS: SeriesEntry[] = [
  { label: "VIX",                  key: "vix",              suffix: "", threshold: { warn: 20, bad: 35 }, higherIsBad: true,
    badge: v => v < 15 ? { text: "CALM", color: "var(--sr-pos)" } : v < 20 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 35 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "FEAR", color: "var(--sr-neg)" } },
  { label: "MOVE Index",           key: "move_index",       suffix: "", threshold: { warn: 100, bad: 140 }, higherIsBad: true,
    badge: v => v < 80 ? { text: "CALM", color: "var(--sr-pos)" } : v < 100 ? { text: "NORMAL", color: "var(--sr-pos)" } : v < 140 ? { text: "ELEVATED", color: "var(--sr-warn)" } : { text: "STRESSED", color: "var(--sr-neg)" } },
  { label: "SKEW Index",           key: "skew_index",       suffix: "", threshold: { warn: 130, bad: 145 }, higherIsBad: true },
  { label: "Fin. Stress (STLFSI4)", key: "stlfsi4",         suffix: "", threshold: { warn: 0.5, bad: 1.5 }, higherIsBad: true,
    badge: v => v < -1 ? { text: "VERY LOOSE", color: "var(--sr-pos)" } : v < 0 ? { text: "ACCOMMODATIVE", color: "var(--sr-pos)" } : v < 0.5 ? { text: "NEUTRAL", color: "var(--sr-text-3)" } : v < 1.5 ? { text: "TIGHT", color: "var(--sr-warn)" } : { text: "STRESS", color: "var(--sr-neg)" } },
  { label: "Chicago NFCI",         key: "nfci",             suffix: "", threshold: { warn: 0, bad: 0.5 }, higherIsBad: true,
    badge: v => v < -0.5 ? { text: "LOOSE", color: "var(--sr-pos)" } : v < 0 ? { text: "ACCOMMODATIVE", color: "var(--sr-pos)" } : v < 0.5 ? { text: "TIGHTENING", color: "var(--sr-warn)" } : { text: "TIGHT", color: "var(--sr-neg)" } },
  { label: "Geopolitical (GRC)",   key: "geopolitical_risk", suffix: "", threshold: { warn: 45, bad: 65 }, higherIsBad: true },
  { label: "Melt-up Score",        key: "meltup_score",     suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Bubble — Debt",        key: "bubble_debt",      suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
  { label: "Bubble — AI/Tech",     key: "bubble_ai",        suffix: "", threshold: { warn: 60, bad: 80 }, higherIsBad: true },
];

const SENTIMENT: SeriesEntry[] = [
  { label: "Fear & Greed",          key: "fear_greed",           suffix: "", threshold: { warn: 70, bad: 80 }, higherIsBad: true,
    badge: v => v < 25 ? { text: "EXTREME FEAR", color: "var(--sr-neg)" } : v < 45 ? { text: "FEAR", color: "var(--sr-warn)" } : v < 55 ? { text: "NEUTRAL", color: "var(--sr-text-3)" } : v < 75 ? { text: "GREED", color: "var(--sr-warn)" } : { text: "EXTREME GREED", color: "var(--sr-neg)" } },
  { label: "F&G Rating",            key: "fear_greed_rating",    text: true },
  { label: "Sentiment Signal",      key: "sentiment_signal",     text: true },
  { label: "Put/Call Ratio",        key: "put_call_ratio",       suffix: "", decimals: 2, threshold: { warn: 1.0, bad: 1.3 }, higherIsBad: true,
    badge: v => v < 0.7 ? { text: "COMPLACENT", color: "var(--sr-neg)" } : v < 0.9 ? { text: "BULLISH", color: "var(--sr-warn)" } : v < 1.1 ? { text: "NEUTRAL", color: "var(--sr-text-3)" } : v < 1.3 ? { text: "BEARISH", color: "var(--sr-warn)" } : { text: "EXTREME FEAR", color: "var(--sr-neg)" } },
  { label: "Credit Private Proxy",  key: "credit_private_proxy", suffix: "%", decimals: 2, signed: true },
  { label: "Credit Divergence",     key: "credit_divergence",    suffix: "",  decimals: 0,
    derived: m => m.credit_divergence != null ? (m.credit_divergence ? 1 : 0) : null,
    badge: v => v === 1 ? { text: "DIVERGING", color: "var(--sr-warn)" } : { text: "NO DIV.", color: "var(--sr-pos)" } },
  { label: "BOJ Assets ($T)",       key: "boj_assets",           suffix: "T", prefix: "$", decimals: 1,
    derived: m => m.boj_assets != null ? Number(m.boj_assets) / 1e12 : null },
  { label: "Claims Trend",          key: "claims_trend",         text: true },
  { label: "Profits Trend",         key: "profits_trend",        text: true },
  { label: "Recession Gate",        key: "recession_gate_active", suffix: "", decimals: 0,
    derived: m => m.recession_gate_active != null ? (m.recession_gate_active ? 1 : 0) : null,
    badge: v => v === 1 ? { text: "ACTIVE", color: "var(--sr-pos)" } : { text: "INACTIVE", color: "var(--sr-warn)" } },
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
  { id: "sentiment",  label: "Sentiment",   series: SENTIMENT  },
];

const SAHM_BANDS = [
  { range: "≥ 0.80",    label: "RECESSION CONFIRMED", color: "var(--sr-neg)" },
  { range: "0.50–0.79", label: "Probable recession",  color: "#FB923C" },
  { range: "0.25–0.49", label: "Elevated risk",        color: "var(--sr-warn)" },
  { range: "0.10–0.24", label: "Monitor",              color: "var(--sr-text-3)" },
  { range: "< 0.10",    label: "Benign",               color: "var(--sr-pos)" },
];

function sahmBand(v: number | null | undefined) {
  if (v == null) return null;
  if (v >= 0.80) return SAHM_BANDS[0];
  if (v >= 0.50) return SAHM_BANDS[1];
  if (v >= 0.25) return SAHM_BANDS[2];
  if (v >= 0.10) return SAHM_BANDS[3];
  return SAHM_BANDS[4];
}

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
            {!missing && item.badge && val != null && (() => {
              const b = item.badge!(val);
              return b ? (
                <span style={{ fontSize: "9px", fontWeight: 700, padding: "1px 5px", borderRadius: 3, letterSpacing: "0.02em",
                  background: `color-mix(in srgb, ${b.color} 14%, transparent)`, color: b.color }}>
                  {b.text}
                </span>
              ) : null;
            })()}
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

// ─── P8: Sub-score computation (mirrors ic-proxy/lib/macro.js formulas) ──────
function computeSubScores(m: MacroState) {
  const g = (k: keyof MacroState) => m[k] != null ? Number(m[k]) : null;
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  // LCC
  const netLiq = g("net_liquidity_t");
  const netLiq_s = netLiq == null ? 50 : clamp(netLiq < 3 ? 0 : netLiq < 4 ? (netLiq - 3) * 30 : netLiq < 5 ? 30 + (netLiq - 4) * 30 : 60 + ((netLiq - 5) / 1.5) * 40);
  const wresbalB = g("wresbal");
  const wresbalT = wresbalB != null ? wresbalB / 1000 : null;
  const wresbal_s = wresbalT == null ? 50 : clamp(wresbalT >= 4 ? 100 : wresbalT >= 3 ? 50 + (wresbalT - 3) * 50 : wresbalT >= 2 ? (wresbalT - 2) * 50 : 0);
  const sofr = g("sofr"); const ff = g("fedfunds");
  let sofr_s = 50;
  if (sofr != null && ff != null) { const sp = sofr - ff; sofr_s = clamp(sp < -0.5 ? 100 : sp < 0 ? 50 + (Math.abs(sp) / 0.5) * 50 : sp < 0.25 ? 50 - (sp / 0.25) * 50 : 0); }
  else if (sofr != null) { sofr_s = clamp(50 + (4.0 - sofr) * 12.5); }
  const m2 = g("m2_growth");
  const m2_s = m2 == null ? 50 : clamp(m2 < -2 ? 0 : m2 < 0 ? ((m2 + 2) / 2) * 30 : m2 < 4 ? 30 + (m2 / 4) * 40 : m2 < 8 ? 70 + ((m2 - 4) / 4) * 20 : Math.max(50, 90 - (m2 - 8) * 5));
  const lcc = netLiq_s * 0.35 + wresbal_s * 0.2 + sofr_s * 0.2 + m2_s * 0.15 + 50 * 0.1;

  // CSC
  const hyOas = g("hy_oas");
  const hyOas_s = hyOas == null ? 50 : clamp(hyOas < 250 ? 0 : hyOas < 350 ? ((hyOas - 250) / 100) * 30 : hyOas < 500 ? 30 + ((hyOas - 350) / 150) * 45 : 75 + Math.min(25, ((hyOas - 500) / 200) * 25));
  const bbOas = g("hy_bb_oas"); const cccOas = g("hy_ccc_oas");
  const bbCcc_s = (bbOas == null || cccOas == null) ? 40 : (() => { const d = cccOas - bbOas; return clamp(d < 100 ? 10 : d < 200 ? 10 + ((d - 100) / 100) * 30 : d < 350 ? 40 + ((d - 200) / 150) * 40 : 80 + Math.min(20, ((d - 350) / 100) * 20)); })();
  const bbb = g("bbb_oas");
  const bbb_s = bbb == null ? 30 : clamp(bbb < 100 ? 0 : bbb < 150 ? ((bbb - 100) / 50) * 30 : bbb < 250 ? 30 + ((bbb - 150) / 100) * 50 : 80 + Math.min(20, ((bbb - 250) / 50) * 20));
  const stlfsi = g("stlfsi4");
  const stlfsi_s = stlfsi == null ? 30 : clamp(stlfsi < -1 ? 0 : stlfsi < 0 ? (stlfsi + 1) * 25 : stlfsi < 0.5 ? 25 + (stlfsi / 0.5) * 40 : stlfsi < 1 ? 65 + ((stlfsi - 0.5) / 0.5) * 25 : 90 + Math.min(10, (stlfsi - 1) * 10));
  const nfci = g("nfci");
  const nfci_s = nfci == null ? 30 : clamp(nfci < -1 ? 0 : nfci < 0 ? ((nfci + 1) / 1) * 30 : nfci < 0.5 ? 30 + (nfci / 0.5) * 40 : nfci < 1 ? 70 + ((nfci - 0.5) / 0.5) * 20 : 90 + Math.min(10, (nfci - 1) * 10));
  const candi = g("c_and_i_loans");
  const candi_s = candi == null ? 30 : clamp(candi < -20 ? 0 : candi < 0 ? ((candi + 20) / 20) * 20 : candi < 25 ? 20 + (candi / 25) * 30 : candi < 50 ? 50 + ((candi - 25) / 25) * 30 : 80 + Math.min(20, ((candi - 50) / 20) * 20));
  const card = g("credit_card_delinq");
  const card_s = card == null ? 25 : clamp(card < 2.5 ? 5 : card < 4 ? 5 + ((card - 2.5) / 1.5) * 30 : card < 6 ? 35 + ((card - 4) / 2) * 40 : 75 + Math.min(25, ((card - 6) / 1.5) * 25));
  const csc = hyOas_s * 0.25 + nfci_s * 0.20 + bbCcc_s * 0.15 + bbb_s * 0.15 + stlfsi_s * 0.10 + candi_s * 0.10 + card_s * 0.05;

  // RPC
  const sahm = g("sahm_rule");
  const sahm_s = sahm == null ? 20 : clamp(sahm < 0.1 ? 5 : sahm < 0.3 ? 5 + ((sahm - 0.1) / 0.2) * 25 : sahm < 0.5 ? 30 + ((sahm - 0.3) / 0.2) * 40 : 70 + Math.min(30, ((sahm - 0.5) / 0.5) * 30));
  const t10y2y = g("t10y2y");
  const curve2y_s = t10y2y == null ? 30 : clamp(t10y2y > 1.5 ? 5 : t10y2y > 0.5 ? 5 + (1.5 - t10y2y) * 20 : t10y2y > 0 ? 25 + ((0.5 - t10y2y) / 0.5) * 25 : t10y2y > -0.5 ? 50 + (Math.abs(t10y2y) / 0.5) * 25 : 75 + Math.min(25, ((Math.abs(t10y2y) - 0.5) / 0.5) * 25));
  const t10y3m = g("t10y3m");
  const curve3m_s = t10y3m == null ? 30 : clamp(t10y3m > 1 ? 5 : t10y3m > 0 ? 5 + (1 - t10y3m) * 30 : t10y3m > -0.5 ? 35 + (Math.abs(t10y3m) / 0.5) * 35 : 70 + Math.min(30, (Math.abs(t10y3m) - 0.5) * 30));
  const icsaRaw = g("icsa"); const icsaK = icsaRaw != null && icsaRaw > 1000 ? icsaRaw / 1000 : icsaRaw;
  const icsa_s = icsaK == null ? 20 : clamp(icsaK < 200 ? 5 : icsaK < 250 ? 5 + ((icsaK - 200) / 50) * 20 : icsaK < 300 ? 25 + ((icsaK - 250) / 50) * 30 : icsaK < 350 ? 55 + ((icsaK - 300) / 50) * 25 : 80 + Math.min(20, ((icsaK - 350) / 100) * 20));
  const umcsent = g("umcsent");
  const umcsent_s = umcsent == null ? 30 : clamp(umcsent > 90 ? 5 : umcsent > 80 ? 5 + (90 - umcsent) * 2 : umcsent > 65 ? 25 + ((80 - umcsent) / 15) * 40 : umcsent > 50 ? 65 + ((65 - umcsent) / 15) * 25 : 90 + Math.min(10, ((50 - umcsent) / 10) * 10));
  const houst = g("house_starts");
  const houst_s = houst == null ? 25 : clamp(houst > 1600 ? 5 : houst > 1400 ? 5 + ((1600 - houst) / 200) * 20 : houst > 1200 ? 25 + ((1400 - houst) / 200) * 30 : houst > 1000 ? 55 + ((1200 - houst) / 200) * 25 : 80 + Math.min(20, ((1000 - houst) / 200) * 20));
  const rpc = sahm_s * 0.25 + curve2y_s * 0.2 + curve3m_s * 0.15 + icsa_s * 0.15 + umcsent_s * 0.15 + houst_s * 0.1;

  // GRC
  const wti = g("wti_level");
  const wti_s = wti == null ? 30 : clamp(wti < 60 ? 10 : wti < 80 ? 10 + ((wti - 60) / 20) * 20 : wti < 100 ? 30 + ((wti - 80) / 20) * 40 : 70 + Math.min(30, ((wti - 100) / 30) * 30));
  const brent = g("brent");
  const brentWti_s = (brent == null || wti == null) ? 20 : (() => { const sp = brent - wti; return clamp(sp < 1 ? 10 : sp < 3 ? 10 + ((sp - 1) / 2) * 20 : sp < 8 ? 30 + ((sp - 3) / 5) * 50 : 80 + Math.min(20, ((sp - 8) / 4) * 20)); })();
  const ovx = g("ovx");
  const ovx_s = ovx == null ? 30 : clamp(ovx < 20 ? 10 : ovx < 30 ? 10 + ((ovx - 20) / 10) * 30 : ovx < 45 ? 40 + ((ovx - 30) / 15) * 40 : 80 + Math.min(20, ((ovx - 45) / 15) * 20));
  const usdjpy = g("usdjpy");
  const usdjpy_s = usdjpy == null ? 20 : clamp(usdjpy > 155 ? 30 : usdjpy > 145 ? 20 : usdjpy > 140 ? 20 + (145 - usdjpy) * 6 : usdjpy > 135 ? 50 + (140 - usdjpy) * 6 : 80 + Math.min(20, (135 - usdjpy) * 4));
  const dxy = g("dxy");
  const dxy_s = dxy == null ? 20 : clamp(dxy < 96 ? 10 : dxy < 100 ? 10 + ((dxy - 96) / 4) * 10 : dxy < 106 ? 20 + ((dxy - 100) / 6) * 25 : dxy < 110 ? 45 + ((dxy - 106) / 4) * 35 : 80 + Math.min(20, ((dxy - 110) / 5) * 20));
  const grc = wti_s * 0.23 + brentWti_s * 0.14 + ovx_s * 0.19 + 30 * 0.19 + usdjpy_s * 0.1 + dxy_s * 0.1 + 25 * 0.05;

  // HSC
  const hsRaw = g("home_sales"); const hs = hsRaw != null && hsRaw > 10000 ? hsRaw / 1000 : hsRaw;
  const hs_s = hs == null ? 30 : clamp(hs > 5500 ? 5 : hs > 5000 ? 5 + ((5500 - hs) / 500) * 25 : hs > 4000 ? 30 + ((5000 - hs) / 1000) * 30 : hs > 3500 ? 60 + ((4000 - hs) / 500) * 20 : 80 + Math.min(20, ((3500 - hs) / 500) * 20));
  const mort = g("mortgage_rate");
  const mort_s = mort == null ? 30 : clamp(mort < 4 ? 5 : mort < 6 ? 5 + ((mort - 4) / 2) * 25 : mort < 7 ? 30 + (mort - 6) * 35 : mort < 7.5 ? 65 + ((mort - 7) / 0.5) * 20 : 85 + Math.min(15, ((mort - 7.5) / 0.5) * 15));
  const houst_hsc = houst == null ? 25 : clamp(houst > 1600 ? 5 : houst > 1400 ? 5 + ((1600 - houst) / 200) * 25 : houst > 1200 ? 30 + ((1400 - houst) / 200) * 30 : houst > 1000 ? 60 + ((1200 - houst) / 200) * 25 : 85 + Math.min(15, ((1000 - houst) / 200) * 15));
  const permit = g("building_permits");
  const permit_s = permit == null ? 25 : clamp(permit > 1700 ? 5 : permit > 1500 ? 5 + ((1700 - permit) / 200) * 25 : permit > 1300 ? 30 + ((1500 - permit) / 200) * 30 : permit > 1100 ? 60 + ((1300 - permit) / 200) * 25 : 85 + Math.min(15, ((1100 - permit) / 200) * 15));
  const cs = g("case_shiller_yoy");
  const cs_s = cs == null ? 25 : clamp(cs > 5 ? 10 : cs > 2 ? 10 + ((5 - cs) / 3) * 25 : cs > 0 ? 35 + ((2 - cs) / 2) * 30 : cs > -3 ? 65 + (Math.abs(cs) / 3) * 25 : 90 + Math.min(10, ((Math.abs(cs) - 3) / 3) * 10));
  const hsc = hs_s * 0.3 + mort_s * 0.25 + houst_hsc * 0.2 + permit_s * 0.15 + cs_s * 0.1;

  return {
    csc: { total: csc, subs: [{ label: "HY OAS Level", s: hyOas_s }, { label: "BB-CCC Diff", s: bbCcc_s }, { label: "BBB Spread", s: bbb_s }, { label: "Fin. Stress", s: stlfsi_s }, { label: "C&I Tightening", s: candi_s }, { label: "Card Delinq.", s: card_s }] },
    lcc: { total: lcc, subs: [{ label: "Net Liquidity", s: netLiq_s }, { label: "Bank Reserves", s: wresbal_s }, { label: "SOFR Spread", s: sofr_s }, { label: "M2 Growth", s: m2_s }] },
    rpc: { total: rpc, subs: [{ label: "Sahm Rule", s: sahm_s }, { label: "Curve 10Y-2Y", s: curve2y_s }, { label: "Curve 10Y-3M", s: curve3m_s }, { label: "Jobless Claims", s: icsa_s }, { label: "UMich Sentiment", s: umcsent_s }, { label: "Housing Starts", s: houst_s }] },
    grc: { total: grc, subs: [{ label: "WTI Crude", s: wti_s }, { label: "Brent-WTI", s: brentWti_s }, { label: "OVX", s: ovx_s }, { label: "USD/JPY", s: usdjpy_s }, { label: "DXY", s: dxy_s }] },
    hsc: { total: hsc, subs: [{ label: "Existing Sales", s: hs_s }, { label: "Mortgage Rate", s: mort_s }, { label: "Housing Starts", s: houst_hsc }, { label: "Permits", s: permit_s }, { label: "Case-Shiller", s: cs_s }] },
  };
}

function CompositeBreakdown({ macro, loading }: { macro: MacroState | null; loading: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (loading || !macro) return (
    <div className="card">
      <div className="section-label">Composite Score Breakdown</div>
      {[1,2,3,4,5].map(i => <div key={i} style={{ marginBottom: 6 }}><Sk w="100%" h={22} /></div>)}
    </div>
  );
  const sc = computeSubScores(macro);
  const composites: { id: string; label: string; stored: number | null | undefined; computed: number; subs: { label: string; s: number }[]; bad: boolean }[] = [
    { id: "csc", label: "Credit Stress (CSC)",    stored: macro.credit_stress,     computed: sc.csc.total, subs: sc.csc.subs, bad: true },
    { id: "lcc", label: "Liquidity Cycle (LCC)",  stored: macro.liquidity_cycle,   computed: sc.lcc.total, subs: sc.lcc.subs, bad: false },
    { id: "rpc", label: "Recession Prob (RPC)",   stored: macro.recession_prob,    computed: sc.rpc.total, subs: sc.rpc.subs, bad: true },
    { id: "grc", label: "Geopolitical Risk (GRC)",stored: macro.geopolitical_risk, computed: sc.grc.total, subs: sc.grc.subs, bad: true },
    { id: "hsc", label: "Housing Stress (HSC)",   stored: macro.housing_stress,    computed: sc.hsc.total, subs: sc.hsc.subs, bad: true },
  ];
  return (
    <div className="card">
      <div className="section-label">Composite Score Breakdown</div>
      <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: 10 }}>Click → sub-drivers. Stored = cron · Computed = frontend approx.</div>
      {composites.map(({ id, label, stored, computed, subs, bad }) => {
        const score = stored ?? Math.round(computed);
        const isExp = expanded === id;
        const pct = Math.min(100, Math.max(0, score));
        const col = bad
          ? (score > 65 ? "var(--sr-neg)" : score > 45 ? "var(--sr-warn)" : "var(--sr-pos)")
          : (score < 35 ? "var(--sr-neg)" : score < 55 ? "var(--sr-warn)" : "var(--sr-pos)");
        return (
          <div key={id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setExpanded(isExp ? null : id)}>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", flex: 1 }}>{label}</span>
              <div style={{ position: "relative", flex: "0 0 70px", height: 5, background: "var(--sr-surface-3)", borderRadius: 3 }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, borderRadius: 3, background: col, transition: "width 500ms" }} />
              </div>
              <span style={{ fontSize: "10px", fontWeight: 700, color: col, width: 26, textAlign: "right" }} className="num">{score.toFixed(0)}</span>
              <span style={{ fontSize: "9px", color: "var(--sr-text-3)", width: 10 }}>{isExp ? "▲" : "▼"}</span>
            </div>
            {isExp && (
              <div style={{ paddingLeft: 8, paddingTop: 5, borderLeft: `2px solid ${col}`, marginLeft: 2, marginTop: 4 }}>
                {subs.map(sub => {
                  const sc2 = Math.min(100, Math.max(0, sub.s));
                  const sc2col = bad
                    ? (sc2 > 65 ? "var(--sr-neg)" : sc2 > 40 ? "var(--sr-warn)" : "var(--sr-pos)")
                    : (sc2 < 35 ? "var(--sr-neg)" : sc2 < 55 ? "var(--sr-warn)" : "var(--sr-pos)");
                  return (
                    <div key={sub.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: "9px", color: "var(--sr-text-3)", flex: 1 }}>{sub.label}</span>
                      <div style={{ position: "relative", flex: "0 0 50px", height: 3, background: "var(--sr-surface-3)", borderRadius: 2 }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${sc2}%`, borderRadius: 2, background: sc2col }} />
                      </div>
                      <span style={{ fontSize: "9px", fontWeight: 600, color: sc2col, width: 22, textAlign: "right" }} className="num">{sc2.toFixed(0)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
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

          {/* P8: Composite sub-score breakdown */}
          <CompositeBreakdown macro={macro} loading={loading} />

          {/* Sahm Rule bands */}
          <div className="card">
            <div className="section-label">Sahm Rule — Recession Trigger</div>
            <div style={{ marginBottom: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>SAHMREALTIME</div>
              {loading ? <Sk w={60} h={20} /> : (() => {
                const sv = macro?.sahm_rule != null ? Number(macro.sahm_rule) : null;
                const band = sahmBand(sv);
                return (
                  <>
                    <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: band?.color ?? "var(--sr-text)" }}>
                      {sv != null ? sv.toFixed(2) : "—"}
                    </div>
                    {band && (
                      <div style={{ fontSize: "10px", fontWeight: 600, color: band.color, marginTop: 4 }}>{band.label}</div>
                    )}
                  </>
                );
              })()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {SAHM_BANDS.map(b => {
                const sv = macro?.sahm_rule != null ? Number(macro.sahm_rule) : null;
                const isBandActive = sahmBand(sv) === b;
                return (
                  <div key={b.range} style={{
                    display: "flex", justifyContent: "space-between", padding: "4px 8px", borderRadius: 4,
                    background: isBandActive ? `color-mix(in srgb, ${b.color} 12%, var(--sr-surface-2))` : "var(--sr-surface-2)",
                    border: isBandActive ? `1px solid color-mix(in srgb, ${b.color} 30%, transparent)` : "1px solid transparent",
                  }}>
                    <span style={{ fontSize: "10px", fontWeight: 700, color: b.color }} className="num">{b.range}</span>
                    <span style={{ fontSize: "10px", color: isBandActive ? b.color : "var(--sr-text-3)", fontWeight: isBandActive ? 600 : 400 }}>{b.label}</span>
                  </div>
                );
              })}
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
                ["Fed Balance Sheet", macro?.walcl != null ? `$${(Number(macro.walcl)/1e6).toFixed(2)}T` : "Pending"],
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
