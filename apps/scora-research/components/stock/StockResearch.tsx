"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores, StockAnalysis } from "@/lib/types";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";
import { GroundedBadge } from "@/components/ui/GroundedBadge";
import { getRating, calcFactorTilts, SECTOR_PE_BM, SECTOR_EV_BM } from "@/lib/scoring";

interface Props {
  data: StockData | null;
  scores: Scores | null;
  loading: boolean;
  ticker: string;
  macro: MacroState | null;
  macroTilt: { tilt: number; label: string; color: string; reasons: string[] } | null;
}

function computeMoat(metrics: Record<string, unknown> | null, ratios: Record<string, unknown> | null): { score: number; pillars: { name: string; score: number; detail: string }[] } {
  const grossMarginRaw = ratios?.grossProfitMarginTTM != null ? ratios.grossProfitMarginTTM as number : null;
  const roicRaw        = metrics?.roicTTM             != null ? metrics.roicTTM             as number : null;
  const netMarginRaw   = ratios?.netProfitMarginTTM   != null ? ratios.netProfitMarginTTM   as number : null;
  const interestCov    = ratios?.interestCoverageTTM  != null ? ratios.interestCoverageTTM  as number : null;

  const grossMargin = grossMarginRaw != null ? grossMarginRaw * 100 : null;
  const roic        = roicRaw        != null ? roicRaw        * 100 : null;
  const netMargin   = netMarginRaw   != null ? netMarginRaw   * 100 : null;

  const demand  = grossMargin == null ? 4 : Math.min(25, grossMargin > 60 ? 22 : grossMargin > 40 ? 16 : grossMargin > 25 ? 10 : 5);
  const supply  = roic        == null ? 4 : Math.min(25, roic        > 20 ? 22 : roic        > 12 ? 15 : roic        > 7  ? 9  : 4);
  const pricing = netMargin   == null ? 4 : Math.min(25, netMargin   > 20 ? 22 : netMargin   > 12 ? 15 : netMargin   > 5  ? 9  : 4);
  const capital = interestCov == null ? 4 : Math.min(25, interestCov > 15 ? 22 : interestCov > 8  ? 15 : interestCov > 3  ? 9  : 4);

  return {
    score: demand + supply + pricing + capital,
    pillars: [
      { name: "Demand Inelasticity", score: demand,  detail: grossMargin != null ? `Gross margin: ${grossMargin.toFixed(1)}%`        : "Gross margin: N/A" },
      { name: "Supply Barriers",     score: supply,  detail: roic        != null ? `ROIC: ${roic.toFixed(1)}%`                      : "ROIC: N/A" },
      { name: "Pricing Power",       score: pricing, detail: netMargin   != null ? `Net margin: ${netMargin.toFixed(1)}%`            : "Net margin: N/A" },
      { name: "Capital Efficiency",  score: capital, detail: interestCov != null ? `Interest coverage: ${interestCov.toFixed(1)}x`  : "Interest coverage: N/A" },
    ],
  };
}

