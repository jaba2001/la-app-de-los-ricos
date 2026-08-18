"use client";
import { useEffect, useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores, StockAnalysis } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";
import { trajectoryRating, stockPickingRegime } from "@/lib/microScore";
import { topDownContext } from "@/lib/topDown";
import type { RegimeId } from "@/lib/timeframes";
import { RATING_COLOR, type Rating } from "@/lib/rating";
import { classifyInstrument } from "@/lib/instrument";
import { buildVerdict, deriveTechnicals } from "@/lib/verdict";
import { useHorizon } from "@/lib/horizon";
import WhyMoved from "@/components/stock/WhyMoved";
import StockThesis from "@/components/stock/StockThesis";
import EarningsTone from "@/components/stock/EarningsTone";
import InstrumentPanel from "@/components/stock/InstrumentPanel";
import BondCockpit from "@/components/stock/BondCockpit";

interface Props {
  data: StockData | null;
  macro: MacroState | null;
  scores: Scores | null;
  icScore: number | null;
  rating: { label: string; color: string } | null;
  macroTilt: { tilt: number; label: string; color: string; reasons: string[] } | null;
  loading: boolean;
  ticker: string;
  savedAnalysis: StockAnalysis | null;
}

function closePrices(history: Record<string, unknown>[]): number[] {
  return history.map(h => Number(h.close)).filter(v => !isNaN(v));
}
function sma(arr: number[], period: number): number | null {
  if (arr.length < period) return null;
  return arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
}
function ema(arr: number[], period: number): number | null {
  if (arr.length < period) return null;
  const src = [...arr].reverse();
  const k = 2 / (period + 1);
  let e = src.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < src.length; i++) e = src[i] * k + e * (1 - k);
  return e;
}
function rsiCalc(arr: number[], period = 14): number | null {
  if (arr.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = arr[i] - arr[i + 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}
function periodRet(arr: number[], days: number): number | null {
  if (arr.length <= days) return null;
  const past = arr[days];
  return past ? ((arr[0] - past) / past) * 100 : null;
}

function ScoreGauge({ score, max, label, color }: { score: number; max: number; label: string; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
        <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }} className="num">{score}<span style={{ color: "var(--sr-text-3)", fontWeight: 400 }}>/{max}</span></span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${(score / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

const SC = { value: "#3B82F6", health: "var(--sr-pos)", momentum: "var(--sr-amber)", growth: "#8B5CF6" };
function totalColor(v: number) {
  return v >= 80 ? "var(--sr-pos)" : v >= 65 ? "#34D399" : v >= 50 ? "var(--sr-warn)" : v >= 35 ? "#FB923C" : "var(--sr-neg)";
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const mn = Math.min(...points), mx = Math.max(...points), rng = mx - mn || 1;
  const W = 160, H = 32;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map(v => H - ((v - mn) / rng) * H);
  const d  = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={3} fill={color} />
    </svg>
  );
}

export default function StockOverview({ data, macro, scores, icScore, rating, macroTilt, loading, ticker, savedAnalysis }: Props) {
  // Shared with the answer-first Verdict bar — same holding period, same call.
  const horizon = useHorizon();

  const profile = data?.profile;
  const metrics = data?.metrics;
  const ratios  = data?.ratios;
  const quote   = data?.quote;

  // Instrument routing — metals/bonds/broad ETFs are read by momentum + regime, not P/E.
  const instr = classifyInstrument(ticker, profile ? {
    isEtf: Boolean(profile.isEtf ?? profile.isFund),
    sector: profile.sector as string | undefined,
    industry: profile.industry as string | undefined,
  } : null);

  const [scoreHistory, setScoreHistory] = useState<{ date: string; score: number }[]>([]);
  const [sectorPeers, setSectorPeers] = useState<{ ticker: string; score: number; date: string }[]>([]);

  useEffect(() => {
    supabase.from("sl_analyses")
      .select("analysis_date, score_total, macro_tilt")
      .eq("ticker", ticker.toUpperCase())
      .order("analysis_date", { ascending: true })
      .limit(30)
      .then(({ data: rows }) => {
        if (rows) setScoreHistory(rows.map(r => ({
          date: r.analysis_date as string,
          score: Number(r.score_total) + Number(r.macro_tilt ?? 0),
        })));
      });
  }, [ticker]);

  useEffect(() => {
    const sector = data?.profile?.sector as string | undefined;
    if (!sector) return;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    supabase.from("sl_analyses")
      .select("ticker, analysis_date, score_total, macro_tilt")
      .eq("sector", sector)
      .gte("analysis_date", thirtyDaysAgo)
      .order("analysis_date", { ascending: false })
      .limit(200)
      .then(({ data: rows }) => {
        if (!rows) return;
        const seen = new Set<string>();
        const deduped: { ticker: string; score: number; date: string }[] = [];
        for (const row of rows) {
          if (!seen.has(row.ticker as string)) {
            seen.add(row.ticker as string);
            deduped.push({
              ticker: row.ticker as string,
              score: Number(row.score_total) + Number(row.macro_tilt ?? 0),
              date: row.analysis_date as string,
            });
          }
        }
        setSectorPeers(deduped);
      });
  }, [data?.profile?.sector]);

  const cl    = !loading && data ? closePrices(data.history)    : [];
  const spyCl = !loading && data ? closePrices(data.spyHistory) : [];
  const price = quote?.price != null ? Number(quote.price) : null;

  const rsi14  = rsiCalc(cl, 14);
  const sma50  = sma(cl, 50);
  const sma200 = sma(cl, 200);
  const ema12  = ema(cl, 12);
  const ema26  = ema(cl, 26);
  const macd   = ema12 != null && ema26 != null ? ema12 - ema26 : null;
  const ret3m  = periodRet(cl, 63);
  const ret6m  = periodRet(cl, 126);
  const spyRet = periodRet(spyCl, 126);
  const alpha6m = ret6m != null && spyRet != null ? ret6m - spyRet : null;
  const vs50   = sma50  != null && price != null ? ((price - sma50)  / sma50)  * 100 : null;
  const vs200  = sma200 != null && price != null ? ((price - sma200) / sma200) * 100 : null;

  function rc(v: number) { return v > 0 ? "var(--sr-pos)" : v < 0 ? "var(--sr-neg)" : "var(--sr-text-3)"; }

  const n = (v: unknown, d = 2, s = ""): string => {
    if (v == null || isNaN(Number(v))) return "—";
    return `${Number(v).toFixed(d)}${s}`;
  };

  return (
    <div className="animate-fade-in">
      {/* Answer-first: the move, decomposed, before any of the deeper panels. */}
      <WhyMoved data={data} loading={loading} ticker={ticker} />

      {/* Previous analysis banner */}
      {savedAnalysis && !loading && (
        <div style={{
          display: "flex", alignItems: "center", gap: "var(--sr-sp-4)",
          padding: "var(--sr-sp-2) var(--sr-sp-4)", marginBottom: "var(--sr-sp-4)",
          borderRadius: "var(--sr-radius)",
          background: "var(--sr-surface-2)",
          border: "1px solid var(--sr-border)",
          fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)",
          flexWrap: "wrap",
        }}>
          <span>Último análisis guardado:</span>
          <span style={{ color: "var(--sr-text-2)", fontWeight: 600 }}>
            {new Date(savedAnalysis.analysis_date).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
          <span style={{ color: savedAnalysis.rating === "STRONG BUY" ? "var(--sr-pos)" : savedAnalysis.rating?.includes("BUY") ? "#34D399" : savedAnalysis.rating?.includes("SELL") ? "var(--sr-neg)" : "var(--sr-warn)", fontWeight: 700 }}>
            {savedAnalysis.rating ?? "—"}
          </span>
          <span className="num" style={{ color: "var(--sr-text-2)" }}>
            Score: <strong>{savedAnalysis.score_total}</strong>
            {savedAnalysis.macro_tilt != null && savedAnalysis.macro_tilt !== 0 && (
              <span style={{ color: Number(savedAnalysis.macro_tilt) > 0 ? "var(--sr-pos)" : "var(--sr-neg)", marginLeft: 4 }}>
                {Number(savedAnalysis.macro_tilt) > 0 ? "+" : ""}{savedAnalysis.macro_tilt} macro
              </span>
            )}
          </span>
          {icScore != null && (
            <span className="num" style={{ color: "var(--sr-text-3)", marginLeft: "auto" }}>
              vs current: <strong style={{ color: icScore >= savedAnalysis.score_total + (savedAnalysis.macro_tilt ?? 0) ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                {icScore.toFixed(0)}
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Macro context */}
      {(macro || loading) && (
        <div style={{
          marginBottom: "var(--sr-sp-5)", padding: "var(--sr-sp-4) var(--sr-sp-5)",
          borderRadius: "var(--sr-radius-lg)",
          background: macroTilt ? `color-mix(in srgb, ${macroTilt.color} 6%, var(--sr-surface))` : "var(--sr-surface)",
          border: macroTilt ? `1px solid color-mix(in srgb, ${macroTilt.color} 25%, var(--sr-border))` : "1px solid var(--sr-border)",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sr-sp-4)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-2)" }}>
                <div className="section-label" style={{ margin: 0 }}>Macro Context</div>
                {loading ? <Sk w={80} h={18} /> : macro?.regime_label && (
                  <Pill label={macro.regime_label} color={
                    macro.regime_id === "expansion" ? "var(--sr-pos)" :
                    macro.regime_id === "contraction" || macro.regime_id === "stagflation" ? "var(--sr-neg)" : "var(--sr-warn)"
                  } />
                )}
              </div>
              {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><Sk w="90%" h={14} /><Sk w="75%" h={14} /></div>
              ) : macroTilt ? (
                <div>
                  <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-2)" }}>
                    <strong style={{ color: macroTilt.color }}>{profile?.sector ? `${profile.sector as string} sector` : "This position"}</strong>
                    {" — macro tilt is "}<strong style={{ color: macroTilt.color }}>{macroTilt.label}</strong>
                    {macroTilt.tilt !== 0 && <span className="num"> ({macroTilt.tilt > 0 ? "+" : ""}{macroTilt.tilt} pts)</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
                    {macroTilt.reasons.map((r, i) => (
                      <span key={i} style={{ fontSize: "var(--sr-t-xs)", padding: "3px 8px", borderRadius: "var(--sr-radius-pill)", background: "var(--sr-surface-2)", color: "var(--sr-text-2)" }}>{r}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexShrink: 0 }}>
              {[
                { label: "IC Score",  val: loading ? null : macro?.ic_score != null ? Number(macro.ic_score).toFixed(1) : null },
                { label: "Rec. Prob", val: loading ? null : macro?.recession_prob != null ? `${Number(macro.recession_prob).toFixed(0)}%` : null },
                { label: "DGS10",     val: loading ? null : macro?.dgs10 != null ? `${Number(macro.dgs10).toFixed(2)}%` : null },
              ].map(({ label, val }) => (
                <div key={label} style={{ textAlign: "center", minWidth: 60 }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 2, whiteSpace: "nowrap" }}>{label}</div>
                  {loading || val == null ? <Sk w={40} h={20} /> : <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 700 }} className="num">{val}</div>}
                </div>
              ))}
            </div>
          </div>
          {!loading && macroTilt && (
            <div style={{ marginTop: "var(--sr-sp-3)", display: "flex", alignItems: "center", gap: "var(--sr-sp-3)" }}>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", width: 80, flexShrink: 0 }}>Macro Tilt</span>
              <div style={{ flex: 1, height: 6, background: "var(--sr-surface-3)", borderRadius: 3, position: "relative" }}>
                <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", width: `${Math.abs(macroTilt.tilt) / 20 * 50}%`, transform: macroTilt.tilt >= 0 ? "none" : "translateX(-100%)", background: macroTilt.color, borderRadius: 3, transition: "width 600ms ease" }} />
                <div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 10, background: "var(--sr-border-2)" }} />
              </div>
              <span style={{ fontSize: "var(--sr-t-xs)", color: macroTilt.color, fontWeight: 700, width: 80, textAlign: "right" }} className="num">
                {macroTilt.tilt > 0 ? "+" : ""}{macroTilt.tilt} pts
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "var(--sr-sp-5)" }}>
        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
          {/* Non-equity (metal / bond / commodity / broad-ETF) → instrument panel, not fundamentals */}
          {!loading && !instr.isEquity && (
            <InstrumentPanel instrument={instr} closes={cl} spyCloses={spyCl} macro={macro} ticker={ticker} />
          )}
          {/* Bond ETF → rates cockpit (duration/convexity + regime rate view + Treasury calc) */}
          {!loading && instr.type === "bond-etf" && (
            <BondCockpit ticker={ticker} macro={macro} price={cl[0] ?? null} />
          )}

          {instr.isEquity && (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="section-label">Scora Score</div>
            {loading ? <Sk w="80px" h={64} /> : (
              <div>
                <div style={{ fontSize: "var(--sr-t-hero)", fontWeight: 700, letterSpacing: "-0.03em", color: icScore != null ? totalColor(icScore) : "var(--sr-text-3)", lineHeight: 1 }} className="num">
                  {icScore?.toFixed(0) ?? "—"}
                </div>
                {rating && <div style={{ marginTop: 6 }}><Pill label={rating.label} color={rating.color} /></div>}
                {scores && macroTilt && macroTilt.tilt !== 0 && (
                  <div style={{ marginTop: 8, fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                    Base: <span className="num">{scores.total}</span>
                    <span style={{ color: macroTilt.color, marginLeft: 4 }}>{macroTilt.tilt > 0 ? "+" : ""}{macroTilt.tilt} macro</span>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {instr.isEquity && (
          <div className="card">
            <div className="section-label">Score Breakdown</div>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>{[0,1,2,3].map(i => <Sk key={i} w="100%" h={28} />)}</div>
            ) : scores ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
                <ScoreGauge score={scores.value}    max={25} label="Value"    color={SC.value} />
                <ScoreGauge score={scores.health}   max={30} label="Health"   color={SC.health} />
                <ScoreGauge score={scores.momentum} max={25} label="Momentum" color={SC.momentum} />
                <ScoreGauge score={scores.growth}   max={20} label="Growth"   color={SC.growth} />
              </div>
            ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No data</div>}
          </div>
          )}

          {/* Trajectory · momentum (Phase 4) — validated: momentum selection pays when correlation is low */}
          {instr.isEquity && !loading && scores && (() => {
            const mom12_1 = cl.length > 252 ? ((cl[21] - cl[252]) / cl[252]) * 100 : null;
            const pc6 = periodRet(cl, 126);
            const tr = trajectoryRating(mom12_1, pc6, scores.growth);
            const pick = stockPickingRegime(macro?.implied_corr ?? null);
            return (
              <div className="card">
                <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)" }}>
                  <div className="section-label" style={{ margin: 0 }}>Trajectory · momentum</div>
                  <span style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: tr.color }} className="num">
                    {tr.score}<span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 400 }}>/100 · {tr.label}</span>
                  </span>
                </div>
                <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${tr.score}%`, background: tr.color }} /></div>
                <div style={{ display: "flex", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-3)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", flexWrap: "wrap" }}>
                  <span>12-1m mom: <strong className="num" style={{ color: mom12_1 != null ? (mom12_1 > 0 ? "var(--sr-pos)" : "var(--sr-neg)") : "var(--sr-text-3)" }}>{mom12_1 != null ? (mom12_1 > 0 ? "+" : "") + mom12_1.toFixed(0) + "%" : "—"}</strong></span>
                  <span>6m: <strong className="num" style={{ color: "var(--sr-text-2)" }}>{pc6 != null ? (pc6 > 0 ? "+" : "") + pc6.toFixed(0) + "%" : "—"}</strong></span>
                  <span>growth: <strong className="num" style={{ color: "var(--sr-text-2)" }}>{scores.growth}/20</strong></span>
                </div>
                <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${pick.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${pick.color} 28%, transparent)`, fontSize: "var(--sr-t-xs)", lineHeight: 1.5 }}>
                  <strong style={{ color: pick.color }}>Stock-picking: {pick.label}</strong>
                  <span style={{ color: "var(--sr-text-3)" }}> — {pick.detail}</span>
                </div>
              </div>
            );
          })()}

          {/* Top-Down Context (A4) — the cascade composed: L1 secular → L2 risk-on → loop → L4 selection + IC ensemble */}
          {instr.isEquity && !loading && scores && (() => {
            const mom12_1 = cl.length > 252 ? ((cl[21] - cl[252]) / cl[252]) * 100 : null;
            const td = topDownContext({
              macro, sector: (data?.profile?.sector as string) ?? null,
              subScores: { value: scores.value, health: scores.health, momentum: scores.momentum, growth: scores.growth },
              mom12_1,
            });
            const toneColor = (t: string) => t === "pos" ? "var(--sr-pos)" : t === "neg" ? "var(--sr-neg)" : t === "warn" ? "var(--sr-warn)" : "var(--sr-text-2)";
            return (
              <div className="card">
                <div className="section-label">Top-down context</div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>{td.summary}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {td.layers.map((L, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--sr-sp-2)" }} title={L.note}>
                      <span className="num" style={{ fontSize: "10px", fontWeight: 700, color: toneColor(L.tone), minWidth: 20 }}>{L.code}</span>
                      <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", minWidth: 62 }}>{L.label}</span>
                      <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 600, color: toneColor(L.tone) }}>{L.value}</span>
                    </div>
                  ))}
                </div>
                {td.ensemble && td.ensemble.contributions.length > 0 && (
                  <div style={{ marginTop: "var(--sr-sp-3)", paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
                    <div className="sr-flex-between" style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>IC-weighted composite · {td.ensemble.regime} corr</span>
                      <span className="num" style={{ fontSize: "var(--sr-t-sm)", fontWeight: 800, color: td.ensemble.color }}>{td.ensemble.composite}/100</span>
                    </div>
                    <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${td.ensemble.composite}%`, background: td.ensemble.color }} /></div>
                    <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 5 }}>
                      Weighted by measured IC: {td.ensemble.contributions.map((c) => `${c.factor} ${(c.weight * 100).toFixed(0)}%`).join(" · ")}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Timeframe reads (2026-07) — the honest multi-timeframe context: structural (macro
              tailwind for sector+factor) → trend (12-1m + relative strength) → timing (reversion).
              Explainability + discipline, not a new alpha score. */}
          {instr.isEquity && !loading && scores && (() => {
            // Single source of the call: `buildVerdict` is the same function behind the
            // answer-first Verdict bar, so the headline and this panel cannot drift into
            // showing two different ratings for the same name.
            const rt = buildVerdict({
              scores,
              icScore,
              regime: (macro?.regime_id as RegimeId) ?? null,
              riskOn: macro?.risk_on != null ? Number(macro.risk_on) : null,
              impliedCorr: macro?.implied_corr != null ? Number(macro.implied_corr) : null,
              sector: (data?.profile?.sector as string) ?? null,
              technicals: deriveTechnicals({
                stockCloses: cl,
                spyCloses: spyCl,
                sectorCloses: closePrices(data?.sectorEtfHistory ?? []),
                price,
              }),
              horizon,
            });
            const tf = rt.timeframes;
            const convColor = rt.conviction === "High" ? "var(--sr-pos)" : rt.conviction === "Medium" ? "var(--sr-warn)" : "var(--sr-text-3)";
            const rows: { k: string; q: string; r: typeof tf.monthly; tk: "monthly" | "weekly" | "daily" }[] = [
              { k: "Monthly", q: "Own it? · macro tailwind", r: tf.monthly, tk: "monthly" },
              { k: "Weekly", q: "Trending & leading?", r: tf.weekly, tk: "weekly" },
              { k: "Daily", q: "Good entry or chasing?", r: tf.daily, tk: "daily" },
            ];
            const barColor = (s: number) => s >= 60 ? "var(--sr-pos)" : s >= 45 ? "var(--sr-warn)" : "var(--sr-neg)";
            const chip = (rat: Rating, small = false) => (
              <span style={{ fontSize: small ? "9px" : "11px", fontWeight: 800, color: RATING_COLOR[rat], padding: small ? "1px 6px" : "2px 9px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${RATING_COLOR[rat]} 15%, transparent)`, whiteSpace: "nowrap" }}>{rat}</span>
            );
            return (
              <div className="card">
                <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)" }}>
                  <div className="section-label" style={{ margin: 0 }}>Rating · top-down</div>
                  <span style={{ fontSize: "10px", fontWeight: 700, color: convColor }}>{rt.conviction} conviction · {rt.convictionPct}%</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-2)", marginBottom: 4 }}>
                  {chip(rt.rating)}
                  <span className="num sr-hint">{rt.directional}/100 directional</span>
                </div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>{tf.summary} <span style={{ color: "var(--sr-text-2)" }}>{rt.note}</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                  {rows.map(({ k, q, r, tk }) => (
                    <div key={k} title={r.reasons.join(" · ")}>
                      <div className="sr-flex-between" style={{ marginBottom: 3 }}>
                        <span style={{ fontSize: "var(--sr-t-xs)" }}><strong style={{ color: "var(--sr-text)" }}>{k}</strong> <span style={{ color: "var(--sr-text-3)" }}>· {q}</span></span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span className="num" style={{ fontSize: "10px", fontWeight: 600, color: "var(--sr-text-3)" }}>{r.score}</span>
                          {chip(rt.perTimeframe[tk], true)}
                        </span>
                      </div>
                      <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${r.score}%`, background: barColor(r.score) }} /></div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-3)", lineHeight: 1.5 }}>
                  No &quot;Hold&quot; by design — every name gets a directional call; conviction (not a neutral label) carries the honesty. Monthly gates the call; daily is a reversion/entry filter. The full-score cross-sectional IC is ~0, so the direction leans on the trend + regime reads, not the raw score.
                </div>
              </div>
            );
          })()}

          {/* AI thesis (Phase 6) — grounded per-name, cites only real metrics */}
          {instr.isEquity && !loading && scores && (() => {
            const mom12_1 = cl.length > 252 ? ((cl[21] - cl[252]) / cl[252]) * 100 : null;
            const traj = trajectoryRating(mom12_1, periodRet(cl, 126), scores.growth).score;
            const num = (v: unknown) => (typeof v === "number" && !isNaN(v) ? v : null);
            return (
              <StockThesis
                macro={macro}
                input={{
                  ticker,
                  sector: (data?.profile?.sector as string) ?? null,
                  icScore,
                  scores: { value: scores.value, health: scores.health, momentum: scores.momentum, growth: scores.growth },
                  trajectory: traj,
                  mom12_1,
                  pe: num(metrics?.peRatioTTM),
                  pb: num(metrics?.priceToBookRatioTTM),
                  pfcf: num(metrics?.priceToFreeCashFlowsRatioTTM),
                  macroTilt: macroTilt?.tilt ?? null,
                  rating: rating?.label ?? null,
                }}
              />
            );
          })()}

          {instr.isEquity && <EarningsTone ticker={ticker} />}

          {scoreHistory.length >= 2 && (
            <div className="card">
              <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
                <div className="section-label" style={{ margin: 0 }}>Score History</div>
                <span className="sr-hint">{scoreHistory.length} sessions</span>
              </div>
              <Sparkline points={scoreHistory.map(h => h.score)} color="var(--sr-amber)" />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span className="sr-hint">{scoreHistory[0]?.date?.slice(0, 10)}</span>
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)" }} className="num">
                  {scoreHistory[scoreHistory.length - 1]?.score?.toFixed(0)}
                </span>
              </div>
            </div>
          )}

          {/* Score Track Record — did past scores precede gains? Forward return from
              each analysis date to the latest close, computed from price history ($0). */}
          {!loading && scoreHistory.length >= 2 && cl.length > 0 && (() => {
            const dated = (data?.history ?? [])
              .map(h => ({ date: String(h.date ?? "").slice(0, 10), close: Number(h.close) }))
              .filter(h => h.date && !isNaN(h.close))
              .sort((a, b) => a.date.localeCompare(b.date));
            if (dated.length < 2) return null;
            const latestClose = dated[dated.length - 1].close;
            // Closest close on-or-before a given date.
            const closeAt = (d: string): number | null => {
              let found: number | null = null;
              for (const row of dated) { if (row.date <= d) found = row.close; else break; }
              return found;
            };
            const rows = scoreHistory
              .map(h => {
                const c = closeAt(h.date);
                const fwd = c != null && c > 0 ? ((latestClose - c) / c) * 100 : null;
                return { date: h.date.slice(0, 10), score: h.score, fwd };
              })
              .filter(r => r.fwd != null)
              .slice(-6);
            if (rows.length < 2) return null;
            // Simple hit-rate signal: of scores >= 60, how many had positive forward return?
            const highs = rows.filter(r => r.score >= 60);
            const hits = highs.filter(r => (r.fwd ?? 0) > 0).length;
            return (
              <div className="card">
                <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)" }}>
                  <div className="section-label" style={{ margin: 0 }}>Score Track Record</div>
                  {highs.length > 0 && (
                    <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: hits >= highs.length / 2 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                      {hits}/{highs.length} BUY→up
                    </span>
                  )}
                </div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
                  Forward price return from each analysis to today
                </div>
                {rows.map(r => (
                  <div key={r.date} className="stat-row" style={{ padding: "3px 0" }}>
                    <span className="sr-hint num">{r.date}</span>
                    <span style={{ display: "flex", gap: "var(--sr-sp-3)", alignItems: "center" }}>
                      <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: totalColor(r.score) }} className="num">{r.score.toFixed(0)}</span>
                      <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, width: 52, textAlign: "right", color: (r.fwd ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                        {(r.fwd ?? 0) >= 0 ? "+" : ""}{(r.fwd ?? 0).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}

          <div className="card">
            <div className="section-label">Quick Info</div>
            {[
              { label: "Sector",     val: profile?.sector as string },
              { label: "Industry",   val: profile?.industry as string },
              { label: "Exchange",   val: (quote?.exchange as string) ?? (profile?.exchangeShortName as string) },
              { label: "Market Cap", val: quote?.marketCap != null ? `$${((quote.marketCap as number)/1e9).toFixed(1)}B` : null },
              { label: "Beta (5Y)",  val: n(quote?.beta ?? profile?.beta) },
              { label: "IPO Date",   val: profile?.ipoDate as string },
            ].map(({ label, val }) => (
              <div key={label} className="stat-row">
                <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>{label}</span>
                {loading ? <Sk w={70} h={14} /> : <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 500 }}>{val ?? "—"}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Right */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
          <div className="card">
            <div className="section-label">Key Metrics (TTM)</div>
            <div className="sr-grid-4">
              {[
                { label: "P/E",             val: n(metrics?.peRatioTTM, 1) },
                { label: "EV/EBITDA",       val: n(metrics?.enterpriseValueOverEBITDATTM, 1) },
                { label: "P/FCF",           val: n(metrics?.priceToFreeCashFlowsRatioTTM, 1) },
                { label: "Gross Margin",    val: n(ratios?.grossProfitMarginTTM != null ? Number(ratios.grossProfitMarginTTM)*100 : null, 1, "%") },
                { label: "ROIC",            val: n(metrics?.roicTTM != null ? Number(metrics.roicTTM)*100 : null, 1, "%") },
                { label: "ROE",             val: n(metrics?.roeTTM  != null ? Number(metrics.roeTTM)*100  : null, 1, "%") },
                { label: "Net Debt/EBITDA", val: n(metrics?.netDebtToEBITDATTM, 2) },
                { label: "Interest Cov.",   val: n(ratios?.interestCoverageTTM, 1) },
                { label: "FCF Yield",       val: n(metrics?.freeCashFlowYieldTTM != null ? Number(metrics.freeCashFlowYieldTTM)*100 : null, 1, "%") },
                { label: "P/Book",          val: n(metrics?.priceToBookRatioTTM, 1) },
                { label: "Div. Yield",      val: n(metrics?.dividendYieldTTM != null ? Number(metrics.dividendYieldTTM)*100 : null, 2, "%") },
                { label: "EV/Revenue",      val: n(metrics?.evToSalesTTM, 1) },
              ].map(({ label, val }) => (
                <div key={label} className="sr-tile">
                  <div className="sr-tile-label">{label}</div>
                  {loading ? <Sk w={40} h={18} /> : <div style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }} className="num">{val}</div>}
                </div>
              ))}
            </div>
          </div>

          {!loading && quote?.price != null && (() => {
            const p52 = Number(quote.price), low52 = quote.yearLow != null ? Number(quote.yearLow) : null, high52 = quote.yearHigh != null ? Number(quote.yearHigh) : null;
            return (
              <div className="card">
                <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)" }}>
                  <div className="section-label" style={{ margin: 0 }}>52-Week Range</div>
                  <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">${p52.toFixed(2)}</span>
                </div>
                {low52 != null && high52 != null && (
                  <>
                    <div style={{ position: "relative", height: 8, background: "var(--sr-surface-3)", borderRadius: 4 }}>
                      {(() => {
                        const pct = Math.max(0, Math.min(100, ((p52 - low52) / (high52 - low52)) * 100));
                        return <div style={{ position: "absolute", left: `${pct}%`, top: -2, width: 12, height: 12, borderRadius: "50%", background: "var(--sr-amber)", transform: "translateX(-50%)", boxShadow: "0 0 6px var(--sr-amber)" }} />;
                      })()}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                      <span className="sr-hint num">${low52.toFixed(2)}</span>
                      <span className="sr-hint num">${high52.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* Technical Signals */}
          <div className="card">
            <div className="section-label">Technical Signals</div>
            {loading || !cl.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-3)" }}>
                {[0,1,2,3,4,5].map(i => <Sk key={i} w="100%" h={52} />)}
              </div>
            ) : (
              <>
                <div className="sr-grid-3">
                  {/* RSI 14 */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">RSI (14)</div>
                    {rsi14 != null ? (
                      <>
                        <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rsi14 > 70 ? "var(--sr-neg)" : rsi14 < 30 ? "var(--sr-pos)" : "var(--sr-warn)" }} className="num">{rsi14.toFixed(1)}</div>
                        <div style={{ fontSize: "var(--sr-t-xs)", color: rsi14 > 70 ? "var(--sr-neg)" : rsi14 < 30 ? "var(--sr-pos)" : "var(--sr-warn)", fontWeight: 600, marginTop: 2 }}>
                          {rsi14 > 70 ? "Overbought" : rsi14 < 30 ? "Oversold" : "Neutral"}
                        </div>
                      </>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>

                  {/* vs SMA50 */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">vs SMA 50</div>
                    {vs50 != null ? (
                      <>
                        <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(vs50) }} className="num">{vs50 >= 0 ? "+" : ""}{vs50.toFixed(1)}%</div>
                        <div style={{ fontSize: "var(--sr-t-xs)", color: rc(vs50), fontWeight: 600, marginTop: 2 }}>{vs50 >= 0 ? "Above" : "Below"} SMA50</div>
                      </>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>

                  {/* vs SMA200 */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">vs SMA 200</div>
                    {vs200 != null ? (
                      <>
                        <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(vs200) }} className="num">{vs200 >= 0 ? "+" : ""}{vs200.toFixed(1)}%</div>
                        <div style={{ fontSize: "var(--sr-t-xs)", color: rc(vs200), fontWeight: 600, marginTop: 2 }}>{vs200 >= 0 ? "Uptrend" : "Downtrend"}</div>
                      </>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>

                  {/* MACD */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">MACD (12/26)</div>
                    {macd != null ? (
                      <>
                        <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(macd) }} className="num">{macd >= 0 ? "+" : ""}{macd.toFixed(2)}</div>
                        <div style={{ fontSize: "var(--sr-t-xs)", color: rc(macd), fontWeight: 600, marginTop: 2 }}>{macd >= 0 ? "Bullish" : "Bearish"}</div>
                      </>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>

                  {/* 3M Return */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">3M Return</div>
                    {ret3m != null ? (
                      <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(ret3m) }} className="num">{ret3m >= 0 ? "+" : ""}{ret3m.toFixed(1)}%</div>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>

                  {/* 6M Alpha vs SPY */}
                  <div className="sr-tile">
                    <div className="sr-tile-label">6M Alpha vs SPY</div>
                    {alpha6m != null ? (
                      <>
                        <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(alpha6m) }} className="num">{alpha6m >= 0 ? "+" : ""}{alpha6m.toFixed(1)}%</div>
                        <div style={{ fontSize: "var(--sr-t-xs)", color: rc(alpha6m), fontWeight: 600, marginTop: 2 }}>{alpha6m >= 0 ? "Outperforming" : "Underperforming"}</div>
                      </>
                    ) : <div style={{ color: "var(--sr-text-3)" }}>—</div>}
                  </div>
                </div>

                {sma50 != null && sma200 != null && (
                  <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", fontSize: "var(--sr-t-xs)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700, color: sma50 > sma200 ? "var(--sr-pos)" : "var(--sr-neg)" }}>
                      {sma50 > sma200 ? "Golden Cross" : "Death Cross"}
                    </span>
                    <span style={{ color: "var(--sr-text-3)" }}>
                      SMA50 ${sma50.toFixed(2)} {sma50 > sma200 ? ">" : "<"} SMA200 ${sma200.toFixed(2)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sector Context — requires ≥3 peers */}
          {sectorPeers.length >= 3 && icScore != null && (() => {
            const currentScore = icScore;
            const sorted = [...sectorPeers].sort((a, b) => a.score - b.score);
            const n = sorted.length;
            const medIdx = Math.floor(n / 2);
            const median = sorted[medIdx].score;
            const rank = sorted.filter(p => p.score <= currentScore).length;
            const pct = Math.round((rank / n) * 100);
            const pctColor = pct >= 75 ? "var(--sr-pos)" : pct >= 50 ? "var(--sr-warn)" : pct >= 25 ? "#FB923C" : "var(--sr-neg)";
            const sector = data?.profile?.sector as string;

            // Histogram: 5 buckets 0-20, 20-40, 40-60, 60-80, 80-100
            const buckets = [0, 20, 40, 60, 80, 100];
            const hist = buckets.slice(0, -1).map((lo, i) => ({
              lo, hi: buckets[i + 1],
              count: sorted.filter(p => p.score >= lo && p.score < buckets[i + 1]).length,
            }));
            const maxCount = Math.max(...hist.map(b => b.count), 1);
            const currentBucket = hist.findIndex(b => currentScore >= b.lo && currentScore < b.hi);

            return (
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-4)" }}>
                  <div>
                    <div className="section-label" style={{ margin: 0 }}>Sector Context</div>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
                      {sector} · {n} analyzed in last 30d
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: pctColor }} className="num">
                      {pct}th pct.
                    </div>
                    <div className="sr-hint">vs sector</div>
                  </div>
                </div>

                {/* Distribution histogram */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 40, marginBottom: "var(--sr-sp-2)" }}>
                  {hist.map((b, i) => (
                    <div key={b.lo} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <div style={{
                        width: "100%",
                        height: `${Math.max(4, (b.count / maxCount) * 36)}px`,
                        borderRadius: "2px 2px 0 0",
                        background: i === currentBucket
                          ? pctColor
                          : "var(--sr-surface-3)",
                        transition: "height 400ms ease",
                        position: "relative",
                      }}>
                        {i === currentBucket && (
                          <div style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)", fontSize: 8, color: pctColor, fontWeight: 700, marginBottom: 2, whiteSpace: "nowrap" }}>
                            ▼ you
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
                  <span className="num">0</span>
                  <span className="num">20</span>
                  <span className="num">40</span>
                  <span className="num">60</span>
                  <span className="num">80</span>
                  <span className="num">100</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-2)", fontSize: "var(--sr-t-xs)" }}>
                  {[
                    { label: "Your Score",    val: currentScore.toFixed(0), color: pctColor },
                    { label: "Sector Median", val: median.toFixed(0), color: "var(--sr-text-2)" },
                    { label: "vs Median",     val: `${currentScore - median >= 0 ? "+" : ""}${(currentScore - median).toFixed(0)}`, color: (currentScore - median) > 0 ? "var(--sr-pos)" : "var(--sr-neg)" },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-2) var(--sr-sp-3)" }}>
                      <div style={{ color: "var(--sr-text-3)", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 700, color, fontSize: "var(--sr-t-sm)" }} className="num">{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {profile?.description != null && !loading && (
            <div className="card">
              <div className="section-label">About</div>
              <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.7 }}>
                {String(profile.description).length > 400 ? String(profile.description).slice(0, 400) + "…" : String(profile.description)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
