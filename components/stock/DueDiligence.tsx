"use client";
import { useEffect, useMemo, useState } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import type { MacroState, Scores } from "@/lib/types";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { buildDiligenceModule, MODULE_META, type ModuleKind } from "@/lib/aiGrounding";
import { checkAdvice } from "@/lib/grounding";
import { kelly, MAX_POSITION } from "@/lib/kelly";
import { fetchKbCards, selectCards, renderKb, fetchDocChunks, renderDocChunks, type KbCard, type KbDoc } from "@/lib/knowledge";
import { Sk } from "@/components/ui/Skeleton";

interface Props { data: StockData | null; macro: MacroState | null; scores: Scores | null; icScore: number | null; loading: boolean; ticker: string; }

const ORDER: ModuleKind[] = ["redflags", "moat", "bullbear", "macrosens", "thesisupdate"];
const num = (v: unknown): number | null => { const n = Number(v); return v != null && !isNaN(n) ? n : null; };
const na = (v: number | null, unit = "", d = 1) => (v == null ? "not available" : `${v.toFixed(d)}${unit}`);

function renderMd(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) return <div key={i} style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: "var(--sr-amber)", marginTop: i ? "var(--sr-sp-3)" : 0, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{line.slice(3)}</div>;
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith("**") && p.endsWith("**") ? <strong key={j} style={{ color: "var(--sr-text)" }}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>);
    return <div key={i} style={{ marginBottom: line.trim() ? 3 : 0 }}>{parts}</div>;
  });
}

interface ModState { text: string; violations: (number | string)[]; advice: string[]; loading: boolean; error: string; }
const EMPTY: ModState = { text: "", violations: [], advice: [], loading: false, error: "" };

