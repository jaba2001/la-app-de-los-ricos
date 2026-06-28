"use client";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { StockData } from "@/app/stock/[ticker]/page";
import { Sk } from "@/components/ui/Skeleton";
import { authedFetch } from "@/lib/proxy";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, ComposedChart, Area,
} from "recharts";

interface Props { data: StockData | null; loading: boolean; ticker: string; }

const n = (v: unknown, d = 2, suffix = "", prefix = "") => {
  if (v == null || v === "" || isNaN(Number(v))) return "—";
  return `${prefix}${Number(v).toFixed(d)}${suffix}`;
};

const pct = (v: unknown) => n(v != null ? (v as number) * 100 : null, 1, "%");

function fmtB(v: number) {
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function HistoricalFinancials({ annual, loading }: { annual: Record<string, unknown>[]; loading: boolean }) {
  const [metric, setMetric] = useState<"revenue" | "income" | "fcf">("revenue");

  const chartData = useMemo(() => {
    return [...annual].reverse().map(r => ({
      year:    String(r.calendarYear ?? r.date ?? "").slice(0, 4),
      revenue: Number(r.revenue ?? 0),
      income:  Number(r.netIncome ?? 0),
      fcf:     Number(r.freeCashFlow ?? 0),
    }));
  }, [annual]);

  const cfg = {
    revenue: { label: "Revenue",    color: "var(--sr-amber)", key: "revenue" as const },
    income:  { label: "Net Income", color: "var(--sr-pos)",   key: "income"  as const },
    fcf:     { label: "Free Cash Flow", color: "var(--sr-info)", key: "fcf" as const },
  };
  const c = cfg[metric];

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Historical Financials — Annual</div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["revenue", "income", "fcf"] as const).map(m => (
            <button key={m} onClick={() => setMetric(m)} style={{
              padding: "3px 10px", borderRadius: "var(--sr-radius-pill)",
              fontSize: "var(--sr-t-xs)", fontWeight: 600, cursor: "pointer",
              background: metric === m ? "var(--sr-surface-3)" : "transparent",
              border: "1px solid var(--sr-border)",
              color: metric === m ? "var(--sr-text)" : "var(--sr-text-3)",
            }}>{cfg[m].label}</button>
          ))}
        </div>
      </div>
      {loading || !chartData.length ? <Sk w="100%" h={200} /> : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.4} />
            <XAxis dataKey="year" tick={{ fill: "var(--sr-text-3)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--sr-text-3)", fontSize: 11 }} tickFormatter={fmtB} width={60} />
            <Tooltip
              contentStyle={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [fmtB(v), c.label]}
            />
            <Bar dataKey={c.key} fill={c.color} radius={[3, 3, 0, 0]} opacity={0.85} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function SharesDilutionChart({ sharesFloat, loading }: { sharesFloat: Record<string, unknown>[]; loading: boolean }) {
  const chartData = useMemo(() => {
    return [...sharesFloat]
      .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")))
      .map(r => ({
        date:   String(r.date ?? "").slice(0, 7),
        shares: Number(r.outstandingShares ?? r.floatShares ?? 0) / 1e6,
        float:  Number(r.floatShares ?? 0) / 1e6,
      }));
  }, [sharesFloat]);

  const first = chartData[0]?.shares ?? 0;
  const last  = chartData[chartData.length - 1]?.shares ?? 0;
  const dilution = first > 0 ? ((last - first) / first) * 100 : null;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
        <div className="section-label">Shares Outstanding — Dilution Trend</div>
        {dilution != null && (
          <span style={{
            fontSize: "var(--sr-t-xs)", fontWeight: 700, padding: "3px 8px",
            borderRadius: "var(--sr-radius-pill)",
            background: dilution > 5 ? "color-mix(in srgb, var(--sr-neg) 12%, transparent)" : "color-mix(in srgb, var(--sr-pos) 12%, transparent)",
            color: dilution > 5 ? "var(--sr-neg)" : "var(--sr-pos)",
          }}>
            {dilution > 0 ? "+" : ""}{dilution.toFixed(1)}% dilution
          </span>
        )}
      </div>
      {loading || !chartData.length ? <Sk w="100%" h={160} /> : (
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.4} />
            <XAxis dataKey="date" tick={{ fill: "var(--sr-text-3)", fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill: "var(--sr-text-3)", fontSize: 10 }} tickFormatter={v => `${v.toFixed(0)}M`} width={50} />
            <Tooltip
              contentStyle={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 8, fontSize: 12 }}
              formatter={(v: number) => [`${v.toFixed(0)}M shares`, ""]}
            />
            <Area type="monotone" dataKey="shares" fill="color-mix(in srgb, var(--sr-warn) 12%, transparent)" stroke="var(--sr-warn)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {chartData.length > 0 && (
        <div style={{ display: "flex", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-3)" }}>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>
            Current: <strong>{last.toFixed(0)}M</strong> shares
          </div>
          {dilution != null && (
            <div style={{ fontSize: "var(--sr-t-xs)", color: dilution > 5 ? "var(--sr-neg)" : "var(--sr-pos)" }}>
              {dilution > 5 ? "Significant dilution" : dilution > 0 ? "Mild dilution" : "Share buybacks"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeerMetricsTable({ ticker, peers, ratios }: {
  ticker: string;
  peers: string[];
  ratios: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [peerData, setPeerData] = useState<Record<string, Record<string, unknown>>>({});
  const [loadingPeers, setLoadingPeers] = useState(false);
  const limited = peers.slice(0, 5);

  useEffect(() => {
    if (!limited.length) return;
    setLoadingPeers(true);
    Promise.allSettled(
      limited.map(t =>
        authedFetch<Record<string, unknown>[]>(`/api/fmp/ratios-ttm?symbol=${t}`)
          .then(r => ({ t, d: (Array.isArray(r) ? r[0] : r) as Record<string, unknown> ?? {} }))
      )
    ).then(results => {
      const map: Record<string, Record<string, unknown>> = {};
      results.forEach(r => { if (r.status === "fulfilled") map[r.value.t] = r.value.d; });
      setPeerData(map);
      setLoadingPeers(false);
    }).catch(() => setLoadingPeers(false));
  }, [limited.join(",")]);

  const fmtPe = (v: unknown) => {
    const x = Number(v); return isNaN(x) || x <= 0 || x > 999 ? "—" : x.toFixed(1) + "x";
  };
  const fmtPct = (v: unknown, mul = true) => {
    const x = Number(v); return isNaN(x) ? "—" : ((mul ? x * 100 : x).toFixed(1)) + "%";
  };

  const rows = [ticker, ...limited].map(t => {
    const m = t === ticker ? ratios : (peerData[t] ?? null);
    const revGrowth = m ? fmtPct(m.revenueGrowthTTM) : "—";
    return {
      t, isSelf: t === ticker,
      pe:          m ? fmtPe(m.peRatioTTM) : "—",
      grossMargin: m ? fmtPct(m.grossProfitMarginTTM) : "—",
      revGrowth,
      roe:         m ? fmtPct(m.returnOnEquityTTM) : "—",
      revGrowthNum: m?.revenueGrowthTTM != null ? Number(m.revenueGrowthTTM) : null,
      isLoading: t !== ticker && loadingPeers && !peerData[t],
    };
  });

  return (
    <div className="card">
      <div className="section-label">Peer Comparison</div>
      <div style={{ overflowX: "auto" }}>
        <table className="sr-table" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th>Ticker</th>
              <th style={{ textAlign: "right" }}>P/E (TTM)</th>
              <th style={{ textAlign: "right" }}>Gross Margin</th>
              <th style={{ textAlign: "right" }}>Rev Growth</th>
              <th style={{ textAlign: "right" }}>ROE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.t} style={{ background: row.isSelf ? "color-mix(in srgb, var(--sr-amber) 6%, transparent)" : undefined }}>
                <td>
                  {row.isSelf
                    ? <span style={{ fontWeight: 700, color: "var(--sr-amber)" }}>{row.t}</span>
                    : <span onClick={() => router.push(`/stock/${row.t}`)} style={{ color: "var(--sr-text-2)", fontWeight: 600, cursor: "pointer" }}>{row.t}</span>
                  }
                </td>
                {row.isLoading ? (
                  <><td><Sk w={40} h={14} /></td><td><Sk w={50} h={14} /></td><td><Sk w={50} h={14} /></td><td><Sk w={50} h={14} /></td></>
                ) : (
                  <>
                    <td style={{ textAlign: "right" }} className="num">{row.pe}</td>
                    <td style={{ textAlign: "right" }} className="num">{row.grossMargin}</td>
                    <td style={{ textAlign: "right", color: row.revGrowthNum != null ? (row.revGrowthNum >= 0 ? "var(--sr-pos)" : "var(--sr-neg)") : undefined }} className="num">{row.revGrowth}</td>
                    <td style={{ textAlign: "right" }} className="num">{row.roe}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)" }}>
        TTM = trailing twelve months · Max 5 peers shown
      </div>
    </div>
  );
}

export default function StockFundamentals({ data, loading, ticker }: Props) {
  const [quarterLimit, setQuarterLimit] = useState(4);
  const income = data?.income ?? [];
  const balance = data?.balanceSheet ?? [];
  const annual = data?.annualIncome ?? [];
  const sharesFloat = data?.sharesFloat ?? [];
  const cashFlow = data?.cashFlow ?? [];
  const ratios = data?.ratios;
  const metrics = data?.metrics;
  const peers = data?.peers ?? [];

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "var(--sr-sp-5)" }}>
      {/* Margins & Profitability */}
      <div className="card">
        <div className="section-label">Profitability (TTM)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)" }}>
          {[
            { label: "Gross Margin",    val: pct(ratios?.grossProfitMarginTTM) },
            { label: "Operating Margin",val: pct(ratios?.operatingProfitMarginTTM) },
            { label: "Net Margin",      val: pct(ratios?.netProfitMarginTTM) },
            { label: "FCF/Share (TTM)", val: n(ratios?.freeCashFlowPerShareTTM, 2, "", "$") },
            { label: "ROIC",            val: pct(ratios?.returnOnInvestedCapitalTTM ?? ratios?.returnOnCapitalEmployedTTM) },
            { label: "ROE",             val: pct(ratios?.returnOnEquityTTM) },
            { label: "ROA",             val: pct(ratios?.returnOnAssetsTTM) },
            { label: "EBITDA/Share",    val: n(ratios?.ebitdaPerShareTTM, 2, "", "$") },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
              {loading ? <Sk w={50} h={20} /> : (
                <div style={{ fontSize: "var(--sr-t-md)", fontWeight: 700 }} className="num">{val}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Operating Efficiency (P9) */}
      {(() => {
        const revTTM  = income.slice(0, 4).reduce((s, q) => s + Number(q.revenue        ?? 0), 0);
        const ebitTTM = income.slice(0, 4).reduce((s, q) => s + Number(q.operatingIncome ?? 0), 0);
        const revPrev  = income.slice(4, 8).reduce((s, q) => s + Number(q.revenue        ?? 0), 0);
        const ebitPrev = income.slice(4, 8).reduce((s, q) => s + Number(q.operatingIncome ?? 0), 0);
        const capexTTM = Math.abs(cashFlow.slice(0, 4).reduce((s, q) => s + Number(q.capitalExpenditure ?? 0), 0));
        const ar       = Number(balance[0]?.netReceivables ?? balance[0]?.accountsReceivable ?? 0);
        const dso      = revTTM > 0 && ar > 0 ? (ar / revTTM) * 365 : null;
        const capexRev = revTTM > 0 && capexTTM > 0 ? (capexTTM / revTTM) * 100 : null;
        const revChg   = revPrev > 0 ? (revTTM - revPrev) / revPrev : null;
        const ebitChg  = ebitPrev !== 0 ? (ebitTTM - ebitPrev) / Math.abs(ebitPrev) : null;
        const opLev    = revChg != null && ebitChg != null && Math.abs(revChg) > 0.001 ? ebitChg / revChg : null;
        if (dso == null && capexRev == null && opLev == null) return null;
        return (
          <div className="card">
            <div className="section-label">Operating Efficiency (TTM YoY)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}>
              {[
                { label: "DSO", val: dso != null ? `${dso.toFixed(0)} days` : "—", note: "Accounts Receivable / Revenue × 365", good: dso != null && dso < 45, warn: dso != null && dso > 90 },
                { label: "Capex / Revenue", val: capexRev != null ? `${capexRev.toFixed(1)}%` : "—", note: "Capital intensity indicator", good: capexRev != null && capexRev < 5, warn: capexRev != null && capexRev > 20 },
                { label: "Operating Leverage", val: opLev != null ? `${opLev.toFixed(2)}x` : "—", note: "% EBIT Δ ÷ % Revenue Δ (YoY)", good: opLev != null && opLev > 1 && opLev < 5, warn: opLev != null && (opLev > 10 || opLev < 0) },
              ].map(({ label, val, note, good, warn: w }) => (
                <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                  {loading ? <Sk w={50} h={20} /> : (
                    <div style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, color: good ? "var(--sr-pos)" : w ? "var(--sr-warn)" : "var(--sr-text)" }} className="num">{val}</div>
                  )}
                  <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 4, lineHeight: 1.4 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Historical Financials chart */}
      <HistoricalFinancials annual={annual} loading={loading} />

      {/* Shares / Dilution chart */}
      {(sharesFloat.length > 0 || !loading) && (
        <SharesDilutionChart sharesFloat={sharesFloat} loading={loading} />
      )}

      {/* Quarterly Income Statement */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-3)" }}>
          <div className="section-label" style={{ margin: 0 }}>Income Statement — Quarterly</div>
          {!loading && income.length > 4 && (
            <button
              className="btn-ghost"
              style={{ fontSize: "var(--sr-t-xs)", padding: "3px 10px" }}
              onClick={() => setQuarterLimit(prev => prev === 4 ? income.length : 4)}
            >
              {quarterLimit === 4 ? `Show all ${income.length}Q` : "Show less"}
            </button>
          )}
        </div>
        {loading ? <Sk w="100%" h={200} /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="sr-table" style={{ minWidth: 600 }}>
              <thead><tr>
                <th>Period</th>
                {income.slice(0, quarterLimit).map(q => (
                  <th key={q.date as string} style={{ textAlign: "right" }}>
                    {(q.date as string)?.slice(0, 7)}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {[
                  { label: "Revenue",     key: "revenue",     fmt: (v: number) => `$${(v/1e9).toFixed(1)}B` },
                  { label: "Gross Profit",key: "grossProfit", fmt: (v: number) => `$${(v/1e9).toFixed(1)}B` },
                  { label: "Net Income",  key: "netIncome",   fmt: (v: number) => `$${(v/1e9).toFixed(1)}B` },
                  { label: "EPS",         key: "eps",         fmt: (v: number) => `$${v.toFixed(2)}` },
                ].map(row => (
                  <tr key={row.label}>
                    <td style={{ fontWeight: 600, color: "var(--sr-text)" }}>{row.label}</td>
                    {income.slice(0, quarterLimit).map(q => {
                      const raw = q[row.key];
                      const val = raw != null ? Number(raw) : null;
                      return (
                        <td key={q.date as string} style={{ textAlign: "right" }} className="num">
                          {val != null && !isNaN(val) ? row.fmt(val) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balance Sheet Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-5)" }}>
        <div className="card">
          <div className="section-label">Balance Sheet (Latest Quarter)</div>
          {loading ? <Sk w="100%" h={160} /> : balance.length > 0 ? (
            [
              { label: "Total Assets",      key: "totalAssets" },
              { label: "Total Liabilities", key: "totalLiabilities" },
              { label: "Total Equity",      key: "totalStockholdersEquity" },
              { label: "Cash & Equiv.",     key: "cashAndCashEquivalents" },
              { label: "Total Debt",        key: "totalDebt" },
            ].map(({ label, key }) => (
              <div key={label} className="stat-row">
                <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{label}</span>
                <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600 }} className="num">
                  {balance[0][key] != null ? `$${(Number(balance[0][key])/1e9).toFixed(1)}B` : "—"}
                </span>
              </div>
            ))
          ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No data</div>}
        </div>

        <div className="card">
          <div className="section-label">Free Cash Flow (Latest Quarters)</div>
          {loading ? <Sk w="100%" h={160} /> : cashFlow.length > 0 ? (
            cashFlow.slice(0, 5).map(q => {
              const fcf = Number(q.operatingCashFlow ?? 0) - Number(q.capitalExpenditure ?? 0);
              return (
                <div key={q.date as string} className="stat-row">
                  <span style={{ fontSize: "var(--sr-t-sm)", color: "var(--sr-text-2)" }}>{(q.date as string)?.slice(0, 7)}</span>
                  <span style={{ fontSize: "var(--sr-t-sm)", fontWeight: 600, color: fcf >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                    {`$${(fcf/1e9).toFixed(2)}B`}
                  </span>
                </div>
              );
            })
          ) : <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>No data</div>}
        </div>
      </div>

      {/* Technical Signals — Phase 2 */}
      <div className="card">
        <div className="section-label">Technical Signals</div>
        {loading ? <Sk w="100%" h={300} /> : !data?.technicals ? null : (() => {
          const t = data.technicals!;
          const price = Number(data.quote?.price ?? 0);

          const smaSignal = (sma: number | null) => {
            if (!sma || !price) return { color: "var(--sr-text-3)", label: "—" };
            const diff = ((price - sma) / sma) * 100;
            return { color: diff >= 0 ? "var(--sr-pos)" : "var(--sr-neg)", label: `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%` };
          };
          const s20 = smaSignal(t.sma20); const s50 = smaSignal(t.sma50); const s200 = smaSignal(t.sma200);

          const rangeW = t.week52High && t.week52Low && t.week52High > t.week52Low && price
            ? Math.min(100, Math.max(0, ((price - t.week52Low) / (t.week52High - t.week52Low)) * 100)) : null;

          return (
            <>
              {/* RSI / Beta / Short Float / Next Earnings */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
                {([
                  {
                    label: "RSI (14)",
                    val: t.rsi14 != null ? t.rsi14.toFixed(1) : "—",
                    color: t.rsi14 != null ? (t.rsi14 >= 70 ? "var(--sr-neg)" : t.rsi14 <= 30 ? "var(--sr-pos)" : "var(--sr-warn)") : "var(--sr-text-3)",
                    sub: t.rsi14 != null ? (t.rsi14 >= 70 ? "Overbought" : t.rsi14 <= 30 ? "Oversold" : "Neutral") : "",
                  },
                  {
                    label: "Beta",
                    val: t.beta != null ? t.beta.toFixed(2) : "—",
                    color: t.beta != null && Math.abs(t.beta) > 1.5 ? "var(--sr-warn)" : "var(--sr-text)",
                    sub: t.beta != null ? (Math.abs(t.beta) > 1.5 ? "High volatility" : t.beta < 0.8 ? "Defensive" : "Moderate") : "",
                  },
                  {
                    label: "Short Float",
                    val: t.shortPercent != null ? `${t.shortPercent.toFixed(1)}%` : "—",
                    color: t.shortPercent != null && t.shortPercent > 15 ? "var(--sr-neg)" : "var(--sr-text)",
                    sub: t.shortPercent != null ? (t.shortPercent > 15 ? "High short interest" : t.shortPercent > 5 ? "Moderate" : "Low") : "",
                  },
                  {
                    label: "Next Earnings",
                    val: t.nextEarningsDate ? t.nextEarningsDate.slice(5) : "—",
                    color: "var(--sr-amber)",
                    sub: t.nextEarningsHour === "amc" ? "After Close" : t.nextEarningsHour === "bmo" ? "Before Open" : (t.nextEarningsHour ?? ""),
                  },
                ] as {label:string;val:string;color:string;sub:string}[]).map(({ label, val, color, sub }) => (
                  <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                    <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: "var(--sr-t-md)", fontWeight: 700, color }} className="num">{val}</div>
                    {sub && <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 3 }}>{sub}</div>}
                  </div>
                ))}
              </div>

              {/* SMA vs price */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
                {([
                  { label: "vs SMA 20",  sig: s20,  sma: t.sma20  },
                  { label: "vs SMA 50",  sig: s50,  sma: t.sma50  },
                  { label: "vs SMA 200", sig: s200, sma: t.sma200 },
                ] as {label:string;sig:{color:string;label:string};sma:number|null}[]).map(({ label, sig, sma }) => (
                  <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>{label}</div>
                      {sma != null && <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginTop: 2 }} className="num">${sma.toFixed(2)}</div>}
                    </div>
                    <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: sig.color }} className="num">{sig.label}</div>
                  </div>
                ))}
              </div>

              {/* 52W range bar */}
              {rangeW != null && (
                <div style={{ marginBottom: "var(--sr-sp-4)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 6 }}>
                    <span>52W Low <strong className="num">${t.week52Low?.toFixed(2)}</strong></span>
                    <span style={{ color: "var(--sr-amber)" }}>{rangeW.toFixed(0)}% of 52W range</span>
                    <span>52W High <strong className="num">${t.week52High?.toFixed(2)}</strong></span>
                  </div>
                  <div style={{ height: 6, background: "var(--sr-surface-3)", borderRadius: 3, position: "relative" }}>
                    <div style={{ height: "100%", width: `${rangeW}%`, background: "linear-gradient(to right, var(--sr-pos), var(--sr-warn))", borderRadius: "3px 0 0 3px" }} />
                    <div style={{ position: "absolute", left: `${rangeW}%`, top: -3, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "var(--sr-amber)", border: "2px solid var(--sr-bg)" }} />
                  </div>
                </div>
              )}

              {/* Performance */}
              <div>
                <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: "var(--sr-sp-2)" }}>PRICE PERFORMANCE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "var(--sr-sp-2)" }}>
                  {([
                    { label: "1W",  val: t.perfWeek     },
                    { label: "1M",  val: t.perfMonth    },
                    { label: "3M",  val: t.perfQuarter  },
                    { label: "6M",  val: t.perfHalfYear },
                    { label: "1Y",  val: t.perfYear     },
                    { label: "YTD", val: t.perfYTD      },
                  ] as {label:string;val:number|null}[]).map(({ label, val }) => (
                    <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius-sm)", padding: "var(--sr-sp-2) var(--sr-sp-2)", textAlign: "center" }}>
                      <div style={{ fontSize: "9px", color: "var(--sr-text-3)", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: "var(--sr-t-xs)", fontWeight: 700, color: val != null ? (val >= 0 ? "var(--sr-pos)" : "var(--sr-neg)") : "var(--sr-text-3)" }} className="num">
                        {val != null ? `${val >= 0 ? "+" : ""}${val.toFixed(1)}%` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Peers */}
      {peers.length > 0 && (
        <PeerMetricsTable ticker={ticker} peers={peers} ratios={ratios ?? null} />
      )}
    </div>
  );
}
