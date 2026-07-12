// Shared scoring adapter: point-in-time fundamentals + raw price + momentum → the
// exact production ScoreInputs → calcScores (no re-implementation of the formula).
// Used by the PoC, the historical backtest, and the live cron — one code path.
import { calcScores, calcFactorTilts, getMacroTilt } from "../lib/scoring.ts";

/** Assemble ScoreInputs from a fundamentalsAsOf() bundle + raw price + momentum + sector. */
export function buildInputs(f, rawPrice, mom = {}, sector = "", regime = null) {
  const mcap = f.shares && rawPrice ? rawPrice * f.shares : null;
  const ebitda = f.oiTTM != null && f.daTTM != null ? f.oiTTM + f.daTTM : null;
  const fcf = f.ocfTTM != null && f.capexTTM != null ? f.ocfTTM - f.capexTTM : null;
  const ev = mcap != null ? mcap + (f.debt ?? 0) - (f.cash ?? 0) : null;
  const invested = (f.equity ?? 0) + (f.debt ?? 0);
  const pos = (x) => (x != null && x > 0 ? x : null);

  return {
    pe:               mcap != null && pos(f.niTTM) ? mcap / f.niTTM : null,
    pb:               mcap != null && pos(f.equity) ? mcap / f.equity : null,
    evEbitda:         ev != null && pos(ebitda) ? ev / ebitda : null,
    pfcf:             mcap != null && pos(fcf) ? mcap / fcf : null,
    debtEquity:       pos(f.equity) ? (f.debt ?? 0) / f.equity : null,
    currentRatio:     pos(f.curL) ? f.curA / f.curL : null,
    interestCoverage: pos(f.interestTTM) && f.oiTTM != null ? f.oiTTM / f.interestTTM : null,
    netDebtEbitda:    pos(ebitda) ? ((f.debt ?? 0) - (f.cash ?? 0)) / ebitda : null,
    roic:             pos(invested) && f.oiTTM != null ? (f.oiTTM * 0.79 / invested) * 100 : null,
    roe:              pos(f.equity) && f.niTTM != null ? (f.niTTM / f.equity) * 100 : null,
    roa:              pos(f.assets) && f.niTTM != null ? (f.niTTM / f.assets) * 100 : null,
    grossMargin:      pos(f.revTTM) && f.gpTTM != null ? (f.gpTTM / f.revTTM) * 100 : null,
    netMargin:        pos(f.revTTM) && f.niTTM != null ? (f.niTTM / f.revTTM) * 100 : null,
    operatingMargin:  pos(f.revTTM) && f.oiTTM != null ? f.oiTTM / f.revTTM : null,
    revenueGrowth:    pos(f.revPrevTTM) ? (f.revTTM / f.revPrevTTM - 1) * 100 : null,
    epsGrowth:        pos(f.niPrevTTM) ? (f.niTTM / f.niPrevTTM - 1) * 100 : null,
    priceChange1M:    mom.m1 ?? null, priceChange3M: mom.m3 ?? null, priceChange6M: mom.m6 ?? null,
    marketCap:        mcap,
    sector:           sector || null,
    regime:           regime,
  };
}

/** Full score for a name: base scores + macro-tilted IC score (0-100). Matches the production
 *  app path — the macro tilt now folds in the stock's FACTOR profile (regime→factor rotation),
 *  exactly like getMacroTilt(macro, sector, factorTilts) in page.tsx/screener. Set
 *  FACTOR_FOLD=0 to measure the score WITHOUT the fold (A/B validation only). */
export function scoreStock(f, rawPrice, mom, sector, macroState = null) {
  const regime = macroState?.regime_id ?? null;
  const inputs = buildInputs(f, rawPrice, mom, sector, regime);
  const scores = calcScores(inputs);
  const useFold = process.env.FACTOR_FOLD !== "0";
  const factorTilts = useFold ? calcFactorTilts(inputs) : null;
  const tilt = macroState ? getMacroTilt(macroState, sector || "", factorTilts).tilt : 0;
  const ic = Math.max(0, Math.min(100, scores.total + tilt));
  return { inputs, scores, tilt, ic };
}
