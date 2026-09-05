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

// ─────────────────────────────────────────────────────────────────────────────
// MEDICIÓN (F5) — el giro de PLAN_TEORIA_FINANCIERA_SCORA.md §4.1: usar BSM en la
// dirección ÚTIL. Hasta aquí el módulo va precio ← vol (tecleas una vol, sale un precio:
// la calculadora te devuelve tu propia suposición). Lo que sigue va vol ← precio, y añade
// la probabilidad implícita que `blackScholes` ya calculaba y se tiraba a la basura.
// Nada de esto necesita una cadena de opciones ni un feed de pago.
// Todas las vols son DECIMALES (0.20 = 20%), igual que en el resto del fichero.
// ─────────────────────────────────────────────────────────────────────────────

/** Cotas de no-arbitraje del precio de una opción europea. Fuera de ellas no existe
 *  ninguna volatilidad que reproduzca el precio (dato malo o error de captura). */
export function noArbitrageBounds(
  spot: number, strike: number, t: number, rate: number, q: number, type: OptionType
): { lo: number; hi: number } {
  const sd = spot * Math.exp(-q * t);
  const kd = strike * Math.exp(-rate * t);
  return type === "call"
    ? { lo: Math.max(0, sd - kd), hi: sd }
    : { lo: Math.max(0, kd - sd), hi: kd };
}

export interface ImpliedVolResult {
  vol: number;         // volatilidad implícita anualizada (decimal)
  iterations: number;
  method: "newton" | "bisection";
  /** |precio(vol) − precio de mercado| alcanzado. */
  priceError: number;
  /** Vega en la solución (por 1.00 de vol). Mide cuánta INFORMACIÓN sobre la vol
   *  contenía realmente el precio. */
  vega: number;
  /** Incertidumbre de la vol devuelta (decimal), = IV_TOL/vega. Publícala: una IV de
   *  32% ± 0.01 puntos es un dato; ± 3 puntos es otra cosa. */
  volUncertainty: number;
}

const IV_MIN = 1e-6;
const IV_MAX = 5;       // 500% anual: techo generoso, evita búsquedas infinitas
const IV_TOL = 1e-8;

/**
 * Incertidumbre máxima tolerada en la vol implícita (decimal). 1e-4 = 0.01 puntos de vol,
 * muy por debajo de lo que cualquier lector puede usar.
 */
export const MAX_VOL_UNCERTAINTY = 1e-4;

/**
 * Vega mínima para considerar la volatilidad IDENTIFICABLE a partir del precio.
 *
 * Muy dentro (o muy fuera) de dinero, vega colapsa: el precio es prácticamente el valor
 * intrínseco descontado y NO depende de la volatilidad. Ahí el solver converge en PRECIO
 * pero devuelve una vol arbitraria — medido: una call S=100/K=20 con vol real 20%
 * "resuelve" a 28.4% clavando el precio hasta el noveno decimal.
 *
 * El umbral NO se elige a ojo, se deriva: el solver acepta un error de precio de IV_TOL,
 * que por la relación dPrecio = vega·dVol equivale a una incertidumbre en vol de
 * IV_TOL/vega. Exigir que esa incertidumbre baje de MAX_VOL_UNCERTAINTY da directamente
 * vega > IV_TOL/MAX_VOL_UNCERTAINTY = 1e-4.
 *
 * Por debajo se devuelve null: el precio no contiene la respuesta, y publicar el número
 * sería falsa precisión — justo lo que este módulo existe para evitar.
 */
export const MIN_VEGA_FOR_IV = IV_TOL / MAX_VOL_UNCERTAINTY;

/**
 * Volatilidad implícita: invierte Black-Scholes desde el precio de MERCADO.
 * Es la pieza que convierte la calculadora en instrumento de medida — "ese precio implica
 * 42% de vol; la acción ha realizado 26%, pagas 16 puntos de prima".
 *
 * Newton-Raphson sembrado con Brenner-Subrahmanyam, con bisección de respaldo cuando vega
 * es diminuta (opciones muy dentro/fuera de dinero) y Newton se vuelve inestable.
 * Devuelve null si el precio viola las cotas de no-arbitraje o no hay convergencia.
 */
