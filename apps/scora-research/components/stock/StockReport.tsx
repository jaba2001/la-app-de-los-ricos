"use client";
import { useEffect, useMemo, useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores } from "@/lib/types";
import { forwardValuation, footballField, dupont, bubbleGauge, type ValuationResult } from "@/lib/researchReport";
import { trajectoryRating } from "@/lib/microScore";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { buildResearchReport } from "@/lib/aiGrounding";
import { fetchKbCards, selectCards, renderKb, fetchDocChunks, renderDocChunks, type KbCard, type KbDoc } from "@/lib/knowledge";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

interface Props { data: StockData | null; macro: MacroState | null; scores: Scores | null; icScore: number | null; loading: boolean; ticker: string; }

const num = (v: unknown): number | null => { const n = Number(v); return v != null && !isNaN(n) ? n : null; };
const sum4 = (arr: Record<string, unknown>[], key: string) => arr.slice(0, 4).reduce((s, q) => s + (Number(q[key]) || 0), 0);
const fmt = (v: number | null, d = 2, pre = "$") => (v == null ? "—" : `${pre}${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);

function renderMd(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <div key={i} style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)", marginTop: i ? "var(--sr-sp-3)" : 0, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{line.slice(3)}</div>;
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith("**") && p.endsWith("**") ? <strong key={j} style={{ color: "var(--sr-text)" }}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>);
    return <div key={i} style={{ marginBottom: line.trim() ? 3 : 0 }}>{parts}</div>;
  });
}

export default function StockReport({ data, macro, scores, icScore, loading, ticker }: Props) {
  const [note, setNote] = useState("");
  const [noteViol, setNoteViol] = useState<(number | string)[]>([]);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");
  const [cards, setCards] = useState<KbCard[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);

  useEffect(() => { fetchKbCards().then(setCards).catch(() => {}); }, []);
  // A full research note needs balance: what the business is and how it earns, alongside
  // the risks. Broader query and more passages per section than the thesis.
  useEffect(() => {
    fetchDocChunks(ticker, undefined, {
      query: "business segments products customers competition market share revenue growth margin pricing capital expenditure risk factors outlook demand",
      perSection: 4,
    }).then(setDocs).catch(() => setDocs([]));
  }, [ticker]);

  // ── Derive valuation inputs from already-fetched data (zero extra API calls) ──────
  const model = useMemo(() => {
    if (!data) return null;
    const income = data.income ?? [], balance = data.balanceSheet ?? [], cash = data.cashFlow ?? [];
    const revTTM = sum4(income, "revenue");
    const niTTM = sum4(income, "netIncome");
    const fcfTTM = cash.slice(0, 4).reduce((s, q) => s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0);
    let ebitdaTTM = sum4(income, "ebitda");
    if (ebitdaTTM <= 0) ebitdaTTM = sum4(income, "operatingIncome") + Math.abs(sum4(cash, "depreciationAndAmortization"));
    const netDebt = balance[0] ? (Number(balance[0].totalDebt) || 0) - (Number(balance[0].cashAndCashEquivalents) || 0) : 0;
    const price = num(data.quote?.price);
    const marketCap = num(data.quote?.marketCap);
    const shares = num(data.metrics?.weightedAverageSharesOutstandingDilutedTTM) ?? (marketCap != null && price ? marketCap / price : null);
    const beta = num(data.technicals?.beta) ?? num(data.metrics?.beta) ?? 1.0;
    const rf = num(macro?.dgs10) ?? 4.2;
    const evEbitda = num(data.metrics?.enterpriseValueOverEBITDATTM);

    // Near-term growth from analyst revenue estimates, else conservative default.
    const est = data.analystEstimates ?? [];
    const estRev = est.length ? num(est[0].estimatedRevenueAvg ?? est[0].revenueAvg) : null;
    let g1 = 8;
    if (estRev != null && revTTM > 0) g1 = Math.max(-10, Math.min(40, ((estRev - revTTM) / revTTM) * 100));
    const g2 = g1 / 2;

    if (revTTM <= 0 || shares == null || shares <= 0 || price == null) return null;
    const v = forwardValuation({
      currentPrice: price, revenueTTM: revTTM, fcfMarginTTM: fcfTTM / revTTM, ebitdaTTM,
      netDebt, sharesOut: shares, beta, rfRate: rf, creditStress: num(macro?.credit_stress),
      currentEvEbitda: evEbitda, g1, g2,
    });

    // Analyst targets (low/mean/high) from the price-target list.
    const tps = (data.priceTargets ?? []).map((t) => num(t.priceTarget ?? t.adjPriceTarget)).filter((x): x is number => x != null && x > 0);
    const analyst = tps.length ? { low: Math.min(...tps), high: Math.max(...tps), mean: tps.reduce((a, b) => a + b, 0) / tps.length } : { low: null, high: null, mean: null };
    const week52 = { low: num(data.quote?.yearLow) ?? num(data.technicals?.week52Low), high: num(data.quote?.yearHigh) ?? num(data.technicals?.week52High) };

    const dp = dupont(niTTM, revTTM, num(balance[0]?.totalAssets), num(balance[0]?.totalStockholdersEquity ?? balance[0]?.totalEquity));
    const revGrowth = num(data.ratios?.revenueGrowthTTM); // decimal
    const bubble = bubbleGauge(num(data.technicals?.perfYear), revGrowth != null ? revGrowth * 100 : null);
    const field = footballField(v, price, analyst, week52);
    const cl = (data.history ?? []).map((h) => Number(h.close)).filter((x) => !isNaN(x)); // newest-first
    const mom12_1 = cl.length > 252 && cl[252] ? ((cl[21] - cl[252]) / cl[252]) * 100 : null;
    const traj = trajectoryRating(mom12_1, num(data.technicals?.perfHalfYear), scores?.growth ?? 0).score;

    return { v, price, marketCap, analyst, week52, dp, bubble, field, revGrowth, g1,
      pe: num(data.metrics?.peRatioTTM), evEbitda, netDebtEbitda: num(data.metrics?.netDebtToEBITDATTM), traj };
  }, [data, macro, scores]);

  async function generate() {
    if (!data || !model) return;
    setGen(true); setErr(""); setNoteViol([]);
    try {
      const kb = renderKb(selectCards(cards, ["momentum", "stock-picking", "valuation", "edge", "quality"]));
      const filings = renderDocChunks(docs);
      const prompt = buildResearchReport({
        ticker, company: (data.profile?.companyName as string) ?? null, sector: (data.profile?.sector as string) ?? null,
        price: model.price, marketCap: model.marketCap, wacc: model.v.wacc,
        dcfGordon: model.v.dcfGordon, dcfExit: model.v.dcfExit, hingeGapPct: model.v.hingeGapPct,
        analystMean: model.analyst.mean, roe: model.dp.roe, netMargin: model.dp.netMargin,
        revGrowth: model.revGrowth != null ? model.revGrowth * 100 : null,
        pe: model.pe, evEbitda: model.evEbitda, netDebtEbitda: model.netDebtEbitda,
        scoreTotal: icScore, trajectory: model.traj,
      }, kb, filings);
      const sources = [...docs.map((d) => `${d.form} ${d.section}`), ...(kb ? ["kb"] : [])];
      const res = await aiAnalyzeAudited(prompt, { module: "research-report", ticker, dataBlock: prompt, sources, maxTokens: 900 });
      setNote(res.text); setNoteViol(res.violations);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed to generate report"); }
    setGen(false);
  }

  function exportHTML() {
    if (!model) return;
    const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
    const noteHtml = note ? note.split("\n").map((l) => l.startsWith("## ") ? `<h3>${esc(l.slice(3))}</h3>` : l.trim() ? `<p>${esc(l)}</p>` : "").join("") : "<p><em>AI note not generated.</em></p>";
    const rows = model.field.map((r) => `<tr><td>${r.label}</td><td>${fmt(r.lo)}</td><td>${fmt(r.hi)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${ticker} — Scora Research Note</title>
<style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1a1a1a}h1{margin:0}h2{color:#b45309;border-bottom:1px solid #eee;padding-bottom:4px;margin-top:28px}h3{color:#b45309;margin:16px 0 4px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}small{color:#888}</style></head><body>
<h1>${ticker} — Research Note</h1><small>${esc((data?.profile?.companyName as string) ?? "")} · Scora Research · ${new Date().toISOString().slice(0, 10)} · educational, not advice</small>
<h2>Valuation — terminal-multiple hinge</h2>
<table><tr><th>Method</th><th>Intrinsic $/share</th></tr>
<tr><td>DCF · Gordon 2.5% perpetuity</td><td>${fmt(model.v.dcfGordon)}</td></tr>
<tr><td>DCF · exit at today's EV/EBITDA</td><td>${fmt(model.v.dcfExit)}</td></tr>
<tr><td>Gap between terminal methods</td><td>${model.v.hingeGapPct ?? "—"}%</td></tr>
<tr><td>WACC</td><td>${model.v.wacc}%</td></tr>
<tr><td>Current price</td><td>${fmt(model.price)}</td></tr></table>
<h2>Valuation range (football field)</h2><table><tr><th>Method</th><th>Low</th><th>High</th></tr>${rows}</table>
<h2>DuPont ROE</h2><table><tr><td>ROE</td><td>${model.dp.roe != null ? (model.dp.roe * 100).toFixed(1) + "%" : "—"}</td></tr>
<tr><td>Net margin</td><td>${model.dp.netMargin != null ? (model.dp.netMargin * 100).toFixed(1) + "%" : "—"}</td></tr>
<tr><td>Asset turnover</td><td>${model.dp.assetTurnover != null ? model.dp.assetTurnover.toFixed(2) + "×" : "—"}</td></tr>
<tr><td>Equity multiplier</td><td>${model.dp.equityMultiplier != null ? model.dp.equityMultiplier.toFixed(2) + "×" : "—"}</td></tr></table>
<h2>Analyst note</h2>${noteHtml}
</body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = document.createElement("a"); a.href = url; a.download = `${ticker}_scora_research_${new Date().toISOString().slice(0, 10)}.html`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Sk w="100%" h={500} />;
  if (!model) return <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>Not enough financial data to build a research note for {ticker}. (Non-US names, ETFs and metals don&apos;t have a DCF.)</div>;

  const { v, field } = model;
  // Common axis for the football field bars.
  const all = field.flatMap((r) => [r.lo, r.hi]).concat([model.price]);
  const axLo = Math.min(...all) * 0.95, axHi = Math.max(...all) * 1.05, axRange = axHi - axLo || 1;
  const xpos = (p: number) => ((p - axLo) / axRange) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)", animation: "none" }} className="animate-fade-in">
      <div className="sr-flex-between" style={{ flexWrap: "wrap", gap: "var(--sr-sp-3)" }}>
        <div>
          <h2 style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, margin: 0 }}>Research Report</h2>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>Institutional-style initiation note · assembled from data you already fetched. Educational.</div>
        </div>
        <button onClick={exportHTML} style={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)", padding: "6px 12px", cursor: "pointer" }}>↓ Export HTML</button>
      </div>

      {/* ── Terminal-multiple hinge — the differentiator ── */}
      <div className="card">
        <div className="section-label">Terminal-multiple hinge</div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
          A 10-year DCF is dominated by its terminal value — and TV rests on one unprovable choice. We show it <strong style={{ color: "var(--sr-text)" }}>both ways</strong> and the gap. Don&apos;t average them; decide which assumption fits this business.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-3)" }}>
          {[
            { k: "DCF · Gordon 2.5%", val: v.dcfGordon, up: v.gordonUpside, sub: "perpetuity terminal" },
            { k: "DCF · exit multiple", val: v.dcfExit, up: v.exitUpside, sub: "exit at today's EV/EBITDA" },
            { k: "Method gap", val: null, up: null, sub: v.hingeGapPct != null ? `${v.hingeGapPct}% apart` : "—", isGap: true },
          ].map((c) => (
            <div key={c.k} style={{ padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)" }}>
              <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.k}</div>
              {c.isGap ? (
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, color: v.hingeGapPct != null && v.hingeGapPct > 40 ? "var(--sr-warn)" : "var(--sr-text)", marginTop: 4 }} className="num">{v.hingeGapPct != null ? `${v.hingeGapPct}%` : "—"}</div>
              ) : (
                <>
                  <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 800, marginTop: 4 }} className="num">{fmt(c.val, 0)}</div>
                  {c.up != null && <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 600, color: c.up >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{pct(c.up)} vs price</div>}
                </>
              )}
              <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 3 }}>{c.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-3)" }}>WACC {v.wacc}% (CAPM: rf {num(macro?.dgs10)?.toFixed(1) ?? "—"}% + β×ERP). Near-term growth {model.g1.toFixed(0)}% (analyst estimates).</div>
      </div>

      {/* ── Football field ── */}
      <div className="card">
        <div className="section-label">Valuation range · football field</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)", marginTop: "var(--sr-sp-2)" }}>
          {field.map((r) => {
            const color = r.kind === "dcf" ? "var(--sr-amber)" : r.kind === "analyst" ? "var(--sr-accent, #6366f1)" : "var(--sr-text-3)";
            return (
              <div key={r.label}>
                <div className="sr-flex-between" style={{ fontSize: "var(--sr-t-xs)", marginBottom: 3 }}>
                  <span style={{ color: "var(--sr-text-2)" }}>{r.label}</span>
                  <span className="num" style={{ color: "var(--sr-text-3)" }}>{fmt(r.lo, 0)} – {fmt(r.hi, 0)}</span>
                </div>
                <div style={{ position: "relative", height: 10, background: "var(--sr-surface-3)", borderRadius: 5 }}>
                  <div style={{ position: "absolute", left: `${xpos(r.lo)}%`, width: `${Math.max(1, xpos(r.hi) - xpos(r.lo))}%`, top: 0, height: "100%", background: `color-mix(in srgb, ${color} 55%, transparent)`, borderRadius: 5 }} />
                </div>
              </div>
            );
          })}
          {/* current-price marker */}
          <div style={{ position: "relative", height: 16 }}>
            <div style={{ position: "absolute", left: `${xpos(model.price)}%`, top: 0, transform: "translateX(-50%)", fontSize: "10px", color: "var(--sr-text)", fontWeight: 700, whiteSpace: "nowrap" }} className="num">▲ ${model.price.toFixed(0)} now</div>
          </div>
        </div>
      </div>

      {/* ── DuPont + bubble ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--sr-sp-4)" }}>
        <div className="card">
          <div className="section-label">DuPont ROE</div>
          {model.dp.roe != null ? (
            <>
              <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, marginBottom: "var(--sr-sp-2)" }} className="num">{(model.dp.roe * 100).toFixed(1)}<span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>% ROE</span></div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.9 }}>
                <div className="sr-flex-between"><span>Net margin</span><strong className="num">{(model.dp.netMargin! * 100).toFixed(1)}%</strong></div>
                <div className="sr-flex-between"><span>× Asset turnover</span><strong className="num">{model.dp.assetTurnover!.toFixed(2)}×</strong></div>
                <div className="sr-flex-between"><span>× Equity multiplier</span><strong className="num">{model.dp.equityMultiplier!.toFixed(2)}×</strong></div>
              </div>
            </>
          ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>Not available</div>}
        </div>
        <div className="card">
          <div className="section-label">Price vs growth</div>
          <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 800, color: model.bubble.color }}>{model.bubble.label}</div>
          {model.bubble.ratio != null && <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }} className="num">1y price move ÷ revenue growth = {model.bubble.ratio.toFixed(1)}×</div>}
        </div>
      </div>

      {/* ── AI research note (grounded) ── */}
      <div className="card">
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
          <div>
            <div className="section-label" style={{ margin: 0 }}>Analyst note · AI, grounded</div>
            <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>SWOT + bull/base/bear from the computed valuation{docs.length > 0 ? <span style={{ color: "var(--sr-pos)" }}> · cites 10-K</span> : ""}. No invented numbers.</div>
          </div>
          <button className="btn-primary" onClick={generate} disabled={gen} style={{ flexShrink: 0 }}>{gen ? "Writing…" : note ? "Regenerate" : "✦ Write note"}</button>
        </div>
        {err && <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{err}</div>}
        {gen && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{[90, 70, 85, 60, 75].map((w, i) => <Sk key={i} w={`${w}%`} h={13} />)}</div>}
        {note && !gen && (
          <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
            <GroundedBadge violations={noteViol} />
            <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)" }}>{renderMd(note)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
