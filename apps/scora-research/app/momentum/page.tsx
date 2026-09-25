"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { datos } from "@/lib/dataClient";
import type { MacroState } from "@/lib/types";
import { marketMomentum, type MarketMomentum } from "@/lib/marketMomentum";
import { stockPickingRegime } from "@/lib/microScore";
import { Sk } from "@/components/ui/Skeleton";

export default function MarketMomentumPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [macro, setMacro] = useState<MacroState | null>(null);
  const [mm, setMm] = useState<MarketMomentum | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (!authLoading && !session) router.replace("/login"); }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      const { data } = await datos.from("macro_state").select("*").eq("id", 1).single();
      if (!alive) return;
      const m = (data as MacroState) ?? null;
      setMacro(m);
      setMm(m ? marketMomentum({
        breadth200: m.breadth_200dma, breadth50: m.breadth_50dma,
        breadthMom: m.breadth_mom, breadth1m: m.breadth_1m,
        riskOn: m.risk_on, impliedCorr: m.implied_corr, hyOas: m.hy_oas,
      }) : null);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [session]);

  if (authLoading || !session) return null;
  const picking = stockPickingRegime(macro?.implied_corr ?? null);

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1080, margin: "0 auto" }} className="animate-fade-in">
      <div style={{ marginBottom: "var(--sr-sp-5)" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Market Momentum</h1>
        <p style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 6, maxWidth: 760, lineHeight: 1.6 }}>
          How much of the market is actually participating, and whether credit and risk appetite agree.
          This answers <em>&ldquo;what is the backdrop?&rdquo;</em> — not <em>&ldquo;what should I buy?&rdquo;</em>
        </p>
      </div>

      {/* Lo que este panel NO es. Va arriba y no en letra pequeña al final, porque es
          resultado de haberlo medido: tres formas de convertir señales de mercado en
          rentabilidad se probaron y se cayeron en esta misma base de código. */}
      <div style={{ padding: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: "1px dashed var(--sr-border)" }}>
        <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-text-2)", marginBottom: 4 }}>
          What this is measured to do — and what it is not
        </div>
        <div className="sr-hint" style={{ lineHeight: 1.55 }}>
          This is <strong style={{ color: "var(--sr-text-2)" }}>context, not a timing signal</strong>. We tested three ways of turning
          market signals into returns in this codebase — a momentum composite, a binary regime gate and sector-relative percentiles —
          and all three failed out of sample. The one that survived (the correlation gate) improved
          <strong style={{ color: "var(--sr-text-2)" }}> risk-adjusted return, not return</strong>. So this page tells you what the
          market is doing; it does not claim to know what it will do next.
        </div>
      </div>

      {!loaded ? <Sk w="100%" h={280} /> : !mm ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
          Not enough market data yet — breadth is aggregated on weekdays.
        </div>
      ) : (
        <>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
            <div style={{ textAlign: "center", minWidth: 120 }}>
              <div style={{ fontSize: "var(--sr-t-hero)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: mm.color }} className="num">{mm.score}</div>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }}>of 100</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: mm.color }}>{mm.label}</div>
              <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 4, lineHeight: 1.55 }}>{mm.detail}</div>
              {mm.divergence && (
                <div style={{ marginTop: 8, fontSize: "var(--sr-t-xs)", color: "var(--sr-warn)", fontWeight: 600 }}>
                  ⚠ Divergence: the index is above its 200-day average while fewer than 45% of names are.
                </div>
              )}
            </div>
          </div>

          {/* El desglose. Sin él, el número de arriba sería magia — y esconder los números
              detrás de una nota es justo lo que se le critica a Seeking Alpha. */}
          <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
            <div className="section-label">The {mm.coverage} signals behind it</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
              {mm.signals.map((s) => (
                <div key={s.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                    <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>{s.label}</span>
                    <span className="sr-hint num">
                      {s.raw.toFixed(s.key === "hyOas" ? 0 : 1)}{s.key.startsWith("breadth") ? "%" : s.key === "hyOas" ? "bp" : ""}
                      <span style={{ marginLeft: 8, fontWeight: 700, color: s.score >= 60 ? "var(--sr-pos)" : s.score >= 40 ? "var(--sr-text-2)" : "var(--sr-neg)" }}>{s.score}</span>
                    </span>
                  </div>
                  <div className="score-bar-track"><div className="score-bar-fill" style={{ width: `${s.score}%`, background: s.score >= 60 ? "var(--sr-pos)" : s.score >= 40 ? "var(--sr-warn)" : "var(--sr-neg)" }} /></div>
                  <div className="sr-hint" style={{ marginTop: 2 }}>{s.hint}</div>
                </div>
              ))}
            </div>
          </div>

          {/* El gate, que es lo único de toda la investigación que replicó fuera de muestra. */}
          <div className="card">
            <div className="section-label">Selection weight today</div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)" }}>
              <div style={{ minWidth: 90, textAlign: "center" }}>
                <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, color: picking.color, lineHeight: 1 }} className="num">{Math.round(picking.gate * 100)}%</div>
                <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 2 }}>{picking.label}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.55 }}>{picking.detail}</div>
                <div className="sr-hint" style={{ marginTop: 6 }}>
                  Scales continuously with implied correlation. Measured over two independent windows
                  (2010-2018 and 2019-2026) it improved Sharpe — 1.08→1.14 and 0.78→0.86 — but <strong style={{ color: "var(--sr-text-2)" }}>not
                  total return</strong>. It is risk management, not an edge.
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-4)" }}>
        {macro?.breadth_updated_at ? `Breadth as of ${String(macro.breadth_updated_at).slice(0, 10)} · ` : ""}
        aggregated daily by <code style={{ fontSize: "inherit" }}>research/macro_breadth.mjs</code>. Educational — not investment advice.
      </div>
    </div>
  );
}