export function impliedVol(
  marketPrice: number, spot: number, strike: number, t: number, rate: number, q: number, type: OptionType
): ImpliedVolResult | null {
  if (!(t > 0) || !(spot > 0) || !(strike > 0) || !(marketPrice > 0) || !isFinite(marketPrice)) return null;
  const { lo, hi } = noArbitrageBounds(spot, strike, t, rate, q, type);
  // Tolerancia mínima en el borde: un precio exactamente en la cota implica vol 0 o infinita.
  const eps = Math.max(1e-10, hi * 1e-12);
  if (marketPrice < lo - eps || marketPrice > hi + eps) return null;

  const priceAt = (v: number) => blackScholes(spot, strike, t, v, rate, q, type).price;

  /** Salida única: solo se devuelve una IV si el precio REALMENTE la identificaba. */
  const settle = (
    vol: number, iterations: number, method: "newton" | "bisection"
  ): ImpliedVolResult | null => {
    const g = blackScholes(spot, strike, t, vol, rate, q, type);
    if (!(g.vega > MIN_VEGA_FOR_IV)) return null; // vol no identificable desde el precio
    return {
      vol, iterations, method,
      priceError: Math.abs(g.price - marketPrice),
      vega: g.vega,
      volUncertainty: IV_TOL / g.vega,
    };
  };

  // Semilla de Brenner-Subrahmanyam: sigma ≈ sqrt(2π/T)·(precio/spot). Buena en ATM.
  let v = Math.sqrt((2 * Math.PI) / t) * (marketPrice / spot);
  if (!isFinite(v) || v <= 0) v = 0.2;
  v = Math.min(IV_MAX, Math.max(IV_MIN, v));

  for (let i = 0; i < 60; i++) {
    const g = blackScholes(spot, strike, t, v, rate, q, type);
    const diff = g.price - marketPrice;
    if (Math.abs(diff) < IV_TOL) return settle(v, i + 1, "newton");
    // vega aquí es por 1.00 de vol (no por punto), que es la derivada que Newton necesita.
    if (!(g.vega > 1e-8)) break; // vega colapsada → Newton no es fiable, pasa a bisección
    const next = v - diff / g.vega;
    if (!isFinite(next) || next <= IV_MIN || next >= IV_MAX) break;
    if (Math.abs(next - v) < 1e-12) { v = next; break; }
    v = next;
  }

  // Bisección: el precio es monótono creciente en vol, así que si hay cambio de signo
  // en [IV_MIN, IV_MAX] la raíz se acota siempre.
  let a = IV_MIN, b = IV_MAX;
  const fa = priceAt(a) - marketPrice;
  const fb = priceAt(b) - marketPrice;
  if (fa * fb > 0) {
    // Sin cambio de signo: el precio no es alcanzable dentro de [IV_MIN, IV_MAX]. Solo se
    // acepta si un extremo ya clava el precio (y `settle` aún debe validar la vega).
    const bestEdge = Math.abs(fa) <= Math.abs(fb) ? a : b;
    return Math.min(Math.abs(fa), Math.abs(fb)) < 1e-6 ? settle(bestEdge, 0, "bisection") : null;
  }
  let mid = a;
  for (let i = 0; i < 200; i++) {
    mid = (a + b) / 2;
    const fm = priceAt(mid) - marketPrice;
    if (Math.abs(fm) < IV_TOL || b - a < 1e-12) return settle(mid, i + 1, "bisection");
    if (fa * fm < 0) b = mid; else a = mid;
  }
  return settle(mid, 200, "bisection");
}

export interface ImpliedProbability {
  /** N(d2) — probabilidad NEUTRAL AL RIESGO de acabar por encima del strike al vencimiento. */
  above: number;
  below: number;
  d2: number;
  /** Movimiento de 1 sigma implícito hasta el vencimiento, en % del spot. */
  expectedMovePct: number;
}

/**
 * Lo que el mercado está descontando, sin inventar nada: N(d2).
 *
 * Ojo con la interpretación (y hay que decirlo en la UI): es una probabilidad NEUTRAL AL
 * RIESGO, no la probabilidad del mundo real. Incorpora la prima de riesgo, así que
 * sobreestima sistemáticamente las caídas. Es "lo que el mercado cobra", no "lo que pasará".
 */
export function impliedProbability(
  spot: number, strike: number, t: number, vol: number, rate: number, q = 0
): ImpliedProbability | null {
  if (!(t > 0) || !(vol > 0) || !(spot > 0) || !(strike > 0)) return null;
  const g = blackScholes(spot, strike, t, vol, rate, q, "call");
  const above = normCdf(g.d2);
  return {
    above,
    below: 1 - above,
    d2: g.d2,
    expectedMovePct: vol * Math.sqrt(t) * 100,
  };
}

/** Volatilidad realizada ANUALIZADA (decimal) desde una serie de retornos simples
 *  (decimales: 0.01 = 1%). `periodsPerYear`: 252 diario, 12 mensual. */
export function realizedVol(returns: number[], periodsPerYear = 252): number | null {
  const r = returns.filter((x) => x != null && isFinite(x));
  if (r.length < 2) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  const varr = r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(varr * periodsPerYear);
}

