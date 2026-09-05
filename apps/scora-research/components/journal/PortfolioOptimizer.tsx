"use client";
import { useState } from "react";
import { authedFetch } from "@/lib/proxy";
import {
  covariance, ledoitWolf, minVariance, maxSharpe, longOnly, portfolioStats, equalWeights,
  resampleWeights, type PortfolioStats,
} from "@/lib/optimize";

interface Props { tickers: string[]; }

interface Band { mean: number[]; stdDev: number[] }

interface Result {
  tickers: string[];
  equal: number[]; minVar: number[]; maxSharpe: number[];
  statsEqual: PortfolioStats; statsMinVar: PortfolioStats; statsMaxSharpe: PortfolioStats;
  /** Intensidad de encogimiento de Ledoit-Wolf (0-1). Alta = pocos datos para tantos nombres. */
  shrinkDelta: number;
  bandMinVar: Band | null;
  bandMaxSharpe: Band | null;
  months: number;
}

const RF = 0.04; // annual risk-free assumption for Sharpe
const DRAWS = 150;

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

      // Ledoit-Wolf en vez de la covarianza muestral a secas: con ~1 año de datos y varios
      // nombres, la muestral es ruidosa (y con más nombres que sesiones, singular). El
      // encogimiento la estabiliza y el optimizador deja de escupir pesos disparatados.
      const shrunk = ledoitWolf(series);
      const covD = shrunk ? shrunk.cov : covariance(series);
      const cov = covD.map((row) => row.map((v) => v * 252));    // annualized

      const k = usable.length;
      const equal = equalWeights(k);
      const minVar = longOnly(minVariance(cov) ?? equal);
      const maxShp = longOnly(maxSharpe(mu, cov, RF) ?? equal);

      // Remuestreo de Michaud: cuánto se mueven los pesos si la historia hubiera salido algo
      // distinta. Es lo que convierte "AAPL 12%" en "AAPL 12% ± 9%".
      const annualize = (c: number[][]) => c.map((row) => row.map((v) => v * 252));
      const rsMinVar = resampleWeights(series, (c) => longOnly(minVariance(annualize(c)) ?? []), { draws: DRAWS, seed: 7 });
      const rsMaxShp = resampleWeights(series, (c, m) => longOnly(maxSharpe(m.map((x) => x * 252), annualize(c), RF) ?? []), { draws: DRAWS, seed: 7 });

      setResult({
        tickers: usable.map((u) => u.t),
        equal, minVar, maxSharpe: maxShp,
        statsEqual: portfolioStats(equal, mu, cov, RF),
        statsMinVar: portfolioStats(minVar, mu, cov, RF),
        statsMaxSharpe: portfolioStats(maxShp, mu, cov, RF),
        shrinkDelta: shrunk ? shrunk.delta : 0,
        bandMinVar: rsMinVar ? { mean: rsMinVar.mean, stdDev: rsMinVar.stdDev } : null,
        bandMaxSharpe: rsMaxShp ? { mean: rsMaxShp.mean, stdDev: rsMaxShp.stdDev } : null,
        months: n,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    }
    setLoading(false);
  }

  const band = (b: Band | null, i: number) =>
    b && b.stdDev[i] != null ? <div style={{ fontSize: "10px", color: "var(--sr-text-3)", marginTop: 1 }}>± {(b.stdDev[i] * 100).toFixed(1)}</div> : null;

  // La banda del max-Sharpe suele ser mucho más ancha que la del min-varianza: es Michaud
  // (1989) hecho visible. Se calcula para poder decirlo con el número delante.
  const avg = (a: number[] | undefined) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const spreadMinVar = avg(result?.bandMinVar?.stdDev);
  const spreadMaxShp = avg(result?.bandMaxSharpe?.stdDev);

  return (
    <div className="card" style={{ marginBottom: "var(--sr-sp-5)" }}>
      <div className="sr-flex-between" style={{ marginBottom: "var(--sr-sp-2)", gap: "var(--sr-sp-3)", flexWrap: "wrap" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Portfolio optimizer · Markowitz</div>
          <div className="sr-hint" style={{ maxWidth: 520, lineHeight: 1.5 }}>
            Min-variance &amp; max-Sharpe weights across your open names, with Ledoit-Wolf shrinkage and
            resampled uncertainty bands. A tool alongside the regime allocator — not a replacement.
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
              <th style={{ textAlign: "right" }}>Equal wt (1/N)</th>
              <th style={{ textAlign: "right" }}>Min-variance</th>
              <th style={{ textAlign: "right" }}>Max-Sharpe</th>
            </tr></thead>
            <tbody>
              {result.tickers.map((t, i) => (
                <tr key={t}>
                  <td style={{ fontWeight: 700 }}>{t}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{pct(result.equal[i])}</td>
                  <td style={{ textAlign: "right", color: "var(--sr-text-2)" }} className="num">
                    {pct(result.minVar[i])}{band(result.bandMinVar, i)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--sr-amber)" }} className="num">
                    {pct(result.maxSharpe[i])}{band(result.bandMaxSharpe, i)}
                  </td>
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

          <div className="sr-hint" style={{ marginTop: "var(--sr-sp-2)", lineHeight: 1.6 }}>
            Long-only, weights sum to 100%. Built from {result.months} aligned daily returns
            {result.shrinkDelta > 0 && <> · Ledoit-Wolf shrinkage <strong className="num">{(result.shrinkDelta * 100).toFixed(0)}%</strong> toward a constant-correlation target</>}.
            <br />
            The <strong>±</strong> figures are the spread of each weight across {DRAWS} bootstrap resamples of the same
            history — how much the &ldquo;optimal&rdquo; weight moves when the past comes out slightly differently.
            {spreadMinVar != null && spreadMaxShp != null && spreadMaxShp > spreadMinVar && (
              <>
                {" "}Note that max-Sharpe&rsquo;s bands are about{" "}
                <strong className="num">{(spreadMaxShp / Math.max(spreadMinVar, 1e-9)).toFixed(1)}×</strong> wider than
                min-variance&rsquo;s: it depends on expected returns, which are the worst-estimated input there is
                (Michaud 1989; Chopra &amp; Ziemba measured errors in means costing ~11× errors in variances).
              </>
            )}
            <br />
            Equal weight is here as the control, not as filler: DeMiguel, Garlappi &amp; Uppal (2009) found 1/N beats
            sample-based optimization out of sample across 14 datasets. If the optimized portfolios don&rsquo;t clearly
            beat it, the honest read is that they don&rsquo;t.
          </div>
        </div>
      )}
    </div>
  );
}
