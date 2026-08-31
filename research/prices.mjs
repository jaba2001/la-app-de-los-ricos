// Historical EOD prices for the backtest. Each series normalizes to rows of
// { date, raw, adj }:  raw = unadjusted price (market cap / P/E / P/B), adj =
// total-return (split+dividend) adjusted (returns & momentum).
//   • PRIMARY: Yahoo v8 chart — free, no token, universal for LISTED symbols.
//     raw is reconstructed from split events (close × Π split ratios after the date).
//   • FALLBACK: Tiingo (free token via TIINGO_TOKEN) — covers DELISTED names too,
//     and returns raw `close` + `adjClose` directly (no split math). This is what
//     kills survivorship: set TIINGO_TOKEN and the backtest/cron include dead names.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "px");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
// Fetch window start. Default 2018-06 for the equity backtest; override with PX_FROM to
// pull a longer history (e.g. the multi-asset 0B robustness run back to the GFC).
const FROM = process.env.PX_FROM || "2018-06-01";
const P1 = Math.floor(new Date(FROM).getTime() / 1000);
const P2 = Math.floor(Date.now() / 1000);
const TODAY = new Date().toISOString().slice(0, 10);
const TIINGO = process.env.TIINGO_TOKEN || "";
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yahoo → normalized rows, raw reconstructed from splits (product of ratios AFTER date).
async function fromYahoo(ticker) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${P1}&period2=${P2}&interval=1d&events=split`, { headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp) return [];
      const ts = res.timestamp, q = res.indicators.quote[0], adjc = res.indicators.adjclose?.[0]?.adjclose;
      const splits = Object.values(res.events?.splits ?? {}).map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), f: s.numerator / s.denominator }));
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        const fwd = splits.reduce((f, s) => (s.date > date ? f * s.f : f), 1);
        rows.push({ date, raw: q.close[i] * fwd, adj: adjc?.[i] ?? q.close[i] });
      }
      return rows.sort((x, y) => x.date.localeCompare(y.date));
    } catch { await sleep(700 * (a + 1)); }
  }
  return [];
}

// Tiingo → normalized rows (covers delisted). close = raw, adjClose = total-return.
async function fromTiingo(ticker) {
  if (!TIINGO) return [];
  try {
    const r = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${FROM}&endDate=${TODAY}&format=json&token=${TIINGO}`, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j)
      ? j.filter((x) => x?.date && x.close != null).map((x) => ({ date: x.date.slice(0, 10), raw: x.close, adj: x.adjClose ?? x.close })).sort((a, b) => a.date.localeCompare(b.date))
      : [];
  } catch { return []; }
}

// Canonical symbol → Yahoo symbol. We use FMP's crypto format (BTCUSD) as the ONE
// canonical ticker across the app, backtest and paper fund; Yahoo needs the hyphen form.
//
// ── CAMBIOS DE TICKER ───────────────────────────────────────────────────────────────────
// Una empresa puede cambiar de ticker sin dejar de ser la misma empresa, y entonces el
// universo point-in-time —congelado en 2025-08-23— sigue nombrándola con el ticker viejo
// mientras el precio vive bajo el nuevo. Sin esta tabla, miembros grandes y sanos del S&P 500
// quedaban con la señal calculada por un lado y el precio de otro instrumento por el otro.
//
// ⚠️ REGLA PARA AÑADIR UN CAMBIO DE TICKER AQUÍ, y no es opcional: `tickerToCik` tiene que
// devolver EL MISMO CIK para los dos. Es la única prueba de que se trata del mismo
// registrante y no de un ticker REASIGNADO a otra compañía — el error simétrico, y mucho
// peor, porque empalma los precios de una empresa ajena sin que nada falle. Verificado así
// el 2026-08-22 para `BK` y `MMC`.
//
// Ojo, porque es contraintuitivo: que el ticker VIEJO resuelva a CIK no significa que la SEC
// lo conserve. `company_tickers.json` sólo trae tickers VIGENTES —comprobado: 10.403 entradas
// con `BNY`, `MRSH` y `BRK-B`, sin `BK`, `MMC` ni `BRK.B`—. Si `tickerToCik("BK")` responde es
// porque `MANUAL_CIK` de `edgar.mjs` lo lleva a mano. Las dos tablas van juntas: una entrada
// aquí sin su pareja allí (o al revés) deja el nombre medio roto, que es lo que pasaba.
const ALIAS_A_MANO = {
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  BK: "BNY",     // Bank of New York Mellon · CIK 0001390777 en los dos tickers
  MMC: "MRSH",   // Marsh & McLennan        · CIK 0000062709 en los dos tickers
  // Y un caso distinto: no es un cambio de ticker sino la MISMA acción escrita de otra
  // forma. El CSV de miembros del índice usa punto para la clase; Yahoo y la SEC, guion.
  "BRK.B": "BRK-B", // Berkshire Hathaway clase B · CIK 0001067983
};