/** Volatilidad realizada anualizada desde una serie de CIERRES en orden cronológico
 *  (el más antiguo primero). Usa retornos logarítmicos, que es la convención de BSM. */
export function realizedVolFromCloses(closes: number[], periodsPerYear = 252): number | null {
  const c = closes.filter((x) => x != null && isFinite(x) && x > 0);
  if (c.length < 3) return null;
  const lr: number[] = [];
  for (let i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]));
  return realizedVol(lr, periodsPerYear);
}

export interface VarianceRiskPremium {
  /** IV² − RV², en puntos de VARIANZA (la definición del paper). */
  variancePoints: number;
  /** IV − RV, en puntos de VOLATILIDAD — más legible para la UI. */
  volPoints: number;
  ratio: number;              // IV / RV
  richness: "cara" | "neutral" | "barata";
}

/**
 * Prima de riesgo de varianza: lo que el mercado COBRA por el seguro frente a lo que la
 * volatilidad luego RESULTA ser. Positiva de forma persistente (Bollerslev-Tauchen-Zhou
 * 2009) — es de las primas mejor documentadas que existen.
 *
 * A nivel índice sale gratis y ya tienes las dos piezas: `macro_state.vix` (implícita) y la
 * vol realizada de SPY. Ambas vols en DECIMAL (0.20 = 20%); VIX viene en puntos → divide /100.
 */
export function varianceRiskPremium(impliedVolDec: number, realizedVolDec: number): VarianceRiskPremium | null {
  if (!(impliedVolDec > 0) || !(realizedVolDec > 0)) return null;
  const volPoints = (impliedVolDec - realizedVolDec) * 100;
  return {
    variancePoints: (impliedVolDec ** 2 - realizedVolDec ** 2) * 10000,
    volPoints,
    ratio: impliedVolDec / realizedVolDec,
    // Bandas de oficio sobre puntos de vol: ±2 puntos es ruido de estimación.
    richness: volPoints > 2 ? "cara" : volPoints < -2 ? "barata" : "neutral",
  };
}

// ── Vol rank + income (theta) plans — the free, honest half of an "options lab" ────
// Selling premium is what most retail options services actually monetize, and the two
// numbers that decide it are (a) is volatility rich right now, relative to its own past,
// and (b) what am I paid, annualized, for the capital I commit. Both are computable from
// the price history the app already fetches. What still needs a paid feed is the live
// chain and the IV surface (see ROADMAP §C1) — everything here works on EOD closes.

export interface VolRank {
  /** Where the current vol sits between its own 1-year low and high, 0-100. */
  rank: number;
  /** Share of observations below the current vol, 0-100. Less sensitive to one outlier. */
  percentile: number;
  low: number;
  high: number;
  /** Observations behind the ranking — small samples are not a ranking. */
  sampleSize: number;
  /** Trader shorthand on the same 0-100 scale. */
  label: "very low" | "low" | "average" | "high" | "very high";
}

/**
 * Rank a current volatility against its own history. `history` is a series of past
 * annualized vols (decimals) — typically rolling realized vol.
 *
 * Rank and percentile answer different questions and disagree often: rank is a position
 * between the extremes (one crisis spike distorts it for a year), percentile is a share of
 * observations (robust). Showing both is the honest version.
 */
export function volRank(current: number, history: number[], minSample = 30): VolRank | null {
  if (!(current > 0)) return null;
  const h = history.filter((v) => typeof v === "number" && isFinite(v) && v > 0);
  if (h.length < minSample) return null;
  const low = Math.min(...h), high = Math.max(...h);
  const rank = high > low ? ((current - low) / (high - low)) * 100 : 50;
  const below = h.filter((v) => v < current).length;
  const percentile = (below / h.length) * 100;
  const clamped = Math.max(0, Math.min(100, rank));
  return {
    rank: clamped,
    percentile,
    low,
    high,
    sampleSize: h.length,
    label: clamped < 20 ? "very low" : clamped < 40 ? "low" : clamped < 60 ? "average" : clamped < 80 ? "high" : "very high",
  };
}

/** Rolling annualized realized vol series from newest-first closes, newest first.
 *  Feeds `volRank` directly. */
export function rollingRealizedVol(closesNewestFirst: number[], window = 21, periodsPerYear = 252): number[] {
  const c = closesNewestFirst.filter((x) => typeof x === "number" && isFinite(x) && x > 0);
  const out: number[] = [];
  for (let i = 0; i + window < c.length; i++) {
    // Slice is newest-first; realizedVol squares deviations, so order does not matter.
    const v = realizedVolFromCloses(c.slice(i, i + window + 1), periodsPerYear);
    if (v != null && isFinite(v)) out.push(v);
  }
  return out;
}

