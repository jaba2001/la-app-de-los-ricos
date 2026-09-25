"use client";
import { useState, useEffect } from "react";
import type { MacroState } from "@/lib/types";
import { aiAnalyzeAudited } from "@/lib/proxy";
import { datos } from "@/lib/dataClient";
import { useAuth } from "@/lib/auth";
import { Sk } from "@/components/ui/Skeleton";
import { GroundedBadge } from "@/components/ui/GroundedBadge";
import { computeICHealthScore } from "@/lib/scoring";

interface Props { macro: MacroState | null; loading: boolean; }

// Opt-in toggle for the daily macro-alert emails sent by el cron alerts-check
// cron (credit blowout, QT acceleration, credit divergence). Writes the user's email
// into sl_alert_prefs; the cron reads that table and emails via Resend.
function AlertSubscription() {
  const { session } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    datos.from("sl_alert_prefs").select("macro_alerts").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => setEnabled(data ? Boolean((data as { macro_alerts: boolean }).macro_alerts) : false));
  }, [session]);

  async function toggle() {
    if (!session || enabled == null) return;
    const next = !enabled;
    setSaving(true);
    setEnabled(next); // optimistic
    const { error } = await datos.from("sl_alert_prefs").upsert({
      user_id: session.user.id,
      email: session.user.email,
      macro_alerts: next,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) setEnabled(!next); // revert on failure
    setSaving(false);
  }

  if (!session || enabled == null) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", marginTop: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 600, color: "var(--sr-text-2)" }}>Email me macro alerts</div>
        <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>
          Daily check — credit blowout, QT acceleration, credit divergence. To {session.user.email}
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        aria-pressed={enabled}
        style={{
          position: "relative", width: 40, height: 22, borderRadius: 11, border: "none", cursor: saving ? "default" : "pointer",
          background: enabled ? "var(--sr-pos)" : "var(--sr-surface-3)", transition: "background 200ms", flexShrink: 0,
        }}
      >
        <span style={{ position: "absolute", top: 2, left: enabled ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 200ms" }} />
      </button>
    </div>
  );
}

const TRIPWIRES = [
  { label: "VIX > 35",             key: "vix",            threshold: 35, dir: "above" },
  { label: "Recession Prob ≥ 60",  key: "recession_prob", threshold: 60, dir: "above" },
  { label: "Credit Stress ≥ 70",   key: "credit_stress",  threshold: 70, dir: "above" },
  { label: "Core PCE > 3.5%",      key: "core_pce_yoy",   threshold: 3.5, dir: "above" },
  { label: "Buffett Ind. > 180%",  key: "buffett_indicator", threshold: 180, dir: "above" },
  { label: "Oil Shock active",     key: "oil_shock",      special: "notnull" },
];

function buildOPLAPrompt(macro: MacroState): string {
  const icHealth = computeICHealthScore(macro)?.toFixed(1) ?? "N/A";

  return `You are an Investment Committee AI (CFA/CAIA level). Apply the Druckenmiller Signal Hierarchy (Tier 1: Liquidity → Tier 2: Credit → Tier 3: Recession → Tier 4: Geopolitical → Tier 5: Positioning) and the Howell Global Liquidity Model to analyze the following macro data. Structure your response with EXACTLY these section headers:

## RÉGIMEN MACRO ACTUAL
[Current regime + cycle stage + primary driver per Druckenmiller hierarchy]

## SEÑAL MAESTRA INMEDIATA
[Single most important signal right now. Which hierarchy tier is driving the view? Cite specific data points]

## ESCENARIOS (probabilities must sum to 100%)
- **Base Case (X%):** [6-12 month path, key catalysts, implications]
- **Bull Case (X%):** [trigger conditions, timeline, what breaks the bear thesis]
- **Bear Case (X%):** [tail risk, contagion path, what to watch]

## TRIPWIRES — ACCIONES CONCRETAS
1. [Exact threshold] → [Exact portfolio action + ETF ticker]
2. [Exact threshold] → [Exact portfolio action + ETF ticker]
3. [Exact threshold] → [Exact portfolio action + ETF ticker]
4. [Exact threshold] → [Exact portfolio action + ETF ticker]
5. [Exact threshold] → [Exact portfolio action + ETF ticker]
6. [Exact threshold] → [Exact portfolio action + ETF ticker]

## POSICIONAMIENTO IC
[Quadrant: ${macro.cartera_quadrant ?? "N/A"}. Specific overweight/underweight by asset class with ETF tickers. Duration stance. Credit quality preference]

## DALIO DEBT CYCLE + FED POLICY PATH
[Long-term debt cycle stage. Fed optionality. Credit transmission lags. Yield curve target]

## ANALOG HISTÓRICO
[Most analogous historical period (1997/1999/2007-08/2018/2022). Key similarities, key differences, what happened next]

## OUTLOOK 12 MESES
[Forward view: probable regime transition, key watchpoints, overall conviction level (HIGH/MEDIUM/LOW) and why]

---
MACRO DATA (${macro.snapshot_date ?? "current"}):

IC HEALTH SCORE: ${icHealth}/100
IC SCORE: ${macro.ic_score ?? "N/A"} | REGIME: ${macro.regime_label ?? "N/A"} (${macro.regime_id ?? "N/A"}) | QUADRANT: ${macro.cartera_quadrant ?? "N/A"}

COMPOSITE SCORES (0-100, stress direction):
• Liquidity Cycle (LCC): ${macro.liquidity_cycle ?? "N/A"} [>60 expanding; <40 contracting — PRIMARY Druckenmiller signal]
• Credit Stress (CSC): ${macro.credit_stress ?? "N/A"} [>70 crisis; <30 benign — credit is the transmission mechanism]
• Recession Prob (RPC): ${macro.recession_prob ?? "N/A"} [>60 high; Sahm + yield curve + labor composite]
• Geopolitical Risk (GRC): ${macro.geopolitical_risk ?? "N/A"} [oil/gold/FX stress]
• Housing Stress (HSC): ${macro.housing_stress ?? "N/A"} [lagging cycle indicator]

RATES & LIQUIDITY:
• 2Y: ${macro.dgs2 ?? "N/A"}% | 5Y: ${macro.dgs5 ?? "N/A"}% | 10Y: ${macro.dgs10 ?? "N/A"}% | 30Y: ${macro.dgs30 ?? "N/A"}%
• Curve 10Y-2Y: ${macro.t10y2y != null ? macro.t10y2y.toFixed(2) + "%" : "N/A"} | Curve 10Y-3M: ${macro.t10y3m != null ? macro.t10y3m.toFixed(2) + "%" : "N/A"} | Term Premium: ${macro.term_premium_10y ?? "N/A"}%
• SOFR: ${macro.sofr ?? "N/A"}% | Fed Funds: ${macro.fedfunds ?? "N/A"}% | Real Yield 10Y: ${macro.dgs10 != null && macro.core_pce_yoy != null ? (Number(macro.dgs10) - Number(macro.core_pce_yoy)).toFixed(2) + "%" : "N/A"}
• Net Liquidity: ${macro.net_liquidity_t != null ? `$${macro.net_liquidity_t}T` : "N/A"} (${macro.net_liquidity_dir ?? "N/A"}) | Fed BS: ${macro.walcl != null ? `$${(Number(macro.walcl)/1e6).toFixed(2)}T` : "N/A"}
• Global Liquidity: ${macro.global_liquidity_dir ?? "N/A"} | M2 Growth: ${macro.m2_growth ?? "N/A"}% | Sahm Rule: ${macro.sahm_rule ?? "N/A"}

CREDIT & STRESS:
• HY OAS (All): ${macro.hy_oas ?? "N/A"}bp | HY OAS BB: ${macro.hy_bb_oas ?? "N/A"}bp | HY OAS CCC: ${macro.hy_ccc_oas ?? "N/A"}bp | BBB: ${macro.bbb_oas ?? "N/A"}bp
• C&I Tightening: ${macro.c_and_i_loans ?? "N/A"}% | Credit Card Delinq.: ${macro.credit_card_delinq ?? "N/A"}%
• NFCI: ${macro.nfci ?? "N/A"} | STLFSI4: ${macro.stlfsi4 ?? "N/A"}

MACRO & FED:
• Core PCE YoY: ${macro.core_pce_yoy ?? "N/A"}% | Core CPI YoY: ${macro.core_cpi_yoy ?? "N/A"}% | Unemployment: ${macro.unrate ?? "N/A"}%
• UMich Sentiment: ${macro.umcsent ?? "N/A"} | Jobless Claims: ${macro.icsa ?? "N/A"}K
• Buffett Indicator: ${macro.buffett_indicator ?? "N/A"}% | Expected 10Y Return: ${macro.expected_return_10y ?? "N/A"}%
• Fed Room: ${macro.fed_room ?? "N/A"} | WTI: $${macro.wti_level ?? "N/A"} (1M: ${macro.wti_chg_1m ?? "N/A"}%) | Oil Shock: ${macro.oil_shock ?? "none"}
• DXY: ${macro.dxy ?? "N/A"} | USD/JPY: ${macro.usdjpy ?? "N/A"} | Brent: $${macro.brent ?? "N/A"}

HOUSING:
• Mortgage Rate 30Y: ${macro.mortgage_rate ?? "N/A"}% | Housing Starts: ${macro.house_starts ?? "N/A"}K | Building Permits: ${macro.building_permits ?? "N/A"}K
• Existing Home Sales: ${macro.home_sales != null ? (Number(macro.home_sales)/1000).toFixed(0) + "K" : "N/A"} | Case-Shiller YoY: ${macro.case_shiller_yoy ?? "N/A"}%

SENTIMENT & VOLATILITY:
• Fear & Greed: ${macro.fear_greed ?? "N/A"} (${macro.fear_greed_rating ?? "N/A"}) | Put/Call: ${macro.put_call_ratio ?? "N/A"}
• VIX: ${macro.vix ?? "N/A"} | MOVE Index: ${macro.move_index ?? "N/A"} | OVX: ${macro.ovx ?? "N/A"}
• Sentiment Signal: ${macro.sentiment_signal ?? "N/A"} | Global Liquidity: ${macro.global_liquidity_dir ?? "N/A"}

Be specific, quantitative, and actionable. Use exact numbers from the data. Scenario probabilities must sum to 100%.`;
}

function buildHTMLReport(macro: MacroState, synthesis: string, date: string): string {
  const escape = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const renderSynthesis = synthesis
    .replace(/## (.+)/g, '<h3 style="color:#F59E0B;margin:1.2em 0 0.5em;font-size:14px;letter-spacing:0.05em">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>IC Report — ${date}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#fff;color:#0f172a;font-size:12px;line-height:1.6}
  .page{max-width:900px;margin:0 auto;padding:32px}
  .header{border-bottom:3px solid #F59E0B;padding-bottom:16px;margin-bottom:24px}
  .title{font-size:22px;font-weight:700;letter-spacing:-0.02em}
  .sub{color:#64748b;font-size:12px;margin-top:4px}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.05em}
  .grid{display:grid;gap:12px;margin-bottom:20px}
  .g5{grid-template-columns:repeat(5,1fr)}
  .g3{grid-template-columns:repeat(3,1fr)}
  .card{border:1px solid #e2e8f0;border-radius:8px;padding:12px}
  .card-title{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
  .card-value{font-size:22px;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:20px}
  th{background:#f8fafc;padding:6px 10px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0}
  td{padding:6px 10px;border-bottom:1px solid #f1f5f9}
  .section{margin-bottom:24px}
  .section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#0f172a;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
  .synthesis{font-size:12px;line-height:1.8;color:#334155}
  .bar-track{height:6px;background:#f1f5f9;border-radius:3px;margin-top:6px}
  .bar-fill{height:100%;border-radius:3px}
  .pos{color:#16a34a} .neg{color:#dc2626} .warn{color:#d97706}
  .disclaimer{font-size:10px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px;margin-top:24px}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="title">Investment Committee Report</div>
    <div class="sub">Generated: ${date} · IC Score: ${macro.ic_score?.toFixed(1) ?? "—"} · Regime: ${escape(macro.regime_label ?? "—")} · Quadrant: ${escape(macro.cartera_quadrant ?? "—")}</div>
  </div>

  <div class="section">
    <div class="section-title">Composite Scores</div>
    <div class="grid g5">
      ${[
        {l:"Liquidity (LCC)", v: macro.liquidity_cycle, c: Number(macro.liquidity_cycle??0)>55?"#16a34a":Number(macro.liquidity_cycle??0)<35?"#dc2626":"#d97706"},
        {l:"Recession (RPC)", v: macro.recession_prob,  c: Number(macro.recession_prob??0)>60?"#dc2626":Number(macro.recession_prob??0)<25?"#16a34a":"#d97706"},
        {l:"Credit (CSC)",   v: macro.credit_stress,   c: Number(macro.credit_stress??0)>70?"#dc2626":Number(macro.credit_stress??0)<30?"#16a34a":"#d97706"},
        {l:"Geopolit (GRC)", v: macro.geopolitical_risk,c:"#d97706"},
        {l:"Housing (HSC)",  v: macro.housing_stress,  c:"#d97706"},
      ].map(({l,v,c}) => `<div class="card"><div class="card-title">${l}</div><div class="card-value" style="color:${c}">${v!=null?Number(v).toFixed(0):"—"}</div><div class="bar-track"><div class="bar-fill" style="width:${Number(v??0)}%;background:${c}"></div></div></div>`).join("")}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Key Market Data</div>
    <table>
      <tr><th>Indicator</th><th>Value</th><th>Indicator</th><th>Value</th></tr>
      <tr><td>2Y Treasury</td><td><strong>${macro.dgs2?.toFixed(2)??"—"}%</strong></td><td>Core PCE YoY</td><td><strong>${macro.core_pce_yoy?.toFixed(1)??"—"}%</strong></td></tr>
      <tr><td>10Y Treasury</td><td><strong>${macro.dgs10?.toFixed(2)??"—"}%</strong></td><td>Unemployment</td><td><strong>${macro.unrate?.toFixed(1)??"—"}%</strong></td></tr>
      <tr><td>Curve (10Y-2Y)</td><td><strong>${macro.t10y2y!=null?`${macro.t10y2y>0?"+":""}${macro.t10y2y.toFixed(2)}%`:"—"}${macro.curve_steepener?` (${macro.curve_steepener})`:""}</strong></td><td>Buffett Indicator</td><td><strong>${macro.buffett_indicator?.toFixed(0)??"—"}%</strong></td></tr>
      <tr><td>Net Liquidity</td><td><strong>${macro.net_liquidity_t!=null?`$${macro.net_liquidity_t}T`:"—"} (${macro.net_liquidity_dir??"—"})</strong></td><td>WTI Oil</td><td><strong>$${macro.wti_level?.toFixed(1)??"—"}</strong></td></tr>
      <tr><td>Fear & Greed</td><td><strong>${macro.fear_greed?.toFixed(0)??"—"} (${macro.fear_greed_rating??"—"})</strong></td><td>VIX</td><td><strong>${macro.vix?.toFixed(1)??"—"}</strong></td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">AI Macro Synthesis — OPLA Framework</div>
    <div class="synthesis">${renderSynthesis}</div>
  </div>

  <div class="disclaimer">
    This report is generated by Scora Research AI for informational purposes only. Not financial advice. Past performance does not guarantee future results. Data sourced from Supabase macro_state as of ${date}.
  </div>
</div>
</body>
</html>`;
}

export default function MacroAI({ macro, loading }: Props) {
  const [synthesis, setSynthesis] = useState("");
  const [synthViol, setSynthViol] = useState<(number | string)[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [alertsSaved, setAlertsSaved] = useState(false);

  async function generate() {
    if (!macro) return;
    setGenerating(true);
    setError("");
    try {
      const prompt = buildOPLAPrompt(macro);
      const res = await aiAnalyzeAudited(prompt, { module: "macro-synthesis", dataBlock: prompt, sources: ["macro_state"], maxTokens: 1800 });
      setSynthesis(res.text); setSynthViol(res.violations);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate synthesis");
    }
    setGenerating(false);
  }

  async function saveSynthesis() {
    if (!synthesis || !macro) return;
    setSaving(true);
    // supabase-js returns { error } instead of throwing — a try/catch never fires
    const { error } = await datos.from("ic_briefs").insert({
      snapshot_date: new Date().toISOString().split("T")[0],
      ic_score: macro.ic_score,
      regime_id: macro.regime_id,
      brief_text: synthesis,
      meta: { recession_prob: macro.recession_prob, credit_stress: macro.credit_stress },
    });
    if (!error) setSaved(true);
    else setError(`Save failed: ${error.message}`);
    setSaving(false);
  }

  async function saveAlerts() {
    if (!macro || activeTripwires.length === 0) return;
    setAlertsSaved(false);
    // Columns must match the real alerts_log schema (alert_type/threshold/
    // actual_value/message), not the old alert_key/alert_label names that silently
    // failed every insert.
    const rows = activeTripwires.map(t => {
      const v = (macro as unknown as Record<string, unknown>)[t.key];
      const cur = v != null && typeof v !== "string" ? Number(v) : null;
      return {
        alert_type:   t.key,
        threshold:    t.threshold ?? null,
        actual_value: cur,
        message:      `${t.label}${cur != null ? ` — ${cur.toFixed(2)}` : ""} (snapshot ${macro.snapshot_date ?? "current"})`,
        triggered_at: new Date().toISOString(),
      };
    });
    // supabase-js returns { error } instead of throwing — check it explicitly
    const { error } = await datos.from("alerts_log").insert(rows);
    if (!error) setAlertsSaved(true);
  }

  function exportReport() {
    if (!synthesis || !macro) return;
    setExporting(true);
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
    const html = buildHTMLReport(macro, synthesis, date);
    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `IC_Report_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setTimeout(() => setExporting(false), 800);
  }

  const activeTripwires = TRIPWIRES.filter(t => {
    if (!macro) return false;
    if (t.special === "notnull") { const v = (macro as unknown as Record<string, unknown>)[t.key]; return !!v && v !== "none"; }
    const raw = (macro as unknown as Record<string, unknown>)[t.key];
    if (raw == null) return false;
    const val = Number(raw);
    if (isNaN(val)) return false;
    return t.dir === "above" ? val >= (t.threshold ?? 0) : val <= (t.threshold ?? 0);
  });

  return (
    <div className="animate-fade-in">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "var(--sr-sp-5)" }}>
        {/* AI Synthesis */}
        <div>
          <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
            <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
              <div>
                <div className="section-label">AI Macro Synthesis — OPLA Framework</div>
                <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Claude Haiku · Druckenmiller Hierarchy · 8-section structured analysis</div>
              </div>
              <div style={{ display: "flex", gap: "var(--sr-sp-3)", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {synthesis && (
                  <>
                    <button
                      onClick={exportReport}
                      disabled={exporting}
                      style={{
                        padding: "8px 14px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-sm)",
                        fontWeight: 600, cursor: "pointer",
                        background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
                        color: "var(--sr-text-2)",
                      }}
                    >
                      {exporting ? "Exporting…" : "⬇ Export HTML"}
                    </button>
                    <button
                      onClick={saveSynthesis}
                      disabled={saving || saved}
                      style={{
                        padding: "8px 14px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-sm)",
                        fontWeight: 600, cursor: saving || saved ? "default" : "pointer",
                        background: saved ? "color-mix(in srgb, var(--sr-pos) 15%, transparent)" : "var(--sr-surface-2)",
                        border: `1px solid ${saved ? "color-mix(in srgb, var(--sr-pos) 40%, transparent)" : "var(--sr-border)"}`,
                        color: saved ? "var(--sr-pos)" : "var(--sr-text-2)",
                      }}
                    >
                      {saving ? "Saving…" : saved ? "✓ Saved" : "↓ Save Brief"}
                    </button>
                  </>
                )}
                <button
                  className="btn-primary"
                  onClick={generate}
                  disabled={generating || loading || !macro}
                  style={{ flexShrink: 0 }}
                >
                  {generating ? "Generating…" : synthesis ? "Regenerate" : "✦ Generate Analysis"}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)",
                background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)",
                color: "var(--sr-neg)", fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-4)",
              }}>
                {error}
              </div>
            )}

            {generating && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                {[95, 80, 90, 70, 85, 60, 75, 50].map((w, i) => <Sk key={i} w={`${w}%`} h={16} />)}
              </div>
            )}

            {synthesis && !generating && (
              <div style={{ borderTop: "1px solid var(--sr-border)", paddingTop: "var(--sr-sp-4)" }}>
                <GroundedBadge violations={synthViol} />
                <div style={{ fontSize: "var(--sr-t-base)", lineHeight: 1.8, color: "var(--sr-text-2)", whiteSpace: "pre-wrap" }}>
                  {synthesis}
                </div>
              </div>
            )}

            {!synthesis && !generating && (
              <div style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
                <div style={{ fontSize: "var(--sr-t-xl)", marginBottom: "var(--sr-sp-3)" }}>✦</div>
                <div style={{ fontSize: "var(--sr-t-sm)", marginBottom: "var(--sr-sp-2)" }}>
                  8-section OPLA analysis: Régimen · Señal Maestra · Escenarios (Base/Bull/Bear) · Tripwires · Positioning · Dalio Debt Cycle · Analog Histórico · Outlook 12M
                </div>
                <div className="sr-hint">Powered by Druckenmiller Signal Hierarchy + Howell Liquidity Model</div>
              </div>
            )}
          </div>

          {/* Historical snapshots */}
          <div className="card">
            <div className="section-label">Historical Macro Snapshot</div>
            <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", padding: "var(--sr-sp-4) 0" }}>
              Historical snapshot data is stored in the macro_state table. IC DataLayer writes snapshots on each refresh cycle.
            </div>
            <table className="sr-table">
              <thead><tr>
                <th>Date</th><th>IC Score</th><th>LCC</th><th>RPC</th><th>CSC</th><th>Regime</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}><Sk w="100%" h={14} /></td></tr>
                ) : macro ? (
                  <tr>
                    <td>{macro.snapshot_date ?? "—"}</td>
                    <td className="num">{macro.ic_score != null ? Number(macro.ic_score).toFixed(1) : "—"}</td>
                    <td className="num">{macro.liquidity_cycle != null ? Number(macro.liquidity_cycle).toFixed(0) : "—"}</td>
                    <td className="num">{macro.recession_prob != null ? Number(macro.recession_prob).toFixed(0) : "—"}</td>
                    <td className="num">{macro.credit_stress != null ? Number(macro.credit_stress).toFixed(0) : "—"}</td>
                    <td>{macro.regime_label ?? "—"}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tripwires */}
        <div>
          <div className="card" style={{ marginBottom: "var(--sr-sp-4)" }}>
            <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
              <div>
                <div className="section-label">Tripwires</div>
              </div>
              <div style={{ display: "flex", gap: "var(--sr-sp-2)", alignItems: "center" }}>
                {activeTripwires.length > 0 && (
                  <button
                    onClick={saveAlerts}
                    disabled={alertsSaved}
                    style={{
                      padding: "4px 10px", borderRadius: "var(--sr-radius-pill)", fontSize: "var(--sr-t-xs)",
                      fontWeight: 600, cursor: alertsSaved ? "default" : "pointer",
                      background: alertsSaved ? "color-mix(in srgb, var(--sr-pos) 12%, transparent)" : "var(--sr-surface-2)",
                      border: `1px solid ${alertsSaved ? "color-mix(in srgb, var(--sr-pos) 35%, transparent)" : "var(--sr-border)"}`,
                      color: alertsSaved ? "var(--sr-pos)" : "var(--sr-text-3)",
                    }}
                  >
                    {alertsSaved ? "✓ Saved" : "↓ Save to Log"}
                  </button>
                )}
              <span style={{
                fontSize: "var(--sr-t-xs)", fontWeight: 700, padding: "2px 8px",
                borderRadius: "var(--sr-radius-pill)",
                background: activeTripwires.length > 0
                  ? "color-mix(in srgb, var(--sr-neg) 15%, transparent)"
                  : "color-mix(in srgb, var(--sr-pos) 15%, transparent)",
                color: activeTripwires.length > 0 ? "var(--sr-neg)" : "var(--sr-pos)",
              }}>
                {activeTripwires.length} ACTIVE
              </span>
              </div>
            </div>
            {TRIPWIRES.map(t => {
              const active = activeTripwires.includes(t);
              const raw = macro ? (macro as unknown as Record<string, unknown>)[t.key] : null;
              const val = raw != null && typeof raw !== "string" ? Number(raw) : null;
              return (
                <div key={t.label} style={{
                  display: "flex", alignItems: "center", gap: "var(--sr-sp-3)",
                  padding: "var(--sr-sp-2) var(--sr-sp-3)",
                  borderRadius: "var(--sr-radius-sm)", marginBottom: 4,
                  background: active ? "color-mix(in srgb, var(--sr-neg) 8%, transparent)" : "transparent",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: active ? "var(--sr-neg)" : "var(--sr-surface-3)",
                    boxShadow: active ? "0 0 6px var(--sr-neg)" : "none",
                  }} />
                  <span style={{
                    fontSize: "var(--sr-t-sm)", color: active ? "var(--sr-text)" : "var(--sr-text-3)",
                    fontWeight: active ? 600 : 400, flex: 1,
                  }}>
                    {t.label}
                  </span>
                  {val != null && (
                    <span style={{ fontSize: "var(--sr-t-xs)", color: active ? "var(--sr-neg)" : "var(--sr-text-3)" }} className="num">
                      {val.toFixed(1)}
                    </span>
                  )}
                </div>
              );
            })}
            <AlertSubscription />
          </div>

          {/* IC Positioning */}
          <div className="card">
            <div className="section-label">IC Positioning</div>
            {loading ? <Sk w="100%" h={80} /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                {[
                  { label: "QUADRANT",       val: macro?.cartera_quadrant },
                  { label: "REGIME",         val: macro?.regime_label },
                  { label: "NET LIQUIDITY",  val: macro?.net_liquidity_dir },
                  { label: "GLOBAL LIQ.",    val: macro?.global_liquidity_dir },
                ].map(({ label, val }) => (
                  <div key={label} style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
                    <div className="sr-tile-label">{label}</div>
                    <div style={{ fontWeight: 700, textTransform: "capitalize" }}>{val ?? "—"}</div>
                  </div>
                ))}
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.6 }}>
                  Signals computed daily by IC DataLayer engine. Stored in Supabase macro_state (id=1).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
