"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { StockAnalysis, WatchlistItem } from "@/lib/types";
import { getRating } from "@/lib/scoring";
import { Pill } from "@/components/ui/Pill";

interface Props { ticker: string; }

const COMPARE_METRICS = [
  { label: "Scora Score",   key: (a: StockAnalysis) => Number(a.score_total) + Number(a.macro_tilt), best: "max" },
  { label: "Base Score",    key: (a: StockAnalysis) => Number(a.score_total),                        best: "max" },
  { label: "Macro Tilt",    key: (a: StockAnalysis) => Number(a.macro_tilt),                         best: "max" },
  { label: "Value",         key: (a: StockAnalysis) => Number(a.score_val),                          best: "max" },
  { label: "Health",        key: (a: StockAnalysis) => Number(a.score_hlth),                         best: "max" },
  { label: "Momentum",      key: (a: StockAnalysis) => Number(a.score_mom),                          best: "max" },
  { label: "Growth",        key: (a: StockAnalysis) => Number(a.score_growth),                       best: "max" },
];

export default function StockCompare({ ticker }: Props) {
  const { session } = useAuth();
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StockAnalysis>>({});
  const [selected, setSelected] = useState<string[]>([ticker]);

  useEffect(() => {
    if (!session) return;
    supabase.from("sl_watchlist").select("*").then(({ data }) => {
      setWatchlist((data ?? []) as WatchlistItem[]);
    });
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const tickers = watchlist.map(w => w.ticker);
    // Always include current ticker (works even when watchlist is empty)
    if (!tickers.includes(ticker)) tickers.push(ticker);
    supabase.from("sl_analyses").select("*")
      .in("ticker", tickers)
      .order("analysis_date", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, StockAnalysis> = {};
        (data as StockAnalysis[]).forEach(a => { if (!map[a.ticker]) map[a.ticker] = a; });
        setAnalyses(map);
      });
  }, [watchlist, ticker, session]);

  function toggle(t: string) {
    setSelected(prev => {
      if (prev.includes(t)) return prev.length > 1 ? prev.filter(x => x !== t) : prev;
      if (prev.length >= 4) return prev;
      return [...prev, t];
    });
  }

  const activeTickers = selected.filter(t => analyses[t]);

  return (
    <div className="animate-fade-in">
      {/* Ticker selector */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">Select tickers to compare (max 4)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
          {/* Always show current ticker first, even if not in watchlist */}
          {!watchlist.some(w => w.ticker === ticker) && (() => {
            const hasAnalysis = !!analyses[ticker];
            const isSelected = selected.includes(ticker);
            return (
              <button
                key={ticker}
                onClick={() => hasAnalysis && toggle(ticker)}
                style={{
                  padding: "5px 14px",
                  borderRadius: "var(--sr-radius-pill)",
                  fontSize: "var(--sr-t-sm)",
                  fontWeight: 600,
                  cursor: hasAnalysis ? "pointer" : "not-allowed",
                  opacity: hasAnalysis ? 1 : 0.5,
                  background: isSelected ? "var(--sr-amber-dim)" : "var(--sr-surface-2)",
                  color: isSelected ? "var(--sr-amber)" : "var(--sr-text-2)",
                  border: isSelected ? "1px solid color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "1px solid var(--sr-amber)",
                }}
              >
                {ticker} ★{!hasAnalysis && <span style={{ marginLeft: 4, fontSize: "10px", opacity: 0.6 }}>(no analysis)</span>}
              </button>
            );
          })()}
          {watchlist.map(w => {
            const hasAnalysis = !!analyses[w.ticker];
            const isSelected = selected.includes(w.ticker);
            return (
              <button
                key={w.ticker}
                onClick={() => hasAnalysis && toggle(w.ticker)}
                style={{
                  padding: "5px 14px",
                  borderRadius: "var(--sr-radius-pill)",
                  fontSize: "var(--sr-t-sm)",
                  fontWeight: 600,
                  cursor: hasAnalysis ? "pointer" : "not-allowed",
                  opacity: hasAnalysis ? 1 : 0.4,
                  background: isSelected ? "var(--sr-amber-dim)" : "var(--sr-surface-2)",
                  color: isSelected ? "var(--sr-amber)" : "var(--sr-text-2)",
                  border: isSelected ? "1px solid color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "1px solid var(--sr-border)",
                }}
              >
                {w.ticker}
                {w.ticker === ticker && <span style={{ marginLeft: 4, fontSize: "var(--sr-t-xs)", opacity: 0.7 }}>★</span>}
              </button>
            );
          })}
          {watchlist.length === 0 && !analyses[ticker] && (
            <div style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-3)" }}>
              Analyze this ticker first, then add others in the Screener tab to compare.
            </div>
          )}
        </div>
      </div>

      {activeTickers.length < 2 ? (
        <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-text-3)" }}>
          Select at least 2 tickers with saved analyses to compare.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="sr-table">
            <thead><tr>
              <th>Metric</th>
              {activeTickers.map(t => (
                <th key={t} style={{ textAlign: "right" }}>
                  <button
                    onClick={() => router.push(`/stock/${t}`)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: t === ticker ? "var(--sr-amber)" : "var(--sr-text)", fontWeight: 700, fontSize: "var(--sr-t-sm)" }}
                  >
                    {t} {t === ticker ? "★" : ""}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 600 }}>Sector</td>
                {activeTickers.map(t => <td key={t} style={{ textAlign: "right", color: "var(--sr-text-2)" }}>{analyses[t].sector ?? "—"}</td>)}
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Rating</td>
                {activeTickers.map(t => {
                  const r = getRating(Number(analyses[t].score_total));
                  return <td key={t} style={{ textAlign: "right" }}><Pill label={r.label} color={r.color} /></td>;
                })}
              </tr>
              {COMPARE_METRICS.map(m => {
                const vals = activeTickers.map(t => m.key(analyses[t]));
                const best = m.best === "max" ? Math.max(...vals) : Math.min(...vals);
                return (
                  <tr key={m.label}>
                    <td style={{ fontWeight: 600 }}>{m.label}</td>
                    {activeTickers.map((t, i) => {
                      const v = vals[i];
                      const isBest = v === best;
                      const color = m.label.includes("Tilt")
                        ? v > 0 ? "var(--sr-pos)" : v < 0 ? "var(--sr-neg)" : "var(--sr-text-3)"
                        : isBest ? "var(--sr-amber)" : "var(--sr-text-2)";
                      return (
                        <td key={t} style={{
                          textAlign: "right", fontWeight: isBest ? 700 : 400, color,
                          background: isBest ? "color-mix(in srgb, var(--sr-amber) 8%, transparent)" : "transparent",
                        }} className="num">
                          {m.label === "Macro Tilt" && v > 0 ? `+${v}` : `${v}`}
                        </td>
                      );
                    })}
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
