"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { datos } from "@/lib/dataClient";
import type { StockAnalysis, WatchlistItem } from "@/lib/types";
import { getRating } from "@/lib/scoring";
import { Sk } from "@/components/ui/Skeleton";
import { latestAnalyses } from "@/lib/latestAnalyses";
import DataError, { NO_SE_PUDO_CARGAR, NO_SE_PUDO_GUARDAR } from "@/components/ui/DataError";
import { t as tr, tv } from "@/lib/i18n/cliente";
import TickerSearch, { tickerFlag } from "@/components/TickerSearch";

const QUICK_PICKS = [
  { t: "AAPL",    l: "🇺🇸" }, { t: "MSFT",    l: "🇺🇸" }, { t: "NVDA",    l: "🇺🇸" },
  { t: "AMZN",    l: "🇺🇸" }, { t: "MC.PA",   l: "🇫🇷" }, { t: "SAP.DE",  l: "🇩🇪" },
  { t: "SAN.MC",  l: "🇪🇸" }, { t: "NESN.SW", l: "🇨🇭" }, { t: "BP.L",    l: "🇬🇧" },
  { t: "ASML.AS", l: "🇳🇱" },
];

export default function StockPage() {
  const { session, loading: authLoading } = useAuth();
  const router = useRouter();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, StockAnalysis>>({});
  const [loadingWl, setLoadingWl] = useState(true);
  const [errorWl, setErrorWl] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !session) router.replace("/login");
  }, [session, authLoading, router]);

  useEffect(() => {
    if (!session) return;
    datos.from("sl_watchlist").select("*").eq("user_id", session!.user.id).then(({ data, error }) => {
      // Un fallo NO es una watchlist vacía: se dice, en vez de enseñar "Your watchlist is empty".
      if (error) setErrorWl(NO_SE_PUDO_CARGAR);
      else if (data) setWatchlist(data as WatchlistItem[]);
      setLoadingWl(false);
    });
  }, [session]);

  useEffect(() => {
    if (!watchlist.length) return;
    const tickers = watchlist.map(w => w.ticker);
    latestAnalyses(tickers)
      .then((map) => {
        setAnalyses(map);
      });
  }, [watchlist]);

  async function removeFromWatchlist(t: string) {
    const { error } = await datos.from("sl_watchlist").delete().eq("ticker", t).eq("user_id", session!.user.id);
    // Antes se quitaba de la lista aunque el borrado fallara: desaparecía y volvía al recargar.
    if (error) { setErrorWl(NO_SE_PUDO_GUARDAR); return; }
    setWatchlist(prev => prev.filter(w => w.ticker !== t));
  }

  if (authLoading || !session) return null;

  return (
    <div style={{ padding: "var(--sr-sp-6)", maxWidth: 1200, margin: "0 auto" }}>
      {/* Hero search */}
      <div style={{ textAlign: "center", marginBottom: "var(--sr-sp-8)", padding: "var(--sr-sp-6) 0" }}>
        <h1 style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "var(--sr-sp-2)" }}>
          {tr("Stock Analysis")}</h1>
        <p style={{ fontSize: "var(--sr-t-base)", color: "var(--sr-text-2)", marginBottom: "var(--sr-sp-6)" }}>
          {tr("Micro fundamentals + macro regime · NYSE, NASDAQ, BME/IBEX, LSE, Xetra, Euronext and more")}</p>

        <TickerSearch
          variant="hero"
          placeholder={tr("Company name or ticker (e.g. Apple, AAPL, SAN.MC)…")}
          submitLabel={tr("Analyze")}
          autoFocus
          style={{ maxWidth: 520, margin: "0 auto" }}
        />

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
          <div className="section-label">{tr("Watchlist")}</div>
          <span className="sr-hint">{tr(`${watchlist.length} tickers`)}</span>
        </div>
        <DataError mensaje={errorWl} onCerrar={() => setErrorWl(null)} />

        {loadingWl ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "var(--sr-sp-3)" }}>
            {[0, 1, 2, 3].map(i => <div key={i} className="card" style={{ height: 80 }}><Sk w="100%" h={80} /></div>)}
          </div>
        ) : watchlist.length === 0 && !errorWl ? (
          <div className="card" style={{ textAlign: "center", padding: "var(--sr-sp-8)", color: "var(--sr-text-3)" }}>
            {tr("Your watchlist is empty. Search any ticker above and analyze it to add it here.")}</div>
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
                    {tickerFlag(w.ticker)} {w.ticker}
                  </div>
                  {a ? (
                    <>
                      <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rating?.color }} className="num">
                        {icScore?.toFixed(0) ?? "—"}
                      </div>
                      <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: rating?.color, marginTop: 2 }}>
                        {tv(rating?.label)}
                      </div>
                    </>
                  ) : (
                    <div className="sr-hint">{tr("Not analyzed yet")}</div>
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
