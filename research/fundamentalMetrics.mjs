// ─────────────────────────────────────────────────────────────────────────────
// MÉTRICAS FUNDAMENTALES desde EDGAR — fuente única compartida por
// `factor_dist.mjs` (que calcula los cuantiles sectoriales) y `score_pctl_impact.mjs`
// (que compara el score de bandas contra el de percentiles).
//
// Está extraído a su propio módulo por la misma razón que `momentumSignals.mjs`: si cada
// script tuviera su copia, las UNIDADES podrían divergir sin que nada fallara — y una
// unidad equivocada aquí no rompe, miente. Comparar un ROE en % contra unos cuantiles
// calculados en fracción da percentiles absurdos y perfectamente creíbles.
//
// ⚠️ UNIDADES — idénticas a las que recibe `ScoreInputs` en lib/types.ts:
//     porcentaje (0-100): roe, roa, roic, grossMargin, netMargin, grossProfitability,
//                         revenueGrowth, epsGrowth, priceChange1M/3M/6M
//     fracción   (0-1)  : operatingMargin, capexToRevenue, fcfYield
//     ratio             : pe, pb, evEbitda, pfcf, debtEquity, currentRatio,
//                         interestCoverage, netDebtEbitda
// ─────────────────────────────────────────────────────────────────────────────

/** Las dos grafías de sector que conviven en el proyecto (FMP dice "Financial Services",
 *  GICS y EDGAR dicen "Financials"). Se emiten AMBAS para que el lookup acierte venga de
 *  donde venga el nombre — el mismo criterio que ya siguen los mapas de lib/scoring.ts. */
export const SECTOR_ALIASES = {
  "Financials": ["Financial Services"], "Financial Services": ["Financials"],
  "Materials": ["Basic Materials"], "Basic Materials": ["Materials"],
};

/** Métricas de un nombre, en las unidades de ScoreInputs. null donde no se pueda calcular. */
export function metricsOf(f, raw, mom) {
  const mcap = f.shares > 0 && raw > 0 ? raw * f.shares : null;
  const ev = mcap != null ? mcap + (f.debt ?? 0) - (f.cash ?? 0) : null;
  const fcf = f.ocfTTM != null && f.capexTTM != null ? f.ocfTTM - f.capexTTM : null;
  const ebitda = f.oiTTM != null && f.daTTM != null ? f.oiTTM + f.daTTM : null;
  const invested = (f.equity ?? 0) + (f.debt ?? 0);
  const pos = (x) => (x != null && isFinite(x) && x > 0 ? x : null);

  return {
    // Valoración — sólo con denominador positivo: un PER negativo no es "barato", es otra cosa,
    // y meterlo en la distribución contamina los cuantiles bajos justo donde más duele.
    pe: mcap != null && pos(f.niTTM) ? mcap / f.niTTM : null,
    pb: mcap != null && pos(f.equity) ? mcap / f.equity : null,
    evEbitda: ev != null && pos(ebitda) ? ev / ebitda : null,
    pfcf: mcap != null && pos(fcf) ? mcap / fcf : null,
    // Rentabilidad (porcentaje)
    roe: pos(f.equity) && f.niTTM != null ? (f.niTTM / f.equity) * 100 : null,
    roa: pos(f.assets) && f.niTTM != null ? (f.niTTM / f.assets) * 100 : null,
    roic: invested > 0 && f.oiTTM != null ? ((f.oiTTM * 0.79) / invested) * 100 : null,
    grossMargin: pos(f.revTTM) && f.gpTTM != null ? (f.gpTTM / f.revTTM) * 100 : null,
    netMargin: pos(f.revTTM) && f.niTTM != null ? (f.niTTM / f.revTTM) * 100 : null,
    grossProfitability: pos(f.assets) && f.gpTTM != null ? (f.gpTTM / f.assets) * 100 : null,
    // Fracciones
    operatingMargin: pos(f.revTTM) && f.oiTTM != null ? f.oiTTM / f.revTTM : null,
    capexToRevenue: pos(f.revTTM) && f.capexTTM != null ? f.capexTTM / f.revTTM : null,
    fcfYield: mcap != null && fcf != null ? fcf / mcap : null,
    // Solidez (ratios)
    debtEquity: pos(f.equity) ? (f.debt ?? 0) / f.equity : null,
    currentRatio: pos(f.curL) && f.curA != null ? f.curA / f.curL : null,
    interestCoverage: pos(f.interestTTM) && f.oiTTM != null ? f.oiTTM / f.interestTTM : null,
    netDebtEbitda: pos(ebitda) ? ((f.debt ?? 0) - (f.cash ?? 0)) / ebitda : null,
    // Crecimiento (porcentaje)
    revenueGrowth: pos(f.revPrevTTM) && f.revTTM != null ? (f.revTTM / f.revPrevTTM - 1) * 100 : null,
    epsGrowth: pos(f.niPrevTTM) && f.niTTM != null ? (f.niTTM / f.niPrevTTM - 1) * 100 : null,
    // Momentum (porcentaje)
    priceChange1M: mom?.m1 ?? null,
    priceChange3M: mom?.m3 ?? null,
    priceChange6M: mom?.m6 ?? null,
  };
}
