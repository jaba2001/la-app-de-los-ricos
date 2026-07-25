"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";
import { calcScores, calcFactorTilts, getRating, getMacroTilt } from "@/lib/scoring";
import { stockPickingRegime } from "@/lib/microScore";
import { normalizeFundamentals } from "@/lib/normalize";
import { useMacroContext } from "@/lib/MacroContext";
import type { StockAnalysis, WatchlistItem } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

// Data Explorer — optional metric columns the user can toggle on/off over the watchlist
// (TIKR-style). Every metric is already computed & stored in sl_analyses; no new fetch.
const EXTRA_COLS: { key: string; label: string; get: (a: StockAnalysis) => number | null }[] = [
  { key: "score_val",    label: "Value",    get: a => (a.score_val    != null ? Number(a.score_val)    : null) },
  { key: "score_hlth",   label: "Health",   get: a => (a.score_hlth   != null ? Number(a.score_hlth)   : null) },
  { key: "score_mom",    label: "Momentum", get: a => (a.score_mom    != null ? Number(a.score_mom)    : null) },
  { key: "score_growth", label: "Growth",   get: a => (a.score_growth != null ? Number(a.score_growth) : null) },
];

export default function StockScreener() {
  const { session } = useAuth();
  const { macro: macroState } = useMacroContext();
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StockAnalysis>>({});
  const [newTicker, setNewTicker] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzingTickers, setAnalyzingTickers] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"ic_score" | "score_total" | "macro_tilt">("ic_score");
  const [extraCols, setExtraCols] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session) return;
    supabase.from("sl_watchlist").select("*").eq("user_id", session.user.id).then(({ data }) => {
      if (data) setWatchlist(data as WatchlistItem[]);
      setLoading(false);
    });
  }, [session]);

  useEffect(() => {
    if (!watchlist.length) return;
    supabase.from("sl_analyses").select("*")
      .in("ticker", watchlist.map(w => w.ticker))
      .order("analysis_date", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, StockAnalysis> = {};
        (data as StockAnalysis[]).forEach(a => { if (!map[a.ticker]) map[a.ticker] = a; });
        setAnalyses(map);
      });
  }, [watchlist]);

  async function quickAnalyze(ticker: string) {
    if (!session) return;
    setAnalyzingTickers(prev => new Set([...prev, ticker]));
    try {
      const [quoteRes, profileRes, metricsRes, ratiosRes, growthRes, fhMetricRes] = await Promise.allSettled([
        authedFetch<unknown[]>(`/api/fmp/quote?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/profile?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/key-metrics-ttm?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/ratios-ttm?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/financial-growth?symbol=${ticker}&limit=1`),
        authedFetch<{ metric: Record<string, number> }>(`/api/finnhub/stock/metric?symbol=${ticker}&metric=all`),
      ]);

      const quote   = quoteRes.status   === "fulfilled" ? (quoteRes.value   as Record<string,unknown>[])?.[0] ?? null : null;
      const profile = profileRes.status === "fulfilled" ? (profileRes.value as Record<string,unknown>[])?.[0] ?? null : null;
      const fmpKeyMetrics = metricsRes.status === "fulfilled" ? (metricsRes.value as Record<string,unknown>[])?.[0] ?? null : null;
      const fmpRatios     = ratiosRes.status  === "fulfilled" ? (ratiosRes.value  as Record<string,unknown>[])?.[0] ?? null : null;
      const fmpGrowth     = growthRes.status  === "fulfilled" ? (growthRes.value  as Record<string,unknown>[])?.[0] ?? null : null;
      const fhM = fhMetricRes.status === "fulfilled" ? (fhMetricRes.value as { metric?: Record<string, number> })?.metric ?? null : null;

      // Canonical field mapping (FMP-stable + Finnhub) — same layer as the full page.
      const { metrics, ratios } = normalizeFundamentals({ fmpKeyMetrics, fmpRatios, fmpGrowth, finnhubMetric: fhM, profile });

      const sector = profile?.sector as string ?? null;
      const scoreInputs = {
        pe:               metrics?.peRatioTTM              as number ?? null,
        pb:               metrics?.priceToBookRatioTTM     as number ?? null,
        evEbitda:         metrics?.enterpriseValueOverEBITDATTM as number ?? null,
        pfcf:             metrics?.priceToFreeCashFlowsRatioTTM as number ?? null,
        debtEquity:       ratios?.debtEquityRatioTTM       as number ?? null,
        currentRatio:     ratios?.currentRatioTTM          as number ?? null,
        interestCoverage: ratios?.interestCoverageTTM      as number ?? null,
        netDebtEbitda:    metrics?.netDebtToEBITDATTM      as number ?? null,
        roic:             metrics?.roicTTM != null ? (metrics.roicTTM as number) * 100 : null,
        roe:              metrics?.roeTTM  != null ? (metrics.roeTTM  as number) * 100 : null,
        roa:              ratios?.returnOnAssetsTTM != null ? (ratios.returnOnAssetsTTM as number) * 100 : null,
        netMargin:        ratios?.netProfitMarginTTM != null ? (ratios.netProfitMarginTTM as number) * 100 : null,
        grossMargin:      ratios?.grossProfitMarginTTM != null ? (ratios.grossProfitMarginTTM as number) * 100 : null,
        grossProfitability: ratios?.grossProfitMarginTTM != null && ratios?.assetTurnoverTTM != null
          ? (ratios.grossProfitMarginTTM as number) * (ratios.assetTurnoverTTM as number) * 100 : null, // GP/assets (Novy-Marx)

        revenueGrowth:    ratios?.revenueGrowthTTM     != null ? (ratios.revenueGrowthTTM     as number) * 100 : null,
        epsGrowth:        ratios?.netIncomeGrowthTTM   != null ? (ratios.netIncomeGrowthTTM   as number) * 100 : null,
        marketCap:        quote?.marketCap as number ?? null,
        regime:           macroState?.regime_id ?? null,
        sector,
        priceChange1M:    null,
        priceChange3M:    null,
        priceChange6M:    null,
      };
      const calc = calcScores(scoreInputs);
      const tiltResult = macroState && sector ? getMacroTilt(macroState, sector, calcFactorTilts(scoreInputs)) : { tilt: 0 };

      const rating = getRating(calc.total);
      const row = {
        user_id: session!.user.id,
        ticker: ticker.toUpperCase(),
        analysis_date: new Date().toISOString().split("T")[0],
        score_total: calc.total,
        score_val:   calc.value,
        score_hlth:  calc.health,
        score_mom:   calc.momentum,
        score_growth: calc.growth,
        rating: rating.label,
        macro_tilt: tiltResult.tilt,
        sector,
        // P1-8 valuation multiples (fcf_yield needs the cash-flow statement → null in the quick path)
        pe:        (metrics?.peRatioTTM as number) ?? null,
        ev_ebitda: (metrics?.enterpriseValueOverEBITDATTM as number) ?? null,
        pfcf:      (metrics?.priceToFreeCashFlowsRatioTTM as number) ?? null,
        roic:      metrics?.roicTTM != null ? (metrics.roicTTM as number) * 100 : null,
        fcf_yield: null,
      };

      await supabase.from("sl_analyses").upsert(row, { onConflict: "ticker,analysis_date,user_id" });
      setAnalyses(prev => ({ ...prev, [ticker]: row as StockAnalysis }));
    } catch { /* fail silently — screener still shows the row */ }
    setAnalyzingTickers(prev => { const s = new Set(prev); s.delete(ticker); return s; });
  }

  async function addTicker(e: React.FormEvent) {
    e.preventDefault();
    const t = newTicker.trim().toUpperCase();
    if (!t || watchlist.some(w => w.ticker === t)) return;
    const { data } = await supabase.from("sl_watchlist").insert({ user_id: session!.user.id, ticker: t }).select().single();
    if (data) {
      setWatchlist(prev => [...prev, data as WatchlistItem]);
      setNewTicker("");
      quickAnalyze(t);
    }
  }

  async function removeTicker(t: string) {
    await supabase.from("sl_watchlist").delete().eq("ticker", t).eq("user_id", session!.user.id);
    setWatchlist(prev => prev.filter(w => w.ticker !== t));
  }

  const sorted = [...watchlist].sort((a, b) => {
    const aa = analyses[a.ticker];
    const ba = analyses[b.ticker];
    if (!aa && !ba) return 0;
    if (!aa) return 1;
    if (!ba) return -1;
    if (sortBy === "ic_score") return (Number(ba.score_total) + Number(ba.macro_tilt ?? 0)) - (Number(aa.score_total) + Number(aa.macro_tilt ?? 0));
    if (sortBy === "score_total") return Number(ba.score_total) - Number(aa.score_total);
    if (sortBy === "macro_tilt") return Number(ba.macro_tilt ?? 0) - Number(aa.macro_tilt ?? 0);
    return 0;
  });

  const picking = stockPickingRegime(macroState?.implied_corr ?? null);

  function toggleCol(key: string) {
    setExtraCols(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  }

  // Export the full watchlist (all base + toggled metric columns) — the "Data Explorer" export.
  function exportWatchlistCSV() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`; // RFC-4180 quote-escaping
    const cols = EXTRA_COLS.filter(c => extraCols.has(c.key));
    const header = ["Ticker", "Sector", "Base Score", ...cols.map(c => c.label), "Macro Tilt", "Scora Score", "Rating", "As Of"];
    const lines = [header.map(esc).join(",")];
    for (const w of sorted) {
      const a = analyses[w.ticker];
      const tilt = macroState && a?.sector ? getMacroTilt(macroState, a.sector).tilt : (a?.macro_tilt != null ? Number(a.macro_tilt) : null);
      const ic = a ? Number(a.score_total) + (tilt ?? 0) : null;
      const cells = [
        w.ticker,
        a?.sector ?? "",
        a ? Number(a.score_total).toFixed(0) : "",
        ...cols.map(c => { const v = a ? c.get(a) : null; return v != null ? v.toFixed(0) : ""; }),
        tilt != null ? String(tilt) : "",
        ic != null ? ic.toFixed(0) : "",
        a?.rating ?? "",
        a?.analysis_date ?? "",
      ];
      lines.push(cells.map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `scora_watchlist_${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-fade-in">
      {/* Stock-picking regime — validated Phase 4 context: does selecting names pay right now? */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${picking.color} 9%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${picking.color} 28%, transparent)` }}>
        <span style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: picking.color, whiteSpace: "nowrap" }}>Selection regime: {picking.label}</span>
        <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", lineHeight: 1.4 }}>
          {macroState?.implied_corr != null ? `Implied correlation ${macroState.implied_corr.toFixed(1)}. ` : ""}{picking.detail}
        </span>
      </div>

      {/* Add ticker */}
      <form onSubmit={addTicker} style={{ display: "flex", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)", maxWidth: 400 }}>
        <input
          className="sr-input"
          placeholder="Add ticker to watchlist"
          value={newTicker}
          onChange={e => setNewTicker(e.target.value.toUpperCase())}
        />
        <button type="submit" className="btn-primary" style={{ flexShrink: 0 }}>Add</button>
      </form>

      {/* Sort controls */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-3)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", alignSelf: "center" }}>Sort by:</span>
        {([["ic_score", "Scora Score"], ["score_total", "Base Score"], ["macro_tilt", "Macro Tilt"]] as const).map(([key, label]) => (
          <button
            key={key}
            className={`subtab ${sortBy === key ? "active" : ""}`}
            onClick={() => setSortBy(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Data Explorer — toggle metric columns + export */}
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)", alignSelf: "center" }}>Columns:</span>
        {EXTRA_COLS.map(c => (
          <button key={c.key} className={`subtab ${extraCols.has(c.key) ? "active" : ""}`} onClick={() => toggleCol(c.key)}>
            {extraCols.has(c.key) ? "✓ " : "+ "}{c.label}
          </button>
        ))}
        {watchlist.length > 0 && (
          <button
            onClick={exportWatchlistCSV}
            style={{ marginLeft: "auto", background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)", color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)", padding: "5px 10px", cursor: "pointer" }}
          >
            ↓ Export CSV
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <Sk w="100%" h={300} />
      ) : watchlist.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-10)", color: "var(--sr-text-3)" }}>
          Watchlist is empty. Add tickers above.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="sr-table">
            <thead><tr>
              <th>Ticker</th><th>Sector</th><th style={{ textAlign: "right" }}>Base Score</th>
              {EXTRA_COLS.filter(c => extraCols.has(c.key)).map(c => (
                <th key={c.key} style={{ textAlign: "right" }}>{c.label}</th>
              ))}
              <th style={{ textAlign: "right" }}>Macro Tilt</th><th style={{ textAlign: "right" }}>Scora Score</th>
              <th>Rating</th><th>As of</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map(w => {
                const a = analyses[w.ticker];
                const isAnalyzing = analyzingTickers.has(w.ticker);
                const liveTilt = macroState && a?.sector ? getMacroTilt(macroState, a.sector).tilt : null;
                const tilt = liveTilt ?? (a?.macro_tilt != null ? Number(a.macro_tilt) : null);
                const ic = a ? Number(a.score_total) + (tilt ?? 0) : null;
                const rating = a ? getRating(Number(a.score_total)) : null;
                // Rows are each ticker's LATEST analysis, which can be days apart — the
                // date makes cross-ticker comparisons honest; >7 days flags as stale.
                const daysOld = a?.analysis_date ? Math.max(0, Math.floor((Date.now() - new Date(a.analysis_date + "T00:00:00Z").getTime()) / 86400000)) : null;
                const stale = daysOld != null && daysOld > 7;
                return (
                  <tr key={w.ticker} style={{ cursor: "pointer" }} onClick={() => router.push(`/stock/${w.ticker}`)}>
                    <td style={{ fontWeight: 700, color: "var(--sr-text)" }}>
                      {w.ticker}
                      {isAnalyzing && (
                        <span style={{ marginLeft: 6, fontSize: "var(--sr-t-xs)", color: "var(--sr-amber)", fontWeight: 400 }}>analyzing…</span>
                      )}
                    </td>
                    <td style={{ color: "var(--sr-text-3)" }}>{a?.sector ?? "—"}</td>
                    <td style={{ textAlign: "right" }} className="num">{a ? Number(a.score_total).toFixed(0) : isAnalyzing ? "…" : "—"}</td>
                    {EXTRA_COLS.filter(c => extraCols.has(c.key)).map(c => {
                      const v = a ? c.get(a) : null;
                      return <td key={c.key} style={{ textAlign: "right", color: "var(--sr-text-2)" }} className="num">{v != null ? v.toFixed(0) : isAnalyzing ? "…" : "—"}</td>;
                    })}
                    <td style={{ textAlign: "right", color: tilt != null ? (tilt > 0 ? "var(--sr-pos)" : tilt < 0 ? "var(--sr-neg)" : "var(--sr-text-3)") : "var(--sr-text-3)" }} className="num">
                      {tilt != null ? `${tilt > 0 ? "+" : ""}${tilt}` : "—"}
                      {liveTilt != null && <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginLeft: 3 }} title="Live tilt from current macro">↻</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: ic != null ? (ic >= 65 ? "var(--sr-pos)" : ic >= 50 ? "var(--sr-warn)" : "var(--sr-neg)") : "var(--sr-text-3)" }} className="num">
                      {ic != null ? ic.toFixed(0) : isAnalyzing ? "…" : "—"}
                    </td>
                    <td>{rating ? <Pill label={rating.label} color={rating.color} /> : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="num" style={{ fontSize: "var(--sr-t-xs)", color: stale ? "var(--sr-warn)" : "var(--sr-text-3)" }} title={a?.analysis_date ? `Scored on ${a.analysis_date}${stale ? " — stale, re-analyze to compare fairly" : ""}` : undefined}>
                        {a?.analysis_date ? (daysOld === 0 ? "today" : daysOld === 1 ? "1d ago" : `${daysOld}d ago`) : "—"}
                        {stale ? " ⚠" : ""}
                      </span>
                      {a && !isAnalyzing && (
                        <button
                          title="Re-analyze with fresh data"
                          style={{ background: "none", border: "none", color: "var(--sr-text-3)", cursor: "pointer", padding: "2px 4px", fontSize: "var(--sr-t-xs)" }}
                          onClick={e => { e.stopPropagation(); quickAnalyze(w.ticker); }}
                        >↻</button>
                      )}
                    </td>
                    <td>
                      <button
                        style={{ background: "none", border: "none", color: "var(--sr-text-3)", cursor: "pointer", padding: "4px 8px", fontSize: "var(--sr-t-base)" }}
                        onClick={e => { e.stopPropagation(); removeTicker(w.ticker); }}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
