"use client";
import { useState, useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import { Sk } from "@/components/ui/Skeleton";
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

      {/* Peers */}
      {peers.length > 0 && (
        <div className="card">
          <div className="section-label">Peer Comparison</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sr-sp-2)" }}>
            {[ticker, ...peers.slice(0, 8)].map(p => (
              <a
                key={p}
                href={`/stock/${p}`}
                style={{
                  padding: "4px 12px",
                  borderRadius: "var(--sr-radius-pill)",
                  fontSize: "var(--sr-t-sm)",
                  fontWeight: 600,
                  background: p === ticker ? "var(--sr-amber-dim)" : "var(--sr-surface-2)",
                  color: p === ticker ? "var(--sr-amber)" : "var(--sr-text-2)",
                  border: p === ticker ? "1px solid color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "1px solid var(--sr-border)",
                  transition: "all 160ms",
                }}
              >
                {p}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
