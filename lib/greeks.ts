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

// ── Multi-leg option strategies (Fase 4) ─────────────────────────────────────────
// A leg is long (qty>0) or short (qty<0). Stock legs use kind "stock" (premium = entry price).
// Pure math on top of BSM: net premium, expiry payoff curve, breakevens, max profit/loss, net Greeks.
export type LegKind = "call" | "put" | "stock";
export interface PricedLeg { kind: LegKind; qty: number; strike?: number; premium: number; }

/** Value of one leg's position at expiry price S (per share × qty). */
export function legIntrinsic(leg: PricedLeg, S: number): number {
  if (leg.kind === "stock") return leg.qty * S;
  const k = leg.strike ?? 0;
  const iv = leg.kind === "call" ? Math.max(0, S - k) : Math.max(0, k - S);
  return leg.qty * iv;
}

export interface StrategyAnalysis {
  netPremium: number;                        // cash out today (debit>0, credit<0)
  payoff: { spot: number; pnl: number }[];   // P&L at expiry across a spot grid
  breakevens: number[];
  maxProfit: number | null;                  // null = unbounded
  maxLoss: number | null;                    // null = unbounded
}

/** Analyze a priced multi-leg position at expiry. spot = current underlying (for the grid + stock cost). */
export function analyzeStrategy(legs: PricedLeg[], spot: number, steps = 120): StrategyAnalysis {
  const netPremium = legs.reduce((s, l) => s + l.qty * (l.kind === "stock" ? spot : l.premium), 0);
  const pnlAt = (S: number) => legs.reduce((s, l) => s + legIntrinsic(l, S), 0) - netPremium;
  const hi = Math.max(spot * 2.5, (Math.max(...legs.map(l => l.strike ?? 0)) || spot) * 1.5);
  const payoff: { spot: number; pnl: number }[] = [];
  for (let i = 0; i <= steps; i++) { const S = (hi * i) / steps; payoff.push({ spot: S, pnl: pnlAt(S) }); }
  // Breakevens: linear-interpolate zero crossings.
  const breakevens: number[] = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1], b = payoff[i];
    if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
      const t = a.pnl / (a.pnl - b.pnl);
      breakevens.push(Math.round((a.spot + t * (b.spot - a.spot)) * 100) / 100);
    }
  }
  // Unbounded detection from the right-edge slope.
  const rSlope = payoff[payoff.length - 1].pnl - payoff[payoff.length - 2].pnl;
  const eps = spot * 1e-4;
  const vals = payoff.map(p => p.pnl);
  const maxProfit = rSlope > eps ? null : Math.round(Math.max(...vals) * 100) / 100;
  const maxLoss = rSlope < -eps ? null : Math.round(Math.min(...vals) * 100) / 100;
  return { netPremium: Math.round(netPremium * 100) / 100, payoff, breakevens, maxProfit, maxLoss };
}

export type StrategyName = "covered-call" | "protective-put" | "collar" | "bull-call" | "bear-put" | "straddle" | "strangle" | "butterfly";
export const STRATEGY_LABELS: Record<StrategyName, string> = {
  "covered-call": "Covered call", "protective-put": "Protective put", collar: "Collar",
  "bull-call": "Bull call spread", "bear-put": "Bear put spread", straddle: "Straddle", strangle: "Strangle", butterfly: "Butterfly",
};

export interface StrategyResult extends StrategyAnalysis {
  name: StrategyName; legs: PricedLeg[];
  netDelta: number; netGamma: number; netVega: number; netTheta: number;
}
export interface Market { vol: number; rate: number; q?: number; t: number; }

/** Build a named strategy around `spot`, pricing option legs with BSM. Strikes are set relative
 *  to spot (ATM / ±5-10%). Returns net premium, payoff, breakevens, max P/L and net Greeks. */
export function buildStrategy(name: StrategyName, spot: number, market: Market): StrategyResult | null {
  if (!(spot > 0) || !(market.vol > 0) || !(market.t > 0)) return null;
  const q = market.q ?? 0;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const kATM = r2(spot), kUp = r2(spot * 1.05), kUp10 = r2(spot * 1.10), kDn = r2(spot * 0.95), kDn10 = r2(spot * 0.90);
  const price = (type: OptionType, k: number) => blackScholes(spot, k, market.t, market.vol, market.rate, q, type);
  const mk = (kind: LegKind, qty: number, strike?: number): PricedLeg => {
    if (kind === "stock") return { kind, qty, premium: spot };
    const g = price(kind, strike!);
    return { kind, qty, strike, premium: Math.round(g.price * 100) / 100 };
  };
  let legs: PricedLeg[];
  switch (name) {
    case "covered-call":   legs = [mk("stock", 1), mk("call", -1, kUp)]; break;
    case "protective-put": legs = [mk("stock", 1), mk("put", 1, kDn)]; break;
    case "collar":         legs = [mk("stock", 1), mk("put", 1, kDn), mk("call", -1, kUp)]; break;
    case "bull-call":      legs = [mk("call", 1, kATM), mk("call", -1, kUp10)]; break;
    case "bear-put":       legs = [mk("put", 1, kATM), mk("put", -1, kDn10)]; break;
    case "straddle":       legs = [mk("call", 1, kATM), mk("put", 1, kATM)]; break;
    case "strangle":       legs = [mk("call", 1, kUp), mk("put", 1, kDn)]; break;
    case "butterfly":      legs = [mk("call", 1, kDn), mk("call", -2, kATM), mk("call", 1, kUp)]; break;
    default: return null;
  }
  const analysis = analyzeStrategy(legs, spot);
  // Net Greeks (stock leg: delta = qty, others 0).
  let netDelta = 0, netGamma = 0, netVega = 0, netTheta = 0;
  for (const l of legs) {
    if (l.kind === "stock") { netDelta += l.qty; continue; }
    const g = price(l.kind, l.strike!);
    netDelta += l.qty * g.delta; netGamma += l.qty * g.gamma; netVega += l.qty * g.vega / 100; netTheta += l.qty * g.thetaPerDay;
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return { name, legs, ...analysis, netDelta: r3(netDelta), netGamma: r3(netGamma), netVega: r3(netVega), netTheta: r3(netTheta) };
}
