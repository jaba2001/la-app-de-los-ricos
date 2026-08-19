// Shared scoring adapter: point-in-time fundamentals + raw price + momentum → the
// exact production ScoreInputs → calcScores (no re-implementation of the formula).
// Used by the PoC, the historical backtest, and the live cron — one code path.
import { calcScores, calcFactorTilts, getMacroTilt } from "../lib/scoring.ts";
import { altmanZ, accrualsRatio, dupont, piotroskiF } from "../lib/quality.ts";

/** Point-in-time quality/credit rankers (Fase 7) from EDGAR bundles + raw price. `fPrev` is the
 *  fundamentals bundle ~1yr earlier (for Piotroski). Returns scalars where HIGHER = better, so a
 *  positive IC in the backtest means the signal predicts higher forward returns. */
export function computeQualitySignals({ f, fPrev, rawPrice, sector }) {
  const mcap = f.shares && rawPrice ? rawPrice * f.shares : null;
  const totLiab = f.assets != null && f.equity != null ? f.assets - f.equity : null;
  const serviceOrFinancial = /financial|real estate/i.test(sector || "");
  const az = altmanZ({
    workingCapital: f.curA != null && f.curL != null ? f.curA - f.curL : null,
    retainedEarnings: f.retainedEarnings ?? null, ebit: f.oiTTM ?? null,
    marketCap: mcap, bookEquity: f.equity ?? null, totalLiabilities: totLiab,
    sales: f.revTTM ?? null, totalAssets: f.assets ?? null, serviceOrFinancial,
  });
  const acc = accrualsRatio(f.niTTM ?? null, f.ocfTTM ?? null, f.assets ?? null);
  const dp = dupont({ netIncome: f.niTTM ?? null, sales: f.revTTM ?? null, totalAssets: f.assets ?? null, totalEquity: f.equity ?? null, pretaxIncome: f.pretaxIncome ?? null, ebit: f.oiTTM ?? null });
  let pio = null;
  if (fPrev) {
    const r = piotroskiF({
      roa: f.niTTM != null && f.assets ? f.niTTM / f.assets : null,
      roaPrev: fPrev.niTTM != null && fPrev.assets ? fPrev.niTTM / fPrev.assets : null,
      cfo: f.ocfTTM ?? null, netIncome: f.niTTM ?? null, totalAssets: f.assets ?? null,
      leverage: f.debt != null && f.assets ? f.debt / f.assets : null,
      leveragePrev: fPrev.debt != null && fPrev.assets ? fPrev.debt / fPrev.assets : null,
      currentRatio: f.curA != null && f.curL ? f.curA / f.curL : null,
      currentRatioPrev: fPrev.curA != null && fPrev.curL ? fPrev.curA / fPrev.curL : null,
      shares: f.shares ?? null, sharesPrev: fPrev.shares ?? null,
      grossMargin: f.gpTTM != null && f.revTTM ? f.gpTTM / f.revTTM : null,
      grossMarginPrev: fPrev.gpTTM != null && fPrev.revTTM ? fPrev.gpTTM / fPrev.revTTM : null,
      assetTurnover: f.revTTM != null && f.assets ? f.revTTM / f.assets : null,
      assetTurnoverPrev: fPrev.revTTM != null && fPrev.assets ? fPrev.revTTM / fPrev.assets : null,
    });
    pio = r ? r.score : null;
  }
  return {
    altmanZ: az ? az.z : null,          // higher = safer
    accrualsQ: acc ? -acc.ratio : null, // negate → higher = better earnings quality
    dupontRoe: dp ? dp.roe3 : null,     // higher = better
    piotroski: pio,                     // higher = stronger
  };
}

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
    grossProfitability: pos(f.assets) && f.gpTTM != null ? (f.gpTTM / f.assets) * 100 : null, // Novy-Marx quality

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
export function scoreStock(f, rawPrice, mom, sector, macroState = null, dist = null) {
  const regime = macroState?.regime_id ?? null;
  const inputs = buildInputs(f, rawPrice, mom, sector, regime);
  // `dist` opcional (F2): con tabla de distribuciones el score es sector-relativo; sin ella
  // caen las bandas absolutas y el backtest histórico sigue reproduciéndose igual que antes.
  const scores = calcScores(inputs, dist);
  const useFold = process.env.FACTOR_FOLD !== "0";
  const factorTilts = useFold ? calcFactorTilts(inputs) : null;
  const tilt = macroState ? getMacroTilt(macroState, sector || "", factorTilts).tilt : 0;
  const ic = Math.max(0, Math.min(100, scores.total + tilt));
  return { inputs, scores, tilt, ic };
}
