// Trimestres de FMP completados con EDGAR. Lo usa la ficha de cada acción en el navegador.
//
// El plan de FMP da como mucho 5 trimestres (con más, 402). El TTM del año anterior necesita
// los trimestres 4–7, y la previsión de ingresos 8 o más: esos salen de EDGAR (la SEC, gratis),
// que ya se pide en el mismo lote. Un trimestre de FMP nunca se sustituye.

type Fila = Record<string, unknown> & { date?: unknown };
const DIA = 86400000;

export function completarConEdgar(fmp: Fila[] | null | undefined, edgar: Fila[] | null | undefined): Fila[] {
  const base = Array.isArray(fmp) ? fmp : [];
  const extra = Array.isArray(edgar) ? edgar : [];
  if (!base.length) return extra;
  const masAntigua = base.reduce((m, r) => (String(r.date) < m ? String(r.date) : m), String(base[0].date));
  // 20 días de margen: FMP y la SEC pueden fechar el mismo cierre con días de diferencia, y
  // un trimestre repetido contaría dos veces en el TTM.
  const limite = new Date(+new Date(masAntigua) - 20 * DIA).toISOString().slice(0, 10);
  return [...base, ...extra.filter((r) => String(r.date) < limite)];
}
