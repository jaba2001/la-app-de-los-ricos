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

// ⚠️ ESTA FUENTE SE CAMBIÓ EL 2026-08-29, y el motivo es el defecto más grave que ha aparecido
// en todo el trabajo del sesgo de supervivencia: **la fuente anterior tenía sesgo de
// supervivencia DENTRO**.
//
// `hanshof/sp500_constituents` acierta cuándo sale cada empresa —comprobadas seis fechas de
// adquisición conocidas, todas exactas— pero OMITE EMPRESAS ENTERAS del pasado. El recuento lo
// dice solo, porque el S&P 500 siempre ha tenido ~500 miembros:
//
//     año    hanshof   fja05680
//     2010     446       498      ← faltan 52
//     2012     455       497
//     2014     463       498
//     2016     479       505
//     2018     495       506
//     2024     503       503      ← el déficit se cierra hacia el presente
//
// Ese patrón —error que crece hacia atrás— es la firma de una reconstrucción que borra a las que
// murieron. Y no es inferencia: el 2013-07-01, `hanshof` da 459 nombres y `fja` 497, con CERO
// nombres que estén sólo en `hanshof`. Es un subconjunto estricto, y los 38 que faltan son
// `AABA`, `ADT`, `AGN`, `ALTR`, `BEAM`, `BMC`, `DELL`, `DTV`, `EMC`… todas adquiridas.
//
// O sea que la ventana 2011-2018 del backtest corría sobre un universo al que le faltaba el
// 8-10 % de sus miembros, **precisamente los que desaparecieron** — y el universo equiponderado
// que sirve de referencia estaba sesgado al alza por lo mismo. El trabajo de §10 (resolver los
// CIK de los tickers muertos) partía de una lista ya truncada.
//
// Y `hanshof` además se congeló aguas arriba el 2025-08-24. `fja05680/sp500` sigue mantenida
// (último commit 2026-07-13), cubre 1996-01-02 → 2026-06-30 en 2.718 fechas y usa el MISMO
// formato. La única diferencia de convención observada es `BF.B` frente a `BF-B`, y la nueva
// usa la misma grafía que la foto de hoy — así que la tabla pasa a ser consistente consigo
// misma, que antes no lo era.
const SP500_URL = "https://raw.githubusercontent.com/fja05680/sp500/master/S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv";
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache");
const CACHE_CSV = join(CACHE_DIR, "sp500_historical_components.csv");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Un símbolo, o null si la celda no contiene ninguno reconocible.
 *
 * La fuente es de mantenimiento comunitario y se le cuela texto: el 2023-12-31 escribió
 * **`RVTY (Previously PKI)`** en lugar de `RVTY`. Con la celda tal cual, ese día Revvity no
 * existe —ni como `RVTY` ni como `PKI`— y además contamina la lista de «tickers sin CIK», que
 * es de donde sale el trabajo de resolver el sesgo de supervivencia.
 *
 * Se queda con el símbolo de cabeza y **sólo** si lo que sigue es una aclaración entre
 * paréntesis: se corrige una errata evidente, no se adivina. Cualquier otra cosa se descarta.
 */
