// ─────────────────────────────────────────────────────────────────────────────
// Institutional risk-adjusted performance metrics (2026-07-11) — the professional
// scorecard from the CAIA + portfolio-management curriculum (Downloads/Finance). The
// point Scora sells is RISK-ADJUSTED outperformance vs the S&P 500, and this is the
// evidence: not just Sharpe, but the full downside + relative-to-benchmark suite that a
// gatekeeper (SPIVA-literate) actually checks. Pure module (no imports) so the backtest
// scripts (.mjs) and the app (.ts) share ONE implementation, and the golden tests can
// exercise it headless. All series are MONTHLY simple returns in PERCENT (e.g. 1.2 = +1.2%).
// ─────────────────────────────────────────────────────────────────────────────

const PERIODS = 12; // monthly → annual

const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]): number => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

/** Annualized volatility (%) from monthly returns. */
export function annualVol(rets: number[]): number { return std(rets) * Math.sqrt(PERIODS); }

/** Annualized Sharpe ratio. `rfAnnual` in % (default 0 → excess over cash≈0 for a monthly series). */
export function sharpe(rets: number[], rfAnnual = 0): number {
  const s = std(rets);
  if (s === 0) return 0;
  const rfMonthly = rfAnnual / PERIODS;
  return ((mean(rets) - rfMonthly) / s) * Math.sqrt(PERIODS);
}

/** Downside deviation (%, monthly): dispersion of returns BELOW a target (MAR, default 0). */
export function downsideDeviation(rets: number[], marMonthly = 0): number {
  const below = rets.map((r) => Math.min(0, r - marMonthly));
  if (below.length < 2) return 0;
  // Sortino convention: divide by full n (not n−1), counting non-shortfall months as 0.
  return Math.sqrt(below.reduce((s, x) => s + x * x, 0) / below.length);
}

/** Annualized Sortino ratio — Sharpe that only penalizes DOWNSIDE volatility (CAIA). */
export function sortino(rets: number[], marAnnual = 0): number {
  const marMonthly = marAnnual / PERIODS;
  const dd = downsideDeviation(rets, marMonthly);
  if (dd === 0) return 0;
  return ((mean(rets) - marMonthly) / dd) * Math.sqrt(PERIODS);
}

/** Compounded max drawdown (%, negative) from a monthly return series. */
export function maxDrawdown(rets: number[]): number {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return mdd * 100;
}

/** Calmar ratio: annualized return ÷ |max drawdown|. Rewards return per unit of pain. */
export function calmar(rets: number[]): number {
  const mdd = Math.abs(maxDrawdown(rets));
  if (mdd === 0) return 0;
  const years = rets.length / PERIODS;
  let eq = 1; for (const r of rets) eq *= 1 + r / 100;
  const cagr = (Math.pow(eq, 1 / years) - 1) * 100;
  return cagr / mdd;
}

/** Historical Value at Risk (%, negative) at confidence `conf` (e.g. 0.95) — the monthly
 *  loss the series exceeds only (1−conf) of the time. The empirical quantile (CAIA). */
export function valueAtRisk(rets: number[], conf = 0.95): number {
  if (!rets.length) return 0;
  const sorted = [...rets].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((1 - conf) * sorted.length)));
  return sorted[idx];
}

/** Conditional VaR / Expected Shortfall (%, negative): the MEAN loss in the tail beyond
 *  VaR — the "how bad when it's bad" number. Coherent risk measure (CAIA). */
export function conditionalVaR(rets: number[], conf = 0.95): number {
  if (!rets.length) return 0;
  const sorted = [...rets].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor((1 - conf) * sorted.length));
  const tail = sorted.slice(0, cut);
  return mean(tail);
}

/** OLS beta of the strategy vs a benchmark (same-length monthly series). */
export function beta(rets: number[], bench: number[]): number {
  const n = Math.min(rets.length, bench.length);
  if (n < 2) return 0;
  const r = rets.slice(0, n), b = bench.slice(0, n);
  const mb = mean(b), mr = mean(r);
  let cov = 0, varb = 0;
  for (let i = 0; i < n; i++) { cov += (r[i] - mr) * (b[i] - mb); varb += (b[i] - mb) ** 2; }
  return varb === 0 ? 0 : cov / varb;
}

/** Annualized tracking-error-adjusted active return vs a benchmark (Information Ratio). */
export function informationRatio(rets: number[], bench: number[]): number {
  const n = Math.min(rets.length, bench.length);
  if (n < 2) return 0;
  const active = rets.slice(0, n).map((r, i) => r - bench[i]);
  const te = std(active);
  return te === 0 ? 0 : (mean(active) / te) * Math.sqrt(PERIODS);
}

/** Jensen's alpha (annualized %): return earned above what beta vs the benchmark predicts
 *  (CAPM). `rfAnnual` in %. Positive → skill beyond market exposure. */
export function jensenAlpha(rets: number[], bench: number[], rfAnnual = 0): number {
  const n = Math.min(rets.length, bench.length);
  if (n < 2) return 0;
  const rfMonthly = rfAnnual / PERIODS;
  const b = beta(rets, bench);
  const aMonthly = mean(rets.slice(0, n)) - (rfMonthly + b * (mean(bench.slice(0, n)) - rfMonthly));
  return aMonthly * PERIODS;
}

/** Treynor ratio: excess return per unit of SYSTEMATIC risk (beta), annualized. */
export function treynor(rets: number[], bench: number[], rfAnnual = 0): number {
  const b = beta(rets, bench);
  if (b === 0) return 0;
  const rfMonthly = rfAnnual / PERIODS;
  return ((mean(rets) - rfMonthly) * PERIODS) / b;
}

export interface RiskReport {
  cagr: number; vol: number; sharpe: number; sortino: number; calmar: number;
  maxDrawdown: number; var95: number; cvar95: number;
  beta: number | null; alpha: number | null; informationRatio: number | null; treynor: number | null;
}

/** Full report for a monthly return series, optionally relative to a benchmark series. */
export function riskReport(rets: number[], bench?: number[], rfAnnual = 0): RiskReport {
  const years = rets.length / PERIODS;
  let eq = 1; for (const r of rets) eq *= 1 + r / 100;
  const cagr = years > 0 ? (Math.pow(eq, 1 / years) - 1) * 100 : 0;
  const rel = bench && bench.length >= 2;
  return {
    cagr: +cagr.toFixed(2),
    vol: +annualVol(rets).toFixed(2),
    sharpe: +sharpe(rets, rfAnnual).toFixed(2),
    sortino: +sortino(rets, rfAnnual).toFixed(2),
    calmar: +calmar(rets).toFixed(2),
    maxDrawdown: +maxDrawdown(rets).toFixed(1),
    var95: +valueAtRisk(rets, 0.95).toFixed(2),
    cvar95: +conditionalVaR(rets, 0.95).toFixed(2),
    beta: rel ? +beta(rets, bench!).toFixed(2) : null,
    alpha: rel ? +jensenAlpha(rets, bench!, rfAnnual).toFixed(2) : null,
    informationRatio: rel ? +informationRatio(rets, bench!).toFixed(2) : null,
    treynor: rel ? +treynor(rets, bench!, rfAnnual).toFixed(2) : null,
  };
}
