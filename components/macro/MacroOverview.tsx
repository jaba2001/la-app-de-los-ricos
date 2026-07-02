"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MacroState, StockAnalysis } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";
import { getRating, computeICHealthScore } from "@/lib/scoring";
import { useAuth } from "@/lib/auth";

interface Props { macro: MacroState | null; loading: boolean; }

const COMPOSITES = [
  { key: "liquidity_cycle",   label: "Liquidity Cycle",       abbr: "LCC", color: "var(--sr-lcc)" },
  { key: "recession_prob",    label: "Recession Probability",  abbr: "RPC", color: "var(--sr-rpc)" },
  { key: "credit_stress",     label: "Credit Stress",          abbr: "CSC", color: "var(--sr-csc)" },
  { key: "geopolitical_risk", label: "Geopolitical Risk",      abbr: "GRC", color: "var(--sr-grc)" },
  { key: "housing_stress",    label: "Housing Stress",         abbr: "HSC", color: "var(--sr-hsc)" },
] as const;

const REGIME_COLORS: Record<string, string> = {
  expansion: "var(--sr-pos)", reflation: "var(--sr-warn)",
  stagflation: "var(--sr-neg)", contraction: "var(--sr-neg)", neutral: "var(--sr-text-2)",
};

const PORTFOLIO_QUADRANTS: Record<string, { label: string; color: string; etfs: string[]; desc: string }> = {
  crecimiento: { label: "Growth",       color: "var(--sr-pos)",  etfs: ["QQQ","XLK","XLY","SCHG","VGT"],     desc: "Expansion — equities, tech, consumer discretionary" },
  inflacion:   { label: "Inflation",    color: "var(--sr-warn)", etfs: ["GLD","USO","XLE","XLB","TIP","PDBC"], desc: "Reflation — commodities, energy, materials, TIPS" },
  estanflacion:{ label: "Stagflation",  color: "var(--sr-neg)",  etfs: ["GLD","XLP","XLU","TIP","BIL","SGOV"], desc: "Stagflation — gold, defensives, short duration" },
  defensivo:   { label: "Defensive",    color: "#8B5CF6",        etfs: ["TLT","IEF","XLP","XLV","XLU","BIL"], desc: "Contraction — long bonds, utilities, healthcare" },
};

function icScoreColor(v: unknown) {
  const n = Number(v);
  if (v == null || isNaN(n)) return "var(--sr-text-3)";
  if (n >= 70) return "var(--sr-neg)";
  if (n >= 45) return "var(--sr-warn)";
  return "var(--sr-pos)";
}

function healthLabel(v: number) {
  if (v >= 65) return { label: "FAVORABLE",  color: "var(--sr-pos)" };
  if (v >= 45) return { label: "CAUTION",     color: "var(--sr-warn)" };
  if (v >= 30) return { label: "STRESS",      color: "#FB923C" };
  return               { label: "RISK-OFF",   color: "var(--sr-neg)" };
}

const SIGNAL_HIERARCHY = [
  { tier: 1, name: "Liquidity",   key: "liquidity_cycle",   desc: "Druckenmiller primary — market fuel",     good: (v:number) => v > 55, bad: (v:number) => v < 35 },
  { tier: 2, name: "Credit",      key: "credit_stress",     desc: "Transmission mechanism — stress spreads", good: (v:number) => v < 30, bad: (v:number) => v > 65 },
  { tier: 3, name: "Recession",   key: "recession_prob",    desc: "Growth signal — labor + curve + Sahm",    good: (v:number) => v < 25, bad: (v:number) => v > 55 },
  { tier: 4, name: "Geopolitical",key: "geopolitical_risk", desc: "Commodity + volatility premium",          good: (v:number) => v < 30, bad: (v:number) => v > 65 },
  { tier: 5, name: "Housing",     key: "housing_stress",    desc: "Confirmatory — housing cycle late signal", good: (v:number) => v < 30, bad: (v:number) => v > 60 },
] as const;

