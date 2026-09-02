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

// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 DEL PLAN DE GESTIÓN ACTIVA (2026-09-03) — lo que faltaba para sostener el claim
// «iguala al índice con un tercio del drawdown» con las métricas que un evaluador comprueba.
//
// El orden de arriba es de riesgo ABSOLUTO y relativo al índice en unidades de retorno; esto
// añade lo que el CFA y CAIA exigen para una promesa AJUSTADA AL RIESGO: M² (la ventaja de
// Sharpe expresada en puntos de retorno), la captura alcista/bajista (que descompone
// «participa en subidas, protege en caídas»), la FORMA de la distribución —el Sharpe supone
// normalidad, y una promesa de drawdown obliga a enseñar asimetría y curtosis— y el contraste
// de significación de una diferencia de Sharpe.
// ─────────────────────────────────────────────────────────────────────────────

/** Correlación de Pearson entre dos series. Es la que decide la significación de todo. */
export function correlacion(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(0, n), y = b.slice(0, n);
  const mx = mean(x), my = mean(y);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

/**
 * M² de Modigliani (anualizado, %): **lo que la cartera habría rendido al nivel de riesgo del
 * índice**. Es la ventaja de Sharpe traducida a puntos de retorno, que es como se puede decir
 * «iguala al índice con un tercio del drawdown» en un solo número comparable.
 *
 *     M² = Rf + Sharpe_cartera × σ_índice        M²-alfa = M² − R_índice
 *
 * ⚠️ Usa media ARITMÉTICA anualizada para el índice, no CAGR: el Sharpe del que sale M² también
 * es aritmético, y mezclar los dos produce una diferencia que parece alfa y es un cambio de
 * convenio. (CFA L1 LOS 21.i.)
 */
export function m2(rets: number[], bench: number[], rfAnnual = 0): number {
  if (rets.length < 2 || bench.length < 2) return 0;
  return rfAnnual + sharpe(rets, rfAnnual) * annualVol(bench);
}

/** M²-alfa: cuánto supera M² al retorno del índice, en puntos anuales. */
export function m2Alpha(rets: number[], bench: number[], rfAnnual = 0): number {
  if (rets.length < 2 || bench.length < 2) return 0;
  return m2(rets, bench, rfAnnual) - mean(bench) * PERIODS;
}

/**
 * Captura alcista y bajista (%), enlazadas geométricamente (convenio Morningstar).
 *
 * En los meses en que el índice sube, ¿qué fracción de esa subida se captura? Y en los que baja,
 * ¿qué fracción de la caída se sufre? Un 110 / 90 es una estrategia distinta de un 130 / 130
 * aunque las dos den el mismo Sharpe — y es justo la distinción que vende Scora.
 *
 * `null` cuando no hay meses de ese signo: con cero observaciones no hay ratio, y devolver 0
 * diría «no captura nada», que es lo contrario de «no se sabe».
 */
export function captura(rets: number[], bench: number[], alcista: boolean): number | null {
  const n = Math.min(rets.length, bench.length);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) if (alcista ? bench[i] > 0 : bench[i] < 0) idx.push(i);
  if (!idx.length) return null;
  const geo = (s: number[]) => { let e = 1; for (const x of s) e *= 1 + x / 100; return (Math.pow(e, 1 / s.length) - 1) * 100; };
  const gp = geo(idx.map((i) => rets[i])), gb = geo(idx.map((i) => bench[i]));
  return gb === 0 ? null : (gp / gb) * 100;
}

/** Asimetría muestral (Fisher-Pearson ajustada). Negativa = cola izquierda más larga. */
export function asimetria(rets: number[]): number {
  const n = rets.length;
  if (n < 3) return 0;
  const m = mean(rets), s = std(rets);
  if (s === 0) return 0;
  const suma = rets.reduce((acc, x) => acc + ((x - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * suma;
}

/** Exceso de curtosis muestral. > 0 = colas más gruesas que la normal (más sucesos extremos). */
export function curtosisExceso(rets: number[]): number {
  const n = rets.length;
  if (n < 4) return 0;
  const m = mean(rets), s = std(rets);
  if (s === 0) return 0;
  const suma = rets.reduce((acc, x) => acc + ((x - m) / s) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * suma - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

export interface DiferenciaSharpe {
  sharpeA: number; sharpeB: number; diferencia: number;
  rho: number; errorTipico: number; t: number; significativo: boolean; meses: number;
}

/**
 * ¿Es significativa una diferencia de Sharpe? Jobson-Korkie con la corrección de Memmel (2003).
 *
 *     Var(SR₁−SR₂) ≈ (1/T)·[ 2(1−ρ) + ½(SR₁²+SR₂²) − ρ·SR₁·SR₂ ]
 *
 * ⚠️ **CON LOS SHARPE POR PERIODO Y T = NÚMERO DE OBSERVACIONES, no con los anualizados y T en
 * años.** La derivación asintótica es por observación, y las dos versiones NO son equivalentes:
 * el término `2(1−ρ)` no escala con √12 como sí lo hacen los demás. Calculado mal —anualizando—
 * la diferencia 1,00 vs 0,72 sobre 234 meses daba t = 1,62 con ρ = 0,8; bien, da t = 1,92. Es la
 * diferencia entre «no concluyente» y «casi». Se devuelve todo (ρ, SE, t) para que se pueda
 * comprobar la cuenta, no sólo el veredicto.
 *
 * Dos series muy correlacionadas hacen la diferencia MÁS fácil de detectar, no menos: comparten
 * el ruido de mercado y lo que queda es la diferencia real.
 */
export function diferenciaSharpe(a: number[], b: number[], rfAnnual = 0): DiferenciaSharpe {
  const T = Math.min(a.length, b.length);
  const x = a.slice(0, T), y = b.slice(0, T);
  const raiz = Math.sqrt(PERIODS);
  const s1 = sharpe(x, rfAnnual) / raiz;             // Sharpe MENSUAL
  const s2 = sharpe(y, rfAnnual) / raiz;
  const rho = correlacion(x, y);
  const varDif = (1 / T) * (2 * (1 - rho) + 0.5 * (s1 * s1 + s2 * s2) - rho * s1 * s2);
  const se = Math.sqrt(Math.max(varDif, 0));
  const t = se === 0 ? 0 : (s1 - s2) / se;
  return {
    sharpeA: +(s1 * raiz).toFixed(3), sharpeB: +(s2 * raiz).toFixed(3),
    diferencia: +((s1 - s2) * raiz).toFixed(3),
    rho: +rho.toFixed(3), errorTipico: +se.toFixed(5), t: +t.toFixed(2),
    significativo: Math.abs(t) >= 2, meses: T,
  };
}
