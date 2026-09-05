"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { authedFetch } from "@/lib/proxy";
import type { StockAnalysis, WatchlistItem } from "@/lib/types";
import { getRating } from "@/lib/scoring";
import { Sk } from "@/components/ui/Skeleton";

interface SearchResult { symbol: string; name: string; exchangeShortName: string; }

function tickerFlag(symbol: string, exchange: string): string {
  const dot = symbol.lastIndexOf(".");
  if (dot === -1) return ["NASDAQ", "NYSE", "AMEX"].includes(exchange) ? "🇺🇸" : "🌐";
  const sfx = symbol.slice(dot + 1).toUpperCase();
  const FLAGS: Record<string, string> = {
    PA: "🇫🇷", DE: "🇩🇪", L: "🇬🇧", MI: "🇮🇹", AS: "🇳🇱", SW: "🇨🇭",
    MC: "🇪🇸", ST: "🇸🇪", CO: "🇩🇰", OL: "🇳🇴", HE: "🇫🇮", LS: "🇵🇹",
    BR: "🇧🇪", VI: "🇦🇹", TO: "🇨🇦", AX: "🇦🇺", HK: "🇭🇰", T: "🇯🇵", SI: "🇸🇬",
  };
  return FLAGS[sfx] ?? "🌐";
}

const QUICK_PICKS = [
  { t: "AAPL",    l: "🇺🇸" }, { t: "MSFT",    l: "🇺🇸" }, { t: "NVDA",    l: "🇺🇸" },
  { t: "AMZN",    l: "🇺🇸" }, { t: "MC.PA",   l: "🇫🇷" }, { t: "SAP.DE",  l: "🇩🇪" },
  { t: "SAN.MC",  l: "🇪🇸" }, { t: "NESN.SW", l: "🇨🇭" }, { t: "BP.L",    l: "🇬🇧" },
  { t: "ASML.AS", l: "🇳🇱" },
];

