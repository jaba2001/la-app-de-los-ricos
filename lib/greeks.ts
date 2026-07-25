// Black-Scholes-Merton option pricing + Greeks (P2-15). Pure math, no data feed — the honest,
// free version of "options intelligence": a calculator/education tool, not a paid options-flow
// feed. Sourced from the Derivatives Course material (BSM, Greeks). All rates/vols are decimals
// (0.05 = 5%), time in years. Verified against known textbook values in scripts/p2.test.mjs.

/** Standard normal CDF — Abramowitz & Stegun 7.1.26 (|error| < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function normPdf(x: number): number {
  return 0.3989422804014327 * Math.exp(-x * x / 2);
}

export type OptionType = "call" | "put";

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number;       // per 1.00 vol (÷100 for per 1 vol-point)
  theta: number;      // per year
  thetaPerDay: number;
  rho: number;        // per 1.00 rate (÷100 for per 1%)
  d1: number;
  d2: number;
}

/**
 * Black-Scholes-Merton with continuous dividend yield q.
 * @param spot underlying price, strike, t years to expiry, vol annualized (decimal),
 *        rate risk-free (decimal), q dividend yield (decimal), type call|put.
 */
export function blackScholes(
  spot: number, strike: number, t: number, vol: number, rate: number, q: number, type: OptionType
): Greeks {
  // Degenerate cases → intrinsic value, zero sensitivities (keeps the UI safe at expiry).
  if (!(t > 0) || !(vol > 0) || !(spot > 0) || !(strike > 0)) {
    const intrinsic = type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
    return { price: intrinsic, delta: type === "call" ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0), gamma: 0, vega: 0, theta: 0, thetaPerDay: 0, rho: 0, d1: 0, d2: 0 };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (rate - q + (vol * vol) / 2) * t) / (vol * sqrtT);
  const d2 = d1 - vol * sqrtT;
  const eqt = Math.exp(-q * t);
  const ert = Math.exp(-rate * t);
  const pdfD1 = normPdf(d1);

  let price: number, delta: number, theta: number, rho: number;
  if (type === "call") {
    price = spot * eqt * normCdf(d1) - strike * ert * normCdf(d2);
    delta = eqt * normCdf(d1);
    theta = -(spot * eqt * pdfD1 * vol) / (2 * sqrtT) - rate * strike * ert * normCdf(d2) + q * spot * eqt * normCdf(d1);
    rho = strike * t * ert * normCdf(d2);
  } else {
    price = strike * ert * normCdf(-d2) - spot * eqt * normCdf(-d1);
    delta = -eqt * normCdf(-d1);
    theta = -(spot * eqt * pdfD1 * vol) / (2 * sqrtT) + rate * strike * ert * normCdf(-d2) - q * spot * eqt * normCdf(-d1);
    rho = -strike * t * ert * normCdf(-d2);
  }
  const gamma = (eqt * pdfD1) / (spot * vol * sqrtT);
  const vega = spot * eqt * pdfD1 * sqrtT;

  return { price, delta, gamma, vega, theta, thetaPerDay: theta / 365, rho, d1, d2 };
}

/** Break-even underlying at expiry for a long option bought at `premium`. */
export function breakEven(strike: number, premium: number, type: OptionType): number {
  return type === "call" ? strike + premium : strike - premium;
}

/** Intrinsic payoff at expiry (per share) for a long option, net of premium paid. */
export function payoffAtExpiry(spotAtExpiry: number, strike: number, premium: number, type: OptionType): number {
  const intrinsic = type === "call" ? Math.max(0, spotAtExpiry - strike) : Math.max(0, strike - spotAtExpiry);
  return intrinsic - premium;
}
