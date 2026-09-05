"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { getMacroTilt, getRating } from "@/lib/scoring";
import { HISTORICAL_ANALOGS } from "@/lib/historicalAnalogs";
import type { MacroState, StockAnalysis } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";
import SignalBacktest from "@/components/macro/SignalBacktest";
import AllWeatherAllocator from "@/components/macro/AllWeatherAllocator";
import RegimeRadar from "@/components/macro/RegimeRadar";
import SecularClock from "@/components/macro/SecularClock";
import SectorRotation from "@/components/macro/SectorRotation";
import ScoraBrief from "@/components/macro/ScoraBrief";
import { latestAnalyses } from "@/lib/latestAnalyses";

interface Props { macro: MacroState | null; loading: boolean; }

interface PortfolioEntry {
  ticker: string;
  analysis: StockAnalysis;
  liveTilt: number;
  tiltLabel: string;
  tiltColor: string;
  icScore: number;
}

// Aligns with getMacroTilt label thresholds: Favorable≥6, Neutral≥-2, Caution≥-8, Unfavorable<-8
function tiltBucket(tiltLabel: string): "favorable" | "neutral" | "headwind" {
  if (tiltLabel === "Favorable") return "favorable";
  if (tiltLabel === "Caution" || tiltLabel === "Unfavorable") return "headwind";
  return "neutral";
}

// ── Feature 7: Regime Coverage Map ──────────────────────────────────────────
// For each sector, which of the 4 regimes does it tend to cover?
const SECTOR_REGIME_COVERAGE: Record<string, string[]> = {
  "Technology":              ["expansion"],
  "Communication Services":  ["expansion"],
  "Consumer Cyclical":       ["expansion", "reflation"],
  "Financials":              ["expansion", "reflation"],
  "Industrials":             ["expansion", "reflation"],
  "Energy":                  ["reflation", "stagflation"],
  "Materials":               ["reflation", "stagflation"],
  "Real Estate":             ["reflation"],
  "Consumer Defensive":      ["contraction", "stagflation"],
  "Healthcare":              ["contraction", "stagflation"],
  "Utilities":               ["contraction", "stagflation"],
};
const REGIME_LABELS: Record<string, string> = {
  expansion:   "Expansion",
  reflation:   "Reflation",
  stagflation: "Stagflation",
  contraction: "Contraction",
};
const REGIME_DESC: Record<string, string> = {
  expansion:   "Growth↑ Inflation↓ — tech, growth, cyclicals",
  reflation:   "Growth↑ Inflation↑ — energy, materials, value",
  stagflation: "Growth↓ Inflation↑ — defensives, gold, commodities",
  contraction: "Growth↓ Inflation↓ — bonds, defensives, cash",
};

// ── Feature 8: Satellite Asset Suggestions ───────────────────────────────────
interface SatelliteAsset { ticker: string; label: string; reason: string; regimes: string[] }
const SATELLITE_UNIVERSE: SatelliteAsset[] = [
  { ticker: "GLD",  label: "Gold",                reason: "Inflation & currency debasement hedge; covers reflation + stagflation", regimes: ["reflation","stagflation"] },
  { ticker: "TLT",  label: "Long Bonds",          reason: "Deflationary contraction hedge — quality duration outperforms in recession", regimes: ["contraction"] },
  { ticker: "SHV",  label: "Short T-Bills",       reason: "Cash equivalent; benefits from high rates in stagflation without duration risk", regimes: ["stagflation"] },
  { ticker: "TIP",  label: "TIPS",                reason: "Real yield protection in reflation — principal tied to CPI", regimes: ["reflation","stagflation"] },
  { ticker: "XLE",  label: "Energy ETF",          reason: "Oil & gas outperforms in reflation and stagflation supply shocks", regimes: ["reflation","stagflation"] },
  { ticker: "XLU",  label: "Utilities ETF",       reason: "Defensive; outperforms in contraction and stagflation", regimes: ["contraction","stagflation"] },
  { ticker: "XLV",  label: "Healthcare ETF",      reason: "Defensive growth; minimal macro sensitivity", regimes: ["contraction","stagflation"] },
  { ticker: "DJP",  label: "Commodities Broad",   reason: "Broad commodity exposure as reflation hedge", regimes: ["reflation"] },
  { ticker: "VNQ",  label: "REITs",               reason: "Hard assets; partly inflation-protected in early reflation", regimes: ["reflation"] },
  { ticker: "QQQ",  label: "Nasdaq 100",          reason: "Growth concentration; benefits most in expansion with low rates", regimes: ["expansion"] },
  { ticker: "VWO",  label: "EM Equities",         reason: "Cyclical exposure; outperforms in global expansion", regimes: ["expansion","reflation"] },
  { ticker: "IAU",  label: "Gold (iShares)",      reason: "Negative real rates / USD weakness hedge", regimes: ["reflation","stagflation"] },
  { ticker: "PDBC", label: "Commodity Futures",   reason: "Pure commodity carry; avoids roll issues of DJP in backwardation", regimes: ["reflation"] },
];