/**
 * Y los MISMOS cambios de ticker, pero de las empresas que ya salieron del índice, generados
 * por `research/publicar_resolucion.mjs` con exactamente la prueba que pide la regla de
 * arriba: los dos símbolos resuelven al mismo CIK en la SEC.
 *
 * Es lo que rescata a las renombradas. `FB` no devuelve nada de Meta —hoy ese símbolo es un
 * ETF de ProShares que cotiza desde junio de 2025—, pero `META` devuelve la serie entera
 * desde 2012, porque los proveedores guardan toda la historia bajo el nombre vigente. Sin el
 * alias, Meta quedaría bloqueada por símbolo reutilizado y el backtest perdería uno de los
 * mayores miembros del índice por un simple cambio de nombre.
 *
 * Los de arriba MANDAN sobre éstos: están puestos a mano, verificados uno a uno, y algunos
 * (`BTCUSD`, `BRK.B`) no son cambios de ticker sino convenciones de formato.
 */
function aliasGenerados() {
  try {
    const ruta = join(dirname(fileURLToPath(import.meta.url)), "data", "alias_ticker.json");
    if (existsSync(ruta)) return JSON.parse(readFileSync(ruta, "utf8"))?.alias ?? {};
  } catch { /* sin fichero, sólo los de a mano */ }
  return {};
}

export const YAHOO_ALIAS = { ...aliasGenerados(), ...ALIAS_A_MANO };

/**
 * ¿La serie recién descargada puede REEMPLAZAR a la que ya estaba en disco?
 *
 * Sólo si la abarca por los dos extremos. Cualquier otra cosa —una respuesta más corta, una
 * que empieza más tarde— significa que la fuente ya no tiene la historia o que el ticker es
 * de otra empresa, y en los dos casos escribirla destruye datos que no se pueden recuperar.
 *
 * Pura a propósito: es la regla que impide una pérdida silenciosa de datos, así que tiene
 * que poder testearse sin red ni disco.
 */
export function cubreLaCache(nuevas, previa) {
  if (!previa?.length) return true;              // no había nada que perder
  if (!nuevas?.length) return false;
  return nuevas[0].date <= previa[0].date
    && nuevas[nuevas.length - 1].date >= previa[previa.length - 1].date;
}

/**
 * SÍMBOLOS QUE OTRO INSTRUMENTO HEREDÓ, y por qué esto tiene que estar ANTES de la caché.
 *
 * Cuando una empresa desaparece su símbolo queda libre, y los proveedores indexan por símbolo:
 * piden `GENZ` y devuelven **200 con 4.437 barras continuas de 2009 a 2026**… del *VanEck
 * Digital Native Economy ETF*. Genzyme se vendió a 74 $/acción en abril de 2011 y esa serie
 * marca 32,99 $ ese día. No hay error, no hay hueco, no hay nada que se note: hay precios de
 * otra cosa. Ni Yahoo ni Tiingo distinguen el caso — lo comprobé en los dos.
 *
 * Y no se puede arreglar truncando en la fecha de salida, porque la serie **entera** es del
 * instrumento nuevo, también el tramo antiguo. La única respuesta correcta es no dar precios:
 * el nombre se queda fuera, contado y a la vista, en lugar de entrar con los de otro.
 *
 * La lista la produce `research/simbolos_reutilizados.mjs` comparando cada serie con el periodo
 * en que el ticker estuvo en el índice. Si el fichero falta, no se bloquea nada — el arreglo
 * degrada al comportamiento anterior en vez de dejar el sistema sin precios.
 */
