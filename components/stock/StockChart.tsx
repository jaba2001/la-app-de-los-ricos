"use client";
import { useState, useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import { Sk } from "@/components/ui/Skeleton";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

interface Props { data: StockData | null; loading: boolean; ticker: string; }

type Period = "1M" | "3M" | "6M" | "1Y" | "5Y";

const fmtVol = (v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : `${v}`;

const PERIOD_DAYS: Record<Period, number> = { "1M": 22, "3M": 65, "6M": 130, "1Y": 252, "5Y": 1260 };

function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = data[0] ?? 0;
  for (const v of data) {
    const e = v * k + prev * (1 - k);
    result.push(e);
    prev = e;
  }
  return result;
}

export default function StockChart({ data, loading, ticker }: Props) {
  const [period, setPeriod] = useState<Period>("1Y");
  const [showEMA, setShowEMA] = useState(true);
  const [showVolume, setShowVolume] = useState(false);

  const rawHistory = data?.history ?? [];

  const chartData = useMemo(() => {
    if (!rawHistory.length) return [];
    const days = PERIOD_DAYS[period];
    const sorted = [...rawHistory]
      .sort((a, b) => new Date(a.date as string).getTime() - new Date(b.date as string).getTime());
    const sliced = sorted.slice(-days);
    const prices = sliced.map(d => d.close as number ?? d.adjClose as number ?? 0);
    const ema20 = ema(prices, 20);
    const ema50 = ema(prices, 50);
    return sliced.map((d, i) => ({
      date:   (d.date as string).slice(0, 10),
      price:  prices[i],
      ema20:  ema20[i],
      ema50:  ema50[i],
      volume: Number(d.volume ?? 0),
    }));
  }, [rawHistory, period]);

  const quote = data?.quote;
  const profile = data?.profile;

  const minPrice = chartData.length ? Math.min(...chartData.map(d => d.price)) * 0.97 : 0;
  const maxPrice = chartData.length ? Math.max(...chartData.map(d => d.price)) * 1.03 : 100;

  const firstPrice = chartData[0]?.price ?? 0;
  const lastPrice = chartData[chartData.length - 1]?.price ?? 0;
  const totalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
  const returnColor = totalReturn >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";

  return (
    <div className="animate-fade-in">
      {/* Header stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-5)" }}>
        {[
          { label: "Current Price",  val: quote?.price != null ? `$${(quote.price as number).toFixed(2)}` : "—", color: "var(--sr-text)" },
          { label: `${period} Return`, val: chartData.length > 1 ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%` : "—", color: returnColor },
          { label: "52W High",  val: quote?.yearHigh != null ? `$${(quote.yearHigh as number).toFixed(2)}` : "—", color: "var(--sr-text)" },
          { label: "52W Low",   val: quote?.yearLow  != null ? `$${(quote.yearLow as number).toFixed(2)}`  : "—", color: "var(--sr-text)" },
        ].map(({ label, val, color }) => (
          <div key={label} className="card-sm">
            <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color }} className="num">{val}</div>
          </div>
        ))}
      </div>

      {/* Chart card */}
      <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sr-sp-4)" }}>
          {/* Period selector */}
          <div style={{ display: "flex", gap: 4 }}>
            {(["1M", "3M", "6M", "1Y", "5Y"] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--sr-radius-pill)",
                  fontSize: "var(--sr-t-xs)",
                  fontWeight: 600,
                  border: "1px solid transparent",
                  background: period === p ? "var(--sr-amber-dim)" : "transparent",
                  color: period === p ? "var(--sr-amber)" : "var(--sr-text-3)",
                  cursor: "pointer",
                  borderColor: period === p ? "color-mix(in srgb, var(--sr-amber) 40%, transparent)" : "transparent",
                }}
              >
                {p}
              </button>
            ))}
          </div>
          {/* Overlays */}
          <div style={{ display: "flex", gap: "var(--sr-sp-3)" }}>
            {[{ label: "EMA 20/50", val: showEMA, set: setShowEMA }, { label: "Volume", val: showVolume, set: setShowVolume }].map(({ label, val, set }) => (
              <button
                key={label}
                onClick={() => set(!val)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "var(--sr-radius-pill)",
                  fontSize: "var(--sr-t-xs)",
                  fontWeight: 600,
                  border: "1px solid var(--sr-border)",
                  background: val ? "var(--sr-surface-2)" : "transparent",
                  color: val ? "var(--sr-text)" : "var(--sr-text-3)",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading || !chartData.length ? (
          <Sk w="100%" h={300} />
        ) : (
          <ResponsiveContainer width="100%" height={showVolume ? 380 : 320}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--sr-border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fill: "var(--sr-text-3)", fontSize: 11 }}
                tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
              <YAxis yAxisId="price" domain={[minPrice, maxPrice]} tick={{ fill: "var(--sr-text-3)", fontSize: 11 }}
                tickFormatter={v => `$${v.toFixed(0)}`} width={55} />
              {showVolume && (
                <YAxis yAxisId="vol" orientation="right" tick={{ fill: "var(--sr-text-3)", fontSize: 10 }}
                  tickFormatter={fmtVol} width={48} />
              )}
              <Tooltip
                contentStyle={{ background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--sr-text-2)" }}
                formatter={(v: number, name: string) =>
                  name === "volume" ? [fmtVol(v), "Volume"] : [`$${v.toFixed(2)}`, name]
                }
              />
              {showVolume && (
                <Bar yAxisId="vol" dataKey="volume" fill="color-mix(in srgb, var(--sr-text-3) 20%, transparent)" radius={[1,1,0,0]} maxBarSize={6} />
              )}
              <Line yAxisId="price" type="monotone" dataKey="price" stroke="var(--sr-amber)" strokeWidth={2} dot={false} />
              {showEMA && <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="var(--sr-pos)" strokeWidth={1} dot={false} strokeOpacity={0.7} />}
              {showEMA && <Line yAxisId="price" type="monotone" dataKey="ema50" stroke="var(--sr-info)" strokeWidth={1} dot={false} strokeOpacity={0.7} />}
              {quote?.price && <ReferenceLine yAxisId="price" y={quote.price as number} stroke="var(--sr-text-3)" strokeDasharray="4 4" />}
            </ComposedChart>
          </ResponsiveContainer>
        )}

        <div style={{ display: "flex", gap: "var(--sr-sp-4)", marginTop: "var(--sr-sp-3)", flexWrap: "wrap" }}>
          <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-amber)" }}>— Price</span>
          {showEMA && <><span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-pos)" }}>— EMA 20</span>
          <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-info)" }}>— EMA 50</span></>}
          {showVolume && <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)" }}>▬ Volume</span>}
        </div>
      </div>

      {/* Sector relative strength */}
      <div className="card">
        <div className="section-label">Sector Context</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sr-sp-3)" }}>
          {[
            { label: "Sector",    val: profile?.sector as string ?? "—" },
            { label: "Industry",  val: profile?.industry as string ?? "—" },
            { label: "Beta",      val: quote?.beta != null ? Number(quote.beta).toFixed(2) : "—" },
          ].map(({ label, val }) => (
            <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
              <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: "var(--sr-t-base)", fontWeight: 600 }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
