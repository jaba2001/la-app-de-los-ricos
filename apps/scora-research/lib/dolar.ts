// Puntuación del dólar dentro del riesgo geopolítico (GRC). La usan el cron (lib/server/macro.js)
// y el desglose del front (components/macro/MacroIndicators.tsx): UNA sola definición.
//
// POR QUÉ EXISTE (recorrido con sesión, 12-10-2026). La serie que se descarga es DTWEXBGS —el
// índice AMPLIO del dólar de la Fed, ponderado por comercio, base ene-2006 = 100— y en la
// última década se mueve entre ~108 y ~123. Pero los umbrales con que se puntuaba (96, 100,
// 106, 110) son los del DXY, otra escala. Con 121 el componente salía SIEMPRE al máximo
// (80+), inflando el GRC y, con él, el IC Score. Y la pantalla lo llamaba «DXY 121», que a
// cualquiera le dice «el dólar en máximos de 20 años».
//
// La conversión: entre 2015 y 2025 el índice amplio vale ~1,19 veces el DXY (2018: 112,0 frente
// a 94,5; 2021: 113,1 frente a 92,5; 2022: 120,7 frente a 104,0). Los umbrales originales —y la
// forma de la curva— se mantienen, solo se pasan a la escala de la serie que de verdad se lee.

/** Factor índice amplio / DXY, medido 2015–2025 (ver arriba). */
export const AMPLIO_POR_DXY = 1.19;

/** Umbrales originales, en DXY. */
const UMBRALES_DXY = [96, 100, 106, 110] as const;

/** 0–100: cuánto aprieta el dólar. `amplio` es DTWEXBGS. null → el neutro de siempre (20). */
export function puntuacionDolar(amplio: number | null | undefined): number {
  if (amplio == null || !Number.isFinite(amplio)) return 20;
  const d = amplio / AMPLIO_POR_DXY; // a escala DXY, la de los umbrales
  const [a, b, c, e] = UMBRALES_DXY;
  const s = d < a ? 10
    : d < b ? 10 + ((d - a) / (b - a)) * 10
    : d < c ? 20 + ((d - b) / (c - b)) * 25
    : d < e ? 45 + ((d - c) / (e - c)) * 35
    : 80 + Math.min(20, ((d - e) / 5) * 20);
  return Math.max(0, Math.min(100, s));
}

/** Cómo se llama en pantalla y en los prompts: NO es el DXY. */
export const ETIQUETA_DOLAR = "Broad USD index";

/**
 * Rendimiento real a 10 años = bono a 10 años − PCE subyacente, la derivación de la pestaña
 * Indicators. `real_yield_10y` lo leían Metals y los motores de oro/metales/TIPS/cripto, pero no
 * era una columna de macro_state: salía siempre «—». La migración 007 la añade como columna
 * generada; esto cubre las bases donde aún no se ha aplicado.
 */
export function rendimientoReal(macro: Record<string, unknown> | null | undefined): number | null {
  const directo = Number(macro?.real_yield_10y);
  if (macro?.real_yield_10y != null && Number.isFinite(directo)) return directo;
  const d = Number(macro?.dgs10), p = Number(macro?.core_pce_yoy);
  return macro?.dgs10 != null && macro?.core_pce_yoy != null && Number.isFinite(d) && Number.isFinite(p) ? d - p : null;
}