const AVISADOS = new Set();
const TRUNCADOS_AVISADOS = new Set();
export function simboloBloqueado(ticker) {
  if (!mem.has("__bloq")) {
    let m = {};
    try {
      const ruta = join(dirname(fileURLToPath(import.meta.url)), "data", "simbolos_reutilizados.json");
      if (existsSync(ruta)) m = JSON.parse(readFileSync(ruta, "utf8"))?.bloqueados ?? {};
    } catch { m = {}; }
    mem.set("__bloq", m);
  }
  const motivo = mem.get("__bloq")[ticker.toUpperCase()];
  if (motivo && !AVISADOS.has(ticker)) {
    AVISADOS.add(ticker);
    console.warn(`  ⚠ ${ticker}: sin precios a propósito — ${motivo}`);
  }
  return motivo ?? null;
}

/**
 * HASTA QUÉ FECHA VALE LA SERIE DE ESTE SÍMBOLO. Null = entera.
 *
 * ⚠️ BLOQUEAR NO ES LA ÚNICA RESPUESTA, y tratarlo como si lo fuera tira datos buenos.
 *
 * Hay TRES formas de que la serie de una empresa muerta siga después de su muerte, y sólo
 * una se arregla bloqueando:
 *
  *   · **Otro instrumento heredó el símbolo.** `GENZ` devuelve un ETF con 4.437 barras
 *     continuas, y el tramo antiguo TAMPOCO es de Genzyme. No hay nada que salvar: se bloquea.
  *   · **El proveedor congela el último cierre.** `ANSS` tiene su historia real hasta el
 *     2025-07-17 a 374,30 $ —el día que Synopsys cerró la compra—, luego 204 días de hueco, y
 *     luego 374,30 $ repetido hasta hoy. Y el muñón es PEOR que una serie ajena: volatilidad
 *     cero y retorno cero convierten a Ansys en un activo sin riesgo en cualquier ventana que
  *     lo toque. `SIVB` igual, con 133 barras finales a 0,006 $. Aquí bloquear tiraría ocho
 *     años reales de un miembro del índice: lo correcto es CORTAR donde acaba lo real.
 *   · **La empresa siguió cotizando.** BorgWarner salió del índice y sigue viva: no se toca.
 *
 * La lista la produce `research/simbolos_reutilizados.mjs`, que distingue los tres casos por
 * la forma de la serie y no por cuánto dura la cola.
 */
export function truncarEn(ticker) {
  if (!mem.has("__trunc")) {
    let m = {};
    try {
      const ruta = join(dirname(fileURLToPath(import.meta.url)), "data", "simbolos_reutilizados.json");
      if (existsSync(ruta)) m = JSON.parse(readFileSync(ruta, "utf8"))?.truncados ?? {};
    } catch { m = {}; }
    mem.set("__trunc", m);
  }
  return mem.get("__trunc")[ticker.toUpperCase()] ?? null;
}

