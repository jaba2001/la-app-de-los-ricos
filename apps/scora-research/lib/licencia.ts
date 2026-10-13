// Lo que la licencia de datos permite sacar de la pantalla (plan único, pieza 1.2 c).
//
// Los términos de FMP (2.2) prohíben, sin acuerdo escrito, «transmit», «copy» y crear «derivative
// works» de sus datos; Finnhub prohíbe compartir sus «derived results». Los ratios de FMP son sus
// datos y los scores de Scora son derivados de ellos, así que un CSV con cualquiera de las dos
// cosas es redistribución. Mientras el acuerdo con los proveedores no cubra el canal CSV:
//   · la ficha no ofrece exportar sus métricas;
//   · el screener exporta solo la lista de tickers, que es del usuario.
// Cuando la licencia lo cubra, basta con cambiar este interruptor (y decirlo en la PR).
export const EXPORTAR_METRICAS = false;

/** CSV de una sola columna con los tickers: lo único que se exporta mientras no haya licencia. */
export function csvDeTickers(tickers: readonly string[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`; // RFC 4180
  return ["Ticker", ...tickers].map(esc).join("\n");
}
