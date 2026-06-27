"use client";
import { useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores } from "@/lib/types";
import { authedFetch } from "@/lib/proxy";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";
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
  const grossMargin = (ratios?.grossProfitMarginTTM as number ?? 0) * 100;
  const roic = (metrics?.roicTTM as number ?? 0) * 100;
  const netMargin = (ratios?.netProfitMarginTTM as number ?? 0) * 100;
  const interestCov = ratios?.interestCoverageTTM as number ?? 0;

  const demand = Math.min(25, grossMargin > 60 ? 22 : grossMargin > 40 ? 16 : grossMargin > 25 ? 10 : 5);
  const supply = Math.min(25, roic > 20 ? 22 : roic > 12 ? 15 : roic > 7 ? 9 : 4);
  const pricing = Math.min(25, netMargin > 20 ? 22 : netMargin > 12 ? 15 : netMargin > 5 ? 9 : 4);
  const capital = Math.min(25, interestCov > 15 ? 22 : interestCov > 8 ? 15 : interestCov > 3 ? 9 : 4);

  return {
    score: demand + supply + pricing + capital,
    pillars: [
      { name: "Demand Inelasticity", score: demand, detail: `Gross margin: ${grossMargin.toFixed(1)}%` },
      { name: "Supply Barriers",     score: supply, detail: `ROIC: ${roic.toFixed(1)}%` },
      { name: "Pricing Power",       score: pricing, detail: `Net margin: ${netMargin.toFixed(1)}%` },
      { name: "Capital Efficiency",  score: capital, detail: `Interest coverage: ${interestCov.toFixed(1)}x` },
    ],
  };
}

