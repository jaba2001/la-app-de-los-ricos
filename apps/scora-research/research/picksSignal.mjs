// ─────────────────────────────────────────────────────────────────────────────
// LA SEÑAL DE SCORA PICKS — una sola definición, compartida
//
// La usan el backtest (`picks_rules_backtest.mjs`) y el cron de producción. Existe por la
// misma razón que `lib/picks.ts` y que `momentumSignals.mjs`: si el laboratorio y
// producción calcularan la señal con código distinto, el track record publicado dejaría de
// ser el de lo que se midió — y nada fallaría al hacerlo.
//
// QUÉ ES LA SEÑAL: el percentil transversal medio de cinco métricas de CALIDAD, todas de los
// estados financieros y ninguna del precio. Es la única señal que replicó en las dos
// ventanas (§3 de SCORA_PICKS_REGLAS.md), y bate al pilar `health` de la app en las dos
// —que usa estas mismas ideas con dos métricas más y bandas absolutas que saturan—.
//
// POR QUÉ PERCENTIL Y NO PUNTOS: el percentil es transversal, así que la señal dice "este
// negocio está en el 80% mejor del índice HOY", no "supera un listón fijo". Un listón fijo
// envejece; el percentil se recalibra solo. Y no satura: el pilar `health` empata al 30% del
// universo en su tope, hasta el punto de que 139 nombres comparten el valor del puesto 40.
// ─────────────────────────────────────────────────────────────────────────────
import { collectRows } from "./factorDistCore.mjs";
import { pct } from "./momentumSignals.mjs";

/** Las cinco métricas, con el signo puesto para que "mayor = mejor" en todas. */
export const METRICAS_CALIDAD = ["gprof", "roic", "opm", "icov", "lev"];

/** Mínimo de métricas presentes para que un nombre tenga señal. Con menos de 3 de 5, el
 *  percentil medio lo decide qué datos FALTAN más que qué negocio es. */
export const MIN_METRICAS = 3;

/** Extrae las cinco métricas crudas de una fila de `collectRows`. */
export function metricasDe(fila) {
  return {
    t: fila.ticker,
    gprof: fila.m.grossProfitability,
    roic: fila.m.roic,
    opm: fila.m.operatingMargin,
    icov: fila.m.interestCoverage,
    // netDebtEbitda va al revés: menos deuda es mejor.
    lev: fila.m.netDebtEbitda != null ? -fila.m.netDebtEbitda : null,
  };
}

/**
 * Convierte filas de métricas crudas en el mapa ticker → percentil [0..1].
 * Puro: no toca red ni disco, así que se puede testear.
 */
export function percentilesDe(rows) {
  const maps = METRICAS_CALIDAD.map((k) => pct(rows, k));
  const sig = {};
  for (const r of rows) {
    let suma = 0, n = 0;
    for (const m of maps) { const p = m.get(r.t); if (p != null) { suma += p; n++; } }
    if (n >= MIN_METRICAS) sig[r.t] = +(suma / n).toFixed(4);
  }
  return sig;
}

/**
 * La señal de un universo a una fecha. `asOf` es point-in-time de verdad: `collectRows` usa
 * `fundamentalsAsOf`, que sólo ve las presentaciones ya publicadas en esa fecha.
 *
 * `requirePrice = false` a propósito: la calidad sale entera de los estados financieros.
 * Exigir precio limitaría el cálculo a 2018+ (donde arranca la caché) sin avisar de por qué.
 */
export async function señalAt(tickers, asOf, sectorCache = new Map(), px = null) {
  const filas = await collectRows(tickers, asOf, sectorCache, false, px);
  return percentilesDe(filas.map(metricasDe));
}
