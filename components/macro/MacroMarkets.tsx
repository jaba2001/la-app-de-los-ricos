"use client";
import { useEffect, useState } from "react";
import type { MacroState } from "@/lib/types";
import { authedFetch } from "@/lib/proxy";
import { Sk } from "@/components/ui/Skeleton";

interface Props { macro: MacroState | null; loading: boolean; }

const ETF_GROUPS = [
  { label: "Equity Index",   tickers: ["SPY", "QQQ", "IWM"] },
  { label: "Sectors",        tickers: ["XLF", "KRE", "XLE", "XLK", "XLV"] },
  { label: "Fixed Income",   tickers: ["TLT", "IEF", "HYG", "LQD"] },
  { label: "Commodities",    tickers: ["GLD", "USO"] },
  { label: "Alternatives",   tickers: ["ARCC", "BX", "KKR", "EEM"] },
];

const CRYPTO_TICKERS = ["BTCUSD", "ETHUSD"];

interface Quote { symbol: string; price: number; change: number; changesPercentage: number; }

function QuoteCard({ ticker, quote, loadingQ }: { ticker: string; quote: Quote | null; loadingQ: boolean }) {
  const pct = quote?.changesPercentage ?? 0;
  const color = pct > 0 ? "var(--sr-pos)" : pct < 0 ? "var(--sr-neg)" : "var(--sr-text-3)";
  return (
    <div className="card-sm" style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      borderColor: pct > 0.5 ? "color-mix(in srgb, var(--sr-pos) 25%, var(--sr-border))" :
                   pct < -0.5 ? "color-mix(in srgb, var(--sr-neg) 25%, var(--sr-border))" : "var(--sr-border)",
    }}>
      <div>
        <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }}>{ticker}</div>
        {loadingQ ? <Sk w={60} h={12} /> : (
          <div className="sr-hint">
            {quote?.price != null ? `$${quote.price.toFixed(2)}` : "—"}
          </div>
        )}
      </div>
      {loadingQ ? <Sk w={44} h={18} /> : (
        <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color }} className="num">
          {pct !== 0 ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
        </div>
      )}
    </div>
  );
}

