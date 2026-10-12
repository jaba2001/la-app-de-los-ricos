// Qué filas de sl_discovery son el ranking ACTUAL.
//
// POR QUÉ (12-10-2026). research/discovery.mjs hace upsert por ticker del top de la semana y
// no borra nada: el nombre que sale del top se queda con su rango y su momentum viejos. En la
// copia de producción había 235 filas para un ranking de 150 — 85 de semanas anteriores, con
// rangos repetidos (dos «#54»), y la pantalla las enseñaba todas como si fueran de hoy.
//
// Una ejecución escribe todas sus filas con la misma marca de tiempo (milisegundos de
// diferencia); se queda la tanda más reciente con un margen de un día.
export const MARGEN_TANDA_MS = 24 * 3600 * 1000;

export function ultimaTanda<T extends { updated_at?: string | null }>(filas: T[]): T[] {
  const t = (f: T) => (f.updated_at ? Date.parse(f.updated_at) : NaN);
  const max = Math.max(...filas.map(t).filter(Number.isFinite));
  if (!Number.isFinite(max)) return filas;
  return filas.filter((f) => t(f) >= max - MARGEN_TANDA_MS);
}
