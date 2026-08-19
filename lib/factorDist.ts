// ─────────────────────────────────────────────────────────────────────────────
// CARGA DE LAS DISTRIBUCIONES SECTORIALES (F2) — el puente entre lo que mide
// `research/factor_dist.mjs` y lo que ve el usuario en la ficha de una acción.
//
// Se sirve como fichero ESTÁTICO desde /factor-dist.json (≈26 KB minificado) en vez de
// importarlo en el bundle o de leerlo de Supabase, por tres razones:
//   · no engorda el JS inicial de TODAS las páginas por algo que solo usa la ficha,
//   · cero llamadas de API por usuario (misma lógica de coste que el resto de crons),
//   · no exige migración de base de datos para poder verlo funcionando.
// Cuando exista `sl_factor_dist` en Supabase, este módulo es el único sitio que cambia.
//
// Degradar bien es obligatorio: si el fichero falta o no se puede parsear, `loadFactorDist`
// devuelve null y TODA la capa de grados desaparece de la pantalla sin romper nada.
// ─────────────────────────────────────────────────────────────────────────────
import type { FactorDistTable } from "./percentile";

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ LOS PERCENTILES NO ENTRAN EN EL SCORE. Medido el 2026-08-19
// (`research/score_v2_validate.mjs`, 30 trimestres con distribuciones point-in-time):
//
//   IC v1 bandas      +0.0026     decil top +227%  (+47pp sobre el universo equiponderado)
//   IC v2 percentiles −0.0185     decil top +142%  (−37pp)
//   diferencia pareada −0.0210, t=−1,40 → NO significativa, pero el signo apunta a PEOR.
//
// La explicación es económica, no ruido: neutralizar por sector ELIMINA el alfa sectorial.
// Las bandas absolutas premiaban implícitamente a los sectores con mejores métricas en
// absoluto, que en 2019-2026 significaba inclinarse a tecnología y huir de utilities
// endeudadas — justo lo que funcionó. v2 quita ese tilt por diseño.
//
// Son DOS PREGUNTAS DISTINTAS y no se responden con el mismo número:
//   · "¿es buena PARA SU SECTOR?" → percentiles. EXPLICAN, y ahí se quedan (los grados de
//     la ficha y los umbrales descalificadores, que son una regla de riesgo conservadora).
//   · "¿qué compro?"              → comparación absoluta. SELECCIONA, y ahí sigue el v1.
//
// Misma regla que se aplicó al momentum: al score sólo entra lo que está medido. Cuando
// haya evidencia (otra ventana, otro universo, o neutralización parcial en vez de total),
// se reactiva poniendo esta constante a true y volviendo a correr el validador.
// ─────────────────────────────────────────────────────────────────────────────
export const SCORE_USES_SECTOR_PERCENTILES = false;

let cache: FactorDistTable | null = null;
let pending: Promise<FactorDistTable | null> | null = null;
let failed = false;

/** Carga (una sola vez por sesión de navegador) la tabla de distribuciones. */
export async function loadFactorDist(): Promise<FactorDistTable | null> {
  if (cache) return cache;
  if (failed) return null;              // no reintentar en bucle si no está publicado
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch("/factor-dist.json", { cache: "force-cache" });
      if (!res.ok) { failed = true; return null; }
      const json = await res.json();
      // El fichero puede venir como { dist: {...} } (formato del generador) o ya plano.
      const table = (json?.dist ?? json) as FactorDistTable;
      if (!table || typeof table !== "object" || !table.ALL) { failed = true; return null; }
      cache = table;
      return cache;
    } catch {
      failed = true;
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * Traduce las métricas TTM que devuelve FMP a las UNIDADES en que están calculadas las
 * distribuciones (ver la cabecera de `research/factor_dist.mjs`).
 *
 * ⚠️ Esto es lo más fácil de romper de toda la F2 y no falla ruidosamente: si te equivocas
 * de unidad no salta ningún error, simplemente el percentil sale absurdo. FMP entrega los
 * márgenes y retornos como FRACCIÓN (0.42), y las distribuciones guardan roe/roa/roic y los
 * márgenes en PORCENTAJE (42) — salvo `operatingMargin`, que va en fracción porque así lo
 * recibe `ScoreInputs`. Cada línea de aquí abajo lleva su conversión explícita a propósito.
 */
export function metricsFromRatios(ratios: Record<string, unknown> | null | undefined): Record<string, number | null> {
  const num = (v: unknown): number | null => {
    const x = Number(v);
    return v == null || v === "" || !isFinite(x) ? null : x;
  };
  const toPct = (v: unknown): number | null => { const x = num(v); return x == null ? null : x * 100; };
  return {
    grossMargin: toPct(ratios?.grossProfitMarginTTM),        // fracción → %
    netMargin: toPct(ratios?.netProfitMarginTTM),            // fracción → %
    roic: toPct(ratios?.returnOnInvestedCapitalTTM ?? ratios?.returnOnCapitalEmployedTTM),
    roe: toPct(ratios?.returnOnEquityTTM),                   // fracción → %
    roa: toPct(ratios?.returnOnAssetsTTM),                   // fracción → %
    operatingMargin: num(ratios?.operatingProfitMarginTTM),  // fracción → fracción (NO convertir)
    pe: num(ratios?.priceEarningsRatioTTM),
    pb: num(ratios?.priceToBookRatioTTM),
    debtEquity: num(ratios?.debtEquityRatioTTM),
    currentRatio: num(ratios?.currentRatioTTM),
    interestCoverage: num(ratios?.interestCoverageTTM),
  };
}

/** Distribución para el SCORE. Devuelve null mientras `SCORE_USES_SECTOR_PERCENTILES` sea
 *  false: separar esta función de `loadFactorDist()` es lo que permite que los grados y los
 *  descalificadores sigan usando percentiles mientras el score no. Un único punto de
 *  control, y el motivo escrito justo arriba. */
export async function distForScoring(): Promise<FactorDistTable | null> {
  return SCORE_USES_SECTOR_PERCENTILES ? loadFactorDist() : null;
}