export default function StockResearch({ data, scores, loading, ticker, macro, macroTilt }: Props) {
  const router = useRouter();
  const [aiVerdict, setAiVerdict] = useState("");
  const [verdictViol, setVerdictViol] = useState<(number | string)[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const [earningsAI, setEarningsAI] = useState("");
  const [earningsViol, setEarningsViol] = useState<(number | string)[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  const [peerScores, setPeerScores] = useState<Record<string, StockAnalysis>>({});
  const [peerLoading, setPeerLoading] = useState(false);

  const peerList = (data?.peers ?? []).slice(0, 8);
  const peersKey = peerList.join(",");

  useEffect(() => {
    if (!peersKey || loading) return;
    setPeerLoading(true);
    supabase
      .from("sl_analyses")
      .select("*")
      .in("ticker", peerList)
      .order("analysis_date", { ascending: false })
      .then(({ data: rows }) => {
        const map: Record<string, StockAnalysis> = {};
        if (rows) (rows as StockAnalysis[]).forEach(a => { if (!map[a.ticker]) map[a.ticker] = a; });
        setPeerScores(map);
        setPeerLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peersKey, loading]);

  async function generateEarningsAnalysis() {
    if (!data) return;
    setEarningsLoading(true);
    const income = data.income.slice(0, 4);
    const eps = data.earningsSurprises.slice(0, 4);
    const prompt = `You are a sell-side analyst. Analyze the recent earnings trend for ${data.profile?.companyName ?? ticker} (${ticker}).

Last 4 quarters of income statement:
${income.map(q => { const gmPct = q.grossProfitRatio != null ? ((q.grossProfitRatio as number)*100).toFixed(1) : (q.grossProfit != null && Number(q.revenue) > 0 ? (Number(q.grossProfit)/Number(q.revenue)*100).toFixed(1) : "N/A"); return `${String(q.date ?? "").slice(0,7)}: Revenue ${Number(q.revenue ?? 0) >= 1e9 ? `$${(Number(q.revenue)/1e9).toFixed(2)}B` : `$${(Number(q.revenue)/1e6).toFixed(0)}M`}, Net Income ${Number(q.netIncome ?? 0) >= 1e9 ? `$${(Number(q.netIncome)/1e9).toFixed(2)}B` : `$${(Number(q.netIncome)/1e6).toFixed(0)}M`}, EPS $${Number(q.eps ?? 0).toFixed(2)}, Gross Margin ${gmPct}%`; }).join("\n")}

EPS surprises (actual vs estimate):
${eps.map((e: Record<string, unknown>) => { const act = e.actual ?? e.actualEarningResult ?? 0; const est = e.estimated ?? e.estimate ?? e.estimatedEarning ?? 0; const diff = e.actualEarningResultDifference ?? (Number(act) - Number(est)); return `${String(e.date ?? e.period ?? "").slice(0,7)}: Actual $${Number(act).toFixed(2)} vs Est $${Number(est).toFixed(2)} (${Number(diff) > 0 ? "BEAT" : Number(diff) < 0 ? "MISS" : ""})`; }).join("\n")}

Provide a concise earnings quality analysis (2-3 paragraphs): revenue trend, margin trajectory, EPS beat/miss pattern, and key risk or catalyst for next quarter.`;

    setEarningsViol([]);
    try {
      const res = await aiAnalyzeAudited(prompt, { module: "earnings-analysis", ticker, dataBlock: prompt, maxTokens: 600 });
      setEarningsAI(res.text); setEarningsViol(res.violations);
    } catch { setEarningsAI("Failed to generate earnings analysis."); }
    setEarningsLoading(false);
  }

  const metrics = data?.metrics;
  const ratios = data?.ratios;
  const profile = data?.profile;
  const earningsSurprises = data?.earningsSurprises ?? [];
  const insiderTrades = data?.insiderTrades ?? [];
  const priceTargets = data?.priceTargets ?? [];

  const moat = !loading && metrics && ratios ? computeMoat(metrics, ratios) : null;
  const moatColor = moat ? moat.score >= 80 ? "#34D399" : moat.score >= 60 ? "var(--sr-pos)" : moat.score >= 40 ? "var(--sr-warn)" : "var(--sr-neg)" : "var(--sr-text-3)";
  const moatLabel = moat ? moat.score >= 85 ? "Exceptional" : moat.score >= 70 ? "Strong" : moat.score >= 55 ? "Moderate" : moat.score >= 40 ? "Thin" : "None" : "—";

  const rating = scores ? getRating(scores.total) : null;

  async function generateVerdict() {
    if (!data || !scores || !macro) return;
    setAiLoading(true);
    setAiError("");
    setVerdictViol([]);
    try {
      const prompt = `You are a senior equity analyst. Provide a comprehensive investment verdict for ${ticker} based on the data below. Write 4-5 paragraphs covering: (1) business quality and moat, (2) financial health, (3) valuation, (4) macro context and risks, (5) final verdict with conviction level.

Company: ${profile?.companyName ?? ticker} | Sector: ${profile?.sector ?? "—"} | Industry: ${profile?.industry ?? "—"}

SCORING:
- Scora Score (micro): ${scores.total}/100 → Rating: ${rating?.label}
- Value: ${scores.value}/25 | Health: ${scores.health}/30 | Momentum: ${scores.momentum}/25 | Growth: ${scores.growth}/20
- Macro Tilt: ${macroTilt?.tilt ?? 0} pts (${macroTilt?.label ?? "Neutral"})

KEY METRICS:
- P/E: ${metrics?.peRatioTTM ?? "—"} | EV/EBITDA: ${metrics?.enterpriseValueOverEBITDATTM ?? "—"}
- Gross Margin: ${ratios?.grossProfitMarginTTM != null ? ((ratios.grossProfitMarginTTM as number)*100).toFixed(1) : "—"}%
- ROIC: ${metrics?.roicTTM != null ? ((metrics.roicTTM as number)*100).toFixed(1) : "—"}%
- Net Debt/EBITDA: ${metrics?.netDebtToEBITDATTM ?? "—"}
- Interest Coverage: ${ratios?.interestCoverageTTM ?? "—"}x

MACRO CONTEXT:
- Regime: ${macro.regime_label ?? "—"} | IC Score: ${macro.ic_score ?? "—"}
- Recession Probability: ${macro.recession_prob ?? "—"}% | Credit Stress: ${macro.credit_stress ?? "—"}
- 10Y Treasury: ${macro.dgs10 ?? "—"}%

Moat score: ${moat?.score ?? "—"}/100 (${moatLabel})

Be specific, analytical, and data-driven. Write in English.`;

      const res = await aiAnalyzeAudited(prompt, { module: "investment-verdict", ticker, dataBlock: prompt, maxTokens: 1000 });
      setAiVerdict(res.text); setVerdictViol(res.violations);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
    }
    setAiLoading(false);
  }

  const bullSignals: string[] = [];
  const bearSignals: string[] = [];

  if (!loading && metrics && ratios) {
    const gm   = ratios?.grossProfitMarginTTM != null ? (ratios.grossProfitMarginTTM  as number) * 100 : null;
    const roic = metrics?.roicTTM             != null ? (metrics.roicTTM              as number) * 100 : null;
    const netDebtEbitda = metrics?.netDebtToEBITDATTM as number ?? 0;
    const pe    = metrics?.peRatioTTM          as number ?? 0;
    const intCov = ratios?.interestCoverageTTM as number ?? 0;

    if (gm != null && gm > 50) bullSignals.push(`Gross margin ${gm.toFixed(1)}% — strong pricing power`);
    if (roic != null && roic > 20) bullSignals.push(`ROIC ${roic.toFixed(1)}% — deep moat (Escudero framework)`);
    if (netDebtEbitda < 0) bullSignals.push("Net cash balance sheet — fortress");
    if (intCov > 15) bullSignals.push(`Interest coverage ${intCov.toFixed(0)}x — zero financing risk`);
    if ((scores?.momentum ?? 0) > 18) bullSignals.push("Strong price momentum — trend confirmation");

    if (pe > 50) bearSignals.push(`Premium P/E ${pe.toFixed(0)}x — requires flawless execution`);
    if (netDebtEbitda > 3) bearSignals.push(`High leverage Net Debt/EBITDA ${netDebtEbitda.toFixed(1)}x`);
    if (gm != null && gm < 25) bearSignals.push("Thin gross margins — pricing vulnerability");
    if (roic != null && roic < 8) bearSignals.push("Low ROIC — weak capital allocation");
    if ((scores?.momentum ?? 0) < 8) bearSignals.push("Weak price momentum — not confirming bull case");
    if (macroTilt && macroTilt.tilt < -5) bearSignals.push(`Macro headwind: ${macroTilt.label}`);
  }

  return (
    <div className="animate-fade-in">
      {/* ── AI EARNINGS ANALYSIS ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div>
            <div className="section-label">AI Earnings Analysis</div>
            <div className="sr-hint">Claude Haiku — last 4 quarters revenue, EPS & beat/miss pattern</div>
          </div>
          <button
            className="btn-primary"
            onClick={generateEarningsAnalysis}
            disabled={earningsLoading || loading || !data}
            style={{ flexShrink: 0 }}
          >
            {earningsLoading ? "Analyzing…" : earningsAI ? "Re-analyze" : "✦ Analyze Earnings"}
          </button>
        </div>
        {earningsLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
            <Sk w="95%" h={14} /><Sk w="80%" h={14} /><Sk w="88%" h={14} />
          </div>
        ) : earningsAI ? (
          <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-4)" }}>
            <GroundedBadge violations={earningsViol} />
            <div style={{ fontSize: "var(--sr-t-sm)", lineHeight: 1.8, color: "var(--sr-text-2)", whiteSpace: "pre-wrap" }}>
              {earningsAI}
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", textAlign: "center", padding: "var(--sr-sp-6) 0" }}>
            Click to generate AI earnings quality analysis based on recent quarterly data.
          </div>
        )}
      </div>

      {/* ── PEER SCORING COMPARISON ──────────────────────────── */}
      {peerList.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <div>
              <div className="section-label">Peer Score Comparison</div>
              <div className="sr-hint">From sl_analyses — run full analysis on each peer to populate</div>
            </div>
          </div>
          {peerLoading ? <Sk w="100%" h={160} /> : (
            <table className="sr-table">
              <thead><tr>
                <th>Ticker</th>
                <th style={{ textAlign: "right" }}>Base Score</th>
                <th style={{ textAlign: "right" }}>Value</th>
                <th style={{ textAlign: "right" }}>Health</th>
                <th style={{ textAlign: "right" }}>Momentum</th>
                <th style={{ textAlign: "right" }}>Growth</th>
                <th>Rating</th>
                <th className="sr-hint">Date</th>
              </tr></thead>
              <tbody>
                {peerList.map(p => {
                  const a = peerScores[p];
                  const isThis = p === ticker;
                  const pRating = a ? getRating(Number(a.score_total)) : null;
                  return (
                    <tr
                      key={p}
                      style={{
                        cursor: isThis ? "default" : "pointer",
                        background: isThis ? "color-mix(in srgb, var(--sr-amber) 6%, transparent)" : undefined,
                      }}
                      onClick={() => !isThis && router.push(`/stock/${p}`)}
                    >
                      <td style={{ fontWeight: 700, color: isThis ? "var(--sr-amber)" : "var(--sr-text)" }}>
                        {p}{isThis && <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 400, color: "var(--sr-text-3)", marginLeft: 4 }}>(this)</span>}
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 700 }} className="num">
                        {a ? Number(a.score_total).toFixed(0) : <span style={{ color: "var(--sr-text-3)" }}>—</span>}
                      </td>
                      <td style={{ textAlign: "right" }} className="num">{a ? Number(a.score_val).toFixed(0) : "—"}</td>
                      <td style={{ textAlign: "right" }} className="num">{a ? Number(a.score_hlth).toFixed(0) : "—"}</td>
                      <td style={{ textAlign: "right" }} className="num">{a ? Number(a.score_mom).toFixed(0) : "—"}</td>
                      <td style={{ textAlign: "right" }} className="num">{a ? Number(a.score_growth).toFixed(0) : "—"}</td>
                      <td>{pRating ? <Pill label={pRating.label} color={pRating.color} /> : <span className="sr-hint">not analyzed</span>}</td>
                      <td className="sr-hint">
                        {a?.analysis_date ? String(a.analysis_date).slice(0, 10) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── AI VERDICT — HERO ─────────────────────────────────── */}
      <div className="card" style={{
        marginBottom: "var(--sr-sp-5)",
        borderColor: aiVerdict ? "color-mix(in srgb, var(--sr-amber) 40%, var(--sr-border))" : "var(--sr-border)",
        background: aiVerdict ? "color-mix(in srgb, var(--sr-amber) 4%, var(--sr-surface))" : "var(--sr-surface)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-4)" }}>
          <div>
            <div className="section-label">AI Investment Verdict</div>
            <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
              Claude Haiku — full context: fundamentals + macro + scoring
            </div>
          </div>
          <button
            className="btn-primary"
            onClick={generateVerdict}
            disabled={aiLoading || loading || !data || !macro}
            style={{ flexShrink: 0 }}
          >
            {aiLoading ? "Analyzing…" : aiVerdict ? "✦ Regenerate" : "✦ Generate Verdict"}
          </button>
        </div>

        {aiError && (
          <div style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-3)" }}>
            {aiError}
          </div>
        )}

        {aiLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
            <Sk w="95%" h={16} /><Sk w="80%" h={16} /><Sk w="90%" h={16} />
            <Sk w="70%" h={16} /><Sk w="85%" h={16} /><Sk w="60%" h={16} />
            <Sk w="88%" h={16} /><Sk w="75%" h={16} />
          </div>
        )}

        {aiVerdict && !aiLoading && (
          <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-4)" }}>
            <GroundedBadge violations={verdictViol} />
            <div style={{ fontSize: "var(--sr-t-base)", lineHeight: 1.8, color: "var(--sr-text-2)", whiteSpace: "pre-wrap" }}>
              {aiVerdict}
            </div>
          </div>
        )}

        {!aiVerdict && !aiLoading && (
          <div style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-text-3)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "var(--sr-sp-3)" }}>✦</div>
            <div style={{ fontSize: "var(--sr-t-sm)" }}>
              Click "Generate Verdict" for a comprehensive AI analysis integrating fundamentals, macro context, and scoring
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* Bull case */}
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--sr-pos) 25%, var(--sr-border))", background: "color-mix(in srgb, var(--sr-pos) 4%, var(--sr-surface))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            <span style={{ fontSize: "1.2rem" }}>🏰</span>
            <div className="section-label" style={{ margin: 0, color: "var(--sr-pos)" }}>Bull Case</div>
          </div>
          {loading ? [0,1,2].map(i => <Sk key={i} w="90%" h={14} />) :
            bullSignals.length === 0
              ? <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>No strong bull signals detected</div>
              : bullSignals.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                  <span style={{ color: "var(--sr-pos)", flexShrink: 0 }}>✓</span>{s}
                </div>
              ))}
        </div>

        {/* Bear case */}
        <div className="card" style={{ borderColor: "color-mix(in srgb, var(--sr-neg) 25%, var(--sr-border))", background: "color-mix(in srgb, var(--sr-neg) 4%, var(--sr-surface))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)" }}>
            <span style={{ fontSize: "1.2rem" }}>⚠️</span>
            <div className="section-label" style={{ margin: 0, color: "var(--sr-neg)" }}>Bear Case / Risks</div>
          </div>
          {loading ? [0,1,2].map(i => <Sk key={i} w="90%" h={14} />) :
            bearSignals.length === 0
              ? <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>No major risk signals detected</div>
              : bearSignals.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                  <span style={{ color: "var(--sr-neg)", flexShrink: 0 }}>✗</span>{s}
                </div>
              ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        {/* Moat scorecard */}
        <div className="card">
          <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <div className="section-label">Quality Moat Scorecard</div>
            {moat && <Pill label={moatLabel} color={moatColor} />}
          </div>
          {loading ? <Sk w="100%" h={160} /> : moat ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
                <span style={{ fontSize: "var(--sr-t-hero)", fontWeight: 700, color: moatColor }} className="num">{moat.score}</span>
                <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>/100</span>
              </div>
              {moat.pillars.map(p => (
                <div key={p.name} style={{ marginBottom: "var(--sr-sp-3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{p.name}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="sr-hint">{p.detail}</span>
                      <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: moatColor }} className="num">{p.score}/25</span>
                    </div>
                  </div>
                  <div className="score-bar-track">
                    <div className="score-bar-fill" style={{ width: `${(p.score / 25) * 100}%`, background: moatColor }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No data</div>}
        </div>

        {/* Earnings surprises */}
        <div className="card">
          <div className="section-label">Earnings Surprises (last 8)</div>
          {loading ? <Sk w="100%" h={160} /> : earningsSurprises.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No earnings data</div>
          ) : (
            <table className="sr-table">
              <thead><tr><th>Period</th><th style={{ textAlign: "right" }}>Actual EPS</th><th style={{ textAlign: "right" }}>Expected</th><th style={{ textAlign: "right" }}>Surprise</th></tr></thead>
              <tbody>
                {earningsSurprises.slice(0, 8).map((e, i) => {
                  const actRaw = e.actual ?? e.epsActual ?? e.actualEarningResult;
                  const estRaw = e.estimate ?? e.epsEstimated ?? e.estimatedEarning;
                  const act = actRaw != null ? Number(actRaw) : null;
                  const est = estRaw != null ? Number(estRaw) : null;
                  const surp = act != null && est != null && !isNaN(act) && !isNaN(est) ? act - est : null;
                  return (
                    <tr key={i}>
                      <td>{(e.period as string) ?? (e.date as string)?.slice(0, 7) ?? "—"}</td>
                      <td style={{ textAlign: "right" }} className="num">{act != null && !isNaN(act) ? act.toFixed(2) : "—"}</td>
                      <td style={{ textAlign: "right" }} className="num">{est != null && !isNaN(est) ? est.toFixed(2) : "—"}</td>
                      <td style={{ textAlign: "right", color: surp == null ? "var(--sr-text-3)" : surp >= 0 ? "var(--sr-pos)" : "var(--sr-neg)", fontWeight: 600 }} className="num">
                        {surp != null ? `${surp >= 0 ? "+" : ""}${surp.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── FACTOR TILT ENGINE ─────────────────────────────────── */}
      {!loading && data && (() => {
        const histCl = (data?.history ?? []).map(h => Number(h.close)).filter(v => !isNaN(v));
        const priceChange1M = histCl.length > 22  ? ((histCl[0] - histCl[22])  / histCl[22])  * 100 : null;
        const priceChange3M = histCl.length > 63  ? ((histCl[0] - histCl[63])  / histCl[63])  * 100 : null;
        const priceChange6M = histCl.length > 126 ? ((histCl[0] - histCl[126]) / histCl[126]) * 100 : null;
        const ft = calcFactorTilts({
          pe: metrics?.peRatioTTM as number ?? null,
          pfcf: metrics?.priceToFreeCashFlowsRatioTTM as number ?? null,
          evEbitda: metrics?.enterpriseValueOverEBITDATTM as number ?? null,
          epsGrowth: ratios?.netIncomeGrowthTTM != null ? (ratios.netIncomeGrowthTTM as number) * 100 : null,
          revenueGrowth: ratios?.revenueGrowthTTM != null ? (ratios.revenueGrowthTTM as number) * 100 : null,
          roic: metrics?.roicTTM != null ? (metrics.roicTTM as number) * 100 : null,
          roe: metrics?.roeTTM != null ? (metrics.roeTTM as number) * 100 : null,
          grossMargin: ratios?.grossProfitMarginTTM != null ? (ratios.grossProfitMarginTTM as number) * 100 : null,
          interestCoverage: ratios?.interestCoverageTTM as number ?? null,
          marketCap: (data?.quote?.marketCap as number) ?? null,
          priceChange1M,
          priceChange3M,
          priceChange6M,
        });
        const factors = [
          { label: "Value",    score: ft.value,    color: "#3B82F6",         note: "Cheap vs peers — P/E, FCF, EV" },
          { label: "Growth",   score: ft.growth,   color: "#8B5CF6",         note: "Revenue & EPS acceleration" },
          { label: "Momentum", score: ft.momentum, color: "var(--sr-amber)", note: "Price trend 1M/3M/6M" },
          { label: "Quality",  score: ft.quality,  color: "var(--sr-pos)",   note: "ROIC, ROE, margins, coverage" },
          { label: "Size",     score: ft.size,     color: "#F97316",         note: "Small-cap factor exposure" },
        ];
        return (
          <div className="card" style={{ marginTop: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sr-sp-4)" }}>
              <div className="section-label" style={{ margin: 0 }}>Factor Tilt Engine</div>
              <span className="sr-hint">5 factors × 20 pts = 100 max</span>
            </div>
            <div className="sr-grid-5">
              {factors.map(f => (
                <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", fontWeight: 600 }}>{f.label.toUpperCase()}</span>
                    <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: f.color }} className="num">{f.score}/20</span>
                  </div>
                  <div className="score-bar-track">
                    <div className="score-bar-fill" style={{ width: `${(f.score / 20) * 100}%`, background: f.color }} />
                  </div>
                  <span style={{ fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.3 }}>{f.note}</span>
                </div>
              ))}
            </div>
            {/* Sector PE/EV bubble check */}
            {(() => {
              const sectorName = profile?.sector as string ?? "";
              const bm_pe = SECTOR_PE_BM[sectorName];
              const bm_ev = SECTOR_EV_BM[sectorName];
              const pe = metrics?.peRatioTTM as number ?? null;
              const ev = metrics?.enterpriseValueOverEBITDATTM as number ?? null;
              if (!bm_pe && !bm_ev) return null;
              const pePrem = pe != null && bm_pe ? ((pe - bm_pe) / bm_pe) * 100 : null;
              const evPrem = ev != null && bm_ev ? ((ev - bm_ev) / bm_ev) * 100 : null;
              const maxPrem = Math.max(pePrem ?? 0, evPrem ?? 0);
              const alert = maxPrem > 75 ? { label: "Bubble Risk", color: "var(--sr-neg)" }
                          : maxPrem > 25 ? { label: "Elevated", color: "var(--sr-warn)" }
                          : maxPrem < -15 ? { label: "Undervalued vs sector", color: "var(--sr-pos)" }
                          : { label: "Fair", color: "var(--sr-text-2)" };
              return (
                <div style={{ marginTop: "var(--sr-sp-4)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", display: "flex", gap: "var(--sr-sp-5)", alignItems: "center" }}>
                  <div>
                    <span className="sr-hint">Valuation vs {sectorName} BM</span>
                    <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: alert.color, marginLeft: 10 }}>{alert.label}</span>
                  </div>
                  {pePrem != null && <div className="sr-hint">P/E premium: <strong style={{ color: pePrem > 0 ? "var(--sr-neg)" : "var(--sr-pos)" }}>{pePrem > 0 ? "+" : ""}{pePrem.toFixed(0)}%</strong> vs BM {bm_pe}x</div>}
                  {evPrem != null && <div className="sr-hint">EV/EBITDA premium: <strong style={{ color: evPrem > 0 ? "var(--sr-neg)" : "var(--sr-pos)" }}>{evPrem > 0 ? "+" : ""}{evPrem.toFixed(0)}%</strong> vs BM {bm_ev}x</div>}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Analyst targets & Insider trades */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginTop: "var(--sr-sp-5)" }}>
        <div className="card">
          <div className="section-label">Analyst Price Targets</div>
          {!loading && data?.analystConsensus && (() => {
            const c = data.analystConsensus!;
            const total = c.strongBuy + c.buy + (c.hold ?? 0) + c.sell + c.strongSell;
            const bullPct = total > 0 ? Math.round((c.strongBuy + c.buy) / total * 100) : 0;
            const bearPct = total > 0 ? Math.round((c.sell + c.strongSell) / total * 100) : 0;
            return (
              <div style={{ marginBottom: "var(--sr-sp-3)" }}>
                <div style={{ display: "flex", gap: "var(--sr-sp-3)", marginBottom: 6, alignItems: "center", fontSize: "var(--sr-t-xs)" }}>
                  {bullPct > 0 && <span><span style={{ fontWeight: 700, color: "var(--sr-pos)" }}>{bullPct}%</span> <span style={{ color: "var(--sr-text-3)" }}>Buy</span></span>}
                  {bearPct > 0 && <span><span style={{ fontWeight: 700, color: "var(--sr-neg)" }}>{bearPct}%</span> <span style={{ color: "var(--sr-text-3)" }}>Sell</span></span>}
                </div>
                <div style={{ height: 4, borderRadius: 2, overflow: "hidden", background: "var(--sr-surface-3)" }}>
                  <div style={{ height: "100%", display: "flex" }}>
                    <div style={{ width: `${bullPct}%`, background: "var(--sr-pos)" }} />
                    <div style={{ width: `${bearPct}%`, background: "var(--sr-neg)" }} />
                  </div>
                </div>
              </div>
            );
          })()}
          {loading ? <Sk w="100%" h={120} /> : priceTargets.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No analyst targets</div>
          ) : (
            <table className="sr-table">
              <thead><tr><th>Analyst</th><th style={{ textAlign: "right" }}>Target</th><th>Action</th></tr></thead>
              <tbody>
                {priceTargets.slice(0, 8).map((t, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{t.analystName as string ?? t.analyst as string ?? "—"}</td>
                    <td style={{ textAlign: "right" }} className="num">{t.priceTarget != null ? `$${Number(t.priceTarget).toFixed(2)}` : "—"}</td>
                    <td style={{ color: "var(--sr-pos)" }}>{t.action as string ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="section-label">Insider Transactions</div>
          {loading ? <Sk w="100%" h={120} /> : insiderTrades.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No insider data</div>
          ) : (
            <table className="sr-table">
              <thead><tr><th>Name</th><th>Type</th><th style={{ textAlign: "right" }}>Value</th></tr></thead>
              <tbody>
                {insiderTrades.slice(0, 8).map((t, i) => {
                  const isBuy = (t.transactionType as string)?.toLowerCase().includes("buy") || (t.transactionCode as string) === "P";
                  return (
                    <tr key={i}>
                      <td style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{t.reportingName as string ?? t.name as string ?? "—"}</td>
                      <td style={{ color: isBuy ? "var(--sr-pos)" : "var(--sr-neg)", fontWeight: 600 }}>{isBuy ? "BUY" : "SELL"}</td>
                      <td style={{ textAlign: "right" }} className="num">
                        {t.transactionPrice != null && t.change != null
                          ? `$${(Number(t.transactionPrice) * Math.abs(Number(t.change)) / 1000).toFixed(0)}K`
                          : "—"}
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
