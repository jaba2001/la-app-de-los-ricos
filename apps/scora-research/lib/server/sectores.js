// Sector de cada ticker, del perfil de FMP. Lo usa el cron de insiders (smart_money_top_buyers).
//
// POR QUÉ (12-10-2026). El cron escribía `sector: null` en todas las filas — estaba así desde
// que se portó de OpenInsider — y la tabla «Top insider buyers» de la ficha enseñaba la
// columna Sector vacía. Un fallo al pedir un perfil deja ESE sector en null y sigue: el ranking
// de compras no depende del sector, y perderlo entero por un perfil sería peor.

/**
 * @param {string[]} tickers
 * @param {{ key: string, fetch?: typeof fetch, concurrencia?: number }} op
 * @returns {Promise<{ sectores: Map<string, string>, fallos: string[] }>}
 */
export async function sectoresDeFmp(tickers, { key, fetch: f = fetch, concurrencia = 6 } = {}) {
  const sectores = new Map();
  const fallos = [];
  const cola = [...new Set(tickers)];
  async function trabajador() {
    while (cola.length) {
      const t = cola.shift();
      try {
        const r = await f(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(t)}&apikey=${key}`, { headers: { Accept: "application/json" } });
        if (!r.ok) { fallos.push(`${t}: HTTP ${r.status}`); continue; }
        const j = await r.json();
        const s = Array.isArray(j) ? j[0]?.sector : j?.sector;
        if (typeof s === "string" && s.trim()) sectores.set(t, s.trim());
      } catch (e) {
        fallos.push(`${t}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) }, trabajador));
  return { sectores, fallos };
}