function ScoreRing({ value, color }: { value: number; color: string }) {
  const r = 52, circ = 2 * Math.PI * r, dash = circ * (value / 100);
  return (
    <svg width={130} height={130} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={65} cy={65} r={r} fill="none" stroke="var(--sr-surface-3)" strokeWidth={10} />
      <circle cx={65} cy={65} r={r} fill="none" stroke={color} strokeWidth={10}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 800ms cubic-bezier(0.4,0,0.2,1)" }} />
    </svg>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const mn = Math.min(...points), mx = Math.max(...points), rng = mx - mn || 1;
  const W = 240, H = 40;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map(v => H - ((v - mn) / rng) * H);
  const d  = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={4} fill={color} />
    </svg>
  );
}

export default function MacroOverview({ macro, loading }: Props) {
  const router = useRouter();
  const { session } = useAuth();
  const regimeColor = macro?.regime_id ? (REGIME_COLORS[macro.regime_id] ?? "var(--sr-text-2)") : "var(--sr-text-2)";
  const updatedAt   = macro?.updated_at
    ? new Date(macro.updated_at).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const isStale = macro?.updated_at
    ? (Date.now() - new Date(macro.updated_at).getTime()) > 24 * 60 * 60 * 1000
    : false;

  const [icHistory,  setIcHistory]  = useState<{ date: string; score: number }[]>([]);
  const [topAtRisk,  setTopAtRisk]  = useState<StockAnalysis[]>([]);

  useEffect(() => {
    supabase.from("macro_state_history")
      .select("snapshot_date, ic_score")
      .order("snapshot_date", { ascending: true })
      .limit(90)
      .then(({ data }) => {
        if (data) setIcHistory(data.map(r => ({ date: r.snapshot_date as string, score: Number(r.ic_score) })).filter(r => !isNaN(r.score)));
      });
    if (session) {
      supabase.from("sl_analyses")
        .select("ticker, sector, score_total, macro_tilt, rating, analysis_date")
        .eq("user_id", session.user.id)
        .order("analysis_date", { ascending: false })
        .limit(200)
        .then(({ data }) => {
          if (!data) return;
          const seen = new Set<string>();
          const unique = (data as StockAnalysis[]).filter(r => { if (seen.has(r.ticker)) return false; seen.add(r.ticker); return true; });
          unique.sort((a, b) => Number(a.macro_tilt ?? 0) - Number(b.macro_tilt ?? 0));
          setTopAtRisk(unique.slice(0, 8));
        });
    }
  }, [session]);

  const quadrant = macro?.cartera_quadrant as string | null | undefined;
  const quadrantInfo = quadrant ? PORTFOLIO_QUADRANTS[quadrant] : null;

  return (
    <div className="animate-fade-in">
      {/* Top row: IC Score + Regime */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-6)", alignItems: "stretch" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-5)", minWidth: 260 }}>
          <div style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
            {loading ? <Sk w={130} h={130} r={65} /> : (
              <>
                <ScoreRing value={Number(macro?.ic_score ?? 0)} color={icScoreColor(macro?.ic_score)} />
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: icScoreColor(macro?.ic_score), lineHeight: 1 }} className="num">
                    {macro?.ic_score != null ? Number(macro.ic_score).toFixed(1) : "—"}
                  </span>
                  <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 600, letterSpacing: "0.08em", marginTop: 2 }}>STRESS INDEX</span>
                  <span style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 1, opacity: 0.7 }}>↑ = more risk</span>
                </div>
              </>
            )}
          </div>
          <div>
            <div className="section-label">Market Stress Score</div>
            {loading ? <Sk w={120} h={20} /> : (
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: icScoreColor(macro?.ic_score), marginBottom: 4 }}>
                {Number(macro?.ic_score ?? 0) >= 70 ? "High Stress" : Number(macro?.ic_score ?? 0) >= 45 ? "Elevated" : "Low Stress"}
              </div>
            )}
            {updatedAt && (
              <div style={{ fontSize: "var(--sr-t-xs)", color: isStale ? "var(--sr-warn)" : "var(--sr-text-3)", display: "flex", alignItems: "center", gap: 4 }}>
                {isStale && <span title="Data older than 24h">⚠</span>} Updated {updatedAt}
              </div>
            )}
            {icHistory.length >= 2 && (
              <div style={{ marginTop: 12 }}>
                <Sparkline points={icHistory.map(h => h.score)} color={icScoreColor(macro?.ic_score)} />
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>IC Score — {icHistory.length} snapshots</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-4)" }}>
            <div>
              <div className="section-label">Current Regime</div>
              {loading ? <Sk w={140} h={32} /> : (
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: regimeColor, letterSpacing: "-0.02em" }}>
                  {macro?.regime_label ?? "Loading…"}
                </div>
              )}
            </div>
            {!loading && macro?.regime_id && <Pill label={macro.regime_id.toUpperCase()} color={regimeColor} />}
          </div>
          <div className="sr-grid-3">
            {[
              { label: "Quadrant",      val: macro?.cartera_quadrant },
              { label: "Net Liquidity", val: macro?.net_liquidity_dir },
              { label: "Fed Room",      val: macro?.fed_room },
            ].map(({ label, val }) => (
              <div key={label} className="sr-tile">
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                {loading ? <Sk w="80%" h={14} /> : <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>{val ?? "—"}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* IC Health Score + Signal Hierarchy */}
      {!loading && (() => {
        const icHealth = computeICHealthScore(macro);
        const hl = icHealth != null ? healthLabel(icHealth) : null;
        return (
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
            {/* IC Health Score */}
            <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-4)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "var(--sr-sp-2)" }}>IC Health Score</div>
              {icHealth != null && hl ? (
                <>
                  <div style={{ fontSize: "var(--sr-t-3xl)", fontWeight: 700, color: hl.color, lineHeight: 1 }} className="num">{icHealth.toFixed(0)}</div>
                  <div style={{ marginTop: 6, fontSize: "var(--sr-t-xs)", fontWeight: 700, color: hl.color, letterSpacing: "0.08em" }}>{hl.label}</div>
                  <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: "var(--sr-surface-3)" }}>
                    <div style={{ height: "100%", width: `${icHealth}%`, background: hl.color, borderRadius: 2, transition: "width 800ms ease" }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.4 }}>
                    100 − (CSC×0.25 + (100−LCC)×0.35 + RPC×0.2 + GRC×0.1 + HSC×0.1)
                  </div>
                </>
              ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>—</div>}
            </div>

            {/* Druckenmiller Signal Hierarchy */}
            <div className="card" style={{ padding: "var(--sr-sp-4)" }}>
              <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
                <div className="section-label" style={{ margin: 0 }}>Signal Hierarchy — Druckenmiller Framework</div>
                <span className="sr-hint">Priority 1→5</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
                {SIGNAL_HIERARCHY.map(s => {
                  const raw = macro ? (macro as unknown as Record<string, unknown>)[s.key] : null;
                  const val = raw != null ? Number(raw) : null;
                  const isGood = val != null && s.good(val);
                  const isBad  = val != null && s.bad(val);
                  const sigColor = isBad ? "var(--sr-neg)" : isGood ? "var(--sr-pos)" : "var(--sr-warn)";
                  const dot      = isBad ? "var(--sr-neg)" : isGood ? "var(--sr-pos)" : "var(--sr-surface-3)";
                  return (
                    <div key={s.tier} style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "6px var(--sr-sp-3)", borderRadius: "var(--sr-radius-sm)", background: isBad ? "color-mix(in srgb, var(--sr-neg) 6%, transparent)" : "transparent" }}>
                      <span style={{ fontSize: "10px", color: "var(--sr-text-3)", width: 16, textAlign: "center", fontWeight: 700 }}>{s.tier}</span>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, boxShadow: isBad ? `0 0 5px ${dot}` : "none", flexShrink: 0 }} />
                      <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: sigColor, width: 90, flexShrink: 0 }}>{s.name}</span>
                      <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", flex: 1 }}>{s.desc}</span>
                      <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: sigColor, width: 36, textAlign: "right" }} className="num">{val != null ? val.toFixed(0) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Composite scores */}
      <div className="section-label">Composite Scores</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-6)" }}>
        {COMPOSITES.map(({ key, label, abbr, color }) => {
          const val = macro?.[key] as number | null | undefined;
          return (
            <div key={key} className="card" style={{ padding: "var(--sr-sp-4)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-1)" }}>
                <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, letterSpacing: "0.08em", color: "var(--sr-text-3)" }}>{abbr}</span>
                {loading ? <Sk w={36} h={24} /> : (
                  <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color }} className="num">
                    {val != null ? Number(val).toFixed(0) : "—"}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-2)" }}>{label}</div>
              <div className="score-bar-track">
                <div className="score-bar-fill" style={{ width: `${Number(val ?? 0)}%`, background: color }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Key signals grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-6)" }}>
        <div className="card">
          <div className="section-label">Rates & Curve</div>
          {[
            { label: "2Y Treasury",      val: macro?.dgs2,            fmt: (v: number) => `${v.toFixed(2)}%` },
            { label: "10Y Treasury",     val: macro?.dgs10,           fmt: (v: number) => `${v.toFixed(2)}%` },
            { label: "30Y Treasury",     val: macro?.dgs30,           fmt: (v: number) => `${v.toFixed(2)}%` },
            { label: "Term Premium 10Y", val: macro?.term_premium_10y, fmt: (v: number) => `${v.toFixed(2)}%` },
            { label: "Curve Steepener",  val: macro?.curve_steepener, fmt: (v: number) => isNaN(v) ? String(macro?.curve_steepener ?? "—") : `${v.toFixed(0)}bp` },
          ].map(({ label, val, fmt }) => (
            <div key={label} className="stat-row">
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
              {loading ? <Sk w={50} h={14} /> : <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }} className="num">{val != null ? fmt(Number(val)) : "—"}</span>}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="section-label">Fed & Macro</div>
          {[
            { label: "Core PCE YoY",       val: macro?.core_pce_yoy,       fmt: (v: number) => `${v.toFixed(1)}%` },
            { label: "Unemployment",        val: macro?.unrate,             fmt: (v: number) => `${v.toFixed(1)}%` },
            { label: "Buffett Indicator",   val: macro?.buffett_indicator,  fmt: (v: number) => `${v.toFixed(0)}%` },
            { label: "Expected Return 10Y", val: macro?.expected_return_10y,fmt: (v: number) => `${v.toFixed(1)}%` },
          ].map(({ label, val, fmt }) => (
            <div key={label} className="stat-row">
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
              {loading ? <Sk w={50} h={14} /> : <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }} className="num">{val != null ? fmt(Number(val)) : "—"}</span>}
            </div>
          ))}
          <div className="stat-row">
            <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Fed Room</span>
            {loading ? <Sk w={60} h={14} /> : <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>{macro?.fed_room ?? "—"}</span>}
          </div>
        </div>

        <div className="card">
          <div className="section-label">Oil & Sentiment</div>
          {[
            { label: "WTI Oil",       val: macro?.wti_level,    fmt: (v: number) => `$${v.toFixed(1)}`,  color: undefined },
            { label: "WTI Change 1M", val: macro?.wti_chg_1m,   fmt: (v: number) => `${v.toFixed(1)}%`,  color: (v: number) => v >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" },
            { label: "Fear & Greed",  val: macro?.fear_greed,   fmt: (v: number) => v.toFixed(0),         color: undefined },
            { label: "Put/Call",      val: macro?.put_call_ratio,fmt: (v: number) => v.toFixed(2),         color: undefined },
          ].map(({ label, val, fmt, color }) => (
            <div key={label} className="stat-row">
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
              {loading ? <Sk w={50} h={14} /> : (
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: color && val != null ? color(Number(val)) : "var(--sr-text)" }} className="num">
                  {val != null ? fmt(Number(val)) : "—"}
                </span>
              )}
            </div>
          ))}
          <div className="stat-row">
            <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Global Liquidity</span>
            {loading ? <Sk w={60} h={14} /> : (
              <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: macro?.global_liquidity_dir === "expansion" ? "var(--sr-pos)" : macro?.global_liquidity_dir === "contraction" ? "var(--sr-neg)" : "var(--sr-warn)" }}>
                {macro?.global_liquidity_dir ?? "—"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Portfolio Positioning + Top At Risk */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        {/* Portfolio Positioning */}
        <div className="card">
          <div className="section-label">Portfolio Positioning</div>
          {loading ? <Sk w="100%" h={160} /> : (
            <div>
              {quadrantInfo ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
                    <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: quadrantInfo.color }}>{quadrantInfo.label}</div>
                    <Pill label={quadrant?.toUpperCase() ?? ""} color={quadrantInfo.color} />
                  </div>
                  <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-3)" }}>{quadrantInfo.desc}</div>
                  <div style={{ marginBottom: "var(--sr-sp-2)" }}>
                    <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Suggested ETFs</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
                    {quadrantInfo.etfs.map(etf => (
                      <button
                        key={etf}
                        onClick={() => router.push(`/stock/${etf}`)}
                        style={{
                          padding: "4px 12px", borderRadius: "var(--sr-radius-pill)",
                          background: "var(--sr-surface-2)", border: `1px solid color-mix(in srgb, ${quadrantInfo.color} 30%, var(--sr-border))`,
                          color: quadrantInfo.color, fontWeight: 700, fontSize: "var(--sr-t-xs)",
                          cursor: "pointer", fontFamily: "var(--font-mono, ui-monospace, monospace)",
                        }}
                      >{etf}</button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-4)" }}>All quadrant allocations:</div>
                  {Object.entries(PORTFOLIO_QUADRANTS).map(([key, q]) => (
                    <div key={key} style={{ marginBottom: "var(--sr-sp-3)" }}>
                      <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: q.color, marginBottom: 4 }}>{q.label}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {q.etfs.map(etf => (
                          <span key={etf} style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "var(--sr-radius-pill)", background: "var(--sr-surface-2)", color: "var(--sr-text-3)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>{etf}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Top At Risk */}
        <div className="card">
          <div className="section-label">Top At Risk — Worst Macro Tilt</div>
          {topAtRisk.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>
              Analyze stocks in the Stocks tab to populate this list.
            </div>
          ) : (
            <table className="sr-table">
              <thead><tr>
                <th>Ticker</th><th>Sector</th>
                <th style={{ textAlign: "right" }}>Score</th>
                <th style={{ textAlign: "right" }}>Macro Tilt</th>
              </tr></thead>
              <tbody>
                {topAtRisk.map(r => {
                  const rating = getRating(Number(r.score_total));
                  const tilt = Number(r.macro_tilt ?? 0);
                  return (
                    <tr key={r.ticker} style={{ cursor: "pointer" }} onClick={() => router.push(`/stock/${r.ticker}`)}>
                      <td style={{ fontWeight: 700, color: "var(--sr-amber)" }}>{r.ticker}</td>
                      <td style={{ color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)" }}>{r.sector ?? "—"}</td>
                      <td style={{ textAlign: "right" }}><span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 600, color: rating.color }}>{rating.label}</span></td>
                      <td style={{ textAlign: "right", color: tilt < -5 ? "var(--sr-neg)" : tilt < 0 ? "var(--sr-warn)" : "var(--sr-pos)", fontWeight: 700 }} className="num">
                        {tilt > 0 ? "+" : ""}{tilt}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
