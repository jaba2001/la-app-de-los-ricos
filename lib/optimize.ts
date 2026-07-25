// Mean-variance portfolio optimization (P2-13). Pure linear algebra — closed-form min-variance
// and max-Sharpe (tangency) weights from expected returns μ and covariance Σ, plus a long-only
// projection. From the "Gestión de activos y carteras" material (Markowitz). This is a TOOL that
// sits ALONGSIDE Scora's validated regime allocator, never replacing it. Verified in p2.test.mjs.

type Matrix = number[][];

/** Gauss-Jordan inverse; returns null if singular. */
export function invert(m: Matrix): Matrix | null {
  const n = m.length;
  const A: Matrix = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row) => row.slice(n));
}

function matVec(m: Matrix, v: number[]): number[] {
  return m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}
function normalizeSum1(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  return s !== 0 ? w.map((x) => x / s) : w;
}

/** Global minimum-variance weights: w ∝ Σ⁻¹·1, normalized to sum 1. */
export function minVariance(cov: Matrix): number[] | null {
  const inv = invert(cov);
  if (!inv) return null;
  return normalizeSum1(matVec(inv, cov.map(() => 1)));
}

/** Tangency (max-Sharpe) weights: w ∝ Σ⁻¹·(μ − rf), normalized to sum 1. */
export function maxSharpe(mu: number[], cov: Matrix, rf = 0): number[] | null {
  const inv = invert(cov);
  if (!inv) return null;
  return normalizeSum1(matVec(inv, mu.map((m) => m - rf)));
}

/** Clamp negatives to 0 and renormalize — a simple long-only projection (no shorting). */
export function longOnly(w: number[]): number[] {
  return normalizeSum1(w.map((x) => Math.max(0, x)));
}

export interface PortfolioStats { ret: number; vol: number; sharpe: number }

/** Expected return, volatility and Sharpe of a weight vector given μ and Σ (rf optional). */
export function portfolioStats(w: number[], mu: number[], cov: Matrix, rf = 0): PortfolioStats {
  const ret = w.reduce((s, wi, i) => s + wi * mu[i], 0);
  let variance = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) variance += w[i] * w[j] * cov[i][j];
  const vol = Math.sqrt(Math.max(0, variance));
  return { ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : 0 };
}

/** Sample covariance matrix from aligned return series (columns = assets). */
export function covariance(series: number[][]): Matrix {
  const k = series.length;
  const n = Math.min(...series.map((s) => s.length));
  const means = series.map((s) => s.slice(0, n).reduce((a, b) => a + b, 0) / n);
  const cov: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += (series[i][t] - means[i]) * (series[j][t] - means[j]);
      const c = n > 1 ? acc / (n - 1) : 0;
      cov[i][j] = cov[j][i] = c;
    }
  }
  return cov;
}
