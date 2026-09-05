// Time-series forecast (P2-10 / P2-17). Pure, deterministic: fits a trend to a series (revenue,
// FCF, any metric) and projects `horizon` periods with a confidence band. Uses GEOMETRIC growth
// (OLS on log values) when the series is strictly positive — the right model for compounding
// revenue — and falls back to LINEAR otherwise. From the ARIMA / quantitative-methods material,
// kept honest & simple (no overfit). Verified in scripts/p2.test.mjs.

interface Fit { slope: number; intercept: number; residStd: number; r2: number }

function ols(y: number[]): Fit {
  const n = y.length;
  const meanX = (n - 1) / 2;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX, dy = y[i] - meanY;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) { const pred = intercept + slope * i; ssRes += (y[i] - pred) ** 2; }
  const residStd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  const r2 = syy > 0 ? 1 - ssRes / syy : 1;
  return { slope, intercept, residStd, r2 };
}

export interface ForecastResult {
  method: "geometric" | "linear";
  points: number[];      // central projection, oldest→newest of the FUTURE periods
  lower: number[];
  upper: number[];
  growthRate: number | null; // per-period growth (geometric only), e.g. 0.08 = +8%/period
  r2: number;                // fit quality on the history (0..1)
}

/**
 * @param values history oldest→newest.
 * @param horizon how many periods to project.
 * @param z band half-width in σ (1.28 ≈ central 80%).
 */
export function forecastSeries(values: number[], horizon = 4, z = 1.28): ForecastResult | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 4) return null;
  const n = clean.length;
  const allPos = clean.every((v) => v > 0);

  if (allPos) {
    const { slope, intercept, residStd, r2 } = ols(clean.map(Math.log));
    const points: number[] = [], lower: number[] = [], upper: number[] = [];
    for (let h = 1; h <= horizon; h++) {
      const logPred = intercept + slope * (n - 1 + h);
      points.push(Math.exp(logPred));
      lower.push(Math.exp(logPred - z * residStd));
      upper.push(Math.exp(logPred + z * residStd));
    }
    return { method: "geometric", points, lower, upper, growthRate: Math.exp(slope) - 1, r2 };
  }

  const { slope, intercept, residStd, r2 } = ols(clean);
  const points: number[] = [], lower: number[] = [], upper: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const pred = intercept + slope * (n - 1 + h);
    points.push(pred); lower.push(pred - z * residStd); upper.push(pred + z * residStd);
  }
  return { method: "linear", points, lower, upper, growthRate: null, r2 };
}
