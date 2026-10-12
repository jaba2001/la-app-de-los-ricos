// Capitalización bursátil cuando la cotización no la trae.
//
// POR QUÉ (12-10-2026). Con FMP sin cuota, la cotización sale de Yahoo (respaldo), que no trae
// capitalización. Media ficha la lee de `quote.marketCap` —DCF, DCF inverso, Valuation Lab,
// Altman, Merton, FCF yield— y todo eso salía «Insufficient data» con el precio delante. Se
// completa con lo que haya, en orden de fiabilidad.
type Fila = Record<string, unknown> | null | undefined;
const pos = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };

export function capitalizacion(
  quote: Fila,
  { profile, sharesFloat, income }: { profile?: Fila; sharesFloat?: Fila[] | null; income?: Fila[] | null },
): { valor: number; fuente: "quote" | "profile" | "shares-float" | "income" } | null {
  const directa = pos(quote?.marketCap);
  if (directa) return { valor: directa, fuente: "quote" };
  const delPerfil = pos(profile?.marketCap ?? profile?.mktCap);
  if (delPerfil) return { valor: delPerfil, fuente: "profile" };
  const precio = pos(quote?.price);
  if (!precio) return null;
  const enCirculacion = pos(sharesFloat?.[0]?.outstandingShares);
  if (enCirculacion) return { valor: precio * enCirculacion, fuente: "shares-float" };
  // Acciones diluidas medias del último trimestre (FMP o EDGAR): una media del trimestre, no
  // el saldo de hoy, pero a esta escala la diferencia es de un pequeño porcentaje.
  const diluidas = pos(income?.[0]?.weightedAverageShsOutDil);
  if (diluidas) return { valor: precio * diluidas, fuente: "income" };
  return null;
}
