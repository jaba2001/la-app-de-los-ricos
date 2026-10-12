// Nombre en pantalla del régimen macro y del cuadrante de cartera.
//
// macro_state guarda la etiqueta en español (lib/server/macro.js: «Expansión», cuadrante
// «crecimiento»), igual que las filas heredadas de Supabase. La interfaz va en inglés, así que
// se traduce por el id, que es estable; la etiqueta guardada solo se usa si el id es desconocido.

export const REGIMEN_LABEL: Record<string, string> = {
  expansion: "Expansion",
  reflation: "Reflation",
  stagflation: "Stagflation",
  contraction: "Contraction",
  neutral: "Transition",
};

export const CUADRANTE_LABEL: Record<string, string> = {
  crecimiento: "Growth",
  inflacion: "Inflation",
  estanflacion: "Stagflation",
  defensivo: "Defensive",
};

export function etiquetaRegimen(m: { regime_id?: string | null; regime_label?: string | null } | null | undefined): string | null {
  if (!m) return null;
  return (m.regime_id && REGIMEN_LABEL[m.regime_id]) || m.regime_label || null;
}

export function etiquetaCuadrante(q: string | null | undefined): string | null {
  if (!q) return null;
  return CUADRANTE_LABEL[q] ?? q;
}
