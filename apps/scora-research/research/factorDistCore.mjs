// ─────────────────────────────────────────────────────────────────────────────
// NÚCLEO DE LAS DISTRIBUCIONES SECTORIALES — compartido por `factor_dist.mjs` (la foto de
// hoy, que consume la app) y `factor_dist_history.mjs` (la serie histórica, que es la que
// permite VALIDAR el score v2 sin look-ahead).
//
// Existe por la misma razón que `momentumSignals.mjs` y `fundamentalMetrics.mjs`: si la
// foto de hoy y la serie histórica calcularan los cuantiles con código distinto, validar
// una con la otra no probaría nada.
// ─────────────────────────────────────────────────────────────────────────────
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, momentum } from "./prices.mjs";
import { metricsOf, SECTOR_ALIASES } from "./fundamentalMetrics.mjs";

export const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
export const MIN_N = 8;   // por debajo de esto, un cuantil sectorial es una anécdota

export function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/** Recoge las métricas de cada nombre a una fecha. `sectorCache` evita repetir EDGAR. */
/**
 * `requirePrice` (por defecto true) exige precio para admitir la fila, porque las métricas
 * de VALORACIÓN (PER, P/B, EV/EBITDA, P/FCF) no existen sin él y una distribución a medias
 * es peor que ninguna.
 *
 * Pero las métricas de CALIDAD y SOLVENCIA —rentabilidad bruta sobre activos, ROIC,
 * márgenes, cobertura de intereses, deuda— salen enteras de los estados financieros y no
 * necesitan cotización. Ponerlo a false permite estudiarlas MÁS ATRÁS EN EL TIEMPO que la
 * caché de precios, que arranca en 2018-06 y estaba dejando cualquier análisis anterior
 * en cero filas sin decir por qué.
 */
/**
 * `px` permite inyectar OTRA fuente de precios. Por defecto usa `prices.mjs`, cuya caché
 * arranca en 2018-06: cualquier estudio anterior a esa fecha salía con los pilares de
 * VALORACIÓN y MOMENTUM en null sin avisar de por qué. Pasándole las funciones de
 * `pricesLong.mjs` se pueden estudiar los cuatro pilares desde 2009.
 */
export async function collectRows(tickers, asOf, sectorCache = new Map(), requirePrice = true, px = null) {
  const precioDe = px?.rawPriceAsOf ?? rawPriceAsOf;
  const momentumDe = px?.momentum ?? momentum;
  const filas = [];
  for (const t of tickers) {
    try {
      const cik = await tickerToCik(t);
      if (!cik) continue;
      const f = await fundamentalsAsOf(cik, asOf);
      const raw = await precioDe(t, asOf);
      if (!f || f.revTTM == null || (requirePrice && raw == null)) continue;
      if (!sectorCache.has(t)) sectorCache.set(t, (await sicSector(cik)) || null);
      filas.push({ ticker: t, sector: sectorCache.get(t), m: metricsOf(f, raw, await momentumDe(t, asOf)) });
    } catch { /* saltar */ }
  }
  return filas;
}

/** Cuantiles por sector (+ alias + "ALL") a partir de las filas de una fecha. */
export function buildDist(filas) {
  const METRICAS = Object.keys(filas[0]?.m ?? {});
  if (!METRICAS.length) return {};
  const grupos = new Map();
  const push = (clave, fila) => { if (!grupos.has(clave)) grupos.set(clave, []); grupos.get(clave).push(fila); };
  for (const fila of filas) {
    push("ALL", fila);
    if (fila.sector) {
      push(fila.sector, fila);
      for (const alias of SECTOR_ALIASES[fila.sector] ?? []) push(alias, fila);
    }
  }
  const dist = {};
  for (const [clave, rows] of grupos) {
    const porMetrica = {};
    for (const metrica of METRICAS) {
      const vals = rows.map((r) => r.m[metrica]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
      if (vals.length < MIN_N) continue;
      porMetrica[metrica] = { q: LEVELS.map((p) => +quantile(vals, p).toFixed(4)), n: vals.length };
    }
    if (Object.keys(porMetrica).length) dist[clave] = porMetrica;
  }
  return dist;
}