function getSatelliteSuggestions(macro: MacroState | null): SatelliteAsset[] {
  if (!macro) return [];
  const regime = macro.regime_id ?? "neutral";
  const creditHigh = (macro.credit_stress ?? 0) > 60;
  const inflHigh   = (macro.core_pce_yoy ?? macro.core_cpi_yoy ?? 0) > 3.0;
  const rpcHigh    = (macro.recession_prob ?? 0) > 50;

  const priorityRegimes = new Set<string>([regime]);
  if (inflHigh) { priorityRegimes.add("reflation"); priorityRegimes.add("stagflation"); }
  if (rpcHigh || creditHigh) { priorityRegimes.add("contraction"); }

  // Score each satellite by how many priority regimes it covers
  const scored = SATELLITE_UNIVERSE.map(s => ({
    ...s,
    score: s.regimes.filter(r => priorityRegimes.has(r)).length,
  })).filter(s => s.score > 0)
     .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5);
}

// ── Feature 10: Portfolio Regime Stress Test ──────────────────────────────────
// Sector → estimated relative performance multiplier vs SPY in each analog
// Based on analog.sectorImpact outperformers/underperformers
function estimatePortfolioDrawdown(
  portfolioSectors: string[],
  analog: typeof HISTORICAL_ANALOGS[0],
): { estimated: number | null; explanation: string } {
  const spyDd = analog.marketImpact.spyDrawdownPct;
  if (spyDd == null || portfolioSectors.length === 0) {
    return { estimated: null, explanation: "Insufficient data" };
  }
  const out = new Set(analog.sectorImpact.outperformers);
  const und = new Set(analog.sectorImpact.underperformers);

  let sumMult = 0;
  portfolioSectors.forEach(sector => {
    if (out.has(sector)) sumMult += 0.5;       // outperformer: ~half the SPY drawdown
    else if (und.has(sector)) sumMult += 1.5;  // underperformer: ~1.5× the SPY drawdown
    else sumMult += 1.0;                        // neutral: in-line with SPY
  });
  const avgMult = sumMult / portfolioSectors.length;
  const estimated = spyDd * avgMult;

  const outCount = portfolioSectors.filter(s => out.has(s)).length;
  const undCount = portfolioSectors.filter(s => und.has(s)).length;
  const explanation = outCount > undCount
    ? `${outCount}/${portfolioSectors.length} positions in outperforming sectors`
    : undCount > outCount
    ? `${undCount}/${portfolioSectors.length} positions in underperforming sectors — elevated exposure`
    : "Mixed sector exposure — roughly in-line with index";

  return { estimated: Math.round(estimated * 10) / 10, explanation };
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
    setLoadingData(true);
    const m = macro; // capture non-null macro for async closure

    supabase.from("sl_watchlist").select("ticker").eq("user_id", session.user.id)
      .then(({ data: wlData, error: wlErr }) => {
        if (wlErr || !wlData || wlData.length === 0) { setLoadingData(false); return; }
        const tickers = (wlData as { ticker: string }[]).map(w => w.ticker);
        latestAnalyses(tickers)
          .then((latest) => {

            const result: PortfolioEntry[] = tickers
              .filter(t => latest[t])
              .map(t => {
                const a = latest[t];
                const sector = a.sector ?? null;
                const tiltResult = sector ? getMacroTilt(m, sector) : { tilt: 0, label: "Neutral", color: "var(--sr-text-3)" };
                const tilt = tiltResult.tilt;
                const icScore = Math.max(0, Math.min(100, Number(a.score_total) + tilt));
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

  if (!session) return (
    <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
      Inicia sesión para ver tu cartera.
    </div>
  );

  const buckets = {
    favorable: entries.filter(e => tiltBucket(e.tiltLabel) === "favorable"),
    neutral:   entries.filter(e => tiltBucket(e.tiltLabel) === "neutral"),
    headwind:  entries.filter(e => tiltBucket(e.tiltLabel) === "headwind"),
  };

  const avgIc = entries.length ? entries.reduce((s, e) => s + e.icScore, 0) / entries.length : 0;
  const regimeLabel = macro?.regime_label ?? "—";
  const regimeColor = macro?.regime_id === "expansion" ? "var(--sr-pos)" : macro?.regime_id === "contraction" || macro?.regime_id === "stagflation" ? "var(--sr-neg)" : "var(--sr-warn)";

  return (
    <div className="animate-fade-in">
      {/* Layer 1 secular → Layer 2 multi-asset → Regime Radar (macro-driven, shown regardless of watchlist) */}
      <SecularClock macro={macro} />
      <AllWeatherAllocator macro={macro} />
      <SectorRotation regime={macro?.regime_id ?? null} />
      <RegimeRadar macro={macro} />
      <ScoraBrief macro={macro} />

      {(loading || loadingData) ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-4)" }}>
          {[0, 1, 2].map(i => <div key={i} className="card" style={{ height: 120 }}><Sk w="100%" h={100} /></div>)}
        </div>
      ) : entries.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
          <p style={{ marginBottom: "var(--sr-sp-2)", fontSize: "var(--sr-t-base)" }}>Tu watchlist está vacía</p>
          <p style={{ fontSize: "var(--sr-t-sm)" }}>
            Agrega tickers desde la página de Stock (★) o desde el Screener.
          </p>
        </div>
      ) : (
        <>
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

      {/* Feature 7: Regime Coverage Map 2×2 */}
      {(() => {
        const regimes = ["expansion", "reflation", "stagflation", "contraction"] as const;
        const regimeColors: Record<string, string> = { expansion: "var(--sr-pos)", reflation: "var(--sr-amber)", stagflation: "var(--sr-warn)", contraction: "var(--sr-neg)" };
        const coverageCounts: Record<string, number> = { expansion: 0, reflation: 0, stagflation: 0, contraction: 0 };
        entries.forEach(e => {
          const covrs = SECTOR_REGIME_COVERAGE[e.analysis.sector ?? ""] ?? [];
          covrs.forEach(r => { if (r in coverageCounts) coverageCounts[r]++; });
        });
        const total = entries.length || 1;
        return (
          <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
            <div className="section-label">Regime Coverage Map</div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
              How many of your {entries.length} positions provide exposure to each economic regime (sectors may cover multiple)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-3)" }}>
              {regimes.map(r => {
                const count = coverageCounts[r];
                const pct = Math.round((count / total) * 100);
                const col = regimeColors[r];
                const isCurrentRegime = macro?.regime_id === r;
                return (
                  <div key={r} style={{
                    padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)",
                    background: isCurrentRegime ? `color-mix(in srgb, ${col} 10%, var(--sr-surface-2))` : "var(--sr-surface-2)",
                    border: isCurrentRegime ? `1px solid color-mix(in srgb, ${col} 35%, transparent)` : "1px solid transparent",
                  }}>
                    <div className="sr-flex-between" style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: col }}>{REGIME_LABELS[r]}</span>
                      {isCurrentRegime && <span style={{ fontSize: "9px", color: col, fontWeight: 700 }}>← CURRENT</span>}
                    </div>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 6 }}>{REGIME_DESC[r]}</div>
                    <div style={{ height: 4, borderRadius: 2, background: "var(--sr-surface-3)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: col, borderRadius: 2, transition: "width 500ms ease" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: "10px", color: "var(--sr-text-3)" }}>
                      <span>{count} position{count !== 1 ? "s" : ""}</span>
                      <span style={{ color: col, fontWeight: 600 }} className="num">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {(() => {
              const currentRegimeCount = coverageCounts[macro?.regime_id ?? ""] ?? 0;
              const currentPct = Math.round((currentRegimeCount / total) * 100);
              return currentPct < 25 ? (
                <div style={{ marginTop: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-warn) 8%, var(--sr-surface-2))", border: "1px solid color-mix(in srgb, var(--sr-warn) 25%, transparent)", fontSize: "var(--sr-t-xs)", color: "var(--sr-warn)" }}>
                  ⚠ Only {currentPct}% of your portfolio aligns with the current {REGIME_LABELS[macro?.regime_id ?? ""]} regime — consider rotating toward aligned sectors
                </div>
              ) : null;
            })()}
          </div>
        );
      })()}

      {/* Feature 8: Satellite Asset Suggestions */}
      {(() => {
        const satellites = getSatelliteSuggestions(macro);
        if (satellites.length === 0) return null;
        const regime = macro?.regime_id ?? "neutral";
        const regimeColor = regime === "expansion" ? "var(--sr-pos)" : regime === "reflation" ? "var(--sr-amber)" : regime === "stagflation" ? "var(--sr-warn)" : regime === "contraction" ? "var(--sr-neg)" : "var(--sr-text-2)";
        return (
          <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-2)" }}>
              <div className="section-label" style={{ marginBottom: 0 }}>Satellite Asset Suggestions</div>
              <span style={{ fontSize: "var(--sr-t-xs)", color: regimeColor, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${regimeColor} 12%, transparent)` }}>
                {REGIME_LABELS[regime] ?? regime}
              </span>
            </div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
              Based on Trainor-Black satellite portfolio theory — complement your core equity holdings with regime-specific hedges
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
              {satellites.map(s => (
                <div key={s.ticker} style={{ display: "flex", alignItems: "flex-start", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)" }}>
                  <div style={{ minWidth: 52, padding: "4px 8px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, var(--sr-amber) 12%, transparent)`, border: "1px solid color-mix(in srgb, var(--sr-amber) 25%, transparent)", textAlign: "center" }}>
                    <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: "var(--sr-amber)" }}>{s.ticker}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.4 }}>{s.reason}</div>
                    <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginTop: 4 }}>
                      {s.regimes.map(r => (
                        <span key={r} style={{ fontSize: "9px", fontWeight: 600, padding: "1px 6px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, var(--sr-text-3) 15%, transparent)`, color: "var(--sr-text-3)" }}>
                          {REGIME_LABELS[r]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)" }}>
              Not investment advice — these are ETF examples for educational purposes only. Research before trading.
            </div>
          </div>
        );
      })()}

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

      {/* Feature 10: Portfolio Regime Stress Test */}
      {entries.length > 0 && (() => {
        const portfolioSectors = entries.map(e => e.analysis.sector ?? "").filter(Boolean);
        // Use top 5 most relevant analogs (with known SPY drawdown)
        const analogsWithData = HISTORICAL_ANALOGS
          .filter(a => a.marketImpact.spyDrawdownPct != null)
          .sort((a, b) => Math.abs(b.marketImpact.spyDrawdownPct!) - Math.abs(a.marketImpact.spyDrawdownPct!));

        return (
          <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
            <div className="section-label">Portfolio Regime Stress Test</div>
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-3)" }}>
              Estimated portfolio drawdown vs SPY in historical macro episodes — based on your portfolio's sector composition
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="sr-table" style={{ fontSize: "var(--sr-t-xs)", minWidth: 520 }}>
                <thead>
                  <tr>
                    <th>Episode</th>
                    <th style={{ textAlign: "center" }}>Regime</th>
                    <th style={{ textAlign: "right" }}>SPY Peak-Trough</th>
                    <th style={{ textAlign: "right" }}>Est. Portfolio</th>
                    <th style={{ textAlign: "right" }}>vs SPY</th>
                    <th>Sector Read</th>
                  </tr>
                </thead>
                <tbody>
                  {analogsWithData.map(analog => {
                    const { estimated, explanation } = estimatePortfolioDrawdown(portfolioSectors, analog);
                    const spyDd = analog.marketImpact.spyDrawdownPct!;
                    const diff = estimated != null ? estimated - spyDd : null;
                    const regimeColorMap: Record<string, string> = { expansion: "var(--sr-pos)", reflation: "var(--sr-amber)", stagflation: "var(--sr-warn)", contraction: "var(--sr-neg)", neutral: "var(--sr-text-3)" };
                    const rCol = regimeColorMap[analog.regimeId] ?? "var(--sr-text-3)";
                    return (
                      <tr key={analog.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{analog.label}</div>
                          <div style={{ color: "var(--sr-text-3)", fontSize: "10px" }}>{analog.dateRange}</div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: rCol, padding: "1px 6px", borderRadius: "var(--sr-radius-pill)", background: `color-mix(in srgb, ${rCol} 12%, transparent)` }}>
                            {REGIME_LABELS[analog.regimeId] ?? analog.regimeId}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", color: "var(--sr-neg)", fontWeight: 600 }} className="num">
                          {spyDd.toFixed(1)}%
                        </td>
                        {/* Drawdowns are negative: more negative than SPY = worse = red */}
                        <td style={{ textAlign: "right", fontWeight: 700, color: estimated != null ? (estimated < spyDd ? "var(--sr-neg)" : "var(--sr-pos)") : "var(--sr-text-3)" }} className="num">
                          {estimated != null ? `${estimated.toFixed(1)}%` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: diff == null ? "var(--sr-text-3)" : diff < 0 ? "var(--sr-neg)" : "var(--sr-pos)" }} className="num">
                          {diff != null ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}pp` : "—"}
                        </td>
                        <td style={{ color: "var(--sr-text-3)", fontSize: "10px", maxWidth: 180 }}>{explanation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
              Estimates based on sector classification: outperformers in each episode → ~0.5× SPY drawdown; underperformers → ~1.5× SPY drawdown.
              Historical analogies are educational — actual outcomes depend on position sizing, correlations, and timing.
            </div>
          </div>
        );
      })()}

      {/* Signal backtest — does the score have a track record vs SPY? */}
      <SignalBacktest />
        </>
      )}
    </div>
  );
}
