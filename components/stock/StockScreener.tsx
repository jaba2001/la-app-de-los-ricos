"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { authedFetch } from "@/lib/proxy";
import { calcScores, getRating, getMacroTilt } from "@/lib/scoring";
import { useMacroContext } from "@/lib/MacroContext";
import type { StockAnalysis, WatchlistItem } from "@/lib/types";
import { Sk } from "@/components/ui/Skeleton";
import { Pill } from "@/components/ui/Pill";

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

  useEffect(() => {
    if (!session) return;
    supabase.from("sl_watchlist").select("*").then(({ data }) => {
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
    setAnalyzingTickers(prev => new Set([...prev, ticker]));
    try {
      const [quoteRes, profileRes, metricsRes, ratiosRes] = await Promise.allSettled([
        authedFetch<unknown[]>(`/api/fmp/quote?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/profile?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/key-metrics-ttm?symbol=${ticker}`),
        authedFetch<unknown[]>(`/api/fmp/ratios-ttm?symbol=${ticker}`),
      ]);

      const quote   = quoteRes.status   === "fulfilled" ? (quoteRes.value   as Record<string,unknown>[])?.[0] ?? null : null;
      const profile = profileRes.status === "fulfilled" ? (profileRes.value as Record<string,unknown>[])?.[0] ?? null : null;
      const metrics = metricsRes.status === "fulfilled" ? (metricsRes.value as Record<string,unknown>[])?.[0] ?? null : null;
      const ratios  = ratiosRes.status  === "fulfilled" ? (ratiosRes.value  as Record<string,unknown>[])?.[0] ?? null : null;

      const sector = profile?.sector as string ?? null;
      const tiltResult = macroState && sector ? getMacroTilt(macroState, sector) : { tilt: 0 };

      const calc = calcScores({
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
        grossMargin:      ratios?.grossProfitMarginTTM != null ? (ratios.grossProfitMarginTTM as number) * 100 : null,
        revenueGrowth:    ratios?.revenueGrowthTTM     != null ? (ratios.revenueGrowthTTM     as number) * 100 : null,
        epsGrowth:        ratios?.netIncomeGrowthTTM   != null ? (ratios.netIncomeGrowthTTM   as number) * 100 : null,
        marketCap:        quote?.marketCap as number ?? null,
        regime:           macroState?.regime_id ?? null,
        priceChange1M:    null,
        priceChange3M:    null,
        priceChange6M:    null,
      });

      const rating = getRating(calc.total);
      const row = {
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
      };

      await supabase.from("sl_analyses").upsert(row, { onConflict: "ticker,analysis_date" });
      setAnalyses(prev => ({ ...prev, [ticker]: row as StockAnalysis }));
    } catch { /* fail silently — screener still shows the row */ }
    setAnalyzingTickers(prev => { const s = new Set(prev); s.delete(ticker); return s; });
  }

  async function addTicker(e: React.FormEvent) {
    e.preventDefault();
    const t = newTicker.trim().toUpperCase();
    if (!t || watchlist.some(w => w.ticker === t)) return;
    const { data } = await supabase.from("sl_watchlist").insert({ ticker: t }).select().single();
    if (data) {
      setWatchlist(prev => [...prev, data as WatchlistItem]);
      setNewTicker("");
      quickAnalyze(t);
    }
  }

  async function removeTicker(t: string) {
    await supabase.from("sl_watchlist").delete().eq("ticker", t);
    setWatchlist(prev => prev.filter(w => w.ticker !== t));
  }

  const sorted = [...watchlist].sort((a, b) => {
    const aa = analyses[a.ticker];
    const ba = analyses[b.ticker];
    if (!aa && !ba) return 0;
    if (!aa) return 1;
    if (!ba) return -1;
    if (sortBy === "ic_score") return (Number(ba.score_total) + Number(ba.macro_tilt)) - (Number(aa.score_total) + Number(aa.macro_tilt));
    if (sortBy === "score_total") return Number(ba.score_total) - Number(aa.score_total);
    if (sortBy === "macro_tilt") return Number(ba.macro_tilt) - Number(aa.macro_tilt);
    return 0;
  });

  return (
    <div className="animate-fade-in">
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
      <div style={{ display: "flex", gap: "var(--sr-sp-2)", marginBottom: "var(--sr-sp-4)" }}>
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
              <th style={{ textAlign: "right" }}>Macro Tilt</th><th style={{ textAlign: "right" }}>Scora Score</th>
              <th>Rating</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map(w => {
                const a = analyses[w.ticker];
                const isAnalyzing = analyzingTickers.has(w.ticker);
                const liveTilt = macroState && a?.sector ? getMacroTilt(macroState, a.sector).tilt : null;
                const tilt = liveTilt ?? (a?.macro_tilt != null ? Number(a.macro_tilt) : null);
                const ic = a ? Number(a.score_total) + (tilt ?? 0) : null;
                const rating = a ? getRating(Number(a.score_total)) : null;
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
                    <td style={{ textAlign: "right", color: tilt != null ? (tilt > 0 ? "var(--sr-pos)" : tilt < 0 ? "var(--sr-neg)" : "var(--sr-text-3)") : "var(--sr-text-3)" }} className="num">
                      {tilt != null ? `${tilt > 0 ? "+" : ""}${tilt}` : "—"}
                      {liveTilt != null && <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginLeft: 3 }} title="Live tilt from current macro">↻</span>}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: ic != null ? (ic >= 65 ? "var(--sr-pos)" : ic >= 50 ? "var(--sr-warn)" : "var(--sr-neg)") : "var(--sr-text-3)" }} className="num">
                      {ic != null ? ic.toFixed(0) : isAnalyzing ? "…" : "—"}
                    </td>
                    <td>{rating ? <Pill label={rating.label} color={rating.color} /> : "—"}</td>
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
