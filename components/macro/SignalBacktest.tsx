"use client";
import { useState } from "react";
import { authedFetch } from "@/lib/proxy";
import { useWatchlistAnalyses } from "@/lib/useWatchlistAnalyses";
import { runBacktest, type BacktestAnalysis, type BacktestResult, type DatedClose } from "@/lib/backtest";

const VERDICT_META: Record<BacktestResult["verdict"], { label: string; color: string; note: string }> = {
  supportive:  { label: "Supportive", color: "var(--sr-pos)",  note: "BUY-rated calls beat SPY more often than the rest" },
  mixed:       { label: "Mixed",      color: "var(--sr-warn)", note: "Weak edge — BUY calls beat SPY roughly half the time" },
  weak:        { label: "Weak",       color: "var(--sr-neg)",  note: "BUY-rated calls did not beat SPY in your history" },
  insufficient:{ label: "Not enough data", color: "var(--sr-text-3)", note: "Analyze more tickers over more days to build a track record" },
};

function toCloses(raw: unknown): DatedClose[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(r => ({ date: String((r as Record<string, unknown>).date ?? "").slice(0, 10), close: Number((r as Record<string, unknown>).close) }))
    .filter(r => r.date && !isNaN(r.close));
}

export default function SignalBacktest() {
  const { watchlist, analyses } = useWatchlistAnalyses();
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const analyzed = watchlist.map(w => w.ticker).filter(t => analyses[t]);

  async function run() {
    if (analyzed.length === 0) return;
    setLoading(true);
    setError("");
    try {
      // One EOD history call per analyzed ticker + SPY (proxy caches EOD 1h).
      const [spyRaw, ...tickerRaws] = await Promise.all([
        authedFetch<unknown>(`/api/fmp/historical-price-eod/full?symbol=SPY`),
        ...analyzed.map(t => authedFetch<unknown>(`/api/fmp/historical-price-eod/full?symbol=${t}`).catch(() => [])),
      ]);
      const historyByTicker: Record<string, DatedClose[]> = {};
      analyzed.forEach((t, i) => { historyByTicker[t] = toCloses(tickerRaws[i]); });
      // One analysis point per ticker (latest). Extend to full history when the
      // backend stores per-day analyses.
      const points: BacktestAnalysis[] = analyzed.map(t => {
        const a = analyses[t];
        return { ticker: t, date: String(a.analysis_date).slice(0, 10), score: Number(a.score_total) + Number(a.macro_tilt ?? 0) };
      });
      setResult(runBacktest(points, historyByTicker, toCloses(spyRaw), 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    }
    setLoading(false);
  }

  return (
    <div className="card" style={{ marginTop: "var(--sr-sp-5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--sr-sp-3)", flexWrap: "wrap", gap: "var(--sr-sp-3)" }}>
        <div>
          <div className="section-label" style={{ margin: 0 }}>Signal Backtest — do high scores beat SPY?</div>
          <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginTop: 2 }}>
            Forward return of each analyzed ticker since its analysis date vs SPY over the same window. Descriptive of your own history — not a forecast.
          </div>
        </div>
        <button className="btn-primary" onClick={run} disabled={loading || analyzed.length === 0} style={{ flexShrink: 0 }}>
          {loading ? "Running…" : result ? "Re-run" : "Run backtest"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "var(--sr-sp-2) var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: "color-mix(in srgb, var(--sr-neg) 10%, transparent)", color: "var(--sr-neg)", fontSize: "var(--sr-t-xs)" }}>{error}</div>
      )}

      {analyzed.length === 0 && !loading && (
        <div style={{ color: "var(--sr-text-3)", fontSize: "var(--sr-t-sm)" }}>Analyze tickers in your watchlist first to build a backtest.</div>
      )}

      {result && (() => {
        const m = VERDICT_META[result.verdict];
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", padding: "var(--sr-sp-3)", borderRadius: "var(--sr-radius)", background: `color-mix(in srgb, ${m.color} 8%, var(--sr-surface-2))`, border: `1px solid color-mix(in srgb, ${m.color} 25%, transparent)`, marginBottom: "var(--sr-sp-4)" }}>
              <span style={{ fontSize: "var(--sr-t-base)", fontWeight: 700, color: m.color }}>{m.label}</span>
              <span style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-2)" }}>{m.note}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sr-sp-3)", marginBottom: "var(--sr-sp-4)" }}>
              {[
                { label: `BUY-side (score ≥ ${result.buyThreshold})`, s: result.buy, hi: true },
                { label: `Rest (score < ${result.buyThreshold})`, s: result.rest, hi: false },
              ].map(({ label, s, hi }) => (
                <div key={label} style={{ background: "var(--sr-surface-2)", borderRadius: "var(--sr-radius)", padding: "var(--sr-sp-3)" }}>
                  <div style={{ fontSize: "var(--sr-t-xs)", color: "var(--sr-text-3)", marginBottom: 4 }}>{label}</div>
                  <div style={{ display: "flex", gap: "var(--sr-sp-4)", alignItems: "baseline" }}>
                    <div>
                      <div style={{ fontSize: "var(--sr-t-lg)", fontWeight: 700, color: hi ? (s.hitRate >= 0.6 ? "var(--sr-pos)" : s.hitRate >= 0.45 ? "var(--sr-warn)" : "var(--sr-neg)") : "var(--sr-text-2)" }} className="num">
                        {s.n > 0 ? `${(s.hitRate * 100).toFixed(0)}%` : "—"}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>beat SPY ({s.n})</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700, color: s.avgAlpha >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">
                        {s.avgAlpha >= 0 ? "+" : ""}{s.avgAlpha.toFixed(1)}%
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--sr-text-3)" }}>avg alpha</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="sr-table" style={{ fontSize: "var(--sr-t-xs)" }}>
                <thead><tr>
                  <th>Ticker</th><th>Analyzed</th>
                  <th style={{ textAlign: "right" }}>Score</th>
                  <th style={{ textAlign: "right" }}>Fwd Return</th>
                  <th style={{ textAlign: "right" }}>SPY</th>
                  <th style={{ textAlign: "right" }}>Alpha</th>
                </tr></thead>
                <tbody>
                  {[...result.points].sort((a, b) => b.alpha - a.alpha).map(p => (
                    <tr key={`${p.ticker}-${p.date}`}>
                      <td style={{ fontWeight: 700 }}>{p.ticker}</td>
                      <td style={{ color: "var(--sr-text-3)" }} className="num">{p.date}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: p.score >= 60 ? "var(--sr-pos)" : p.score >= 50 ? "var(--sr-warn)" : "var(--sr-neg)" }} className="num">{p.score.toFixed(0)}</td>
                      <td style={{ textAlign: "right", color: p.fwdReturn >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{p.fwdReturn >= 0 ? "+" : ""}{p.fwdReturn.toFixed(1)}%</td>
                      <td style={{ textAlign: "right", color: "var(--sr-text-3)" }} className="num">{p.spyReturn >= 0 ? "+" : ""}{p.spyReturn.toFixed(1)}%</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: p.alpha >= 0 ? "var(--sr-pos)" : "var(--sr-neg)" }} className="num">{p.alpha >= 0 ? "+" : ""}{p.alpha.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: "var(--sr-sp-3)", fontSize: "10px", color: "var(--sr-text-3)", lineHeight: 1.5 }}>
              One point per ticker (its latest analysis). A small sample and survivorship in your own picks make this indicative, not statistically robust. Past performance does not predict future results.
            </div>
          </div>
        );
      })()}
    </div>
  );
}