export function normalizaTicker(celda) {
  const t = String(celda ?? "").trim();
  if (/^[A-Z][A-Z0-9.-]{0,6}$/.test(t)) return t;
  const m = t.match(/^([A-Z][A-Z0-9.-]{0,6})\s*\(/);
  return m ? m[1] : null;
}

/** date,"TICKER1,TICKER2,…" → [{date, tickers}] ordenado. Puro: se testea sin red. */
export function parseSP500Csv(text) {
  return text.trim().split("\n").slice(1).map((ln) => {
    const c = ln.indexOf(",");
    const date = ln.slice(0, c).replace(/"/g, "").trim();
    const tickers = ln.slice(c + 1).replace(/"/g, "").split(",")
      .map((t) => normalizaTicker(t)).filter(Boolean);
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
          return await conFotoDeHoy(byDate);
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
        return await conFotoDeHoy(byDate);
      }
    }
  } catch { /* cae a null */ }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// LA FOTO DE HOY — porque la histórica lleva parada desde el 2025-08-23
//
// `sp500_historical_components.csv` es point-in-time y sirve para el backtest, pero su última
// fila es del 2025-08-23 y aguas arriba no se actualiza. Para el cron eso es un problema que
// CRECE SOLO: cada alta y cada baja del índice desde entonces es invisible, y a los 366 días
// medidos son 28 nombres de 503 (un 5,6 %).
//
// Esta segunda fuente sí está mantenida (`datasets/s-and-p-500-companies`, actualizada cada
// pocos días) y trae además el CIK de cada miembro.
//
// ⚠️ CORRIGE UNA AFIRMACIÓN FALSA que estuvo en `SCORA_PICKS_REGLAS.md` §2: allí se decía que
// los sustitutos gratuitos traen "tickers equivocados" y se citaban `FISV`, `MRSH`, `Q` y
// `ECHO`. **No lo son.** Comprobado contra data.sec.gov el 2026-08-24, la SEC asocia esos
// tickers exactos a esos CIK: `Q` es Qnity Electronics (escisión de DuPont), `ECHO` es
// EchoStar, `MRSH` es Marsh & McLennan y `FISV` es Fiserv. Son tickers ACTUALES que no se
// reconocieron. La que trae los viejos es la foto congelada — de hecho `MANUAL_CIK` ya tenía
// que mapear `BK`→BNY y `MMC`→MRSH justamente por eso.
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ¿POR QUÉ NO SE RELLENA EL HUECO CON EL HISTORIAL DE ESTA SEGUNDA FUENTE?
//
// Es la pregunta obvia —el repo mantenido tiene 194 commits desde 2012, y cada uno es una foto
// point-in-time— así que queda medido para no repetir la investigación (2026-08-29):
//
//   · El CSV histórico llega al 2025-08-23 y ahí se congela.
//   · El mantenido tiene commits hasta el **2025-08-12** y luego SE PARA TAMBIÉN, hasta el
//     2026-03-04. O sea que ninguna de las dos cubre 2025-08-24 → 2026-03-03: seis meses que
//     no se pueden rellenar con nada de lo que hay.
//   · Y lo que decide: **las dos fuentes usan CONVENCIONES DE TICKER DISTINTAS**. La congelada
//     escribe `BF-B` y `BK`; la mantenida escribe `BF.B` y `BNY`. De las 28 diferencias
//     entre ambas, unas son altas y bajas de verdad y otras son el MISMO nombre escrito de otra
//     forma. Empalmarlas sin una capa de normalización haría que Brown-Forman apareciera como
//     una baja y un alta el mismo día, y Bank of New York igual — sesgo inventado donde no lo
//     había.
//
// Así que rellenar el hueco a medias, con dos convenciones mezcladas, sería PEOR que el hueco:
// un hueco se declara y se cuenta (`cobertura.membresiaCongelada` del backtest lo publica), y
// una baja falsa no. Si algún día hace falta cerrarlo de verdad, lo que falta no es más código
// sino una fuente point-in-time continua, o una tabla de equivalencia entre las dos grafías.
const SP500_HOY_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";
const CACHE_HOY = join(CACHE_DIR, "sp500_actual.csv");

/** Parsea el CSV de miembros actuales. Puro: se testea sin red. Devuelve [{ticker, cik}]. */
export function parseSP500Actual(text) {
  const lineas = text.trim().split(String.fromCharCode(10)).slice(1);
  const out = [];
  for (const ln of lineas) {
    // CSV con comillas: la sede lleva comas dentro.
    const campos = []; let cur = "", dentro = false;
    for (const ch of ln) {
      if (ch === '"') dentro = !dentro;
      else if (ch === "," && !dentro) { campos.push(cur); cur = ""; }
      else cur += ch;
    }
    campos.push(cur);
    const ticker = (campos[0] || "").trim().toUpperCase();
    const cik = (campos[6] || "").trim();
    if (!/^[A-Z][A-Z0-9.-]{0,6}$/.test(ticker)) continue;
    out.push({ ticker, cik: /^[0-9]+$/.test(cik) ? cik.padStart(10, "0") : null });
  }
  return out;
}

/**
 * Descarga la foto de HOY. Devuelve null si no hay red y no hay copia local: quien la llame
 * decide si eso es aceptable — para el cron NO lo es, y por eso `loadSP500Historical` sólo la
 * añade cuando existe de verdad.
 */
export async function loadSP500Actual() {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(SP500_HOY_URL);
      if (r.ok) {
        const text = await r.text();
        const filas = parseSP500Actual(text);
        // 400 es un suelo deliberado: el índice tiene ~503 y una respuesta mucho menor es un
        // error de la fuente, no un índice que ha encogido. Cachear eso envenenaría el respaldo.
        if (filas.length >= 400) {
          try { writeFileSync(CACHE_HOY, text); } catch { /* la caché es un extra */ }
          return filas;
        }
      }
    } catch { /* reintento */ }
    await sleep(600 * (a + 1));
  }
  try {
    if (existsSync(CACHE_HOY)) {
      const filas = parseSP500Actual(readFileSync(CACHE_HOY, "utf8"));
      if (filas.length >= 400) return filas;
    }
  } catch { /* cae a null */ }
  return null;
}

/** ticker → CIK de los miembros ACTUALES, según la fuente mantenida. Es un mapa independiente
 *  de `company_tickers.json` de la SEC, así que sirve de segunda opinión. */
export async function cikDeMiembrosActuales() {
  const filas = await loadSP500Actual();
  if (!filas) return null;
  const m = new Map();
  for (const f of filas) if (f.cik) m.set(f.ticker, f.cik);
  return m;
}

/** Fecha de la foto de miembros más reciente de la tabla. Es la que hay que PUBLICAR: dice
 *  sobre qué universo se decidió, que no es lo mismo que la fecha de la decisión. */
/**
 * Añade la foto de HOY como una instantánea más, si es posterior a la última histórica.
 *
 * No reescribe la historia: la tabla point-in-time del backtest sigue intacta y las fechas
 * anteriores resuelven exactamente igual que antes. Lo único que cambia es que una decisión
 * de HOY ve el índice de hoy en vez del de hace un año.
 *
 * Si la fuente mantenida no responde se devuelve la tabla tal cual y el aviso de antigüedad
 * del cron se encarga del resto: mejor un universo viejo y declarado que ninguno.
 */
async function conFotoDeHoy(byDate) {
  const ultima = byDate[byDate.length - 1]?.date ?? "0000-00-00";
  const hoy = new Date().toISOString().slice(0, 10);
  if (hoy <= ultima) return byDate;
  const filas = await loadSP500Actual();
  if (!filas) return byDate;
  return [...byDate, { date: hoy, tickers: filas.map((f) => f.ticker) }];
}

export function snapshotDate(table) {
  return table?.length ? table[table.length - 1].date : null;
}

/** Members as of a date from the historical membership table. */
export function membersAsOf(table, date) {
  if (!table) return null;
  const on = table.filter((r) => r.date <= date);
  return on.length ? on[on.length - 1].tickers : table[0].tickers;
}
