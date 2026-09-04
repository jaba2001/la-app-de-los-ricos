"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StockData } from "@/app/stock/[ticker]/page";
import { supabase } from "@/lib/supabase";
import { computeSmartMoneySignal } from "@/lib/smartMoney";
import { Sk } from "@/components/ui/Skeleton";

interface Props { data: StockData | null; loading: boolean; ticker: string; }
interface InsiderRow { rank: number; ticker: string; sector: string; net_insider_buying_usd: number; num_insiders: number; month: string; }

function periodRet(arr: number[], days: number): number | null {
  if (arr.length <= days) return null;
  const past = arr[days]; return past ? ((arr[0] - past) / past) * 100 : null;
}
function closes(history: Record<string, unknown>[]): number[] {
  return history.map(h => Number(h.close)).filter(v => !isNaN(v));
}
function rc(v: number) { return v > 0 ? "var(--sr-pos)" : v < 0 ? "var(--sr-neg)" : "var(--sr-text-3)"; }

export default function StockSmartMoney({ data, loading, ticker }: Props) {
  const router = useRouter();
  const [topBuyers, setTopBuyers] = useState<InsiderRow[]>([]);
  const [loadingTop, setLoadingTop] = useState(true);

  useEffect(() => {
    supabase.from("smart_money_top_buyers")
      .select("rank, ticker, sector, net_insider_buying_usd, num_insiders, month")
      .order("month", { ascending: false })
      .order("rank", { ascending: true })
      .limit(20)
      .then(({ data, error }) => {
        if (data) setTopBuyers(data as InsiderRow[]);
        if (error) console.warn("smart_money_top_buyers:", error.message);
        setLoadingTop(false);
      });
  }, []);

  const insiders  = data?.insiderTrades        ?? [];
  const holders   = data?.institutionalHolders  ?? [];
  // ⚠️ `null` significa que las fuentes del STOCK Act NO CONTESTARON, y eso no es «cero
  // operaciones». Los dos volcados publicos dejaron de serlo (403 desde el 2026-09-04), asi que
  // este es hoy el caso normal, no el raro. Enseñar «0B / 0S congress» seria afirmar algo sobre
  // unos datos que no tenemos.
  const congresoCaido = data?.congressTrades == null;
  const congress  = data?.congressTrades        ?? [];
  const house     = data?.houseDisclosures      ?? [];
  const allCongress = [...congress, ...house].sort((a, b) =>
    ((b.date ?? b.transactionDate) as string ?? "").localeCompare((a.date ?? a.transactionDate) as string ?? "")
  );

  // Net smart-money read + TradeVision-style buckets, computed from the data already loaded.
  const signal = computeSmartMoneySignal(insiders, allCongress);

  // Sector Relative Strength
  const tickCl   = closes(data?.history ?? []);
  const sectorCl = closes(data?.sectorEtfHistory ?? []);
  const etfSym   = data?.sectorEtfSymbol ?? "SPY";
  const rs = [
    { label: "1M",  days: 21  },
    { label: "3M",  days: 63  },
    { label: "6M",  days: 126 },
    { label: "1Y",  days: 252 },
  ].map(({ label, days }) => {
    const tickRet   = periodRet(tickCl, days);
    const sectorRet = periodRet(sectorCl, days);
    const alpha = tickRet != null && sectorRet != null ? tickRet - sectorRet : null;
    return { label, tickRet, sectorRet, alpha };
  });

  const toneColor = (tone: "pos" | "neg" | "neu") => tone === "pos" ? "var(--sr-pos)" : tone === "neg" ? "var(--sr-neg)" : "var(--sr-text-3)";

  return (
    <div className="animate-fade-in">
      {/* Smart Money Signal — net read + buckets over insider/13-F/Congress (free-data, TradeVision-style) */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)", flexWrap: "wrap" }}>
          <div className="section-label" style={{ margin: 0 }}>Smart Money Signal — {ticker}</div>
          <span className="sr-hint">{congresoCaido ? "Insider · 13-F · free data (congress no disponible)" : "Insider · 13-F · Congress · free data"}</span>
        </div>
        {loading ? <Sk w="100%" h={120} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 240px) 1fr", gap: "var(--sr-sp-5)", alignItems: "stretch" }}>
            {/* Net read */}
            <div className="sr-tile" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4, borderColor: `color-mix(in srgb, ${signal.color} 35%, transparent)`, background: `color-mix(in srgb, ${signal.color} 7%, var(--sr-surface-2))` }}>
              <div className="sr-tile-label">Net read</div>
              <div style={{ fontSize: "var(--sr-t-2xl)", fontWeight: 800, color: signal.color, lineHeight: 1.1 }}>{signal.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                <span className="num" style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: signal.color }}>{signal.netScore > 0 ? "+" : ""}{signal.netScore}</span>
                <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "var(--sr-radius-pill)", background: "var(--sr-surface-3)", color: "var(--sr-text-2)", fontWeight: 600 }}>{signal.conviction} conviction</span>
              </div>
              <div className="sr-hint" style={{ marginTop: 4 }}>
                {signal.insider.buyCount}B / {signal.insider.sellCount}S insider · {congresoCaido ? "congress no disponible" : `${signal.congress.buyCount}B / ${signal.congress.sellCount}S congress`}
                {signal.insider.netUsd != null && Math.abs(signal.insider.netUsd) > 0 ? ` · net ${signal.insider.netUsd >= 0 ? "+" : "−"}$${(Math.abs(signal.insider.netUsd) / 1e6).toFixed(1)}M` : ""}
              </div>
            </div>
            {/* Buckets */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-2)" }}>
              {signal.highlights.map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "var(--sr-surface-2)", border: `1px solid color-mix(in srgb, ${toneColor(h.tone)} 22%, transparent)` }}>
                  <span style={{ flexShrink: 0, fontSize: "var(--sr-t-xs)", fontWeight: 700, color: toneColor(h.tone), minWidth: 108 }}>{h.label}</span>
                  <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)", lineHeight: 1.5 }}>{h.detail}</span>
                </div>
              ))}
              <div className="sr-hint" style={{ marginTop: 2 }}>
                Net read weights open-market insider buys/sells (cluster buys strongest) + STOCK-Act disclosures. Not a recommendation.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sector Relative Strength */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
          <div className="section-label" style={{ margin: 0 }}>Sector Relative Strength vs {etfSym}</div>
        </div>
        {loading ? <Sk w="100%" h={80} /> : (
          <div className="sr-grid-4">
            {rs.map(({ label, tickRet, sectorRet, alpha }) => (
              <div key={label} className="sr-tile">
                <div className="sr-tile-label">{label} Alpha</div>
                {alpha != null ? (
                  <>
                    <div style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: rc(alpha) }} className="num">
                      {alpha >= 0 ? "+" : ""}{alpha.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 4 }}>
                      {ticker}: {tickRet != null ? `${tickRet >= 0 ? "+" : ""}${tickRet.toFixed(1)}%` : "—"}
                    </div>
                    <div className="sr-hint">
                      {etfSym}: {sectorRet != null ? `${sectorRet >= 0 ? "+" : ""}${sectorRet.toFixed(1)}%` : "—"}
                    </div>
                  </>
                ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>—</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)", marginBottom: "var(--sr-sp-5)" }}>
        {/* Insider transactions */}
        <div className="card">
          <div className="section-label">Insider Transactions — {ticker}</div>
          {loading ? <Sk w="100%" h={200} /> : insiders.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-4) 0" }}>No recent insider activity</div>
          ) : (
            <table className="sr-table">
              <thead><tr><th>Date</th><th>Name</th><th>Type</th><th style={{ textAlign: "right" }}>Shares</th></tr></thead>
              <tbody>
                {insiders.slice(0, 10).map((t, i) => {
                  // Finnhub gives a signed `change` (shares acquired vs disposed) — the
                  // clearest buy/sell signal; fall back to the transaction code/type.
                  const isBuy = t.change != null
                    ? (t.change as number) > 0
                    : ((t.transactionCode as string) === "P" || (t.transactionType as string)?.toLowerCase().includes("buy"));
                  return (
                    <tr key={i}>
                      <td>{(t.transactionDate as string)?.slice(0, 10) ?? "—"}</td>
                      <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{(t.reportingName ?? t.name) as string ?? "—"}</td>
                      <td style={{ color: isBuy ? "var(--sr-pos)" : "var(--sr-neg)", fontWeight: 600 }}>{isBuy ? "BUY" : "SELL"}</td>
                      <td style={{ textAlign: "right" }} className="num">{t.change != null ? Math.abs(t.change as number).toLocaleString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 13-F Institutional Holders */}
        <div className="card">
          <div className="section-label">13-F Institutional Holders</div>
          {loading ? <Sk w="100%" h={200} /> : holders.length === 0 ? (
            <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-4) 0" }}>No institutional data</div>
          ) : (
            <table className="sr-table">
              <thead><tr><th>Institution</th><th style={{ textAlign: "right" }}>Shares</th><th style={{ textAlign: "right" }}>% Portfolio</th></tr></thead>
              <tbody>
                {holders.slice(0, 10).map((h, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{h.holder as string ?? "—"}</td>
                    <td style={{ textAlign: "right" }} className="num">{h.shares != null ? (h.shares as number).toLocaleString() : "—"}</td>
                    <td style={{ textAlign: "right" }} className="num">{h.weightPercent != null ? `${Number(h.weightPercent).toFixed(2)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Congressional Trades */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div className="section-label">Congressional Trades — STOCK Act Disclosures</div>
        {loading ? <Sk w="100%" h={160} /> : allCongress.length === 0 ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-4) 0" }}>
            No recent congressional disclosures for {ticker}
          </div>
        ) : (
          <table className="sr-table">
            <thead><tr>
              <th>Date</th><th>Member</th><th>Chamber</th>
              <th>Type</th><th style={{ textAlign: "right" }}>Amount</th>
            </tr></thead>
            <tbody>
              {allCongress.slice(0, 15).map((t, i) => {
                const isBuy = (t.type as string)?.toLowerCase().includes("purchase") || (t.transactionType as string)?.toLowerCase().includes("buy");
                const isSell = (t.type as string)?.toLowerCase().includes("sale") || (t.transactionType as string)?.toLowerCase().includes("sell");
                const chamber = (t.chamber as string) ?? (house.includes(t) ? "House" : "Senate");
                const name = (t.name ?? t.representativeName ?? t.senator ?? t.member) as string;
                return (
                  <tr key={i}>
                    <td>{((t.date ?? t.transactionDate ?? t.disclosureDate) as string)?.slice(0, 10) ?? "—"}</td>
                    <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{name ?? "—"}</td>
                    <td style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-xs)" }}>{chamber}</td>
                    <td style={{ color: isBuy ? "var(--sr-pos)" : isSell ? "var(--sr-neg)" : "var(--sr-text-2)", fontWeight: 600, fontSize: "var(--sr-t-xs)" }}>
                      {(t.type ?? t.transactionType) as string ?? "—"}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--sr-text-2)", fontSize: "var(--sr-t-xs)" }} className="num">
                      {t.amount as string ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Market-wide top insider buyers */}
      <div className="card">
        <div className="section-label">Market Top Insider Buyers — Open Market (Updated Weekly)</div>
        {loadingTop ? <Sk w="100%" h={200} /> : topBuyers.length === 0 ? (
          <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)", padding: "var(--sr-sp-4) 0" }}>
            No data yet — cron runs every Monday (FMP Form 4s)
          </div>
        ) : (
          <table className="sr-table">
            <thead><tr>
              <th>#</th><th>Ticker</th><th>Sector</th>
              <th style={{ textAlign: "right" }}>Net Buying</th>
              <th style={{ textAlign: "right" }}># Insiders</th>
              <th>Month</th>
            </tr></thead>
            <tbody>
              {topBuyers.slice(0, 15).map((row) => (
                <tr key={row.rank} style={{ background: row.ticker === ticker ? "color-mix(in srgb, var(--sr-amber) 8%, transparent)" : undefined }}>
                  <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>{row.rank}</td>
                  <td><span onClick={() => router.push(`/stock/${row.ticker}`)} style={{ fontWeight: 700, color: row.ticker === ticker ? "var(--sr-amber)" : "var(--sr-text)", cursor: "pointer" }}>{row.ticker}</span></td>
                  <td style={{ color: "var(--sr-text-2)" }}>{row.sector}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-pos)", fontWeight: 600 }} className="num">${(row.net_insider_buying_usd / 1e6).toFixed(1)}M</td>
                  <td style={{ textAlign: "right" }} className="num">{row.num_insiders}</td>
                  <td style={{ color: "var(--sr-text-3)" }}>{row.month?.slice(0, 7)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