async function series(ticker) {
  if (mem.has(ticker)) return mem.get(ticker);
  // Antes que la caché y antes que la red: si el símbolo lo heredó otro instrumento, no hay
  // respuesta buena que buscar, y una caché escrita en una ejecución anterior podría tener ya
  // la serie ajena guardada.
  // ⚠️ EL ALIAS SE RESUELVE ANTES QUE EL BLOQUEO, y el orden inverso dejaba sin precios a
  // empresas vivas. El bloqueo dice «no busques bajo ESTE símbolo»; el alias dice «búscalo bajo
  // AQUEL». Si se bloquea primero, el alias no llega a aplicarse nunca.
  //
  // `CHK` lo enseñó: Chesapeake quebró, volvió a cotizar en 2021 y hoy es `EXE` (Expand Energy),
  // el MISMO CIK. La auditoría —que corrió antes de que existiera el alias— vio bajo `CHK` una
  // serie que empieza en 2021 y no solapa con su periodo en el índice, y lo bloqueó. Con el
  // bloqueo primero, Chesapeake se quedaba sin precios en toda su historia pese a que `EXE` los
  // tiene enteros. Comprobando el bloqueo sobre el símbolo que DE VERDAD se descarga, el alias
  // hace su trabajo y el bloqueo sigue protegiendo a los que no tienen a dónde ir (`GENZ`).
  const yTicker = YAHOO_ALIAS[ticker] ?? ticker;
  if (simboloBloqueado(yTicker)) { mem.set(ticker, []); return []; }
  // ⚠️ LA CACHÉ SE INDEXA POR EL SÍMBOLO DEL QUE SE DESCARGA, no por el que se pide.
  //
  // Con el alias `FB → META`, guardar bajo `FB` deja en disco un fichero que la siguiente
  // ejecución lee ANTES de aplicar el alias — y si ese `FB.json` se escribió cuando `FB` era
  // ya el ETF de ProShares, Meta recibe los precios del ETF sin que nada falle. Indexar por
  // el destino hace que `FB` y `META` compartan la misma serie, que es lo correcto porque son
  // la misma acción, y de paso invalida sola cualquier caché escrita bajo el símbolo viejo.
  const path = join(DIR, yTicker.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
  let rows = null;
  // ⚠️ Esta caché NO CADUCA: una vez escrito el fichero, se reutiliza para siempre. Es lo
  // correcto para un backtest (que quiere datos estables y reproducibles) y VENENO para un
  // proceso en vivo, que se quedaría clavado en la última fecha descargada sin fallar ni
  // avisar. `PX_REFRESH=1` fuerza la recarga; lo usa `cron-picks.mjs`, que necesita el
  // precio de hoy y el calendario de mercado real.
  const refrescar = process.env.PX_REFRESH === "1";
  const enDisco = () => { try { const c = JSON.parse(readFileSync(path, "utf8")); return Array.isArray(c) && c.length && c[0].raw != null ? c : null; } catch { return null; } };
  if (!refrescar && existsSync(path)) rows = enDisco();
  if (!rows) {
    await sleep(160);
    rows = await fromYahoo(yTicker);
    const previa = enDisco();
    // Tiingo se consultaba SÓLO cuando Yahoo devolvía cero barras, y ese "cero" era el
    // supuesto equivocado: Yahoo también devuelve series TRUNCADAS —26 barras de `EA` desde
    // 2026-07-17, cinco de `BK` a 14,79 $— cuando una empresa sale de bolsa o el ticker
    // cambia de manos. Al no estar vacías, la respuesta corta ganaba y la fuente que sí tiene
    // la historia no llegaba a preguntarse. Se le pregunta también cuando la respuesta no
    // cubre lo que ya había, que es justo el caso en que hace falta.
    if (!rows.length || !cubreLaCache(rows, previa)) {
      const alt = await fromTiingo(yTicker);           // cubre deslistados
      if (alt.length > rows.length) rows = alt;
    }
    if (rows.length) {
      // ⚠️ UN REFRESCO PUEDE ALARGAR UNA SERIE; NUNCA ACORTARLA.
      //
      // Antes se escribía cualquier respuesta no vacía, y eso destruyó datos de verdad: un
      // refresco del 2026-08-21 dejó `EA` en 6 barras y `BK` en 5 —a 14,79 $, que no es el
      // precio de Bank of New York sino el de OTRO instrumento con ese ticker— borrando años
      // de historia buena. El daño es silencioso por partida doble: `loadPanel` exige 300
      // barras, así que el nombre desaparece de todos los paneles sin que nada falle, y en CI
      // (donde no hay caché) desaparece del universo directamente.
      //
      // Un ticker puede dejar de cotizar o ser REASIGNADO a otra empresa. En los dos casos la
      // respuesta nueva no cubre la historia guardada, y en los dos casos lo correcto es
      // quedarse con lo que ya había: perder cobertura reciente es un problema menor que
      // empalmar los precios de otra compañía o quedarse sin serie.
      if (cubreLaCache(rows, previa)) writeFileSync(path, JSON.stringify(rows));
      else {
        console.warn(`  ⚠ precios ${ticker}: la descarga (${rows.length} barras, ${rows[0].date}→${rows[rows.length - 1].date}) NO cubre la caché (${previa.length}, ${previa[0].date}→${previa[previa.length - 1].date}). Se conserva la caché.`);
        rows = previa;
      }
    } else if (previa) {
      // El refresco no trajo nada. Sin esto el nombre se caía del panel durante toda la
      // ejecución por un fallo de red pasajero, en silencio.
      rows = previa;
    }
  }
  rows = rows ?? [];
  // Y si la serie sólo vale hasta cierta fecha, se corta AQUÍ y no en cada consumidor: es el
  // único punto por el que pasan todas las lecturas, así que cortar aquí es cortar en todas.
  const hasta = truncarEn(ticker);
  if (hasta) {
    const antes = rows.length;
    rows = rows.filter((r) => r.date <= hasta);
    if (antes !== rows.length && !TRUNCADOS_AVISADOS.has(ticker)) {
      TRUNCADOS_AVISADOS.add(ticker);
      console.warn(`  ✂ ${ticker}: serie cortada en ${hasta} (${antes - rows.length} barras descartadas) — lo que sigue es el último cierre congelado, no cotización`);
    }
  }
  mem.set(ticker, rows);
  return rows;
}

const idxOnOrBefore = (rows, date) => { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

export async function rawPriceAsOf(ticker, date) { const r = await series(ticker); const i = idxOnOrBefore(r, date); return i < 0 ? null : r[i].raw; }
export async function priceAsOf(ticker, date) { const r = await series(ticker); const i = idxOnOrBefore(r, date); return i < 0 ? null : r[i].adj; }
export async function fwdReturn(ticker, from, to) {
  const r = await series(ticker); const a = idxOnOrBefore(r, from), b = idxOnOrBefore(r, to);
  return a >= 0 && b >= 0 && r[a].adj > 0 ? (r[b].adj / r[a].adj - 1) * 100 : null;
}
export async function momentum(ticker, date) {
  const r = await series(ticker); const i = idxOnOrBefore(r, date);
  if (i < 130) return { m1: null, m3: null, m6: null };
  const cur = r[i].adj;
  const pct = (n) => { const p = i - n >= 0 ? r[i - n].adj : null; return p && p > 0 ? ((cur - p) / p) * 100 : null; };
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}
export async function hasPriceAt(ticker, date) { return idxOnOrBefore(await series(ticker), date) >= 0; }

/**
 * Última fecha con barra, o null si no hay serie.
 *
 * `hasPriceAt` NO sirve para saber si un nombre se puede comprar HOY: usa `idxOnOrBefore`, así
 * que una serie que terminó en 2019 sigue devolviendo `true` en 2026 — con el precio de 2019.
 * Un proceso en vivo necesita saber si la serie llega hasta hoy, y ésta es esa pregunta.
 */
export async function lastBarDate(ticker) {
  const r = await series(ticker);
  return r.length ? r[r.length - 1].date : null;
}

// Is the (adjusted) price on `date` above its trailing n-day simple moving average?
// Returns null when there isn't enough history. Used by the breadth aggregator.
export async function aboveSMA(ticker, n, date) {
  const r = await series(ticker); const i = idxOnOrBefore(r, date);
  if (i < 0 || i < n - 1) return null;
  let sum = 0; for (let k = i - n + 1; k <= i; k++) sum += r[k].adj;
  const sma = sum / n, px = r[i].adj;
  return px > 0 && sma > 0 ? px > sma : null;
}

// Full history of daily log total-returns (adj-based), memoized via the same cache.
// Used by correlation.mjs to build the realized-correlation engine. PIT-safe: callers
// slice a trailing window ending on-or-before their as-of date.
export async function returnsSeries(ticker) {
  const r = await series(ticker);
  const out = [];
  for (let k = 1; k < r.length; k++) {
    const p0 = r[k - 1].adj, p1 = r[k].adj;
    if (p0 > 0 && p1 > 0) out.push({ date: r[k].date, ret: Math.log(p1 / p0) });
  }
  return out;
}
