// ─────────────────────────────────────────────────────────────────────────────
// SEÑAL FORENSE — la contabilidad como VETO, no como ranking
//
// La partida doble hace que la contabilidad se pueda desmentir: no se puede inflar una cifra
// sin dejar rastro en otra. Si el beneficio sube sin que suba la caja, la diferencia está en
// devengos; si los ingresos suben sin que entre dinero, tienen que crecer los clientes.
// Cada modelo clásico de este fichero es una de esas ecuaciones despejada.
//
// POR QUÉ VETO Y NO RANKING, que es la decisión central de toda la fase:
//
//   1. Como RANKING ya fracasaron. `research/out/signals_ic.json` los midió sobre 120 nombres
//      y tres regímenes: altmanZ −0,004/+0,021/+0,070, accrualsQ +0,006/+0,022/−0,024,
//      piotroski −0,021/−0,012/−0,089. Ninguno estable, y todos dentro del ruido (el efecto
//      mínimo detectable en estas ventanas ronda 0,0665).
//   2. El IC es el estadístico EQUIVOCADO para una cartera de 40 nombres: el score acierta en
//      la cola sin ordenar el universo entero.
//   3. Los devengos traen información DISTINTA de la que ya usa Picks: rho de Spearman −0,197
//      contra la señal de calidad (medido a 2025-06-02, n=389). Ese es el requisito previo —
//      una señal que solapa con la que ya tienes no aporta nada aunque funcione.
//   4. Y el sitio donde enchufarlo existe y está vacío: `PicksInput.disqualified` está
//      declarado en `lib/picks.ts`, el motor sabe usarlo y producción nunca lo rellena.
//
// ⚠️ NADA DE ESTO ENTRA EN PRODUCCIÓN SIN PASAR `research/forense_lab.mjs`, y el falsador
// (HF3) manda sobre las otras dos hipótesis. La razón tiene nombre propio: de los 40 mejores
// por calidad a 2025-06-02, OCHO tenían devengos de baja calidad y el primero era NVDA. El
// ratio de Sloan castiga el crecimiento del circulante, así que confunde CRECER con INFLAR.
// Este repositorio ya cometió ese error una vez —la regla de 180 días vendía a los ganadores
// y costó 63-74 pp—, y un veto forense mal validado es la misma regla con otro traje.
// ─────────────────────────────────────────────────────────────────────────────
import { tickerToCik, fundamentalsAsOf } from "./edgar.mjs";
import { beneishM, piotroskiF, accrualsRatio } from "../lib/quality.ts";

const num = (x) => (x != null && isFinite(x) ? x : null);
const pos = (x) => (x != null && isFinite(x) && x > 0 ? x : null);

/**
 * Devengos de Sloan, EXIGIENDO QUE RESULTADO Y FLUJO SEAN DEL MISMO PERIODO.
 *
 * Esa condición no es un detalle: antes de reescribir el cálculo del TTM, resultado y flujo
 * de explotación sólo compartían cierre en el 47 % de los nombres, con una mediana de desfase
 * de 91 días — justo un trimestre. Restar un resultado cerrado en junio de un flujo cerrado
 * en marzo no da un devengo: da un devengo más un trimestre de deriva. Hoy coinciden en el
 * 100 %, pero la comprobación se queda porque la garantía tiene que estar en el código, no en
 * la memoria de que un día se arregló.
 */
export function devengos(f) {
  if (!f?.periodos) return null;
  if (!f.periodos.ni || !f.periodos.ocf || f.periodos.ni !== f.periodos.ocf) return null;
  const r = accrualsRatio(num(f.niTTM), num(f.ocfTTM), pos(f.assets));
  return r ? r.ratio : null;
}

/** Beneish M sobre el paquete actual y el del ejercicio anterior. `null` si falta una sola
 *  de las ocho variables: un M-score a medias es un número creíble y sin sentido. */
export function beneish(f) {
  const p = f?.prev;
  if (!p) return null;
  const r = beneishM({
    receivables: num(f.receivables), receivablesPrev: num(p.receivables),
    sales: num(f.revTTM), salesPrev: num(p.revTTM),
    grossProfit: num(f.gpTTM), grossProfitPrev: num(p.gpTTM),
    totalAssets: num(f.assets), totalAssetsPrev: num(p.assets),
    currentAssets: num(f.curA), currentAssetsPrev: num(p.curA),
    ppe: num(f.ppe), ppePrev: num(p.ppe),
    depreciation: num(f.daTTM), depreciationPrev: num(p.daTTM),
    sga: num(f.sgaTTM), sgaPrev: num(p.sgaTTM),
    totalDebt: num(f.debt), totalDebtPrev: num(p.debt),
    netIncome: num(f.niTTM), operatingCashFlow: num(f.ocfTTM),
  });
  return r ? r.m : null;
}

