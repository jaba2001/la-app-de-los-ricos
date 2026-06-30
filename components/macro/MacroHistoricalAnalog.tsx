"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { computeICHealthScore } from "@/lib/scoring";
import { matchHistoricalAnalogs, crossReferenceSectors, type AnalogMatch, type SectorExposure } from "@/lib/historicalMatch";
import type { MacroState, StockAnalysis } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

interface Props { macro: MacroState | null; loading: boolean; }

const REGIME_COLORS: Record<string, string> = {
  expansion: "var(--sr-pos)", reflation: "var(--sr-warn)",
  stagflation: "var(--sr-neg)", contraction: "var(--sr-neg)", neutral: "var(--sr-text-2)",
};

const ROLE_META: Record<SectorExposure["historicalRole"], { label: string; color: string }> = {
  outperformer: { label: "Outperformed", color: "var(--sr-pos)" },
  underperformer: { label: "Underperformed", color: "var(--sr-neg)" },
  neutral: { label: "Mixed / N.A.", color: "var(--sr-text-3)" },
};

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(0)}%`;
}

function fmtMonths(v: number | null): string {
  return v == null ? "—" : `${v}mo`;
}

export default function MacroHistoricalAnalog({ macro, loading }: Props) {
  const { session } = useAuth();
  const [holdings, setHoldings] = useState<{ sector: string | null }[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(true);

  useEffect(() => {
    if (!session) { setHoldingsLoading(false); return; }
    supabase.from("sl_watchlist").select("ticker").eq("user_id", session.user.id)
      .then(({ data: wlData, error: wlErr }) => {
        if (wlErr || !wlData || wlData.length === 0) { setHoldingsLoading(false); return; }
        const tickers = (wlData as { ticker: string }[]).map(w => w.ticker);
        supabase.from("sl_analyses")
          .select("*")
          .in("ticker", tickers)
          .order("analysis_date", { ascending: false })
          .then(({ data: anlData, error: anlErr }) => {
            if (anlErr || !anlData) { setHoldingsLoading(false); return; }
            const latest: Record<string, StockAnalysis> = {};
            (anlData as StockAnalysis[]).forEach(a => { if (!latest[a.ticker]) latest[a.ticker] = a; });
            setHoldings(tickers.filter(t => latest[t]).map(t => ({ sector: latest[t].sector ?? null })));
            setHoldingsLoading(false);
          });
      });
  }, [session]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
        {[0, 1, 2].map(i => <div key={i} className="card" style={{ height: 160 }}><Sk w="100%" h={140} /></div>)}
      </div>
    );
  }

  if (!macro) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
        Macro data unavailable.
      </div>
    );
  }

  const icHealth = computeICHealthScore(macro);
  const regimeColor = REGIME_COLORS[macro.regime_id ?? "neutral"] ?? "var(--sr-text-2)";
  const matches: AnalogMatch[] = matchHistoricalAnalogs(macro, 3);
  const topMatch = matches[0];
  const sectorExposure = topMatch && holdings.length > 0 ? crossReferenceSectors(topMatch, holdings) : [];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>

      {/* Header: today's regime */}
      <div className="card">
        <div className="section-label">Today's Regime</div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-2)" }}>
          <div>
            <span style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: regimeColor }}>
              {macro.regime_label ?? "—"}
            </span>
          </div>
          {icHealth != null && (
            <div style={{ marginLeft: "auto", textAlign: "center" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>IC Health</div>
              <div className="num" style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: icHealth >= 65 ? "var(--sr-pos)" : icHealth >= 45 ? "var(--sr-warn)" : "var(--sr-neg)" }}>
                {icHealth.toFixed(0)}
              </div>
            </div>
          )}
        </div>
        <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: "var(--sr-sp-2)" }}>
          Closest historical analogs ranked by weighted distance across Liquidity, Credit, Recession, Geopolitical and Housing composites (same weighting as the IC Health Score).
        </div>
      </div>

      {/* Ranked analog matches */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
        {matches.map(({ analog, similarity }) => (
          <div key={analog.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-3)" }}>
              <div>
                <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: "var(--sr-text)" }}>{analog.label}</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>{analog.dateRange}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)" }}>
                <Pill label={analog.regimeId} color={REGIME_COLORS[analog.regimeId] ?? "var(--sr-text-2)"} />
                <div style={{ textAlign: "center" }}>
                  <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: similarity >= 70 ? "var(--sr-pos)" : similarity >= 45 ? "var(--sr-warn)" : "var(--sr-text-3)" }}>
                    {similarity}%
                  </div>
                  <div style={{ fontSize: "9px", color: "var(--sr-text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>similarity</div>
                </div>
              </div>
            </div>

            <div style={{ height: 4, borderRadius: 2, background: "var(--sr-surface-3)", marginBottom: "var(--sr-sp-4)" }}>
              <div style={{ height: "100%", borderRadius: 2, width: `${similarity}%`, background: similarity >= 70 ? "var(--sr-pos)" : similarity >= 45 ? "var(--sr-warn)" : "var(--sr-text-3)", transition: "width 400ms ease" }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)", fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)", lineHeight: 1.5, marginBottom: "var(--sr-sp-4)" }}>
              <div><strong style={{ color: "var(--sr-text)" }}>Trigger: </strong>{analog.narrative.trigger}</div>
              <div><strong style={{ color: "var(--sr-text)" }}>Context: </strong>{analog.narrative.context}</div>
              <div><strong style={{ color: "var(--sr-text)" }}>What followed: </strong>{analog.narrative.whatHappenedNext}</div>
            </div>

            <div className="stat-row">
              <span style={{ color: "var(--sr-text-3)" }}>SPY drawdown</span>
              <span className="num" style={{ color: "var(--sr-neg)" }}>{fmtPct(analog.marketImpact.spyDrawdownPct)}</span>
            </div>
            <div className="stat-row">
              <span style={{ color: "var(--sr-text-3)" }}>Duration</span>
              <span className="num" style={{ color: "var(--sr-text-2)" }}>{fmtMonths(analog.marketImpact.durationMonths)}</span>
            </div>
            <div className="stat-row">
              <span style={{ color: "var(--sr-text-3)" }}>Recovery</span>
              <span className="num" style={{ color: "var(--sr-text-2)" }}>{fmtMonths(analog.marketImpact.recoveryMonths)}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-3)" }}>
              <div>
                <div style={{ fontSize: "10px", color: "var(--sr-pos)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Outperformed</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{analog.sectorImpact.outperformers.join(", ") || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: "10px", color: "var(--sr-neg)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Underperformed</div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{analog.sectorImpact.underperformers.join(", ") || "—"}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Portfolio cross-reference against the top match */}
      {!holdingsLoading && session && sectorExposure.length > 0 && topMatch && (
        <div className="card">
          <div className="section-label">Your Portfolio in This Regime</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
            Sector exposure cross-referenced against the closest match ({topMatch.analog.label}) only — illustrative, not a recommendation.
          </div>
          {sectorExposure.map(s => (
            <div key={s.sector} className="stat-row">
              <span style={{ color: "var(--sr-text-2)" }}>{s.sector} <span style={{ color: "var(--sr-text-3)" }}>({s.tickerCount})</span></span>
              <Pill label={ROLE_META[s.historicalRole].label} color={ROLE_META[s.historicalRole].color} />
            </div>
          ))}
        </div>
      )}

      {/* Future enhancement note */}
      <div className="card" style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
        Today's matches compare against a curated library of well-known historical episodes. Scora now records a daily macro snapshot — once enough history accumulates, this tab can also compare today against Scora's own recorded past instead of curated estimates only.
      </div>

      <div style={{ textAlign: "right", fontSize: "10px", color: "var(--sr-text-3)" }}>
        Historical analogs are illustrative and approximate; past regimes do not predict future returns. Not financial advice.
      </div>
    </div>
  );
}
