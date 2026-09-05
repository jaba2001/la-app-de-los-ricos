"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import type { StockAnalysis, WatchlistItem } from "./types";

interface WatchlistAnalyses {
  watchlist: WatchlistItem[];
  /** Latest analysis per ticker (deduped, newest kept). */
  analyses: Record<string, StockAnalysis>;
  loading: boolean;
  refetch: () => void;
}

/**
 * Shared read of the user's watchlist plus the most-recent sl_analyses row per
 * ticker. Six components repeated this fetch-watchlist → fetch-analyses → dedup
 * dance with subtle differences (one forgot RLS user scoping); centralizing it
 * removes that drift. `extraTickers` guarantees rows for tickers not yet in the
 * watchlist (e.g. the currently-viewed stock in the Compare tab).
 */
export function useWatchlistAnalyses(extraTickers: string[] = []): WatchlistAnalyses {
  const { session } = useAuth();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StockAnalysis>>({});
  const [loading, setLoading] = useState(true);

  const extraKey = extraTickers.join(",");

  const load = useCallback(async () => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    const { data: wl } = await supabase
      .from("sl_watchlist")
      .select("*")
      .eq("user_id", session.user.id);
    const list = (wl ?? []) as WatchlistItem[];
    setWatchlist(list);

    const tickers = Array.from(new Set([...list.map(w => w.ticker), ...extraTickers]));
    if (tickers.length === 0) { setAnalyses({}); setLoading(false); return; }

    const { data: rows } = await supabase
      .from("sl_analyses")
      .select("*")
      .in("ticker", tickers)
      .order("analysis_date", { ascending: false });
    const map: Record<string, StockAnalysis> = {};
    if (rows) (rows as StockAnalysis[]).forEach(a => { if (!map[a.ticker]) map[a.ticker] = a; });
    setAnalyses(map);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, extraKey]);

  useEffect(() => { load(); }, [load]);

  return { watchlist, analyses, loading, refetch: load };
}
