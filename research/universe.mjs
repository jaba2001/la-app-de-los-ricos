// Backtest universe. For in-session validation we use a fixed, sector-diverse set of
// ~44 large caps that includes both winners (NVDA, AAPL) and laggards (INTC, DIS, T)
// so the score has something to discriminate — this is survivorship-biased (all still
// listed) and labelled as such. The full, survivorship-controlled run uses
// loadSP500Historical() (GitHub point-in-time constituents incl. removed names) + a
// delisted-capable price source (Tiingo/EODHD) and is a multi-day batch.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ⚠️ CURATED ES DE LABORATORIO, NO DE PRODUCCIÓN. Son 43 megacaps que siguen cotizando: usarlo
// para decidir de verdad sería publicar como "S&P 500" una lista de supervivientes elegida a
// mano. `cron-picks.mjs` no lo importa por eso — si la tabla histórica no está, aborta.
export const CURATED = [
  // Technology
  "AAPL", "MSFT", "NVDA", "AMD", "INTC", "CSCO", "ORCL", "ADBE", "CRM", "QCOM",
  // Communication Services
  "GOOGL", "META", "NFLX", "T", "VZ", "DIS",
  // Financials
  "JPM", "BAC", "WFC", "GS", "C",
  // Healthcare
  "JNJ", "PFE", "UNH", "MRK", "ABBV",
  // Consumer
  "KO", "PEP", "WMT", "PG", "MCD", "NKE", "SBUX", "HD", "COST",
  // Energy / Industrials / Materials
  "XOM", "CVX", "COP", "BA", "CAT", "GE", "HON", "UPS",
];

const SP500_URL = "https://raw.githubusercontent.com/hanshof/sp500_constituents/main/sp_500_historical_components.csv";
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache");
const CACHE_CSV = join(CACHE_DIR, "sp500_historical_components.csv");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** date,"TICKER1,TICKER2,…" → [{date, tickers}] ordenado. Puro: se testea sin red. */
export function parseSP500Csv(text) {
  return text.trim().split("\n").slice(1).map((ln) => {
    const c = ln.indexOf(",");
    const date = ln.slice(0, c).replace(/"/g, "").trim();
    const tickers = ln.slice(c + 1).replace(/"/g, "").split(",").map((t) => t.trim()).filter(Boolean);
    return { date, tickers };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.tickers.length)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Full survivorship-controlled S&P 500 membership over time (GitHub, free).
 * date,"TICKER1,TICKER2,…" from 1996→present, including names later removed.
 *
 * ⚠️ POR QUÉ REINTENTA Y CACHEA EN DISCO. Esta función tenía UN solo `fetch` y devolvía
 * `null` ante cualquier error de red. Eso convertía un parpadeo de GitHub en la desaparición
 * silenciosa del universo entero: quien la llamaba caía a `CURATED` (43 nombres) o se
 * quedaba sin nada, y en el caso del cron quincenal eso significa PERDER UNA FECHA DE
 * DECISIÓN PARA SIEMPRE, porque el workflow no reintenta una fecha pasada.
 *
 * SOBRE LA FRECUENCIA, que es lo único que aquí se puede medir mal: el fallo se observó UNA
 * vez, el 2026-08-21, durante una tanda de descargas seguidas del mismo fichero (o sea,
 * probablemente limitación por ritmo y no una caída). Una medición limpia al día siguiente
 * dio 25 de 25 correctas. **No es un endpoint poco fiable.** Lo que justifica el reintento no
 * es la frecuencia sino el coste: un fallo raro que borra para siempre una decisión de un
 * track record público no se compensa con lo barato que es volver a pedirlo.
 *
 * El CSV es un fichero estático de 3.500 líneas que cambia como mucho una vez al día: no hay
 * ninguna razón para que una caída de red se lleve por delante una decisión publicable. Se
 * reintenta cuatro veces y, si aun así no hay red, se usa la última copia buena del disco.
 * La caché se REESCRIBE en cada descarga correcta, así que nunca envejece por su cuenta.
 */
export async function loadSP500Historical() {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(SP500_URL);
      if (r.ok) {
        const text = await r.text();
        const byDate = parseSP500Csv(text);
        // Sólo se cachea lo que parsea: guardar un 404 o un HTML de error envenenaría el
        // respaldo justo para el día en que hace falta.
        if (byDate.length) {
          try { if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(CACHE_CSV, text); } catch { /* la caché es un extra, no un requisito */ }
          return byDate;
        }
      }
    } catch { /* reintento */ }
    await sleep(600 * (a + 1));
  }
  try {
    if (existsSync(CACHE_CSV)) {
      const byDate = parseSP500Csv(readFileSync(CACHE_CSV, "utf8"));
      if (byDate.length) {
        console.warn(`  ⚠ universo: GitHub no responde; se usa la copia local (${byDate.at(-1).date}).`);
        return byDate;
      }
    }
  } catch { /* cae a null */ }
  return null;
}

/** Fecha de la foto de miembros más reciente de la tabla. Es la que hay que PUBLICAR: dice
 *  sobre qué universo se decidió, que no es lo mismo que la fecha de la decisión. */
export function snapshotDate(table) {
  return table?.length ? table[table.length - 1].date : null;
}

/** Members as of a date from the historical membership table. */
export function membersAsOf(table, date) {
  if (!table) return null;
  const on = table.filter((r) => r.date <= date);
  return on.length ? on[on.length - 1].tickers : table[0].tickers;
}
