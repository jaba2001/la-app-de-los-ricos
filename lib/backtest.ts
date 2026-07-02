/**
 * Lightweight signal backtest — pure, no I/O. Answers the one question a buyer asks:
 * "when this app said BUY, did the stock actually beat SPY afterwards?"
 *
 * For each saved analysis it measures the forward return from the analysis date to
 * the most recent close, and the same-window SPY return, and reports the alpha. It
 * then splits analyses into BUY-side (score ≥ buyThreshold) vs the rest and reports
 * how often each group produced positive alpha. This is descriptive evidence on the
 * user's own history — not a promise — but it's the difference between "a score" and
 * "a score with a track record".
 */

export interface BacktestAnalysis {
  ticker: string;
  date: string;        // analysis_date (YYYY-MM-DD)
  score: number;       // score_total + macro_tilt (the displayed Scora score)
}
export interface DatedClose { date: string; close: number; }

export interface BacktestPoint {
  ticker: string;
  date: string;
  score: number;
  fwdReturn: number;   // % return of the ticker from date → latest
  spyReturn: number;   // % return of SPY over the same window
  alpha: number;       // fwdReturn − spyReturn
}

export interface BacktestResult {
  points: BacktestPoint[];
  buy: { n: number; hitRate: number; avgAlpha: number };   // score ≥ threshold
  rest: { n: number; hitRate: number; avgAlpha: number };
  buyThreshold: number;
  verdict: "supportive" | "mixed" | "weak" | "insufficient";
}

/** Closest close on-or-before a date; null if the series starts after it. */
function closeOnOrBefore(sorted: DatedClose[], date: string): number | null {
  let found: number | null = null;
  for (const row of sorted) { if (row.date <= date) found = row.close; else break; }
  return found;
}

export function runBacktest(
  analyses: BacktestAnalysis[],
  historyByTicker: Record<string, DatedClose[]>,
  spyHistory: DatedClose[],
  buyThreshold = 60,
): BacktestResult {
  const spy = [...spyHistory].filter(h => h.date && !isNaN(h.close)).sort((a, b) => a.date.localeCompare(b.date));
  const spyLatest = spy.length ? spy[spy.length - 1].close : null;

  const points: BacktestPoint[] = [];
  for (const a of analyses) {
    const hist = (historyByTicker[a.ticker] ?? []).filter(h => h.date && !isNaN(h.close)).sort((x, y) => x.date.localeCompare(y.date));
    if (hist.length < 2 || spy.length < 2 || spyLatest == null) continue;
    const latest = hist[hist.length - 1].close;
    const at = closeOnOrBefore(hist, a.date);
    const spyAt = closeOnOrBefore(spy, a.date);
    if (at == null || at <= 0 || spyAt == null || spyAt <= 0) continue;
    const fwdReturn = ((latest - at) / at) * 100;
    const spyReturn = ((spyLatest - spyAt) / spyAt) * 100;
    points.push({ ticker: a.ticker, date: a.date, score: a.score, fwdReturn, spyReturn, alpha: fwdReturn - spyReturn });
  }

  const summarize = (pts: BacktestPoint[]) => ({
    n: pts.length,
    hitRate: pts.length ? pts.filter(p => p.alpha > 0).length / pts.length : 0,
    avgAlpha: pts.length ? pts.reduce((s, p) => s + p.alpha, 0) / pts.length : 0,
  });

  const buyPts = points.filter(p => p.score >= buyThreshold);
  const restPts = points.filter(p => p.score < buyThreshold);
  const buy = summarize(buyPts);
  const rest = summarize(restPts);

  let verdict: BacktestResult["verdict"];
  if (buy.n < 3) verdict = "insufficient";
  else if (buy.hitRate >= 0.6 && buy.avgAlpha > rest.avgAlpha) verdict = "supportive";
  else if (buy.hitRate >= 0.45) verdict = "mixed";
  else verdict = "weak";

  return { points, buy, rest, buyThreshold, verdict };
}