export default function MacroMarkets({ macro, loading }: Props) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [cryptoQuotes, setCryptoQuotes] = useState<Record<string, Quote>>({});
  const [loadingQ, setLoadingQ] = useState(true);
  const [loadingC, setLoadingC] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setLoadingC(false), 12000);
    Promise.allSettled(
      CRYPTO_TICKERS.map(t =>
        authedFetch<Quote[]>(`/api/fmp/quote?symbol=${t}`)
          .then(r => ({ ticker: t, data: Array.isArray(r) ? r[0] : (r as Quote) }))
      )
    ).then(results => {
      clearTimeout(timeout);
      const map: Record<string, Quote> = {};
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value.data) map[r.value.ticker] = r.value.data;
      });
      setCryptoQuotes(map);
      setLoadingC(false);
    }).catch(() => { clearTimeout(timeout); setLoadingC(false); });
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setLoadingQ(false), 12000);
    const allTickers = ETF_GROUPS.flatMap(g => g.tickers);
    Promise.allSettled(
      allTickers.map(t =>
        authedFetch<Quote[]>(`/api/fmp/quote?symbol=${t}`)
          .then(r => ({ ticker: t, data: Array.isArray(r) ? r[0] : (r as Quote) }))
      )
    ).then(results => {
      clearTimeout(timeout);
      const map: Record<string, Quote> = {};
      results.forEach(r => {
        if (r.status === "fulfilled" && r.value.data) map[r.value.ticker] = r.value.data;
      });
      setQuotes(map);
      setLoadingQ(false);
    }).catch(() => { clearTimeout(timeout); setLoadingQ(false); });
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Market Breadth from macro_state */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-6)" }}>
        <div className="card">
          <div className="section-label">Sentiment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Fear & Greed</span>
              {loading ? <Sk w={40} h={16} /> : (
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }} className="num">{macro?.fear_greed != null ? Number(macro.fear_greed).toFixed(0) : "—"}</span>
                  {macro?.fear_greed_rating && <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginLeft: 6 }}>{macro.fear_greed_rating}</span>}
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Put/Call Ratio</span>
              {loading ? <Sk w={40} h={16} /> : (
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }} className="num">{macro?.put_call_ratio != null ? Number(macro.put_call_ratio).toFixed(2) : "—"}</span>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>Sentiment Signal</span>
              {loading ? <Sk w={60} h={16} /> : (
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }}>{macro?.sentiment_signal ?? "—"}</span>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-label">WTI Oil</div>
          {loading ? <Sk w="100%" h={48} /> : (
            <div>
              <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 700 }} className="num">
                ${macro?.wti_level != null ? Number(macro.wti_level).toFixed(1) : "—"}
              </div>
              <div style={{
                fontSize: "var(--sr-t-sm)", fontWeight: 600, marginTop: 4,
                color: Number(macro?.wti_chg_1m ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)",
              }} className="num">
                {macro?.wti_chg_1m != null ? `${Number(macro.wti_chg_1m) >= 0 ? "+" : ""}${Number(macro.wti_chg_1m).toFixed(1)}%` : "—"} (1M)
              </div>
              {macro?.oil_shock && (
                <div style={{ marginTop: 8, fontSize: "var(--sr-t-xs)", padding: "4px 8px", borderRadius: "var(--sr-radius-sm)", background: "var(--sr-surface-2)", display: "inline-block" }}>
                  {macro.oil_shock}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-label">Global Liquidity</div>
          {loading ? <Sk w="100%" h={48} /> : (
            <div>
              <div style={{
                fontSize: "var(--sr-t-2xl)", fontWeight: 700,
                color: macro?.global_liquidity_dir === "expansion" ? "var(--sr-pos)" :
                       macro?.global_liquidity_dir === "contraction" ? "var(--sr-neg)" : "var(--sr-warn)",
                textTransform: "capitalize",
              }}>
                {macro?.global_liquidity_dir ?? "—"}
              </div>
              <div style={{ marginTop: 8, fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>
                Net Liquidity: <strong>{macro?.net_liquidity_dir ?? "—"}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Crypto */}
      <div style={{ marginBottom: "var(--sr-sp-6)" }}>
        <div className="section-label">Crypto</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "var(--sr-sp-4)", maxWidth: 480 }}>
          {CRYPTO_TICKERS.map(t => {
            const q = cryptoQuotes[t];
            const pct = q?.changesPercentage ?? 0;
            const color = pct > 0 ? "var(--sr-pos)" : pct < 0 ? "var(--sr-neg)" : "var(--sr-text-3)";
            const label = t === "BTCUSD" ? "Bitcoin" : t === "ETHUSD" ? "Ethereum" : t;
            const sym   = t === "BTCUSD" ? "BTC" : t === "ETHUSD" ? "ETH" : t;
            const priceStr = q?.price != null
              ? q.price >= 1000
                ? `$${q.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                : `$${q.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : "—";
            return (
              <div key={t} className="card" style={{
                borderColor: pct > 0.5 ? "color-mix(in srgb, var(--sr-pos) 20%, var(--sr-border))" :
                             pct < -0.5 ? "color-mix(in srgb, var(--sr-neg) 20%, var(--sr-border))" : "var(--sr-border)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 800, letterSpacing: "0.04em" }}>{sym}</div>
                  </div>
                  {loadingC ? <Sk w={60} h={20} /> : (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }} className="num">{priceStr}</div>
                      <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color }} className="num">
                        {pct !== 0 ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ETF grids */}
      {ETF_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom: "var(--sr-sp-5)" }}>
          <div className="section-label">{group.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--sr-sp-3)" }}>
            {group.tickers.map(t => (
              <QuoteCard key={t} ticker={t} quote={quotes[t] ?? null} loadingQ={loadingQ} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