export type IncomeKind = "covered-call" | "cash-secured-put";

export interface IncomePlan {
  kind: IncomeKind;
  strike: number;
  /** Premium per share, from BSM at the supplied vol. */
  premium: number;
  days: number;
  /** Capital committed per share: the stock (covered call) or the secured cash (put). */
  capital: number;
  /** Premium ÷ capital over the holding period, in %. */
  periodYield: number;
  /** Simple (non-compounded) annualization of `periodYield`, in %. */
  annualizedYield: number;
  /** Risk-neutral probability of finishing in the money — i.e. being assigned. */
  probAssignment: number;
  /** Risk-neutral probability of finishing past break-even (the position makes money). */
  pop: number;
  breakEven: number;
  /** How far the stock can fall before the position loses money, in % of spot. */
  downsideBufferPct: number;
  /** Short-leg delta (negative for the short call, positive for the short put). */
  delta: number;
  /** Total return if assigned at expiry, in % of capital (covered call only). */
  ifAssignedReturn: number | null;
}

/**
 * Price a single-leg income position at the given strike.
 *
 * Both probabilities are RISK-NEUTRAL — they are what the market charges, not a forecast.
 * Presenting N(d2) as "chance of winning" is the standard way these get oversold; the UI
 * must carry that caveat, as `impliedProbability` already documents.
 */
export function buildIncomePlan(
  kind: IncomeKind, spot: number, strike: number, market: Market
): IncomePlan | null {
  const { vol, rate, t } = market;
  const q = market.q ?? 0;
  const days = t * 365;
  if (!(spot > 0) || !(strike > 0) || !(t > 0) || !(vol > 0)) return null;

  const type: OptionType = kind === "covered-call" ? "call" : "put";
  const g = blackScholes(spot, strike, t, vol, rate, q, type);
  const premium = g.price;
  if (!(premium > 0)) return null;

  // Covered call commits the shares; a cash-secured put commits the strike in cash.
  const capital = kind === "covered-call" ? spot : strike;
  const breakEven = kind === "covered-call" ? spot - premium : strike - premium;

  const assign = impliedProbability(spot, strike, t, vol, rate, q);
  // Short call is assigned above the strike; short put below it.
  const probAssignment = assign == null ? 0 : (kind === "covered-call" ? assign.above : assign.below);

  // Profitable when the underlying finishes above break-even, for both structures.
  const beProb = breakEven > 0 ? impliedProbability(spot, breakEven, t, vol, rate, q) : null;
  const pop = beProb == null ? (breakEven <= 0 ? 1 : 0) : beProb.above;

  const periodYield = (premium / capital) * 100;
  return {
    kind,
    strike,
    premium,
    days,
    capital,
    periodYield,
    annualizedYield: periodYield * (365 / days),
    probAssignment,
    pop,
    breakEven,
    downsideBufferPct: ((spot - breakEven) / spot) * 100,
    delta: g.delta,
    ifAssignedReturn: kind === "covered-call" ? ((strike - spot + premium) / spot) * 100 : null,
  };
}

export interface IncomeGate {
  allowed: boolean;
  tone: "pos" | "warn" | "neg";
  message: string;
}

/**
 * The gate that separates this from a yield screener: never encourage selling a put on a
 * name the engine itself rates poorly. A cash-secured put is a commitment to OWN the stock
 * at the strike — collecting premium on something you scored 30/100 is picking up pennies
 * in front of your own model.
 */
export function incomeGate(kind: IncomeKind, score: number | null): IncomeGate {
  if (score == null) {
    return { allowed: true, tone: "warn", message: "No score for this name — size it as if you did not know." };
  }
  if (kind === "cash-secured-put") {
    if (score < 40) return { allowed: false, tone: "neg", message: `Selling puts here commits you to owning a name the engine scores ${score.toFixed(0)}/100. Don't.` };
    if (score < 55) return { allowed: true, tone: "warn", message: `Middling score (${score.toFixed(0)}/100) — acceptable only if you actually want the shares at the strike.` };
    return { allowed: true, tone: "pos", message: `Score ${score.toFixed(0)}/100 — assignment would leave you holding something the engine likes.` };
  }
  // Covered call: the risk is capping upside on a name you rate highly.
  if (score >= 70) return { allowed: true, tone: "warn", message: `Score ${score.toFixed(0)}/100 — writing calls caps the upside on one of the better names you hold.` };
  return { allowed: true, tone: "pos", message: `Score ${score.toFixed(0)}/100 — capping upside costs little on a name rated this way.` };
}
