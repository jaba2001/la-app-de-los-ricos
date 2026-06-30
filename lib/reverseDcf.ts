/**
 * Reverse DCF — headless solver
 *
 * Core question: What revenue CAGR must the market be pricing in
 * for the current stock price to be "fair value"?
 *
 * Model mirrors StockValuation.tsx to stay internally consistent:
 *   - Years 1-5: revenue grows at impliedCagr
 *   - Years 6-10: revenue grows at impliedCagr/2 (deceleration)
 *   - FCF each year = revenue × observed FCF margin (TTM)
 *   - Terminal value via Gordon Growth: FCF₁₁ / (wacc - terminalGr)
 *   - Equity value = PV(FCFs) + PV(TV) - netDebt
 */

export interface ReverseDCFInputs {
  currentPrice: number;         // $ per share (from quote)
  revenueTTM: number;           // $ (sum of last 4 quarters)
  fcfMarginTTM: number;         // decimal, e.g. 0.22 for 22%
  netDebt: number;              // $ (totalDebt - cash); negative = net cash
  sharesOut: number;            // # of shares outstanding
  beta: number;                 // equity beta (from Finnhub or FMP)
  rfRate: number;               // risk-free rate % (dgs10, e.g. 4.2)
  creditStress?: number | null; // 0-100 composite → adds spread to ERP
  terminalGr?: number;          // terminal growth rate % (default 3)
}

export interface ReverseDCFResult {
  impliedGrowthCagr: number;          // % CAGR implied by current price (Y1-5)
  conventionalValue: number;          // $ per share with 8/4% conservative growth
  upside: number;                     // % discount/premium vs conventional value
  tvShare: number;                    // 0-1 fraction of value from terminal value
  realityBand: 'achievable' | 'ambitious' | 'very_aggressive';
  wacc: number;                       // % WACC used
  rfRate: number;                     // % risk-free rate used
}

export const ERP_BASE = 5.5;       // Equity risk premium base (Damodaran 2026 US estimate)
const MIN_WACC = 7;
const MAX_WACC = 20;
const TERM_GR  = 3;         // Default terminal growth %
const TAX_RATE = 0.21;      // US effective corporate tax approximation

/** WACC = rf + beta × (ERP_base + credit_stress_spread) — shared methodology across Reverse DCF and Interactive DCF */
export function computeWACC(rf: number, beta: number, creditStress: number | null | undefined): number {
  const csc = creditStress != null ? Number(creditStress) : 0;
  // Each point of credit stress adds up to 1.5% extra ERP spread (linear, capped at stress=100)
  const stressSpread = Math.min(1.5, (csc / 100) * 1.5);
  const erp = ERP_BASE + stressSpread;
  const wacc = rf + beta * erp;
  return Math.max(MIN_WACC, Math.min(MAX_WACC, wacc));
}

/**
 * Run the 10-year DCF model and return equity value per share.
 * Returns null if the model is undefined (wacc <= termGr).
 */
function runDCF(
  revenueTTM: number,
  fcfMarginTTM: number,
  netDebt: number,
  sharesOut: number,
  g1: number,           // growth rate Y1-5 (%)
  g2: number,           // growth rate Y6-10 (%)
  wacc: number,         // discount rate (%)
  termGr: number,       // terminal growth (%)
): number | null {
  if (wacc <= termGr || sharesOut <= 0 || revenueTTM <= 0) return null;

  let totalPV = 0;
  let rev = revenueTTM;
  let lastFCF = 0;

  for (let yr = 1; yr <= 10; yr++) {
    const growthRate = yr <= 5 ? g1 / 100 : g2 / 100;
    rev *= (1 + growthRate);
    // FCF = revenue × observed margin (assume margin is persistent)
    // Adjust for tax — if margin already reflects after-tax FCF, no adjustment needed.
    // We use the raw FCF margin as observed (it's already after-tax in free cash flow).
    const fcf = rev * fcfMarginTTM;
    totalPV += fcf / Math.pow(1 + wacc / 100, yr);
    if (yr === 10) lastFCF = fcf;
  }

  // Terminal value at end of year 10
  const tv = (lastFCF * (1 + termGr / 100)) / ((wacc - termGr) / 100);
  const pvTV = tv / Math.pow(1 + wacc / 100, 10);
  totalPV += pvTV;

  const equityValue = totalPV - netDebt;
  return Math.max(0, equityValue / sharesOut);
}

