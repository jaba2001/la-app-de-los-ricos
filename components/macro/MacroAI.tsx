"use client";
import { useState } from "react";
import type { MacroState } from "@/lib/types";
import { authedFetch } from "@/lib/proxy";
import { supabase } from "@/lib/supabase";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

const TRIPWIRES = [
  { label: "VIX > 35",             key: "vix",            threshold: 35, dir: "above" },
  { label: "Recession Prob ≥ 60",  key: "recession_prob", threshold: 60, dir: "above" },
  { label: "Credit Stress ≥ 70",   key: "credit_stress",  threshold: 70, dir: "above" },
  { label: "Core PCE > 3.5%",      key: "core_pce_yoy",   threshold: 3.5, dir: "above" },
  { label: "Buffett Ind. > 180%",  key: "buffett_indicator", threshold: 180, dir: "above" },
  { label: "Oil Shock active",     key: "oil_shock",      special: "notnull" },
];

export default function MacroAI({ macro, loading }: Props) {
  const [synthesis, setSynthesis] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generate() {
    if (!macro) return;
    setGenerating(true);
    setError("");
    try {
      const prompt = `You are a senior macro analyst. Based on the following current macro data, provide a concise professional synthesis (3-4 paragraphs) covering: regime assessment, key risks, portfolio positioning implications.

Data:
- IC Score: ${macro.ic_score ?? "N/A"}
- Regime: ${macro.regime_label ?? "N/A"} (${macro.regime_id ?? "N/A"})
- Recession Probability: ${macro.recession_prob ?? "N/A"}
- Credit Stress: ${macro.credit_stress ?? "N/A"}
- Liquidity Cycle: ${macro.liquidity_cycle ?? "N/A"}
- Core PCE YoY: ${macro.core_pce_yoy ?? "N/A"}%
- Unemployment: ${macro.unrate ?? "N/A"}%
- 10Y Treasury: ${macro.dgs10 ?? "N/A"}%
- Curve Steepener: ${macro.curve_steepener ?? "N/A"}bp
- WTI Oil: $${macro.wti_level ?? "N/A"} (1M change: ${macro.wti_chg_1m ?? "N/A"}%)
- Fear & Greed: ${macro.fear_greed ?? "N/A"} (${macro.fear_greed_rating ?? "N/A"})
- Buffett Indicator: ${macro.buffett_indicator ?? "N/A"}%
- Expected 10Y Return: ${macro.expected_return_10y ?? "N/A"}%
- Net Liquidity: ${macro.net_liquidity_dir ?? "N/A"}
- Global Liquidity: ${macro.global_liquidity_dir ?? "N/A"}

Be specific, data-driven, and actionable.`;

      const res = await authedFetch<{ content: string }>("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ prompt, maxTokens: 800 }),
      });
      const content = res.content ?? "No response generated.";
      setSynthesis(content);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate synthesis");
    }
    setGenerating(false);
  }

  async function saveSynthesis() {
    if (!synthesis || !macro) return;
    setSaving(true);
    try {
      await supabase.from("ic_briefs").insert({
        snapshot_date: new Date().toISOString().split("T")[0],
        ic_score: macro.ic_score,
        regime_id: macro.regime_id,
        brief_text: synthesis,
        meta: { recession_prob: macro.recession_prob, credit_stress: macro.credit_stress },
      });
      setSaved(true);
    } catch { /* ic_briefs may not exist — fail silently */ }
    setSaving(false);
  }

  const activeTripwires = TRIPWIRES.filter(t => {
    if (!macro) return false;
    if (t.special === "notnull") return (macro as unknown as Record<string, unknown>)[t.key] != null;
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
              <div>
                <div className="section-label">AI Macro Synthesis</div>
                <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Claude Sonnet — powered by current macro_state data</div>
              </div>
              <div style={{ display: "flex", gap: "var(--sr-sp-3)" }}>
                {synthesis && (
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
                    {saving ? "Saving…" : saved ? "✓ Saved to Supabase" : "↓ Save Brief"}
                  </button>
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
                padding: "var(--sr-sp-3)",
                borderRadius: "var(--sr-radius)",
                background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)",
                color: "var(--sr-neg)",
                fontSize: "var(--sr-t-sm)",
                marginBottom: "var(--sr-sp-4)",
              }}>
                {error}
              </div>
            )}

            {generating && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                <Sk w="95%" h={16} /><Sk w="80%" h={16} /><Sk w="90%" h={16} />
                <Sk w="70%" h={16} /><Sk w="85%" h={16} /><Sk w="60%" h={16} />
              </div>
            )}

            {synthesis && !generating && (
              <div style={{
                fontSize: "var(--sr-t-base)",
                lineHeight: 1.8,
                color: "var(--sr-text-2)",
                whiteSpace: "pre-wrap",
                borderTop: "1px solid var(--sr-border)",
                paddingTop: "var(--sr-sp-4)",
              }}>
                {synthesis}
              </div>
            )}

            {!synthesis && !generating && (
              <div style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
                <div style={{ fontSize: "var(--sr-t-xl)", marginBottom: "var(--sr-sp-3)" }}>✦</div>
                <div style={{ fontSize: "var(--sr-t-sm)" }}>Click "Generate Analysis" for an AI-powered macro synthesis based on current data</div>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
              <div className="section-label">Tripwires</div>
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
            {TRIPWIRES.map(t => {
              const active = activeTripwires.includes(t);
              return (
                <div key={t.label} style={{
                  display: "flex", alignItems: "center", gap: "var(--sr-sp-3)",
                  padding: "var(--sr-sp-2) var(--sr-sp-3)",
                  borderRadius: "var(--sr-radius-sm)",
                  marginBottom: 4,
                  background: active ? "color-mix(in srgb, var(--sr-neg) 8%, transparent)" : "transparent",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: active ? "var(--sr-neg)" : "var(--sr-surface-3)",
                    boxShadow: active ? "0 0 6px var(--sr-neg)" : "none",
                  }} />
                  <span style={{
                    fontSize: "var(--sr-t-sm)",
                    color: active ? "var(--sr-text)" : "var(--sr-text-3)",
                    fontWeight: active ? 600 : 400,
                  }}>
                    {t.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Portfolio Positioning */}
          <div className="card">
            <div className="section-label">IC Positioning</div>
            {loading ? <Sk w="100%" h={80} /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>QUADRANT</div>
                  <div style={{ fontWeight: 700 }}>{macro?.cartera_quadrant ?? "—"}</div>
                </div>
                <div style={{ padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>REGIME</div>
                  <div style={{ fontWeight: 700 }}>{macro?.regime_label ?? "—"}</div>
                </div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.6 }}>
                  These signals are computed daily by the IC DataLayer engine and stored in Supabase macro_state (id=1).
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
