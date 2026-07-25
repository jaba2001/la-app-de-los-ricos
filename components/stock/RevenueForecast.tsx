"use client";
import { useMemo } from "react";
import type { StockData } from "@/app/stock/[ticker]/page";
import { forecastSeries } from "@/lib/forecast";

interface Props { data: StockData | null; }

function money(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toFixed(0)}`;
}

export default function RevenueForecast({ data }: Props) {
  const model = useMemo(() => {
    const inc = data?.income ?? [];
    // income is newest-first → take up to 12 quarters, reverse to oldest→newest
    const revs = inc.slice(0, 12).map((q) => Number(q.revenue)).filter((v) => isFinite(v) && v > 0).reverse();
    if (revs.length < 4) return null;
    const fc = forecastSeries(revs, 4);
    if (!fc) return null;

    // TTM FCF margin (last 4 quarters) → project FCF off the revenue path (light 3-statement link)
    const cf = data?.cashFlow ?? [];
    const ttmFcf = cf.slice(0, 4).reduce((s, q) => s + ((Number(q.operatingCashFlow) || 0) + (Number(q.capitalExpenditure) || 0)), 0);
    const ttmRev = inc.slice(0, 4).reduce((s, q) => s + (Number(q.revenue) || 0), 0);
    const fcfMargin = ttmRev > 0 ? ttmFcf / ttmRev : null;

    const projTtmRev = fc.points.reduce((a, b) => a + b, 0); // next 4 quarters = forward TTM
    const projFcf = fcfMargin != null ? projTtmRev * fcfMargin : null;
    return { fc, revs, ttmRev, ttmFcf, fcfMargin, projTtmRev, projFcf };
  }, [data]);

  if (!model) {
    return (
      <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
        <div className="section-label">Revenue trajectory forecast</div>
        <div className="sr-hint">Not enough quarterly revenue history to project (need ≥ 4 quarters).</div>
      </div>
    );
  }

  const { fc, ttmRev, projTtmRev, fcfMargin, projFcf } = model;
  const fwdGrowth = ttmRev > 0 ? (projTtmRev / ttmRev - 1) * 100 : null;
  const gColor = (fc.growthRate ?? 0) >= 0 ? "var(--sr-pos)" : "var(--sr-neg)";

  return (
    <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
      <div className="section-label">Revenue trajectory forecast · {fc.method} trend</div>
      <div className="sr-hint" style={{ marginBottom: "var(--sr-sp-3)", lineHeight: 1.5 }}>
        Fits a {fc.method === "geometric" ? "compound-growth" : "linear"} trend to the last {model.revs.length} quarters and projects the next 4 with an ~80% band. Educational, not guidance.
      </div>

      <div className="sr-grid-4" style={{ marginBottom: "var(--sr-sp-3)" }}>
        <div className="sr-tile">
          <div className="sr-tile-label">Qtr growth (fit)</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700, color: gColor }}>
            {fc.growthRate != null ? `${fc.growthRate >= 0 ? "+" : ""}${(fc.growthRate * 100).toFixed(1)}%` : "linear"}
          </div>
          <div className="sr-hint">R² {fc.r2.toFixed(2)}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">TTM revenue</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{money(ttmRev)}</div>
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Fwd TTM (proj.)</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{money(projTtmRev)}</div>
          {fwdGrowth != null && <div className="sr-hint" style={{ color: fwdGrowth >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }}>{fwdGrowth >= 0 ? "+" : ""}{fwdGrowth.toFixed(1)}% YoY</div>}
        </div>
        <div className="sr-tile">
          <div className="sr-tile-label">Fwd FCF (proj.)</div>
          <div className="num" style={{ fontSize: "var(--sr-t-xl)", fontWeight: 700 }}>{money(projFcf)}</div>
          {fcfMargin != null && <div className="sr-hint">@ {(fcfMargin * 100).toFixed(1)}% FCF margin</div>}
        </div>
      </div>

      <table className="sr-table">
        <thead><tr><th>Next quarter</th><th style={{ textAlign: "right" }}>Low (~80%)</th><th style={{ textAlign: "right" }}>Projected</th><th style={{ textAlign: "right" }}>High (~80%)</th></tr></thead>
        <tbody>
          {fc.points.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>Q+{i + 1}</td>
              <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{money(fc.lower[i])}</td>
              <td style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{money(p)}</td>
              <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{money(fc.upper[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
