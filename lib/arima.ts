// ─────────────────────────────────────────────────────────────────────────────
// ARIMA(p,d,0) — lightweight time-series forecast (Fase 5). Differences the series d times,
// fits an AR(p) by OLS, auto-selects (p,d) by AIC, forecasts recursively, integrates back to
// levels, and returns approximate confidence bands. Self-contained & headless. MA(q) is out of
// scope (needs a nonlinear optimizer) → q is always 0; falls back to the caller's geometric/
// linear forecast when the series is too short. Grounded in "Modelos ARIMA" (González Casimiro).
// ─────────────────────────────────────────────────────────────────────────────

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** d-th difference of a series. */
export function difference(y: number[], d: number): number[] {
  let s = y.slice();
  for (let k = 0; k < d; k++) { const out: number[] = []; for (let i = 1; i < s.length; i++) out.push(s[i] - s[i - 1]); s = out; }
  return s;
}

// Solve A·x = b (A square, small) via Gaussian elimination with partial pivoting. null if singular.
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export interface ARFit { intercept: number; coef: number[]; resid: number[]; sigma: number; }
/** Fit AR(p) by OLS: yₜ = c + Σ φᵢ·yₜ₋ᵢ + εₜ. Returns null if insufficient data / singular. */
export function fitAR(y: number[], p: number): ARFit | null {
  const nObs = y.length - p;
  if (nObs < p + 2) return null;
  if (p === 0) { const m = mean(y); const resid = y.map(v => v - m); const sse = resid.reduce((s, e) => s + e * e, 0); return { intercept: m, coef: [], resid, sigma: Math.sqrt(sse / Math.max(1, y.length - 1)) }; }
  const X: number[][] = [], Y: number[] = [];
  for (let t = p; t < y.length; t++) { const row = [1]; for (let i = 1; i <= p; i++) row.push(y[t - i]); X.push(row); Y.push(y[t]); }
  const k = p + 1;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const XtY = new Array(k).fill(0);
  for (let r = 0; r < X.length; r++) for (let a = 0; a < k; a++) { XtY[a] += X[r][a] * Y[r]; for (let b2 = 0; b2 < k; b2++) XtX[a][b2] += X[r][a] * X[r][b2]; }
  const beta = solve(XtX, XtY);
  if (!beta) return null;
  const intercept = beta[0], coef = beta.slice(1);
  const resid = X.map((row, r) => Y[r] - row.reduce((s, xv, a) => s + xv * beta[a], 0));
  const sse = resid.reduce((s, e) => s + e * e, 0);
  return { intercept, coef, resid, sigma: Math.sqrt(sse / Math.max(1, nObs - k)) };
}

export interface ArimaResult {
  method: "arima";
  order: { p: number; d: number; q: number };
  points: number[]; lower: number[]; upper: number[];
  aic: number; sigma: number;
}

function forecastLevels(values: number[], p: number, d: number, horizon: number): { fit: ARFit; levels: number[] } | null {
  const diffed = difference(values, d);
  const fit = fitAR(diffed, p);
  if (!fit) return null;
  // Recursive forecast of the differenced series.
  const hist = diffed.slice();
  const fdiff: number[] = [];
  for (let h = 0; h < horizon; h++) {
    let v = fit.intercept;
    for (let i = 1; i <= p; i++) { const idx = hist.length - i; v += fit.coef[i - 1] * (idx >= 0 ? hist[idx] : mean(diffed)); }
    fdiff.push(v); hist.push(v);
  }
  // Integrate back d times.
  let series = fdiff;
  for (let k = d; k >= 1; k--) {
    const base = difference(values, k - 1); // series at differencing level k-1
    const last = base[base.length - 1];
    const out: number[] = []; let acc = last;
    for (const dv of series) { acc += dv; out.push(acc); }
    series = out;
  }
  return { fit, levels: d === 0 ? fdiff : series };
}

/** Fit ARIMA(p,d,0) with auto (p,d) by AIC and forecast `horizon` steps with z-band CIs.
 *  Returns null if the series is too short (caller should fall back to geometric/linear). */
export function forecastARIMA(values: number[], horizon: number, opts?: { maxP?: number; maxD?: number; z?: number }): ArimaResult | null {
  const clean = values.filter(v => isFinite(v));
  if (clean.length < 8 || horizon < 1) return null;
  const maxP = opts?.maxP ?? 2, maxD = opts?.maxD ?? 1, z = opts?.z ?? 1.28; // ~80% band
  let best: { p: number; d: number; aic: number } | null = null;
  for (let d = 0; d <= maxD; d++) {
    const diffed = difference(clean, d);
    for (let p = 0; p <= maxP; p++) {
      const fit = fitAR(diffed, p);
      if (!fit) continue;
      const n = diffed.length - p, kk = p + 1;
      if (n <= 0) continue;
      const sse = fit.resid.reduce((s, e) => s + e * e, 0);
      // Perfect fit (sse≈0, e.g. a clean linear/AR series) → best possible AIC, not skipped.
      const aic = sse > 1e-9 ? n * Math.log(sse / n) + 2 * kk : -Infinity;
      if (!best || aic < best.aic) best = { p, d, aic };
    }
  }
  if (!best) return null;
  const fc = forecastLevels(clean, best.p, best.d, horizon);
  if (!fc) return null;
  const points = fc.levels.map(v => Math.round(v * 1000) / 1000);
  const lower: number[] = [], upper: number[] = [];
  for (let h = 0; h < horizon; h++) { const se = fc.fit.sigma * Math.sqrt(h + 1); lower.push(Math.round((points[h] - z * se) * 1000) / 1000); upper.push(Math.round((points[h] + z * se) * 1000) / 1000); }
  return { method: "arima", order: { p: best.p, d: best.d, q: 0 }, points, lower, upper, aic: Math.round(best.aic * 100) / 100, sigma: Math.round(fc.fit.sigma * 1000) / 1000 };
}