export default function StockResearch({ data, scores, loading, ticker, macro, macroTilt }: Props) {
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  const [earningsAI, setEarningsAI] = useState("");
  const [earningsLoading, setEarningsLoading] = useState(false);

  const [peerQuotes, setPeerQuotes] = useState<Record<string, { price: number; changesPercentage: number }>>({});
  const [peerLoading, setPeerLoading] = useState(false);

  // Lazy-load peer quotes when peers list is available
  const peerList = (data?.peers ?? []).slice(0, 6);
  const peersKey = peerList.join(",");
  const [peersFetched, setPeersFetched] = useState("");

  if (!loading && peerList.length > 0 && peersKey !== peersFetched && !peerLoading) {
    setPeerLoading(true);
    setPeersFetched(peersKey);
    Promise.allSettled(
      peerList.map(p =>
        authedFetch<{ price: number; changesPercentage: number }[]>(`/api/fmp/quote?symbol=${p}`)
          .then(r => ({ p, q: Array.isArray(r) ? r[0] : null }))
      )
    ).then(results => {
      const map: Record<string, { price: number; changesPercentage: number }> = {};
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value.q) map[r.value.p] = r.value.q;
      });
      setPeerQuotes(map);
      setPeerLoading(false);
    }).catch(() => setPeerLoading(false));
  }

  async function generateEarningsAnalysis() {
    if (!data) return;
    setEarningsLoading(true);
    const income = data.income.slice(0, 4);
    const eps = data.earningsSurprises.slice(0, 4);
    const prompt = `You are a sell-side analyst. Analyze the recent earnings trend for ${data.profile?.companyName ?? ticker} (${ticker}).

Last 4 quarters of income statement:
${income.map(q => `${String(q.date ?? "").slice(0,7)}: Revenue ${Number(q.revenue ?? 0) >= 1e9 ? `$${(Number(q.revenue)/1e9).toFixed(2)}B` : `$${(Number(q.revenue)/1e6).toFixed(0)}M`}, Net Income ${Number(q.netIncome ?? 0) >= 1e9 ? `$${(Number(q.netIncome)/1e9).toFixed(2)}B` : `$${(Number(q.netIncome)/1e6).toFixed(0)}M`}, EPS $${Number(q.eps ?? 0).toFixed(2)}, Gross Margin ${q.grossProfitRatio != null ? ((q.grossProfitRatio as number)*100).toFixed(1) : "N/A"}%`).join("\n")}

EPS surprises (actual vs estimate):
${eps.map((e: Record<string, unknown>) => `${String(e.date ?? "").slice(0,7)}: Actual $${Number(e.actual ?? 0).toFixed(2)} vs Est $${Number(e.estimated ?? e.estimate ?? 0).toFixed(2)} (${e.actualEarningResultDifference != null ? (Number(e.actualEarningResultDifference) > 0 ? "BEAT" : "MISS") : ""})`).join("\n")}

Provide a concise earnings quality analysis (2-3 paragraphs): revenue trend, margin trajectory, EPS beat/miss pattern, and key risk or catalyst for next quarter.`;

    try {
      const res = await authedFetch<{ content: string }>("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ prompt, maxTokens: 600 }),
      });
      setEarningsAI(res.content ?? "");
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

      const res = await authedFetch<{ content: string }>("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ prompt, maxTokens: 1000 }),
      });
      setAiVerdict(res.content ?? "No response generated.");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
    }
    setAiLoading(false);
  }

  const bullSignals: string[] = [];
  const bearSignals: string[] = [];

  if (!loading && metrics && ratios) {
    const gm = (ratios?.grossProfitMarginTTM as number ?? 0) * 100;
    const roic = (metrics?.roicTTM as number ?? 0) * 100;
    const netDebtEbitda = metrics?.netDebtToEBITDATTM as number ?? 0;
    const pe = metrics?.peRatioTTM as number ?? 0;
    const intCov = ratios?.interestCoverageTTM as number ?? 0;

    if (gm > 50) bullSignals.push(`Gross margin ${gm.toFixed(1)}% — strong pricing power`);
    if (roic > 20) bullSignals.push(`ROIC ${roic.toFixed(1)}% — deep moat (Escudero framework)`);
    if (netDebtEbitda < 0) bullSignals.push("Net cash balance sheet — fortress");
    if (intCov > 15) bullSignals.push(`Interest coverage ${intCov.toFixed(0)}x — zero financing risk`);
    if ((scores?.momentum ?? 0) > 18) bullSignals.push("Strong price momentum — trend confirmation");

    if (pe > 50) bearSignals.push(`Premium P/E ${pe.toFixed(0)}x — requires flawless execution`);
    if (netDebtEbitda > 3) bearSignals.push(`High leverage Net Debt/EBITDA ${netDebtEbitda.toFixed(1)}x`);
    if (gm < 25) bearSignals.push("Thin gross margins — pricing vulnerability");
    if (roic < 8) bearSignals.push("Low ROIC — weak capital allocation");
    if ((scores?.momentum ?? 0) < 8) bearSignals.push("Weak price momentum — not confirming bull case");
    if (macroTilt && macroTilt.tilt < -5) bearSignals.push(`Macro headwind: ${macroTilt.label}`);
  }

  return (
    <div className="animate-fade-in">
      {/* ── AI EARNINGS ANALYSIS ─────────────────────────────── */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
          <div>
            <div className="section-label">AI Earnings Analysis</div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>Claude Sonnet — last 4 quarters revenue, EPS & beat/miss pattern</div>
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
          <div style={{ fontSize: "var(--sr-t-sm)", lineHeight: 1.8, color: "var(--sr-text-2)", whiteSpace: "pre-wrap", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-4)" }}>
            {earningsAI}
          </div>
        ) : (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", textAlign: "center", padding: "var(--sr-sp-6) 0" }}>
            Click to generate AI earnings quality analysis based on recent quarterly data.
          </div>
        )}
      </div>

      {/* ── PEERS ────────────────────────────────────────────── */}
      {peerList.length > 0 && (
        <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="section-label">Sector Peers</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "var(--sr-sp-3)" }}>
            {peerList.map(p => {
              const q = peerQuotes[p];
              const pct = q?.changesPercentage ?? 0;
              const isThis = p === ticker;
              return (
                <a key={p} href={`/stock/${p}`} style={{
                  display: "block", padding: "var(--sr-sp-3)",
                  borderRadius: "var(--sr-radius)",
                  background: isThis ? "color-mix(in srgb, var(--sr-amber) 10%, var(--sr-surface-2))" : "var(--sr-surface-2)",
                  border: `1px solid ${isThis ? "color-mix(in srgb, var(--sr-amber) 40%, var(--sr-border))" : "var(--sr-border)"}`,
                  textDecoration: "none",
                }}>
                  <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: isThis ? "var(--sr-amber)" : "var(--sr-text)", marginBottom: 4 }}>{p}</div>
                  {peerLoading ? <Sk w={60} h={12} /> : q ? (
                    <>
                      <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }} className="num">${q.price.toFixed(2)}</div>
                      <div style={{ fontSize: "var(--sr-t-xs)", color: pct >= 0 ? "var(--sr-pos)" : "var(--sr-neg)", fontWeight: 600 }} className="num">
                        {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                      </div>
                    </>
                  ) : <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>—</div>}
                </a>
              );
            })}
          </div>
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
              Claude Sonnet — full context: fundamentals + macro + scoring
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
          <div style={{ fontSize: "var(--sr-t-base)", lineHeight: 1.8, color: "var(--sr-text-2)", whiteSpace: "pre-wrap", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-4)" }}>
            {aiVerdict}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
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
                      <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{p.detail}</span>
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
                  const actRaw = e.actual ?? e.epsActual;
                  const estRaw = e.estimate ?? e.epsEstimated;
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
      {!loading && metrics && ratios && (() => {
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
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>5 factors × 20 pts = 100 max</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sr-sp-3)" }}>
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
                    <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>Valuation vs {sectorName} BM</span>
                    <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: alert.color, marginLeft: 10 }}>{alert.label}</span>
                  </div>
                  {pePrem != null && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>P/E premium: <strong style={{ color: pePrem > 0 ? "var(--sr-neg)" : "var(--sr-pos)" }}>{pePrem > 0 ? "+" : ""}{pePrem.toFixed(0)}%</strong> vs BM {bm_pe}x</div>}
                  {evPrem != null && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>EV/EBITDA premium: <strong style={{ color: evPrem > 0 ? "var(--sr-neg)" : "var(--sr-pos)" }}>{evPrem > 0 ? "+" : ""}{evPrem.toFixed(0)}%</strong> vs BM {bm_ev}x</div>}
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
