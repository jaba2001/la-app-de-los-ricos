"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ALLOC_ASSETS, ASSET_META, blendWeights, type Weights } from "@/lib/allocation";

interface Track { as_of: string; inception: string; nav: number; spy_nav: number; bench6040_nav?: number | null; bench6040_ret?: number | null; total_ret: number; spy_ret: number; max_dd: number; sharpe: number; grade: string; }
interface Reb { rebalance_date: string; weights: Record<string, number>; risk_on: number | null; moved_to_cash: string[] | null; }

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
// An "Accruing" track row can exist before the weekly measure fills nav/sharpe — never .toFixed(null).
const fnum = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? "—" : v.toFixed(d));
const GRADE_COLOR: Record<string, string> = { A: "var(--sr-pos)", B: "var(--sr-pos)", C: "var(--sr-warn)", D: "var(--sr-warn)", F: "var(--sr-neg)", Accruing: "var(--sr-text-3)" };

export default function PaperFund() {
  const [track, setTrack] = useState<Track | null>(null);
  const [reb, setReb] = useState<Reb | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [slider, setSlider] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: t }, { data: r }] = await Promise.all([
        supabase.from("sl_paper_fund_track").select("*").order("as_of", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("sl_paper_fund").select("*").order("rebalance_date", { ascending: false }).limit(1).maybeSingle(),
      ]);
      setTrack((t as Track) ?? null);
      setReb((r as Reb) ?? null);
      if (r) setSlider(Number((r as Reb).risk_on ?? 50));
      setLoaded(true);
    })();
  }, []);

  // Interactive allocator — recompute the blend live from the slider (educational).
  const simWeights = useMemo<Weights | null>(() => (slider == null ? null : blendWeights(slider)), [slider]);
  const grade = track?.grade ?? "Accruing";
  const gradeColor = GRADE_COLOR[grade] ?? "var(--sr-text-3)";
  const liveWeights = reb?.weights ?? null;

  if (!loaded) return null;

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-6)", borderColor: "color-mix(in srgb, var(--sr-amber) 34%, var(--sr-border))" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-3)", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Autonomous paper fund</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2, maxWidth: 560, lineHeight: 1.5 }}>
            The model running itself: a cron rebalances monthly by the validated allocator, another measures weekly and auto-grades. No discretion, no hindsight — a risk-managed record, not a &ldquo;+8% in 30 days&rdquo; pitch.
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Grade</div>
          <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{grade}</div>
        </div>
      </div>

      {track && track.inception && (
        <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="sr-tile"><div className="sr-tile-label">NAV (base 100)</div><div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{fnum(track.nav)}</div><div className="sr-hint">60/40 {fnum(track.bench6040_nav)} · SPY {fnum(track.spy_nav)}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Total return</div><div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: (track.total_ret ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{pct(track.total_ret)}</div><div className="sr-hint">60/40 {pct(track.bench6040_ret)} · SPY {pct(track.spy_ret)}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Max drawdown</div><div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{pct(track.max_dd, 0)}</div></div>
          <div className="sr-tile"><div className="sr-tile-label">Sharpe (ann.)</div><div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{fnum(track.sharpe, 2)}</div></div>
        </div>
      )}
      {track?.inception && (
        <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
          Inception {track.inception} · measured {track.as_of}{grade === "Accruing" ? " · accruing — the NAV path fills in as the weekly measure runs" : ""}.
        </div>
      )}

      {/* Current allocation (from the latest sealed rebalance) */}
      {liveWeights && (
        <div style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Current target allocation · rebalanced {reb?.rebalance_date}</div>
          <WeightBar weights={liveWeights} />
        </div>
      )}

      {/* Interactive allocator — slide the risk-on gauge, see the blend shift */}
      {slider != null && simWeights && (
        <div style={{ paddingTop: "var(--sr-sp-3)", borderTop: "1px solid var(--sr-border)" }}>
          <div className="sr-flex-between" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: "10px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Interactive allocator · risk-on gauge</span>
            <span className="num" style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: slider >= 60 ? "var(--sr-pos)" : slider >= 40 ? "var(--sr-warn)" : "var(--sr-neg)" }}>{slider.toFixed(0)}/100 · {slider >= 60 ? "Risk-on" : slider >= 40 ? "Neutral" : "Risk-off"}</span>
          </div>
          <input type="range" min={0} max={100} step={1} value={slider} onChange={(e) => setSlider(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--sr-amber)" }} />
          <div style={{ marginTop: "var(--sr-sp-2)" }}><WeightBar weights={simWeights} /></div>
          <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 6 }}>Blend only — the live fund also applies a 12-1m momentum gate before rebalancing.</div>
        </div>
      )}
    </div>
  );
}

function WeightBar({ weights }: { weights: Record<string, number> }) {
  return (
    <>
      <div style={{ display: "flex", height: 22, borderRadius: 5, overflow: "hidden", border: "1px solid var(--sr-border)" }}>
        {ALLOC_ASSETS.map((a) => {
          const w = Number(weights[a]) || 0;
          if (w <= 0) return null;
          return <div key={a} title={`${a} ${(w * 100).toFixed(0)}%`} style={{ width: `${w * 100}%`, background: ASSET_META[a].color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", overflow: "hidden" }}>{w >= 0.08 ? `${(w * 100).toFixed(0)}` : ""}</div>;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginTop: 6 }}>
        {ALLOC_ASSETS.map((a) => {
          const w = Number(weights[a]) || 0;
          return <span key={a} style={{ fontSize: "10px", color: "var(--sr-text-3)", display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: ASSET_META[a].color, display: "inline-block" }} />{a} {(w * 100).toFixed(0)}%</span>;
        })}
      </div>
    </>
  );
}