export default function StockPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [ticker, setTicker] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StockAnalysis>>({});
  const [loadingWl, setLoadingWl] = useState(true);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    supabase.from("sl_watchlist").select("*").eq("user_id", session!.user.id).then(({ data }) => {
      if (data) setWatchlist(data as WatchlistItem[]);
      setLoadingWl(false);
    });
  }, [session]);

  useEffect(() => {
    if (!watchlist.length) return;
    const tickers = watchlist.map(w => w.ticker);
    supabase
      .from("sl_analyses")
      .select("*")
      .in("ticker", tickers)
      .order("analysis_date", { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, StockAnalysis> = {};
        (data as StockAnalysis[]).forEach(a => { if (!map[a.ticker]) map[a.ticker] = a; });
        setAnalyses(map);
      });
  }, [watchlist]);

  // Debounced FMP search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (ticker.length < 2) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await authedFetch<SearchResult[]>(
          `/api/fmp/search?query=${encodeURIComponent(ticker)}&limit=8`
        );
        setSuggestions(Array.isArray(results) ? results.slice(0, 8) : []);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [ticker]);

  function pickSuggestion(sym: string) {
    setSuggestions([]);
    setSuggIdx(-1);
    router.push(`/stock/${sym}`);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (suggIdx >= 0 && suggestions[suggIdx]) {
      pickSuggestion(suggestions[suggIdx].symbol);
      return;
    }
    const t = ticker.trim().toUpperCase();
    if (t) router.push(`/stock/${t}`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSuggIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === "Escape") { setSuggestions([]); setSuggIdx(-1); }
  }

  async function addToWatchlist(t: string) {
    if (!session || watchlist.some(w => w.ticker === t)) return;
    const { data } = await supabase.from("sl_watchlist").insert({ user_id: session!.user.id, ticker: t }).select().single();
    if (data) setWatchlist(prev => [...prev, data as WatchlistItem]);
  }

  async function removeFromWatchlist(t: string) {
    await supabase.from("sl_watchlist").delete().eq("ticker", t).eq("user_id", session!.user.id);
    setWatchlist(prev => prev.filter(w => w.ticker !== t));
  }

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero search */}
      <div style={{ textAlign: "center", marginBottom: "var(--sr-sp-8)", padding: "var(--sr-sp-6) 0" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "var(--sr-sp-2)" }}>
          Stock Analysis
        </h1>
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-6)" }}>
          Micro fundamentals + macro regime · NYSE, NASDAQ, BME/IBEX, LSE, Xetra, Euronext and more
        </p>

        <form onSubmit={handleSearch} style={{ display: "flex", gap: "var(--sr-sp-3)", maxWidth: 520, margin: "0 auto" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              className="sr-input"
              style={{ width: "100%" }}
              placeholder="Company name or ticker (e.g. Apple, AAPL, SAN.MC)…"
              value={ticker}
              onChange={e => { setTicker(e.target.value.toUpperCase()); setSuggIdx(-1); }}
              onKeyDown={handleKeyDown}
              onBlur={() => setTimeout(() => { setSuggestions([]); setSuggIdx(-1); }, 160)}
              autoFocus
              autoComplete="off"
              maxLength={15}
            />
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "var(--sr-surface-2)", border: "1px solid var(--sr-border-2)",
                borderRadius: "var(--sr-radius)", boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
                zIndex: 500, overflow: "hidden",
              }}>
                {suggestions.map((s, i) => (
                  <div
                    key={s.symbol}
                    onMouseDown={() => pickSuggestion(s.symbol)}
                    onMouseEnter={() => setSuggIdx(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                      cursor: "pointer", textAlign: "left",
                      background: i === suggIdx ? "var(--sr-surface-2)" : "transparent",
                      borderBottom: i < suggestions.length - 1 ? "1px solid var(--sr-border)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 16, minWidth: 22, lineHeight: 1 }}>
                      {tickerFlag(s.symbol, s.exchangeShortName)}
                    </span>
                    <span style={{
                      fontWeight: 700, color: "var(--sr-amber)", fontSize: "var(--sr-t-sm)",
                      minWidth: 88, fontFamily: "var(--font-mono, ui-monospace, monospace)",
                    }}>
                      {s.symbol}
                    </span>
                    <span style={{
                      color: "var(--sr-text-2)", fontSize: "var(--sr-t-sm)",
                      flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {s.name}
                    </span>
                    <span style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)", flexShrink: 0 }}>
                      {s.exchangeShortName}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" className="btn-primary" style={{ flexShrink: 0 }}>
            Analyze
          </button>
        </form>

        {/* Quick picks */}
        <div style={{ marginTop: "var(--sr-sp-4)", display: "flex", gap: "var(--sr-sp-2)", justifyContent: "center", flexWrap: "wrap" }}>
          {QUICK_PICKS.map(({ t, l }) => (
            <button
              key={t}
              onClick={() => router.push(`/stock/${t}`)}
              style={{
                background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
                borderRadius: "var(--sr-radius-pill)", padding: "4px 12px",
                fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", cursor: "pointer",
                fontFamily: "var(--font-mono, ui-monospace, monospace)", fontWeight: 600,
              }}
            >
              {l} {t}
            </button>
          ))}
        </div>
      </div>

      {/* Watchlist */}
      <div>
        <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-4)" }}>
          <div className="section-label">Watchlist</div>
          <span className="sr-hint">{watchlist.length} tickers</span>
        </div>

        {loadingWl ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--sr-sp-3)" }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="card" style={{ height: 80 }}><Sk w="100%" h={80} /></div>)}
          </div>
        ) : watchlist.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-text-3)" }}>
            Your watchlist is empty. Search any ticker above and analyze it to add it here.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "var(--sr-sp-3)" }}>
            {watchlist.map(w => {
              const a = analyses[w.ticker];
              const icScore = a ? Math.max(0, Math.min(100, Number(a.score_total) + Number(a.macro_tilt ?? 0))) : null;
              const rating = icScore != null ? getRating(icScore) : null;
              return (
                <div
                  key={w.ticker}
                  className="card"
                  style={{ cursor: "pointer", position: "relative", transition: "border-color 160ms" }}
                  onClick={() => router.push(`/stock/${w.ticker}`)}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--sr-border-2)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--sr-border)")}
                >
                  <button
                    style={{ position: "absolute", top: 8, right: 8, background: "none", border: "none", color: "var(--sr-text-3)", fontSize: 16, cursor: "pointer", padding: 4 }}
                    onClick={e => { e.stopPropagation(); removeFromWatchlist(w.ticker); }}
                  >×</button>
                  <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, marginBottom: 4 }}>
                    {tickerFlag(w.ticker, "")} {w.ticker}
                  </div>
                  {a ? (
                    <>
                      <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rating?.color }} className="num">
                        {icScore?.toFixed(0) ?? "—"}
                      </div>
                      <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: rating?.color, marginTop: 2 }}>
                        {rating?.label}
                      </div>
                    </>
                  ) : (
                    <div className="sr-hint">Not analyzed yet</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
