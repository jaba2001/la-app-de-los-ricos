"use client";
import { useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { covariance, minVariance, maxSharpe, longOnly, portfolioStats, type PortfolioStats } from "@/lib/optimize";

interface Props { tickers: string[]; }

interface Result {
  tickers: string[];
  equal: number[]; minVar: number[]; maxSharpe: number[];
  statsEqual: PortfolioStats; statsMinVar: PortfolioStats; statsMaxSharpe: PortfolioStats;
}

const RF = 0.04; // annual risk-free assumption for Sharpe

function dailyReturns(history: Record<string, unknown>[]): number[] {
  // history is newest-first; reverse to oldest→newest, cap ~252 sessions. Prefer adjClose so
  // splits/large dividends don't distort the return series (falls back to close).
  const closes = history.map((h) => Number(h.adjClose ?? h.close)).filter((v) => isFinite(v) && v > 0).slice(0, 252).reverse();
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function PortfolioOptimizer({ tickers }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function optimize() {
    if (tickers.length < 2) { setError("Add at least 2 different open tickers to optimize."); return; }
    setLoading(true); setError(""); setResult(null);
    try {
      const histories = await Promise.all(tickers.map(async (t) => {
        const res = await authedFetch<Record<string, unknown>[]>(`/api/fmp/historical-price-eod/full?symbol=${t}`);
        return dailyReturns(Array.isArray(res) ? res : []);
      }));
      const usable = histories.map((h, i) => ({ t: tickers[i], r: h })).filter((x) => x.r.length >= 30);
      if (usable.length < 2) { setError("Not enough price history to optimize these names."); setLoading(false); return; }

      const n = Math.min(...usable.map((u) => u.r.length));
      const series = usable.map((u) => u.r.slice(0, n));         // align lengths
      const mu = series.map((s) => (s.reduce((a, b) => a + b, 0) / s.length) * 252); // annualized
      const covD = covariance(series);
      const cov = covD.map((row) => row.map((v) => v * 252));    // annualized

      const k = usable.length;
      const equal = Array(k).fill(1 / k);
      const minVar = longOnly(minVariance(cov) ?? equal);
      const maxShp = longOnly(maxSharpe(mu, cov, RF) ?? equal);

      setResult({
        tickers: usable.map((u) => u.t),
        equal, minVar, maxSharpe: maxShp,
        statsEqual: portfolioStats(equal, mu, cov, RF),
        statsMinVar: portfolioStats(minVar, mu, cov, RF),
        statsMaxSharpe: portfolioStats(maxShp, mu, cov, RF),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    }
    setLoading(false);
  }

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Portfolio optimizer · Markowitz</div>
          <div className="sr-hint" style={{ maxWidth: 480, lineHeight: 1.5 }}>
            Min-variance &amp; max-Sharpe weights across your open names from ~1y of returns. A tool alongside the regime allocator — not a replacement.
          </div>
        </div>
        <button className="btn-primary" onClick={optimize} disabled={loading} style={{ flexShrink: 0, padding: "8px 14px", fontSize: "var(--sr-t-sm)" }}>
          {loading ? "Optimizing…" : "✦ Optimize"}
        </button>
      </div>

      {error && <div style={{ marginTop: "var(--sr-sp-2)", padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>}

      {result && (
        <div style={{ marginTop: "var(--sr-sp-3)" }}>
          <table className="sr-table">
            <thead><tr>
              <th>Ticker</th>
              <th style={{ textAlign: "right" }}>Equal wt</th>
              <th style={{ textAlign: "right" }}>Min-variance</th>
              <th style={{ textAlign: "right" }}>Max-Sharpe</th>
            </tr></thead>
            <tbody>
              {result.tickers.map((t, i) => (
                <tr key={t}>
                  <td style={{ fontWeight: 700 }}>{t}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{pct(result.equal[i])}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-2)" }} className="num">{pct(result.minVar[i])}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{pct(result.maxSharpe[i])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--sr-border)" }}>
                <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>Exp. return</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsEqual.ret)}</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsMinVar.ret)}</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsMaxSharpe.ret)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>Volatility</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsEqual.vol)}</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsMinVar.vol)}</td>
                <td style={{ textAlign: "right" }} className="num">{pct(result.statsMaxSharpe.vol)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600, color: "var(--sr-text-3)" }}>Sharpe (rf {pct(RF)})</td>
                <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{result.statsEqual.sharpe.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }} className="num">{result.statsMinVar.sharpe.toFixed(2)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }} className="num">{result.statsMaxSharpe.sharpe.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)" }}>Long-only, weights sum to 100%. Expected return = annualized historical mean (a naive estimator — treat as directional, not a promise).</div>
        </div>
      )}
    </div>
  );
}
