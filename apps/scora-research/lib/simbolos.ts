// ¿Este símbolo de comparable lo cubre el plan de FMP? (recorrido con sesión, 12-10-2026)
//
// FMP stock-peers devuelve comparables de todo el mundo, y para muchos el plan responde 402
// al pedir sus ratios: la pestaña Valuation hacía 3–5 llamadas condenadas por ficha. Se
// descartan por la forma del símbolo, que es lo único que trae la respuesta:
//   · bolsa extranjera: sufijo de 2+ letras (002241.SZ, 0700.HK). BRK.B tiene una y se queda.
//   · extranjera en OTC: 5 letras acabadas en F (PCRFF, SSNLF, XIACF).
//   · fondo de inversión: 5 letras acabadas en X (VIGAX, VINIX).
export function esComparableCubierto(simbolo: string): boolean {
  const s = simbolo.toUpperCase();
  if (/\.[A-Z]{2,}$/.test(s)) return false;
  if (/^[A-Z]{4}[FX]$/.test(s)) return false;
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);
}