/**
 * Bisection solver — find g* in [lo, hi] such that DCF(g*) ≈ targetPrice.
 * Returns null if the function doesn't cross the target (non-convergent).
 */
function bisect(
  revenueTTM: number,
  fcfMarginTTM: number,
  netDebt: number,
  sharesOut: number,
  wacc: number,
  termGr: number,
  targetPrice: number,
  lo = -5,
  hi = 80,
  iterations = 50,
): number | null {
  // g2 = g1/2 (deceleration model)
  const dcfAt = (g: number) => runDCF(revenueTTM, fcfMarginTTM, netDebt, sharesOut, g, g / 2, wacc, termGr);

  const fLo = (dcfAt(lo) ?? 0) - targetPrice;
  const fHi = (dcfAt(hi) ?? 0) - targetPrice;

  // If price is above even the maximum growth scenario → model can't explain price
  if (fHi < 0) return hi; // implied > 80% CAGR — return hi as signal
  // If price is below even the minimum growth scenario → deep undervalue
  if (fLo > 0) return lo;

  let a = lo, b = hi;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    const fMid = (dcfAt(mid) ?? 0) - targetPrice;
    if (Math.abs(fMid) < 0.01 || (b - a) / 2 < 0.01) return mid;
    if (fMid < 0) b = mid; else a = mid;
  }
  return (a + b) / 2;
}

export function computeReverseDCF(inputs: ReverseDCFInputs): ReverseDCFResult | null {
  const {
    currentPrice,
    revenueTTM,
    fcfMarginTTM,
    netDebt,
    sharesOut,
    beta,
    rfRate,
    creditStress,
    terminalGr = TERM_GR,
  } = inputs;

  // Guard: model requires positive revenue, positive FCF margin, valid shares and price
  if (
    currentPrice <= 0 ||
    revenueTTM <= 0 ||
    fcfMarginTTM < -0.5 ||   // too deeply loss-making for model to be meaningful
    sharesOut <= 0
  ) return null;

  const wacc = computeWACC(rfRate, beta, creditStress);

  // Guard: WACC must exceed terminal growth for Gordon formula
  if (wacc <= terminalGr) return null;

  // Solve for the implied CAGR
  const impliedG = bisect(revenueTTM, fcfMarginTTM, netDebt, sharesOut, wacc, terminalGr, currentPrice);
  if (impliedG === null) return null;

  // Conventional "conservative" value: 8% Y1-5, 4% Y6-10
  const conservativeVal = runDCF(revenueTTM, fcfMarginTTM, netDebt, sharesOut, 8, 4, wacc, terminalGr);
  if (conservativeVal === null) return null;

  // Terminal value share at the implied growth scenario
  const totalPVAtImplied = runDCF(revenueTTM, fcfMarginTTM, netDebt, sharesOut, impliedG, impliedG / 2, wacc, terminalGr);
  // Compute just the operating PV (no TV) to get TV share
  let opPV = 0;
  let rev = revenueTTM;
  for (let yr = 1; yr <= 10; yr++) {
    const gr = yr <= 5 ? impliedG / 100 : (impliedG / 2) / 100;
    rev *= (1 + gr);
    opPV += (rev * fcfMarginTTM) / Math.pow(1 + wacc / 100, yr);
  }
  const tvShare = totalPVAtImplied != null && totalPVAtImplied > 0
    ? Math.max(0, Math.min(1, 1 - opPV / (totalPVAtImplied + netDebt / sharesOut)))
    : 0;

  const realityBand: ReverseDCFResult['realityBand'] =
    impliedG <= 12 ? 'achievable' :
    impliedG <= 25 ? 'ambitious'  :
    'very_aggressive';

  const upside = currentPrice > 0
    ? ((conservativeVal - currentPrice) / currentPrice) * 100
    : 0;

  return {
    impliedGrowthCagr: Number(impliedG.toFixed(1)),
    conventionalValue: Number(conservativeVal.toFixed(2)),
    upside:            Number(upside.toFixed(1)),
    tvShare:           Number(tvShare.toFixed(3)),
    realityBand,
    wacc:              Number(wacc.toFixed(2)),
    rfRate,
  };
}

/** Unused tax rate param kept for future after-tax FCF margin adjustments */
export { TAX_RATE };
