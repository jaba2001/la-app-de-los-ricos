// Qué estimación de analistas es «la del próximo ejercicio». (recorrido con sesión, 12-10-2026)
//
// FMP /stable/analyst-estimates devuelve los ejercicios del MÁS LEJANO al más cercano (2030,
// 2029…). El Report tomaba el primero como «crecimiento a corto plazo»: comparaba los ingresos
// estimados de 2030 con los del TTM, salía +39 % (topado en 40) y el DCF daba $707–$1.688 para
// AAPL mientras la pestaña Valuation, con los mismos datos, daba $192.

type Estimacion = Record<string, unknown> & { date?: unknown };

/** El primer ejercicio que cierra después de `hoy`; null si no hay ninguno. */
export function estimacionProxima(est: Estimacion[] | null | undefined, hoy = new Date()): Estimacion | null {
  const corte = hoy.toISOString().slice(0, 10);
  const futuras = (est ?? [])
    .filter((e) => typeof e.date === "string" && e.date >= corte)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return futuras[0] ?? null;
}

/** Ingresos medios estimados de una fila (FMP ha usado los dos nombres). */
export function ingresosEstimados(e: Estimacion | null): number | null {
  const v = Number(e?.revenueAvg ?? e?.estimatedRevenueAvg);
  return Number.isFinite(v) && v > 0 ? v : null;
}
