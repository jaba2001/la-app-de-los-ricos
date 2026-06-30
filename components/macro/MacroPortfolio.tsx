"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { getMacroTilt, getRating } from "@/lib/scoring";
import type { MacroState, StockAnalysis } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

interface Props { macro: MacroState | null; loading: boolean; }

interface PortfolioEntry {
  ticker: string;
  analysis: StockAnalysis;
  liveTilt: number;
  tiltLabel: string;
  tiltColor: string;
  icScore: number;
}

function tiltBucket(t: number): "favorable" | "neutral" | "headwind" {
  if (t > 3) return "favorable";
  if (t < -3) return "headwind";
  return "neutral";
}

const BUCKET_META = {
  favorable: { label: "Favorable", color: "var(--sr-pos)", icon: "▲", bg: "color-mix(in srgb, var(--sr-pos) 6%, transparent)" },
  neutral:   { label: "Neutral",   color: "var(--sr-text-2)", icon: "◆", bg: "color-mix(in srgb, var(--sr-text-3) 6%, transparent)" },
  headwind:  { label: "Headwind",  color: "var(--sr-neg)", icon: "▼", bg: "color-mix(in srgb, var(--sr-neg) 6%, transparent)" },
};

export default function MacroPortfolio({ macro, loading }: Props) {
  const { session } = useAuth();
  const router = useRouter();
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!session || !macro || loading) return;
    const m = macro; // capture non-null macro for async closure

    supabase.from("sl_watchlist").select("ticker").eq("user_id", session.user.id)
      .then(({ data: wlData, error: wlErr }) => {
        if (wlErr || !wlData || wlData.length === 0) { setLoadingData(false); return; }
        const tickers = (wlData as { ticker: string }[]).map(w => w.ticker);
        supabase.from("sl_analyses")
          .select("*")
          .in("ticker", tickers)
          .order("analysis_date", { ascending: false })
          .then(({ data: anlData, error: anlErr }) => {
            if (anlErr || !anlData) { setLoadingData(false); return; }
            const latest: Record<string, StockAnalysis> = {};
            (anlData as StockAnalysis[]).forEach(a => { if (!latest[a.ticker]) latest[a.ticker] = a; });

            const result: PortfolioEntry[] = tickers
              .filter(t => latest[t])
              .map(t => {
                const a = latest[t];
                const sector = a.sector ?? null;
                const tiltResult = sector ? getMacroTilt(m, sector) : { tilt: 0, label: "Neutral", color: "var(--sr-text-3)" };
                const tilt = tiltResult.tilt;
                const icScore = Number(a.score_total) + tilt;
                return {
                  ticker: t,
                  analysis: a,
                  liveTilt: tilt,
                  tiltLabel: tiltResult.label,
                  tiltColor: tiltResult.color ?? "var(--sr-text-3)",
                  icScore,
                };
              });
            setEntries(result);
            setLoadingData(false);
          });
      });
  }, [session, macro, loading]);

  if (loading || loadingData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
        {[0, 1, 2].map(i => <div key={i} className="card" style={{ height: 120 }}><Sk w="100%" h={100} /></div>)}
      </div>
    );
  }

  if (!session) return (
    <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
      Inicia sesión para ver tu cartera.
    </div>
  );

  if (entries.length === 0) return (
    <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
      <p style={{ marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-base)" }}>Tu watchlist está vacía</p>
      <p style={{ fontSize: "var(--sr-t-sm)" }}>
        Agrega tickers desde la página de Stock (★) o desde el Screener.
      </p>
    </div>
  );

  const buckets = {
    favorable: entries.filter(e => tiltBucket(e.liveTilt) === "favorable"),
    neutral:   entries.filter(e => tiltBucket(e.liveTilt) === "neutral"),
    headwind:  entries.filter(e => tiltBucket(e.liveTilt) === "headwind"),
  };

  const avgIc = entries.reduce((s, e) => s + e.icScore, 0) / entries.length;
  const regimeLabel = macro?.regime_label ?? "—";
  const regimeColor = macro?.regime_id === "expansion" ? "var(--sr-pos)" : macro?.regime_id === "contraction" || macro?.regime_id === "stagflation" ? "var(--sr-neg)" : "var(--sr-warn)";

  return (
    <div className="animate-fade-in">
      {/* Summary header */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--sr-sp-4)" }}>
          <div>
            <div className="section-label">Portfolio Heat</div>
            <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", marginTop: 2 }}>
              Régimen: <strong style={{ color: regimeColor }}>{regimeLabel}</strong>
              {" · "}{entries.length} posiciones
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--sr-sp-5)" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 2 }}>Scora Avg</div>
              <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: avgIc >= 65 ? "var(--sr-pos)" : avgIc >= 50 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">
                {avgIc.toFixed(0)}
              </div>
            </div>
            {(["favorable", "neutral", "headwind"] as const).map(b => (
              <div key={b} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 2 }}>{BUCKET_META[b].label}</div>
                <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: BUCKET_META[b].color }} className="num">
                  {buckets[b].length}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bucket columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-4)" }}>
        {(["favorable", "neutral", "headwind"] as const).map(bucket => {
          const meta = BUCKET_META[bucket];
          const group = buckets[bucket];
          return (
            <div key={bucket}>
              <div style={{
                display: "flex", alignItems: "center", gap: "var(--sr-sp-2)",
                padding: "var(--sr-sp-2) var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)",
                borderRadius: "var(--sr-radius)", background: meta.bg,
                border: `1px solid color-mix(in srgb, ${meta.color} 25%, transparent)`,
              }}>
                <span style={{ color: meta.color, fontSize: "var(--sr-t-xs)" }}>{meta.icon}</span>
                <span style={{ color: meta.color, fontWeight: 700, fontSize: "var(--sr-t-sm)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {meta.label}
                </span>
                <span style={{ color: meta.color, fontSize: "var(--sr-t-sm)", fontWeight: 700, marginLeft: "auto" }} className="num">
                  {group.length}
                </span>
              </div>
              {group.length === 0 ? (
                <div style={{ padding: "var(--sr-sp-4)", textAlign: "center", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>—</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
                  {group.sort((a, b) => b.icScore - a.icScore).map(e => {
                    const r = getRating(Number(e.analysis.score_total));
                    return (
                      <div
                        key={e.ticker}
                        className="card"
                        style={{ cursor: "pointer", padding: "var(--sr-sp-3) var(--sr-sp-4)" }}
                        onClick={() => router.push(`/stock/${e.ticker}`)}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-2)" }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "var(--sr-t-base)", color: "var(--sr-text)", letterSpacing: "-0.01em" }}>{e.ticker}</div>
                            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{e.analysis.sector ?? "—"}</div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: e.icScore >= 65 ? "var(--sr-pos)" : e.icScore >= 50 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">
                              {e.icScore.toFixed(0)}
                            </div>
                            {r && <Pill label={r.label} color={r.color} />}
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
                          <span>Base: <span className="num" style={{ color: "var(--sr-text-2)" }}>{e.analysis.score_total}</span></span>
                          <span style={{ color: e.tiltColor, fontWeight: 600 }}>
                            {e.liveTilt > 0 ? "+" : ""}{e.liveTilt} pts
                          </span>
                        </div>
                        <div style={{ marginTop: "var(--sr-sp-2)", height: 3, borderRadius: 2, background: "var(--sr-surface-3)" }}>
                          <div style={{ height: "100%", borderRadius: 2, background: e.icScore >= 65 ? "var(--sr-pos)" : e.icScore >= 50 ? "var(--sr-warn)" : "var(--sr-neg)", width: `${Math.min(100, e.icScore)}%`, transition: "width 400ms ease" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