/** Piotroski F sobre las pruebas que se puedan evaluar. Devuelve {score, max}. */
export function piotroski(f) {
  const p = f?.prev;
  if (!p) return null;
  return piotroskiF({
    roa: pos(f.assets) && num(f.niTTM) != null ? f.niTTM / f.assets : null,
    roaPrev: pos(p.assets) && num(p.niTTM) != null ? p.niTTM / p.assets : null,
    cfo: num(f.ocfTTM), netIncome: num(f.niTTM), totalAssets: pos(f.assets),
    leverage: pos(f.assets) && num(f.debt) != null ? f.debt / f.assets : null,
    leveragePrev: pos(p.assets) && num(p.debt) != null ? p.debt / p.assets : null,
    currentRatio: pos(f.curL) && num(f.curA) != null ? f.curA / f.curL : null,
    currentRatioPrev: pos(p.curL) && num(p.curA) != null ? p.curA / p.curL : null,
    shares: num(f.shares), sharesPrev: num(p.shares),
    grossMargin: pos(f.revTTM) && num(f.gpTTM) != null ? f.gpTTM / f.revTTM : null,
    grossMarginPrev: pos(p.revTTM) && num(p.gpTTM) != null ? p.gpTTM / p.revTTM : null,
    assetTurnover: pos(f.assets) && num(f.revTTM) != null ? f.revTTM / f.assets : null,
    assetTurnoverPrev: pos(p.assets) && num(p.revTTM) != null ? p.revTTM / p.assets : null,
  });
}

/** Umbral de Beneish del artículo original: por encima, "probable manipulador". */
export const BENEISH_UMBRAL = -1.78;
/** Piotroski por debajo de esto = negocio que se deteriora en casi todos los frentes. */
export const PIOTROSKI_MIN = 3;
/** Percentil de devengos —dentro del sector y de la fecha— a partir del cual se marca.
 *  NO es el 0,10 absoluto de `lib/quality.ts`: ese es de manual y no está calibrado aquí. */
export const ACCRUALS_PCTL = 0.90;

/** Métricas forenses crudas de un nombre a una fecha. Sin percentiles: eso es transversal. */
export async function forenseDe(ticker, asOf) {
  const cik = await tickerToCik(ticker);
  if (!cik) return null;
  const f = await fundamentalsAsOf(cik, asOf);
  if (!f) return null;
  const pio = piotroski(f);
  return {
    t: ticker,
    accruals: devengos(f),
    beneish: beneish(f),
    piotroski: pio ? pio.score : null,
    piotroskiMax: pio ? pio.max : null,
    // Se publica la confianza del paquete para poder separar "no hay dato" de "hay dato malo".
    moneda: f.currency,
  };
}

/**
 * Convierte métricas crudas en la lista de VETADOS de una fecha.
 *
 * Los devengos se comparan DENTRO DEL SECTOR: el circulante de una tecnológica y el de una
 * distribuidora no se parecen en nada, y un umbral común marcaría sectores enteros.
 *
 * `cobertura` se devuelve porque un veto que sólo se puede aplicar a un tercio del universo
 * es un sesgo, no un filtro, si no se dice. Beneish sólo sale en el 37,5 % del índice y en el
 * 8 % de la banca.
 */
export function vetados(filas, { sectorDe = () => null, usarBeneish = true, usarPiotroski = true, usarAccruals = true } = {}) {
  const marcas = new Map();
  const cobertura = { accruals: 0, beneish: 0, piotroski: 0, total: filas.length };

  if (usarAccruals) {
    // Percentil de devengos por sector: mayor ratio = peor calidad del beneficio.
    const porSector = new Map();
    for (const r of filas) {
      if (r.accruals == null) continue;
      cobertura.accruals++;
      const s = sectorDe(r.t) ?? "ALL";
      if (!porSector.has(s)) porSector.set(s, []);
      porSector.get(s).push(r);
    }
    for (const [, rs] of porSector) {
      // Con menos de 8 nombres, un percentil sectorial es una anécdota (mismo criterio que
      // `MIN_N` en factorDistCore.mjs).
      if (rs.length < 8) continue;
      const orden = [...rs].sort((a, b) => a.accruals - b.accruals);
      const corte = orden[Math.floor(ACCRUALS_PCTL * (orden.length - 1))].accruals;
      for (const r of rs) if (r.accruals > corte) marcas.set(r.t, [...(marcas.get(r.t) ?? []), "devengos"]);
    }
  }

  for (const r of filas) {
    if (usarBeneish && r.beneish != null) {
      cobertura.beneish++;
      if (r.beneish > BENEISH_UMBRAL) marcas.set(r.t, [...(marcas.get(r.t) ?? []), "beneish"]);
    }
    if (usarPiotroski && r.piotroski != null && r.piotroskiMax === 9) {
      cobertura.piotroski++;
      if (r.piotroski <= PIOTROSKI_MIN) marcas.set(r.t, [...(marcas.get(r.t) ?? []), "piotroski"]);
    }
  }
  return { marcas, cobertura };
}