export default function DueDiligence({ data, macro, scores, icScore, loading, ticker }: Props) {
  const [cards, setCards] = useState<KbCard[]>([]);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [mods, setMods] = useState<Record<string, ModState>>({});
  // Kelly inputs
  const [winProb, setWinProb] = useState(55);
  const [upside, setUpside] = useState(30);
  const [downside, setDownside] = useState(20);

  useEffect(() => { fetchKbCards().then(setCards).catch(() => {}); }, []);
  // Due diligence is looking for what could go wrong, so the retrieval query is weighted
  // to the downside: dependencies, concentration, legal and governance exposure.
  useEffect(() => {
    fetchDocChunks(ticker, undefined, {
      query: "risk factors litigation regulatory investigation dependence concentration single supplier customer covenant debt impairment going concern material weakness governance",
      perSection: 4,
    }).then(setDocs).catch(() => setDocs([]));
  }, [ticker]);

  const dataBlock = useMemo(() => {
    if (!data) return "";
    const m = data.metrics ?? {}, r = data.ratios ?? {}, q = data.quote ?? {};
    const mc = num(q.marketCap);
    const lines = [
      `DATA for ${ticker} (${(data.profile?.sector as string) ?? "sector n/a"}):`,
      `- Price $${na(num(q.price), "", 2)} · market cap ${mc != null ? "$" + (mc / 1e9).toFixed(1) + "B" : "not available"}`,
      `- Scora score ${na(icScore, "/100", 0)} · momentum ${na(num(scores?.momentum), "/25", 0)} · growth ${na(num(scores?.growth), "/20", 0)}`,
      `- Valuation: P/E ${na(num(m.peRatioTTM), "", 1)}, EV/EBITDA ${na(num(m.enterpriseValueOverEBITDATTM), "", 1)}, P/B ${na(num(m.priceToBookRatioTTM), "", 1)}, P/FCF ${na(num(m.priceToFreeCashFlowsRatioTTM), "", 1)}`,
      `- Quality: ROE ${na(num(m.roeTTM) != null ? num(m.roeTTM)! * 100 : null, "%", 0)}, ROIC ${na(num(m.roicTTM) != null ? num(m.roicTTM)! * 100 : null, "%", 0)}, net margin ${na(num(r.netProfitMarginTTM) != null ? num(r.netProfitMarginTTM)! * 100 : null, "%", 0)}, gross margin ${na(num(r.grossProfitMarginTTM) != null ? num(r.grossProfitMarginTTM)! * 100 : null, "%", 0)}`,
      `- Balance: net debt/EBITDA ${na(num(m.netDebtToEBITDATTM), "", 1)}, current ratio ${na(num(r.currentRatioTTM), "", 1)}, interest coverage ${na(num(r.interestCoverageTTM), "", 1)}`,
      `- Growth: revenue ${na(num(r.revenueGrowthTTM) != null ? num(r.revenueGrowthTTM)! * 100 : null, "%", 0)} YoY · 1y price ${na(num(data.technicals?.perfYear), "%", 0)}`,
      `MACRO regime: 10y yield ${na(num(macro?.dgs10), "%", 1)}, DXY ${na(num((macro as unknown as Record<string, unknown>)?.dxy as number), "", 0)}, HY OAS ${na(num(macro?.hy_oas), "bp", 0)}, 10y-3m curve ${na(num(macro?.t10y3m), "", 2)}, recession risk ${na(num(macro?.recession_prob), "", 0)}, risk-on ${na(num(macro?.risk_on), "/100", 0)}, WTI ${na(num((macro as unknown as Record<string, unknown>)?.wti_level as number), "", 0)}`,
    ];
    return lines.join("\n");
  }, [data, macro, scores, icScore, ticker]);

  const k = useMemo(() => kelly(winProb / 100, upside, downside), [winProb, upside, downside]);

  async function run(kind: ModuleKind) {
    if (!dataBlock) return;
    setMods((s) => ({ ...s, [kind]: { ...EMPTY, loading: true } }));
    try {
      const kb = renderKb(selectCards(cards, ["momentum", "stock-picking", "valuation", "quality", "edge"]));
      const filings = renderDocChunks(docs);
      const sources = [...docs.map((d) => `${d.form} ${d.section}`), ...(kb ? ["kb"] : [])];
      const res = await aiAnalyzeAudited(buildDiligenceModule(kind, ticker, dataBlock, kb, filings), {
        module: kind, ticker, dataBlock, sources, maxTokens: 700,
      });
      setMods((s) => ({ ...s, [kind]: { text: res.text, violations: res.violations, advice: checkAdvice(res.text), loading: false, error: "" } }));
    } catch (e) {
      setMods((s) => ({ ...s, [kind]: { ...EMPTY, error: e instanceof Error ? e.message : "Failed" } }));
    }
  }

  if (loading) return <Sk w="100%" h={500} />;
  if (!dataBlock) return <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>Analyze {ticker} first to run due diligence.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }} className="animate-fade-in">
      <div>
        <h2 style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, margin: 0 }}>Due Diligence</h2>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>A guided workflow of grounded AI modules. Golden rule: cite, verify, challenge — every figure is checked against the data.</div>
      </div>

      {/* Golden-rule / governance banner */}
      <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-amber) 8%, var(--sr-surface-2))", border: "1px solid color-mix(in srgb, var(--sr-amber) 24%, transparent)", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.5 }}>
        Every module runs under a <strong style={{ color: "var(--sr-text)" }}>code-enforced grounding gate</strong>: the output&apos;s figures are checked against the data block, the run is logged to your audit trail, and any unverified number or advice phrasing is flagged below.{docs.length > 0 && <span style={{ color: "var(--sr-pos)" }}> Filings loaded: {docs.map((d) => d.section).join(", ")}.</span>}
      </div>

      {/* Module cards */}
      {ORDER.map((kind) => {
        const st = mods[kind] ?? EMPTY;
        const meta = MODULE_META[kind];
        return (
          <div key={kind} className="card">
            <div className="sr-flex-between" style={{ flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
              <div>
                <div className="section-label" style={{ margin: 0 }}>{meta.label}</div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>{meta.blurb}</div>
              </div>
              <button className="btn-primary" onClick={() => run(kind)} disabled={st.loading} style={{ flexShrink: 0 }}>{st.loading ? "Running…" : st.text ? "Re-run" : "Run"}</button>
            </div>
            {st.error && <div style={{ marginTop: 8, padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{st.error}</div>}
            {st.loading && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>{[85, 70, 80].map((w, i) => <Sk key={i} w={`${w}%`} h={12} />)}</div>}
            {st.text && !st.loading && (
              <div style={{ marginTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-3)" }}>
                {/* governance badge */}
                <div style={{ display: "flex", gap: "var(--sr-sp-2)", flexWrap: "wrap", marginBottom: "var(--sr-sp-2)" }}>
                  <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${st.violations.length === 0 ? "var(--sr-pos)" : "var(--sr-warn)"} 14%, transparent)`, color: st.violations.length === 0 ? "var(--sr-pos)" : "var(--sr-warn)" }}>
                    {st.violations.length === 0 ? "✓ grounded" : `⚠ ${st.violations.length} unverified figure${st.violations.length > 1 ? "s" : ""}: ${st.violations.join(", ")}`}
                  </span>
                  {st.advice.length > 0 && <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: "color-mix(in srgb, var(--sr-neg) 14%, transparent)", color: "var(--sr-neg)" }}>⚠ advice phrasing</span>}
                  <span style={{ fontSize: "10px", color: "var(--sr-text-3)", alignSelf: "center" }}>logged to audit trail</span>
                </div>
                <div style={{ fontSize: "var(--sr-t-xs)", lineHeight: 1.65, color: "var(--sr-text-2)" }}>{renderMd(st.text)}</div>
              </div>
            )}
          </div>
        );
      })}

      {/* Kelly position sizing (deterministic) */}
      <div className="card">
        <div className="section-label">Position sizing · fractional Kelly</div>
        <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>Your edge estimate → optimal fraction of capital. Kelly is aggressive; half-Kelly is the practical choice. A calculator, not advice.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
          {([["Win probability", winProb, setWinProb, 10, 90, "%"], ["Upside if right", upside, setUpside, 5, 100, "%"], ["Downside if wrong", downside, setDownside, 5, 80, "%"]] as const).map(([label, val, set, min, max, unit]) => (
            <div key={label}>
              <div className="sr-flex-between" style={{ fontSize: "var(--sr-t-xs)", marginBottom: 3 }}>
                <span style={{ color: "var(--sr-text-2)" }}>{label}</span><span className="num" style={{ color: "var(--sr-text)" }}>{val}{unit}</span>
              </div>
              <input type="range" min={min} max={max} step={1} value={val} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--sr-amber)" }} />
            </div>
          ))}
        </div>
        {k && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--sr-sp-2)", marginTop: "var(--sr-sp-3)" }}>
            {[
              { l: "Payoff (b)", v: `${k.b}×` },
              { l: "Full Kelly", v: `${(k.full * 100).toFixed(0)}%` },
              { l: "Half Kelly", v: `${(k.half * 100).toFixed(0)}%` },
              { l: "Suggested (capped)", v: k.favorable ? `${(k.capped * 100).toFixed(0)}%` : "no bet" },
            ].map((c, i) => (
              <div key={c.l} style={{ padding: "var(--sr-sp-2)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", textAlign: "center" }}>
                <div style={{ fontSize: "9px", color: "var(--sr-text-3)", textTransform: "uppercase" }}>{c.l}</div>
                <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 800, color: i === 3 ? (k.favorable ? "var(--sr-pos)" : "var(--sr-neg)") : "var(--sr-text)" }} className="num">{c.v}</div>
              </div>
            ))}
          </div>
        )}
        {k && !k.favorable && <div style={{ fontSize: "10px", color: "var(--sr-neg)", marginTop: 6 }}>Negative edge at these inputs — Kelly says don&apos;t size a position. Max cap is {(MAX_POSITION * 100).toFixed(0)}%.</div>}
      </div>
    </div>
  );
}
