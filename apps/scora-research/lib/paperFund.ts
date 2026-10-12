// Qué nota del fondo en papel se puede publicar.
//
// POR QUÉ (12-10-2026). La última fila de sl_paper_fund_track (31-08) dice «A» con Sharpe
// 4,48 sobre DOS MESES de vida. La calculó la versión anterior de research/paperfund_measure.mjs,
// que calificaba con 2 retornos; la actual exige 12 tramos (≈ un año) y escribiría «Accruing»,
// pero esa fila sigue en la base hasta que el workflow vuelva a medir. La pantalla no puede
// depender de que nadie haya regenerado el dato: un fondo con menos de un año no tiene nota,
// y su Sharpe anualizado no tiene error estándar interpretable.
export const DIAS_MINIMOS_PARA_CALIFICAR = 365;

export function calificacionPublicable(t: { inception?: string | null; as_of?: string | null; grade?: string | null } | null | undefined):
  { grade: string; calificable: boolean } {
  if (!t?.grade) return { grade: "Accruing", calificable: false };
  const dias = t.inception && t.as_of ? (Date.parse(t.as_of) - Date.parse(t.inception)) / 86_400_000 : NaN;
  if (!Number.isFinite(dias) || dias < DIAS_MINIMOS_PARA_CALIFICAR) return { grade: "Accruing", calificable: false };
  return { grade: t.grade, calificable: t.grade !== "Accruing" };
}
