// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR — point-in-time fundamentals (free, no API key, no limits).
//
// One companyfacts call per company (all XBRL tags at once) → disk-cached, so a
// 500-name universe is ~500 downloads done once. To score as of a past date we use
// ONLY facts with filed<=asOf (native point-in-time, zero look-ahead). Flow items
// (revenue, income, D&A…) are summed over the 4 most-recent discrete quarters known
// by asOf (TTM); balance-sheet instants take the latest value as-of.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const UA = "Scora Research contact@scora.app";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, cacheFile, ttlDays = 30) {
  const path = join(DIR, cacheFile);
  if (existsSync(path)) {
    const age = (Date.now() - Number(readFileSync(path + ".t", "utf8").trim())) / 86400000;
    if (age < ttlDays) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* refetch */ } }
  }
  await sleep(90); // SEC fair-access (<10 req/s)
  let j = null;
  try { const r = await fetch(url, { headers: { "User-Agent": UA } }); j = r.ok ? await r.json() : null; } catch { j = null; }
  if (j) { writeFileSync(path, JSON.stringify(j)); writeFileSync(path + ".t", String(Date.now())); }
  return j;
}

/** ticker → zero-padded 10-digit CIK (free SEC map, cached in-process + disk). */
/**
 * CIK fijados a mano para tickers que el mapa de la SEC no resuelve bien.
 *
 * company_tickers.json (y su gemelo company_tickers_exchange.json — mismas 10.398
 * entradas) NO es un índice completo: falla justo en las empresas que han cambiado de
 * nombre o han estado en una operación corporativa. Comprobado, y son dos fallos distintos:
 *
 *   · Ticker distinto en la SEC — BK cotiza allí como "BNY" tras el rebranding de Bank of
 *     New York Mellon, y MMC como "MRSH".
 *   · Sin ticker alguno (`tickers: []`) — K, DFS, HES y XOM. Son empresas adquiridas o
 *     reorganizadas a las que la SEC ha retirado la metadata de cotización. Sus 10-K
 *     siguen publicados y son perfectamente válidos.
 *
 * XOM es el caso que más engaña: el mapa SÍ devuelve un CIK (2115436), pero es el de
 * "ExxonMobil Holdings Corp", la sociedad nueva de la reorganización, que todavía no ha
 * presentado ningún 10-K. Es decir, devuelve una respuesta plausible y equivocada — por eso
 * estas excepciones tienen PRIORIDAD sobre el mapa en lugar de usarse solo cuando falla.
 *
 * Cada CIK está verificado contra data.sec.gov/submissions: nombre correcto y 10-K real.
 * Antes de tocar esta tabla, compruébalo igual — un CIK inventado ingiere los estados
 * financieros de otra empresa sin dar ningún error.
 */
const MANUAL_CIK = {
  K:   "0000055067", // KELLANOVA
  BK:  "0001390777", // Bank of New York Mellon Corp (en la SEC: "BNY")
  DFS: "0001393612", // Discover Financial Services
  MMC: "0000062709", // MARSH & MCLENNAN COMPANIES (en la SEC: "MRSH")
  HES: "0000004447", // HESS CORP
  AEP: "0000004904", // AMERICAN ELECTRIC POWER CO INC
  XOM: "0000034088", // EXXON MOBIL CORP — no la holding nueva
  // Clase de acción escrita con PUNTO en el CSV de miembros del índice y con GUION en la
  // SEC. No es un cambio de ticker ni una empresa distinta: es otra convención de vendor
  // para la misma acción. Sin esta línea, Berkshire Hathaway era INVISIBLE para el sistema
  // —sin CIK, luego sin fundamentales, luego sin señal— y no aparecía en ningún aviso,
  // porque los avisos sólo ven a los que llegan a tener señal. El otro ticker con sufijo,
  // `BF.B`, tampoco está en el volcado: resuelve, pero por el mapa de históricos, no solo.
  "BRK.B": "0001067983", // BERKSHIRE HATHAWAY INC (en la SEC: "BRK-B")
  // `BF.B`, tampoco está en el volcado: resuelve, pero por el mapa de históricos, no solo.

  // ⚠️ MIEMBROS ACTUALES QUE EL VOLCADO MASIVO DE LA SEC NO TRAE. Encontrados el
  // 2026-08-25 por `research/cobertura_metricas.mjs`, que fue lo primero que dijo
  // «tres miembros sin CIK» — y sin CIK no hay fundamentales, luego no hay señal, luego no
  // aparecen en ningún aviso. Tres nombres del índice, invisibles, sin que fallara nada.
  //
  // Lo llamativo es que `company_tickers.json` y el endpoint de submissions NO DICEN LO
  // MISMO: para `EA`, submissions declara `tickers: ["EA"]` y presenta 10-Q hasta el
  // 2026-08-03, mientras el volcado masivo no la lista en absoluto. O sea que el volcado no
  // es una foto completa de lo vivo, y tratarlo como si lo fuera es la causa de esta familia
  // entera de agujeros — la misma de `K`, `DFS`, `HES` y `XOM` de aquí arriba.
  EA:  "0000712515", // ELECTRONIC ARTS INC. — la SEC declara "EA" en submissions y aun así no está en el volcado
  FI:  "0000798354", // FISERV INC — el volcado sigue diciendo "FISV", el nombre que dejó de usar en 2023
  DAY: "0001725057", // Dayforce, Inc. — antes Ceridian (`CDAY`); el volcado no la trae con ninguno de los dos
};

/**
 * CIK de tickers MUERTOS, resueltos y verificados por `research/resolver_cik.mjs`.
 *
 * `company_tickers.json` sólo contiene tickers VIVOS. Por eso una empresa que salió del índice
 * era invisible **en todas las fechas**, incluidas aquellas en que estaba dentro y era
 * excelente: sin CIK no hay fundamentales, sin fundamentales no hay señal, y sin señal no
 * aparece en ningún aviso — porque los avisos sólo ven a los que llegan a tener señal. Ése es
 * el sesgo de supervivencia de este repositorio, y no entraba por los precios sino por aquí.
 *
 * Cada entrada de ese fichero está verificada exigiendo que el propio emisor declare el símbolo
 * en un documento suyo. Lo que no se pudo verificar NO está.
 */
function cikHistoricos() {
  if (!mem.has("__hist")) {
    let m = {};
    try {
      const ruta = join(dirname(fileURLToPath(import.meta.url)), "data", "cik_historicos.json");
      if (existsSync(ruta)) m = JSON.parse(readFileSync(ruta, "utf8"))?.mapa ?? {};
    } catch { m = {}; } // si el fichero no está o está roto, se sigue sin él
    mem.set("__hist", m);
  }
  return mem.get("__hist");
}

export async function tickerToCik(ticker) {
  const t = ticker.toUpperCase();
  if (MANUAL_CIK[t]) return MANUAL_CIK[t];
  if (!mem.has("__map")) {
    const j = await getJSON("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", 7);
    const m = {};
    if (j) for (const k in j) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, "0");
    mem.set("__map", m);
  }
  // ⚠️ EL ORDEN IMPORTA, y es el revés del de `MANUAL_CIK`. Los históricos van DESPUÉS del mapa
  // vivo, nunca antes: un ticker que quedó libre puede haber sido reasignado a otra empresa
  // —`Q` es hoy Qnity Electronics y `ECHO` es EchoStar, ninguna de las dos la que llevó ese
  // símbolo antes—. Consultarlos primero taparía a la empresa VIVA con la difunta. Como
  // relleno sólo actúan donde la SEC no tiene nada, que es exactamente donde hacen falta.
  return mem.get("__map")[t] ?? cikHistoricos()[t] ?? null;
}

/**
 * Igual que `tickerToCik` pero SIN el relleno histórico: sólo lo que la SEC reconoce hoy.
 *
 * Existe para romper una pescadilla que se muerde la cola. `resolver_cik.mjs` decide qué
 * tickers faltan preguntando por cada uno; si preguntara con el relleno puesto, en la segunda
 * ejecución vería que ya no falta ninguno y reescribiría `resolucion_cik.json` **vacío**,
 * borrando su propio trabajo. Con esto la lista de pendientes es siempre la misma —los muertos
 * de verdad— y el fichero se regenera entero y se puede comparar con el anterior.
 */
export async function tickerToCikVivo(ticker) {
  const t = ticker.toUpperCase();
  if (MANUAL_CIK[t]) return MANUAL_CIK[t];
  await tickerToCik(t); // asegura el mapa en memoria
  return mem.get("__map")[t] ?? null;
}

/**
 * EL CIK QUE LLEVABA LA HISTORIA ANTES DE UNA REORGANIZACION.
 *
 * Cuando una empresa se reorganiza bajo una holding nueva, la SEC le da un CIK NUEVO y el mapa
 * vivo apunta el ticker ahi. El CIK nuevo solo tiene los ejercicios posteriores, asi que la
 * empresa se queda sin fundamentales en toda su historia anterior — luego sin senal, luego
 * invisible en el backtest. No falla nada: devuelve una respuesta plausible y vacia.
 *
 * Es el mismo fenomeno que ya obligo a fijar `XOM` a mano en `MANUAL_CIK`, pero alli se
 * resolvio eligiendo UN CIK, y elegir pierde una mitad: la antigua pierde los trimestres
 * nuevos, la nueva pierde los anos viejos. Aqui no hay que elegir, porque los hechos de XBRL
 * van FECHADOS y `fundamentalsAsOf` ya selecciona por fecha: se unen los dos juegos y cada
 * consulta encuentra el tramo que le toca.
 *
 * Medido el 2026-08-25:
 *   BLK   nuevo 2012383 tiene Assets desde 2023-12-31; el viejo 1364742, desde 2008-12-31.
 *   APA   nuevo 1841666 tiene Assets desde 2019-12-31; el viejo 6769,    desde 2008-12-31.
 *
 * ⚠️ SOLO REORGANIZACIONES. NUNCA UN SIMBOLO REASIGNADO.
 *
 * La diferencia no es tecnica, es de que se esta afirmando. `BLK` y `APA` son la MISMA empresa
 * con otra envoltura juridica, asi que unir sus hechos reconstruye una serie que existio de
 * verdad. `SNDK` no: el SanDisk que estuvo en el indice de 2010 a 2016 lo compro Western
 * Digital, y el `SNDK` de hoy es un spin-off de 2025 que no es su continuacion. Unirlos
 * FABRICARIA una continuidad que nunca hubo — y eso es peor que el hueco, porque un hueco se ve
 * y se cuenta y una serie inventada no.
 *
 * Y la prueba de que son casos distintos esta en los propios datos, no en mi criterio: los
 * hechos de SanDisk viejo (CIK 1000180) acaban el 2016-04-03, el mes de la compra, y los del
 * nuevo empiezan el 2024-06-28. Ocho anos de vacio. Los de BlackRock viejo llegan a 2024-06-30
 * y los del nuevo arrancan en 2023-12-31: se SOLAPAN, que es lo que hace una reorganizacion.
 *
 * Antes de anadir una entrada aqui, comprueba ese solape. Si hay hueco, no es una
 * reorganizacion y no va en esta tabla.
 */
const CIK_PREDECESOR = {
  "0002012383": "0001364742", // BlackRock, Inc. (holding de 2023) <- BLACKROCK FINANCE, INC.
  "0001841666": "0000006769", // APA Corp (holding de 2021)        <- APACHE CORP
  // "0002023554": NO. Sandisk Corp (spin-off de 2025) no continua a SANDISK CORP (1000180).
};

/**
 * Une dos juegos de `companyfacts` conservando la estructura que espera todo lo de abajo.
 *
 * Manda el NUEVO en cualquier colision: durante el solape de una reorganizacion los dos
 * declaran el mismo periodo, y el bueno es el de la entidad que informa hoy — su primer 10-K
 * reexpresa la historia. El viejo solo aporta lo que el nuevo no tiene, que es el pasado.
 */
function fusionarFacts(nuevo, viejo) {
  if (!viejo?.facts) return nuevo;
  if (!nuevo?.facts) return nuevo;
  const clave = (x) => `${x.start ?? ""}|${x.end ?? ""}|${x.fp ?? ""}|${x.form ?? ""}`;
  const out = { ...nuevo, facts: { ...nuevo.facts } };
  for (const tax of Object.keys(viejo.facts)) {
    out.facts[tax] = { ...(out.facts[tax] ?? {}) };
    for (const tag of Object.keys(viejo.facts[tax])) {
      const vt = viejo.facts[tax][tag];
      const nt = out.facts[tax][tag];
      if (!nt) { out.facts[tax][tag] = vt; continue; }
      const units = { ...nt.units };
      for (const u of Object.keys(vt.units ?? {})) {
        const yaEsta = new Set((units[u] ?? []).map(clave));
        const anadidos = (vt.units[u] ?? []).filter((x) => !yaEsta.has(clave(x)));
        units[u] = [...(units[u] ?? []), ...anadidos].sort((a, b) => String(a.end).localeCompare(String(b.end)));
      }
      out.facts[tax][tag] = { ...nt, units };
    }
  }
  return out;
}

async function companyFacts(cik) {
  const key = `facts_${cik}`;
  if (mem.has(key)) return mem.get(key);
  let j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, `CIK${cik}.json`);
  const previo = CIK_PREDECESOR[cik];
  if (previo && j) {
    // Si el predecesor no responde no se rompe nada: se sigue con lo que hay, que es el
    // comportamiento de antes. Un fallo de red no debe cambiar una nota.
    const viejo = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${previo}.json`, `CIK${previo}.json`);
    if (viejo) j = fusionarFacts(j, viejo);
  }
  mem.set(key, j);
  return j;
}

/** Para los tests: quien tiene predecesor declarado y cual. */
export const PREDECESORES = CIK_PREDECESOR;

/** SIC code → Scora sector (from submissions endpoint, cached). */
export async function sicSector(cik) {
  const j = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, `sub${cik}.json`);
  const sic = j?.sic ? Number(j.sic) : null;
  if (sic == null) return "";
  // Coarse SIC-range → Scora sector map (matches SECTOR_PE_BM keys in scoring.ts).
  if (sic >= 6000 && sic <= 6199) return "Financial Services";
  if (sic >= 6200 && sic <= 6399) return "Financial Services";
  if (sic >= 6400 && sic <= 6499) return "Financial Services";
  if (sic >= 6500 && sic <= 6599) return "Real Estate";
  if (sic >= 2833 && sic <= 2836) return "Healthcare";
  if (sic >= 8000 && sic <= 8099) return "Healthcare";
  if (sic >= 3570 && sic <= 3579) return "Technology";
  if (sic >= 3670 && sic <= 3679) return "Technology";
  if (sic >= 7370 && sic <= 7379) return "Technology";
  if (sic === 3571 || sic === 3572 || sic === 3576 || sic === 3577 || sic === 3674) return "Technology";
  if (sic >= 1300 && sic <= 1399) return "Energy";
  if (sic >= 2900 && sic <= 2999) return "Energy";
  if (sic >= 2800 && sic <= 2899) return "Materials";
  if (sic >= 1000 && sic <= 1099) return "Materials";
  if (sic >= 4800 && sic <= 4899) return "Communication Services";
  if (sic >= 2000 && sic <= 2199) return "Consumer Defensive";
  if (sic >= 2080 && sic <= 2099) return "Consumer Defensive";
  if (sic >= 5400 && sic <= 5499) return "Consumer Defensive";
  if (sic >= 5200 && sic <= 5999) return "Consumer Cyclical";
  if (sic >= 3700 && sic <= 3799) return "Consumer Cyclical";
  if (sic >= 4000 && sic <= 4799) return "Industrials";
  if (sic >= 3400 && sic <= 3569) return "Industrials";
  if (sic >= 4900 && sic <= 4999) return "Utilities";

  // ── Rangos que faltaban, y eran 160 de 503 miembros (32 %) ──────────────────────────────
  //
  // El mapa original cubría poco más de la mitad del índice. Los que caían fuera salían con
  // sector vacío, y eso no rompe nada —el score no usa el sector desde que los percentiles
  // sectoriales se retiraron— pero sí deja ciego el análisis de SESGO SECTORIAL del backtest,
  // que es justo el que responde a «¿cuánto de la ventaja es no tener bancos?». Con un tercio
  // del universo sin clasificar, esa pregunta no se podía contestar.
  //
  // Añadidos por tamaño del hueco, y sólo donde el SIC no deja dudas:
  if (sic >= 3841 && sic <= 3851) return "Healthcare";              // 19: instrumental médico y quirúrgico
  if (sic === 6798) return "Real Estate";                           // 28: REITs
  if (sic === 6792) return "Energy";                                // regalías de petróleo (TPL)
  if (sic >= 7000 && sic <= 7099) return "Consumer Cyclical";       // 6: hoteles y casinos
  if (sic >= 5000 && sic <= 5199) return "Industrials";             // 6: mayoristas
  if (sic >= 2600 && sic <= 2699) return "Materials";               // 5: papel y envases
  if (sic >= 1500 && sic <= 1599) return "Consumer Cyclical";       // 4: constructoras de vivienda
  if (sic >= 3300 && sic <= 3399) return "Materials";               // 4: metalurgia primaria
  if (sic >= 2200 && sic <= 2399) return "Consumer Cyclical";       // 4: textil y confección
  if (sic >= 7800 && sic <= 7999) return "Communication Services";  // 4: cine y entretenimiento
  if (sic >= 2700 && sic <= 2799) return "Communication Services";  // 2: edición y prensa
  if (sic >= 1400 && sic <= 1499) return "Materials";               // 2: minería no metálica
  if (sic >= 3000 && sic <= 3099) return "Consumer Cyclical";       // 2: caucho y plástico
  if (sic >= 3900 && sic <= 3999) return "Consumer Cyclical";       // 2: manufactura diversa
  if (sic >= 100 && sic <= 999) return "Consumer Defensive";        // agricultura
  if (sic === 7311) return "Communication Services";                // publicidad (IPG, OMC)
  if (sic === 7320) return "Financial Services";                    // calificación y crédito (MCO, SPGI, EFX)
  if (sic === 7359 || sic === 7381) return "Industrials";           // alquiler de equipo, seguridad
  if (sic === 7389) return "Technology";                            // 16: «servicios NEC», mayoría tecnológicas
  if (sic === 3812) return "Industrials";                           // defensa y aeronáutica (LHX, NOC, TDY)

  // ⚠️ Y AQUÍ SE PARA A PROPÓSITO. 3820-3829 son «instrumentos de medida», y el SIC no los
  // resuelve: de los 16 miembros que caen ahí, seis son de salud (Thermo Fisher, Danaher,
  // Agilent, Waters, Mettler, Revvity), cuatro de tecnología (Keysight, Teradyne, KLA,
  // Trimble) y seis industriales (Roper, Rockwell, Ametek, Fortive, Trane, Veralto). Seis
  // contra cuatro contra seis: no hay mayoría que valga.
  //
  // Mapearlos «por no dejarlos vacíos» pondría a Thermo Fisher entre las industriales, y para
  // un análisis de sesgo sectorial eso es PEOR que no clasificarlos — un hueco se ve y se
  // cuenta, una etiqueta equivocada no. Lo mismo con 3600-3669 (equipo eléctrico: GE y Emerson
  // conviven con Qualcomm y Motorola). Si algún día hacen falta, la fuente correcta no es el
  // SIC sino una tabla GICS.
  return "";
}

/**
 * Taxonomías por orden de preferencia. Un presentador estadounidense sólo tiene `us-gaap`, así
 * que buscar después en `ifrs-full` no le cambia nada; un 20-F europeo o japonés sólo tiene
 * `ifrs-full`, y hasta el 2026-08-22 este fichero fijaba "us-gaap" y devolvía cero conceptos
 * para él — sin error, sin aviso: la empresa simplemente no existía. Comprobado: SAP, Toyota y
 * Shell presentan en `ifrs-full`; ASML y Alibaba, en `us-gaap`.
 */
const TAXONOMIAS = ["us-gaap", "ifrs-full"];

/**
 * ⚠️ HAY QUE MIRAR LA MONEDA, no sólo si el tag existe.
 *
 * Toyota publica en `us-gaap` Y en `ifrs-full`. Buscando sólo por nombre, `Assets` aparecía en
 * la primera —sin un solo importe en yenes, que es su moneda— y nunca se llegaba a la
 * segunda, donde sí estaba el dato. Resultado: Toyota se quedaba sin activo ni patrimonio y
 * caía a 2 de 5 métricas, por debajo del mínimo para tener señal. Otro fallo mudo.
 */
function facts(fj, tag, taxonomy = null, unidad = null) {
  if (taxonomy) return fj?.facts?.[taxonomy]?.[tag]?.units ?? null;
  let primera = null;
  for (const tax of TAXONOMIAS) {
    const u = fj?.facts?.[tax]?.[tag]?.units;
    if (!u) continue;
    if (!unidad) return u;
    if (Array.isArray(u[unidad]) && u[unidad].length) return u;   // ésta sí tiene la moneda
    primera ??= u;
  }
  return primera;
}

/**
 * MONEDA DE PRESENTACIÓN — la parte peligrosa de admitir extranjeras.
 *
 * `quarters()` e `instant()` fijaban `unit = "USD"`. Mientras el universo era estadounidense
 * eso era correcto. En cuanto entra una extranjera deja de serlo, y de la peor manera: ASML
 * presenta en US GAAP pero **en euros**, y SAP en euros y Toyota en yenes. Si se leen esos
 * importes como si fueran dólares, la capitalización (en dólares, del precio) dividida entre
 * el beneficio (en euros) da un PER perfectamente creíble y falso.
 *
 * Por eso el extractor DECLARA su moneda en vez de suponerla, y `metricsOf` se niega a
 * calcular los ratios que cruzan precio y estados financieros cuando no coinciden. Los ratios
 * que salen enteros de los estados financieros —márgenes, ROIC, apalancamiento, cobertura—
 * son adimensionales y siguen siendo válidos en cualquier moneda: la señal de calidad de
 * Picks es exactamente eso, así que una extranjera puede puntuar sin necesidad de tipos de
 * cambio.
 */
const MONEDAS = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "SEK", "DKK", "NOK",
                 "CNY", "HKD", "KRW", "BRL", "MXN", "INR", "ILS", "SGD", "TWD", "ZAR"];

/**
 * ¿Es un presentador NACIONAL (10-K/10-Q) o extranjero (20-F/40-F)?
 *
 * Hace falta para algo que la moneda por sí sola no cubre: **el ratio del ADR**. Shell
 * presenta en dólares, así que la moneda cuadra — pero su ADR equivale a más de una acción
 * ordinaria, y `shares` de EDGAR cuenta ordinarias. Multiplicar el precio del ADR por las
 * ordinarias da una capitalización equivocada aunque las dos cifras estén en dólares.
 *
 * O sea: el precio y los estados financieros pueden no referirse a la misma unidad por DOS
 * motivos independientes, y los dos hay que taparlos. Se mira el tipo de formulario, no la
 * periodicidad: desde que existe la vía anual hay nacionales que presentan sólo ejercicios
 * completos (Coca-Cola en 2019), así que "anual" ya no implica "extranjera".
 */
export function esDomestico(fj) {
  for (const tag of ["Assets", "Revenues", "NetIncomeLoss"]) {
    const u = facts(fj, tag);
    if (!u) continue;
    for (const arr of Object.values(u)) {
      if (!Array.isArray(arr)) continue;
      for (const x of arr) if (x.form === "10-K" || x.form === "10-Q") return true;
    }
  }
  return false;
}

/** Moneda en la que la empresa presenta sus importes: la más usada en los tags de tamaño. */
export function reportingCurrency(fj) {
  const cuenta = new Map();
  for (const tag of ["Assets", "Revenues", "Revenue", "NetIncomeLoss", "ProfitLoss"]) {
    const u = facts(fj, tag);
    if (!u) continue;
    for (const m of MONEDAS) if (Array.isArray(u[m])) cuenta.set(m, (cuenta.get(m) ?? 0) + u[m].length);
  }
  if (!cuenta.size) return null;
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Periodos de duración [minDias, maxDias] conocidos en `asOf`, del más reciente al más
 *  antiguo y deduplicados por fecha de cierre (gana la presentación más nueva). */
function periodos(units, asOf, unit, minDias, maxDias) {
  const arr = units?.[unit];
  if (!Array.isArray(arr)) return [];
  const q = arr.filter((x) => {
    if (!x.start || x.filed > asOf || !esEstadoFinanciero(x)) return false;
    const days = (new Date(x.end) - new Date(x.start)) / 86400000;
    return days >= minDias && days <= maxDias;
  });
  const byEnd = new Map();
  for (const x of q) { const e = byEnd.get(x.end); if (!e || x.filed > e.filed) byEnd.set(x.end, x); }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
}

/** Discrete ~quarter facts known by asOf, newest end first, deduped by period end. */
function quarters(units, asOf, unit = "USD") {
  return periodos(units, asOf, unit, 80, 100);
}

/** Ejercicios completos (~1 año). Es la única granularidad que publica un presentador 20-F:
 *  medido el 2026-08-22, SAP, ASML y Toyota no tienen NI UN periodo de 80-100 días. */
function anuales(units, asOf, unit = "USD") {
  return periodos(units, asOf, unit, 330, 400);
}
/** El instante completo, CON su fecha de cierre. Hace falta para poder exigir que dos
 *  magnitudes sean del mismo corte: comparar el activo de junio contra el pasivo de marzo no
 *  detecta un descuadre, lo inventa. */
function instantFull(units, asOf, unit = "USD") {
  const arr = units?.[unit];
  if (!Array.isArray(arr)) return null;
  const rows = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf && esEstadoFinanciero(x));
  if (!rows.length) return null;
  rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return { val: rows[0].val, end: rows[0].end, filed: rows[0].filed };
}

function instant(units, asOf, unit = "USD") {
  return instantFull(units, asOf, unit)?.val ?? null;
}

/**
 * TTM — DOCE MESES DE VERDAD, no cuatro trimestres cualesquiera.
 *
 * ⚠️ ESTA FUNCIÓN SE REESCRIBIÓ EL 2026-08-23 PORQUE LA ANTERIOR NO CALCULABA UN TTM.
 *
 * Sumaba `q.slice(skip, skip+4)` sobre los trimestres DISCRETOS ordenados por cierre, sin
 * comprobar que fueran consecutivos. Y no lo son casi nunca, por dos motivos estructurales
 * de cómo se presenta a la SEC:
 *
 *   · No existe el 10-Q del CUARTO trimestre fiscal: esa cifra va en el 10-K, y el trimestre
 *     suelto hay que derivarlo (ejercicio − nueve meses). Así que en ingresos y resultado
 *     falta un trimestre de cada cuatro, y la "ventana" saltaba al año anterior. Medido:
 *     Apple y Microsoft cubrían 454 días en vez de 365.
 *   · El estado de FLUJOS se presenta ACUMULADO. Los únicos periodos discretos de 80-100
 *     días son los primeros trimestres. Resultado: el "flujo de explotación TTM" de Apple
 *     sumaba el primer trimestre de 2026, 2025, 2024 y 2023 — **1.189 días** y 157,8 B,
 *     cuando lo real ronda 110-120 B. El de JPMorgan salía en −729 B.
 *
 * Afectaba a `operatingMargin`, `roic` y `grossProfitability`, que son TRES DE LAS CINCO
 * métricas de la señal de Scora Picks, además de a todos los ratios de valoración.
 *
 * LA FORMA CORRECTA, que es la que usa cualquiera que lea XBRL en serio:
 *
 *     TTM = acumulado del ejercicio en curso
 *         + ejercicio anterior completo
 *         − acumulado del ejercicio anterior hasta el mismo punto
 *
 * Sólo necesita periodos ACUMULADOS, que siempre están (son los que se presentan). Si no hay
 * acumulado posterior al último ejercicio cerrado, se usa el ejercicio completo tal cual —que
 * es lo correcto para un 20-F, que sólo presenta una vez al año.
 */

/**
 * SÓLO ESTADOS FINANCIEROS. Un `DEF 14A` no es un balance.
 *
 * `companyfacts` mezcla los hechos de TODOS los documentos que la empresa presenta, y algunos
 * etiquetan el mismo concepto y el mismo periodo con otra escala. Encontrado el 2026-08-24:
 *
 *   FedEx · NetIncomeLoss · 2025-06-01 → 2026-05-31
 *     · del 10-K  (presentado 2026-07-20):  4.433.000.000
 *     · del DEF 14A (presentado 2026-08-17):        4.433   ← en MILLONES
 *
 * El informe de retribuciones se presenta DESPUÉS del 10-K, así que la regla de «gana el más
 * reciente» se quedaba con el de 4.433 dólares. FedEx salía con un resultado de cuatro mil
 * dólares sobre 94.720 millones de ingresos, y un PER de cinco cifras. Medtronic, igual.
 *
 * No se puede arreglar mirando la magnitud —eso sería adivinar—: se arregla no leyendo cifras
 * de documentos que no son estados financieros.
 */
const FORMULARIOS_CONTABLES = /^(10-K|10-Q|20-F|40-F|6-K)/;
const esEstadoFinanciero = (x) => !x.form || FORMULARIOS_CONTABLES.test(x.form);

/** Todos los periodos de flujo visibles en `asOf`, deduplicados por (inicio, cierre). */
function hechosFlujo(fj, tags, asOf, cur) {
  const porClave = new Map();
  for (const t of tags) {
    const arr = facts(fj, t, null, cur)?.[cur];
    if (!Array.isArray(arr)) continue;
    for (const x of arr) {
      if (!x.start || x.filed > asOf || x.end > asOf) continue;
      if (!esEstadoFinanciero(x)) continue;
      const k = `${x.start}|${x.end}`;
      const prev = porClave.get(k);
      if (!prev || x.filed > prev.filed) porClave.set(k, x);
    }
  }
  return [...porClave.values()];
}

const DIA = 86400000;
const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / DIA);
const diaSiguiente = (f) => new Date(new Date(f + "T00:00:00Z").getTime() + DIA).toISOString().slice(0, 10);
/** Dos fechas "iguales" con holgura: los cierres fiscales de 52/53 semanas se mueven días. */
const cerca = (a, b, tol = 7) => a != null && b != null && Math.abs(dias(a, b)) <= tol;

/**
 * Devuelve los TTM sucesivos (el actual y los anteriores) a partir de periodos acumulados.
 * `n` es cuántos se piden hacia atrás: `skip=4` del código antiguo equivale al índice 1.
 */
export function ttmSerie(hechos, n = 2) {
  const anuales = hechos.filter((x) => { const d = dias(x.start, x.end); return d >= 330 && d <= 400; })
    .sort((a, b) => b.end.localeCompare(a.end));
  if (!anuales.length) return [];

  // Longitud del acumulado en curso: define en qué punto del ejercicio estamos, y hay que
  // usar la MISMA para el año anterior o la resta no compara lo mismo.
  const fy0 = anuales[0];
  const inicioSig = diaSiguiente(fy0.end);
  const enCurso = hechos
    .filter((x) => cerca(x.start, inicioSig) && x.end > fy0.end)
    .sort((a, b) => b.end.localeCompare(a.end))[0] ?? null;
  const L = enCurso ? dias(enCurso.start, enCurso.end) : null;

  const out = [];
  for (let k = 0; k < n; k++) {
    const fy = anuales[k];
    if (!fy) break;
    if (L == null) { out.push({ val: fy.val, end: fy.end, filed: fy.filed, periodicidad: "anual" }); continue; }
    const iniSig = diaSiguiente(fy.end);
    const acum = hechos.find((x) => cerca(x.start, iniSig) && Math.abs(dias(x.start, x.end) - L) <= 10);
    const acumPrev = hechos.find((x) => cerca(x.start, fy.start) && Math.abs(dias(x.start, x.end) - L) <= 10);
    if (!acum || !acumPrev) { out.push({ val: fy.val, end: fy.end, filed: fy.filed, periodicidad: "anual" }); continue; }
    out.push({
      val: acum.val + fy.val - acumPrev.val,
      end: acum.end,
      filed: [acum.filed, fy.filed].sort().pop(),
      periodicidad: "ttm",
    });
  }
  return out;
}

/**
 * SEGUNDA VÍA: cuatro trimestres discretos REALMENTE CONSECUTIVOS.
 *
 * Hace falta porque no todo el mundo etiqueta el ejercicio completo. Medido a 2019-03-01:
 * Kroger, Constellation Brands y Western Digital no publican ningún periodo anual en sus
 * tags de ingresos —sólo acumulados y trimestres—, así que la vía de acumulados no les sirve.
 *
 * La diferencia con lo que hacía el código antiguo es la comprobación de CONTINUIDAD: cada
 * trimestre tiene que empezar donde acaba el anterior. Sin ella se sumaban cuatro trimestres
 * cualesquiera, y como no existe el 10-Q del cuarto trimestre fiscal, la ventana saltaba al
 * año anterior y cubría 454 días en vez de 365.
 */
export function ttmDeTrimestres(hechos, n = 2) {
  const q = hechos.filter((x) => { const d = dias(x.start, x.end); return d >= 80 && d <= 100; })
    .sort((a, b) => b.end.localeCompare(a.end));
  const ventanas = [];
  for (let i = 0; i + 4 <= q.length; i++) {
    const s = q.slice(i, i + 4);
    let contiguo = true;
    for (let j = 0; j < 3; j++) if (!cerca(s[j].start, diaSiguiente(s[j + 1].end), 5)) { contiguo = false; break; }
    if (!contiguo) continue;
    ventanas.push({
      val: s.reduce((a, x) => a + x.val, 0),
      end: s[0].end,
      filed: s.map((x) => x.filed).sort().pop(),
      periodicidad: "trimestral",
    });
    if (ventanas.length >= n * 4) break;      // margen de sobra para elegir el de hace un año
  }
  if (!ventanas.length) return [];
  const out = [ventanas[0]];
  for (let k = 1; k < n; k++) {
    // El de hace k años: la ventana cuyo cierre esté ~365·k días antes que la primera.
    const objetivo = -365 * k;
    const cand = ventanas.slice(1).filter((v) => Math.abs(dias(ventanas[0].end, v.end) - objetivo) <= 20);
    if (!cand.length) break;
    out.push(cand[0]);
  }
  return out;
}

/**
 * `preferirMayor` — SÓLO para los ingresos, y por un motivo concreto.
 *
 * Mezclar los periodos de todos los tags en un conjunto único es lo que salva los cambios de
 * etiqueta (una empresa que pasó de `SalesRevenueGoodsNet` a `RevenueFromContractWithCustomer…`
 * en 2018 tiene el ejercicio viejo en un tag y el acumulado nuevo en otro, y hacen falta los
 * dos). Pero tiene un coste: cuando dos tags cubren el MISMO periodo con valores distintos, el
 * que gana lo decide la fecha de presentación, o sea el azar.
 *
 * Y en los REIT eso no es un empate cualquiera: bajo ASC 842 el grueso de sus ingresos es renta
 * de alquiler y el tag de ASC 606 recoge sólo la parte de servicios. Medido el 24-08-2026,
 * Essex Property salía con **10 M de ingresos** cuando su cifra real es **1.890 M**, y con ella
 * un margen bruto del 14.526 %. Camden, Extra Space, SBA, Healthpeak y American Tower, igual.
 *
 * La regla: entre candidatos IGUAL DE FRESCOS se coge el mayor. Un componente es por
 * definición más pequeño que el total, así que el máximo no puede ser un componente. Se aplica
 * únicamente a los ingresos: para el resultado o los flujos, "el mayor" no significa nada
 * —una pérdida grande no es mejor que una pequeña— y ahí manda el orden de la lista.
 */
function flowTTM(fj, tags, asOf, skip = 0, cur = "USD", permitirAnual = true, minEnd = null, preferirMayor = false) {
  const idx = skip / 4;
  if (!Number.isInteger(idx)) return null;
  const calcular = (ts) => {
    const hechos = hechosFlujo(fj, ts, asOf, cur);
    // Primero la vía de acumulados (la correcta y la que más cubre); si la empresa no publica
    // ejercicios completos, la de cuatro trimestres contiguos. Nunca una ventana descosida.
    let serie = ttmSerie(hechos, idx + 1);
    let x = serie[idx];
    if (!x) { serie = ttmDeTrimestres(hechos, idx + 1); x = serie[idx]; }
    return x ?? null;
  };
  let r = calcular(tags);
  if (preferirMayor) {
    // Se comparan el conjunto mezclado y cada tag por separado: lo primero cubre el cambio de
    // etiqueta, lo segundo evita quedarse con una rebanada.
    for (const t of tags) {
      const c = calcular([t]);
      if (!c) continue;
      if (!r || c.end > r.end || (c.end === r.end && c.val > r.val)) r = c;
    }
  }
  if (!r) return null;
  if (!permitirAnual && r.periodicidad === "anual") return null;
  if (minEnd && r.end < minEnd) return null;
  return { val: r.val, latestFiled: r.filed, latestEnd: r.end, periodicidad: r.periodicidad };
}

/**
 * ANTIGÜEDAD MÁXIMA de una magnitud respecto a lo último que la empresa publica.
 *
 * ⚠️ ESTE GUARDIÁN TAPA UN DEFECTO GRAVE Y REAL, no una posibilidad teórica.
 *
 * `flowTTM` se queda con la ventana de cierre MÁS RECIENTE entre los tags candidatos. Cuando
 * una empresa deja de etiquetar un concepto, la ventana "más reciente" de ESE concepto se
 * queda congelada en el año en que dejó de usarlo — y se seguía aceptando como si fuera de
 * hoy. Medido el 2026-08-22 sobre 497 nombres del índice:
 *
 *   · **Amazon** publicó `GrossProfit` por última vez en **2009**. El sistema calculaba su
 *     rentabilidad bruta sobre activos con 4,4 B de margen bruto de 2009 y 1.096 B de activo
 *     de 2026: **0,4 %**, y un margen bruto del **0,6 %**. Su cifra real ronda el 52 %
 *     (730 B de ingresos menos 353 B de coste, los dos del mismo cierre).
 *   · **Oracle** derivaba el margen restando un coste de ventas de **2011** de unos ingresos
 *     de 2026.
 *   · En total, 53 nombres con ingresos y coste desalineados más de tres años, y 63 con el
 *     margen bruto desalineado del activo.
 *
 * `grossProfitability` es UNA DE LAS CINCO MÉTRICAS de la señal de Scora Picks. O sea que el
 * mejor negocio del índice llevaba puntuando por los suelos, sin que nada fallara.
 *
 * 400 días = un ejercicio más un trimestre de holgura: cubre a quien presenta con retraso o
 * cambia de cierre fiscal, y descarta lo que lleva años sin actualizarse.
 */
const ANTIGUEDAD_MAX_DIAS = 400;

/** Resta días a un YYYY-MM-DD. */
function menosDias(fecha, dias) {
  const d = new Date(fecha + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}
/**
 * ⚠️ EL FILTRO DE ANTIGÜEDAD VA DENTRO DEL BUCLE, no después.
 *
 * Estaba fuera —se elegía el primer tag con valor y luego se descartaba si era rancio— y eso
 * hacía que un tag abandonado ENTERRARA a los que venían detrás. CVS tiene
 * `LongTermDebtNoncurrent` congelado en 2020 y `LongTermDebtAndCapitalLeaseObligations` al
 * día: se cogía el de 2020, se rechazaba por viejo, y nunca se llegaba al bueno. La empresa
 * acababa sin deuda. Air Products, Avery Dennison y Dominion, igual.
 *
 * Afectaba a TODOS los instantes —activo, patrimonio, caja, clientes—, no sólo a la deuda:
 * cualquier lista cuyo primer tag hubiera envejecido perdía los demás.
 */
function instTagFull(fj, tags, asOf, taxonomy = null, unit = "USD", minEnd = null) {
  for (const t of tags) {
    const v = instantFull(facts(fj, t, taxonomy, unit), asOf, unit);
    if (v == null) continue;
    if (minEnd && v.end < minEnd) continue;      // rancio: se sigue buscando, no se abandona
    return v;
  }
  return null;
}
function instTag(fj, tags, asOf, taxonomy = null, unit = "USD", minEnd = null) {
  return instTagFull(fj, tags, asOf, taxonomy, unit, minEnd)?.val ?? null;
}

// Sum instant share CLASSES at the latest filing (Google/Meta report A+C separately),
// deduping identical duplicate contexts by value. Returns null if none.
function sumInstantShares(units, asOf) {
  const arr = units?.shares;
  if (!Array.isArray(arr)) return null;
  const elig = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf);
  if (!elig.length) return null;
  const maxEnd = elig.reduce((m, x) => (x.end > m ? x.end : m), "");
  const atEnd = elig.filter((x) => x.end === maxEnd);
  const lf = atEnd.reduce((m, x) => (x.filed > m ? x.filed : m), "");
  const seen = new Set(); let sum = 0;
  for (const x of atEnd.filter((x) => x.filed === lf)) { const k = String(x.val); if (seen.has(k)) continue; seen.add(k); sum += x.val; }
  return sum || null;
}

/** Shares outstanding as-of: cover-page classes → weighted-avg diluted/basic → us-gaap classes. */
function sharesAsOf(fj, asOf) {
  const dei = sumInstantShares(facts(fj, "EntityCommonStockSharesOutstanding", "dei"), asOf);
  if (dei) return dei;
  for (const tag of ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]) {
    const q = quarters(facts(fj, tag), asOf, "shares");
    if (q.length) return q[0].val;
  }
  return sumInstantShares(facts(fj, "CommonStockSharesOutstanding"), asOf);
}

// ⚠️ LOS NOMBRES DE IFRS NO SE MEZCLAN AQUÍ, Y ESO NO ES ESTILO: ES UN FALLO YA COMETIDO.
//
// El primer intento (2026-08-22) metió los tags de IFRS al final de estas mismas listas,
// creyendo que "para un estadounidense no existen". Falso: `ProfitLoss` **también es un tag de
// us-gaap**, y significa otra cosa —resultado INCLUYENDO minoritarios, frente a
// `NetIncomeLoss`, que es el atribuible a la matriz—. Como `flowTTM` se queda con la ventana
// de cierre más reciente y no con el primer tag de la lista, se coló en utilities y REITs:
// midiendo, movió el ROE de Ameren de 6,85 a 10,76 y el de American Tower de 89,8 a 43,8.
// Nada falló; sólo cambiaron 509 métricas ya publicadas.
//
// Por eso las dos taxonomías viven separadas y la de IFRS **sólo se consulta si la empresa
// presenta en IFRS**. Mismo criterio que el resto del repositorio: un cambio que no rompe pero
// miente es peor que uno que rompe.
// ⚠️ EL ORDEN ES EL DESEMPATE. `flowTTM` se queda con la ventana de cierre más reciente y, a
// igualdad, con el PRIMER tag de la lista. Por eso "excluyendo impuestos repercutidos" va
// antes que "incluyéndolos": es la medida limpia y la que ya usaba el repositorio.
//
// Los dos últimos se añadieron el 2026-08-22 y tapan un hueco que llevaba años abierto. Se
// descubrió al poner el guardián de antigüedad: 18 nombres del índice se quedaron de golpe
// SIN ingresos, y resultó que no era el guardián sino que ninguno de los cinco tags de
// entonces seguía vivo para ellos. Duke Energy no etiqueta `Revenues` desde 2012 y TJX no
// usa `SalesRevenueNet` desde 2018; lo que publican hoy es esto. Mientras el dato rancio se
// aceptaba, el hueco no se veía —se usaban ingresos de 2017 con activos de 2025—.
const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating",
             "RevenueFromContractWithCustomerIncludingAssessedTax",  // 15 de los 18 recuperados
             "RegulatedAndUnregulatedOperatingRevenue",              // eléctricas: DUK, NEE, DTE, XEL
             // ── Era anterior a ASC 606 (2018). Imprescindibles: la ventana 2011-2018 del
             // backtest corre ENTERA en esa era, y sin estos tags empresas como Kroger o
             // Constellation Brands no tienen ni un ejercicio anual con el que formar un TTM.
             // Como `hechosFlujo` mezcla los periodos de TODOS los tags en un solo conjunto,
             // el cambio de etiqueta de 2018 se salva solo: el acumulado nuevo y el ejercicio
             // viejo conviven sin que haya que decidir cuál "gana".
             "SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RealEstateRevenueNet",
             // ── AL FINAL DE LA LISTA, y el sitio es la mitad de la decisión ────────────────
             //
             // `OilAndGasRevenue` es la línea de ingresos de las petroleras antes de ASC 606:
             // `CXO` desde 2008, `QEP` desde 2009, `FANG` desde 2010, y `PXD`, `MRO` y `APA`
             // con historia que los tags estándar no alcanzan. Justo la ventana 2011-2018.
             //
             // ⚠️ Pero NO rescata a nadie de quedarse sin ingresos, y conviene decirlo porque
             // yo mismo llegué a llamarlo «probablemente la vía más rentable que queda».
             // Medido sobre 28 energéticas: CERO dependen sólo de este tag — todas tienen
             // alguno estándar. Lo único que hace es PROFUNDIZAR la historia de ~6 nombres en
             // la ventana antigua. Es una mejora pequeña y acotada, no un arreglo.
             //
             // Va el último a propósito: así sólo actúa donde no hay nada mejor y no puede
             // desplazar a un tag estándar en las fechas que ya cubría.
             "OilAndGasRevenue",
             // Ingresos de gestoras y broker-dealers, tambien al final. BlackRock lo usa desde
             // 2007 y es lo unico que cubre su historia anterior a 2016: su CIK predecesor tiene
             // balance desde 2008 pero los tags estandar de ingresos no arrancan hasta 2016.
             "RevenuesExcludingInterestAndDividends"];

/**
 * SEGUNDO RECURSO para los ingresos: sólo se consulta si `REV` no ha dado NADA.
 *
 * No está en la lista principal a propósito. `OperatingLeaseLeaseIncome` son los ingresos por
 * arrendamiento, que en un REIT como Equity Residential SON la cifra de negocio, pero en una
 * empresa cualquiera que además alquile algo son una partida menor. Y como `flowTTM` se queda
 * con la ventana de cierre más reciente, bastaría con que esa partida menor fuera un trimestre
 * más fresca que los ingresos de verdad para que pasara a hacer de "ingresos" — sin error y
 * con un número creíble. Consultándolo sólo cuando no hay otra cosa, ese riesgo desaparece.
 */
const REV2 = ["OperatingLeaseLeaseIncome"];
// `ProfitLoss` NO es sólo IFRS: en US GAAP es el resultado INCLUYENDO minoritarios, y hay
// bancos grandes que sólo etiquetan ese. PNC dejó `NetIncomeLoss` en 2014 y Truist en 2009;
// los dos siguen publicando `ProfitLoss` cada trimestre. Sin esta línea se quedaban sin
// resultado —y antes del guardián de antigüedad era peor: puntuaban con el beneficio de 2014—.
// El orden es el desempate: primero lo atribuible a la matriz, que es la medida estándar.
const NI = ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"];
const GP = ["GrossProfit"];
const COST = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"];
const OI = ["OperatingIncomeLoss"];
/**
 * Gastos de explotación, SÓLO para reconstruir el OI cuando la empresa no lo etiqueta.
 *
 * ⚠️ `CostsAndExpenses` NO vale aquí aunque lo parezca: son los costes TOTALES, coste de
 * ventas incluido, así que restarlo del margen bruto lo descuenta dos veces. Medido: producía
 * desvíos de −2.368 % en Centene y −665 % en Darden. Un tag que suena parecido y significa
 * otra cosa es exactamente la forma de error que este fichero lleva toda la vida cazando.
 */
const OPEX = ["OperatingExpenses"];
const DA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"];
const INT = ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense"];
const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
const CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];

/**
 * Equivalencias en `ifrs-full`, que se AÑADEN sólo a los presentadores que usan esa taxonomía.
 *
 * Los nombres NO están sacados del diccionario de IFRS: están comprobados uno a uno contra lo
 * que Shell, SAP y Toyota publican de verdad (2026-08-22). La diferencia importa, porque IFRS
 * deja mucho más a elección del que presenta que US GAAP:
 *
 *   · **No hay subtotal de explotación obligatorio.** SAP y Toyota etiquetan
 *     `ProfitLossFromOperatingActivities`; **Shell no lo tiene**, sólo `ProfitLossBeforeTax`.
 *     Y ése NO se pone aquí como sustituto: el resultado antes de impuestos va después de
 *     intereses y de resultados no recurrentes, así que llamarlo margen operativo sería
 *     inventar un número creíble. Shell se queda sin margen de explotación, y bien.
 *   · **Ni margen bruto.** Shell y Toyota no publican `CostOfSales` ni `GrossProfit`.
 *   · `Equity` incluye minoritarios y `EquityAttributableToOwnersOfParent` no. Se pide primero
 *     el atribuible a la matriz para que case con `StockholdersEquity` de US GAAP, que es lo
 *     que ya usa el resto del repositorio.
 */
const IFRS = {
  REV: ["Revenue", "RevenueFromContractsWithCustomers"],
  NI: ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss"],
  COST: ["CostOfSales"],
  OI: ["ProfitLossFromOperatingActivities"],
  DA: ["DepreciationAndAmortisationExpense", "AdjustmentsForDepreciationAndAmortisationExpense"],
  INT: ["FinanceCosts"],
  OCF: ["CashFlowsFromUsedInOperatingActivities"],
  CAPEX: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
  ICF: ["CashFlowsFromUsedInInvestingActivities"],
  FCF_: ["CashFlowsFromUsedInFinancingActivities"],
  DCASH: ["IncreaseDecreaseInCashAndCashEquivalents"],
  DIV: ["DividendsPaidClassifiedAsFinancingActivities"],
  SGA: ["AdministrativeExpense"],
  RECV: ["CurrentTradeReceivables", "TradeAndOtherCurrentReceivables"],
  PPE: ["PropertyPlantAndEquipment"],
  INV: ["Inventories"],
  NCI: ["NoncontrollingInterests"],
  EQUITY: ["EquityAttributableToOwnersOfParent", "Equity"],
  CASH: ["CashAndCashEquivalents"],
  CURA: ["CurrentAssets"], CURL: ["CurrentLiabilities"],
  LTD: ["NoncurrentPortionOfNoncurrentBorrowings", "Borrowings"],
  LTDC: ["CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings"],
  LIAB: ["Liabilities"], GP: ["GrossProfit"],
};

// ── Fase F1/F2 (2026-08-22) — lo que piden la capa de integridad contable y los modelos
// forenses (Beneish, Piotroski completo, articulación de caja y patrimonio). Cobertura medida
// sobre las 586 empresas en caché; está anotada porque un modelo que exige TODAS sus entradas
// sólo existe donde están todas: Beneish sale en el 37,5 % del índice y en el 8 % de la banca.
const ICF = ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"];
const FCF_ = ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"];
// DOS TAGS QUE NO SIGNIFICAN LO MISMO, y mezclarlos rompe la identidad de la caja: uno
// INCLUYE el efecto del tipo de cambio sobre los saldos y el otro lo EXCLUYE. Si se suma el
// efecto al que ya lo lleva, se corrige dos veces. Se extraen por separado para que
// `lib/articulacion.ts` compare cada uno contra el lado que le corresponde.
const DCASH_CON_FX = ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect"];
const DCASH_SIN_FX = ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseExcludingExchangeRateEffect",
                      "CashAndCashEquivalentsPeriodIncreaseDecrease",
                      "IncreaseDecreaseInCashAndCashEquivalents"];
// El CUARTO sumando del estado de flujos, y sin él la identidad de la caja NO cierra. Los tres
// flujos (explotación, inversión, financiación) están en la moneda funcional; el saldo de caja
// incluye además lo que el tipo de cambio hace con los saldos en divisa, que no es un flujo de
// nadie. El tag de variación que usa Scora es justo el que dice "IncludingExchangeRateEffect",
// así que la diferencia era exactamente este importe. Lo publican el 74,5 % de las empresas.
// Es el MISMO error que los intereses minoritarios en el balance, cometido dos veces: una
// comprobación de integridad mal planteada no detecta problemas, los fabrica.
const FX = ["EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
            "EffectOfExchangeRateOnCashAndCashEquivalents", "EffectOfExchangeRateOnCash"];
const DIV = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"];
const BUYB = ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"];
const SGA = ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"];
const RND = ["ResearchAndDevelopmentExpense"];
const SBC = ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"];
const RECV = ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsReceivableGrossCurrent"];
const PPE = ["PropertyPlantAndEquipmentNet"];
// ── Ensayo 343: lo que hace falta para la vida util implicita y el precio de recompra ──────
// El inmovilizado BRUTO —no el neto— porque la vida util implicita es bruto/depreciacion: con
// el neto, una empresa con activos muy depreciados pareceria tener vida util corta cuando lo
// que pasa es que son viejos. Y las ACCIONES recompradas, que con el importe dan el precio
// medio al que la directiva compro. Ninguno de los dos estaba, asi que las dos medidas no eran
// point-in-time y no se podian probar.
const PPEG = ["PropertyPlantAndEquipmentGross"];
const DEPSOLA = ["Depreciation"];
const AMORTINT = ["AmortizationOfIntangibleAssets", "AmortizationOfIntangibleAssetsExcludingFinancingCosts"];
const SHREP = ["TreasuryStockSharesAcquired", "StockRepurchasedDuringPeriodShares", "StockRepurchasedAndRetiredDuringPeriodShares"];
const INV = ["InventoryNet"];
const GW = ["Goodwill"];
// ── Fase F4 (2026-08-23) — el juego de métricas propio de BANCA y SEGUROS ────────────────
// Un banco no presenta balance clasificado: no tiene activo corriente ni coste de ventas
// porque su negocio no funciona así. Aplicarle el modelo industrial no es difícil, es
// incorrecto — de ahí que 0 de 18 bancos lleguen a puntuar hoy (§2ter). Estos son los tags
// con los que SÍ se les juzga. Cobertura medida (`research/banca_cobertura.mjs`, 2026-08-01):
// en banca comercial, margen de intereses, comisiones, gastos de explotación y depósitos
// están al 100 %; la calidad crediticia se queda en el 40 % y la solvencia regulatoria en el
// 30 %, así que ESAS DOS NO SE CONSTRUYEN. En seguros, primas y siniestralidad ~80 %.
const NII    = ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"];
const INTINC = ["InterestAndDividendIncomeOperating", "InterestIncomeOperating"];
const NONINT_INC = ["NoninterestIncome", "FeesAndCommissions"];
const NONINT_EXP = ["NoninterestExpense"];
const DEPOS  = ["Deposits", "InterestBearingDepositLiabilities"];
const LOANS  = ["FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss",
                "LoansAndLeasesReceivableNetReportedAmount",
                "FinancingReceivableBeforeAllowanceForCreditLossNoncurrent"];
const ALLOW  = ["FinancingReceivableAllowanceForCreditLosses",
                "FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest",
                "LoansAndLeasesReceivableAllowance"];
const PREMS  = ["PremiumsEarnedNet", "PremiumsEarnedNetPropertyAndCasualty", "PremiumsWritten"];
const CLAIMS = ["PolicyholderBenefitsAndClaimsIncurredNet", "IncurredClaimsPropertyCasualtyAndLiability"];
const ACQC   = ["DeferredPolicyAcquisitionCostAmortizationExpense"];

const LIAB = ["Liabilities"];

/**
 * PATRIMONIO TEMPORAL (mezzanine) — el tercer sumando que faltaba en la identidad del balance.
 *
 * US GAAP obliga a presentar FUERA del patrimonio permanente las participaciones que el socio
 * minoritario puede obligar a recomprar (minoritarios rescatables, acciones rescatables). No
 * son pasivo ni patrimonio: van en medio. La identidad completa es
 *
 *     Activo = Pasivo + patrimonio temporal + Patrimonio + minoritarios
 *
 * Sin este término descuadraban DaVita, S&P Global, T. Rowe Price y Henry Schein por el
 * importe exacto de esa línea, estando bien. Es la TERCERA brecha de definición de esta misma
 * comprobación —después de los minoritarios y del efecto del tipo de cambio en la caja—, y
 * las tres enseñan lo mismo: el fallo estaba en la comprobación, no en los datos.
 */
const TEMPEQ = ["TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests",
                "RedeemableNoncontrollingInterestEquityCarryingAmount",
                "TemporaryEquityCarryingAmountAttributableToParent",
                "RedeemableNoncontrollingInterestEquityFairValue"];
const NCI = ["MinorityInterest", "StockholdersEquityAttributableToNoncontrollingInterest"];
const EQUITY = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"];

/**
 * TTM DE VARIAS MAGNITUDES SOBRE UN CIERRE COMÚN.
 *
 * `fundamentalsAsOf` elige para cada tag su ventana más reciente, que es lo correcto para no
 * perder un dato bueno por culpa de otro que va retrasado. Pero hay cuentas que RESTAN dos
 * magnitudes, y ahí eso deja de valer: los devengos de Sloan son (resultado − flujo de
 * explotación), y medido el 2026-08-22 esas dos sólo comparten cierre en el 47 % de los
 * nombres, con una mediana de desfase de 91 días — justo un trimestre.
 *
 * La causa no es un fallo: el estado de flujos se presenta ACUMULADO en el ejercicio, así que
 * los trimestres sueltos de caja aparecen con menos frecuencia que los de resultado. Restar
 * un resultado de doce meses cerrados en junio de un flujo de doce meses cerrados en marzo no
 * da un devengo: da un devengo más un trimestre de deriva.
 *
 * Esta función busca el cierre MÁS RECIENTE en el que TODAS las magnitudes pedidas tienen sus
 * cuatro trimestres, y las devuelve ahí. Prefiere perder frescura antes que comparar dos
 * fotos distintas. Si no hay ningún cierre común, devuelve null: no hay dato, y decirlo es
 * mejor que inventar uno creíble.
 */
export async function ttmAlineado(cik, asOf, grupos) {
  const fj = await companyFacts(cik);
  if (!fj) return null;
  const cur = reportingCurrency(fj) ?? "USD";
  const usaIFRS = !!fj?.facts?.["ifrs-full"];

  // Para cada grupo, el conjunto de cierres en los que tiene cuatro trimestres consecutivos
  // disponibles, con el valor ya sumado.
  const porGrupo = {};
  for (const [nombre, spec] of Object.entries(grupos)) {
    const tags = usaIFRS && spec.ifrs ? [...spec.tags, ...spec.ifrs] : spec.tags;
    const mapa = new Map();
    for (const t of tags) {
      const q = quarters(facts(fj, t, null, cur), asOf, cur);
      for (let i = 0; i + 4 <= q.length; i++) {
        const s = q.slice(i, i + 4);
        // Los cuatro tienen que ser consecutivos de verdad: cuatro trimestres con un hueco en
        // medio suman trece o quince meses y se parecen mucho a un TTM sin serlo.
        const span = (new Date(s[0].end) - new Date(s[3].start)) / 86400000;
        if (span < 330 || span > 400) continue;
        if (!mapa.has(s[0].end)) mapa.set(s[0].end, s.reduce((a, x) => a + x.val, 0));
      }
    }
    porGrupo[nombre] = mapa;
  }

  const nombres = Object.keys(grupos);
  if (!nombres.length) return null;
  const comunes = [...porGrupo[nombres[0]].keys()]
    .filter((e) => nombres.every((n) => porGrupo[n].has(e)))
    .sort();
  const end = comunes[comunes.length - 1];
  if (!end) return null;
  const out = { end, currency: cur };
  for (const n of nombres) out[n] = porGrupo[n].get(end);
  return out;
}

/** Full point-in-time fundamentals for `cik` as known on `asOf` (YYYY-MM-DD). */
export async function fundamentalsAsOf(cik, asOf) {
  const fj = await companyFacts(cik);
  if (!fj) return null;
  // Se DETECTA la moneda; no se supone. Si no hay ninguna reconocible se cae a USD, que es lo
  // que hacía antes: así un fichero raro se comporta como siempre en vez de desaparecer.
  const cur = reportingCurrency(fj) ?? "USD";

  // Las DOS decisiones que separan el camino de siempre del camino nuevo. Ambas se toman una
  // vez por empresa y con datos, no por tag y a ojo:
  //   · `usaIFRS`      — ¿tiene realmente hechos en `ifrs-full`? Si no, sus tags ni se miran.
  //   · `esTrimestral` — ¿publica al menos cuatro trimestres de ingresos? Si sí, la vía anual
  //                      queda desactivada y su resultado es idéntico al de antes, bit a bit.
  const usaIFRS = !!fj?.facts?.["ifrs-full"];
  const T = (gaap, clave) => (usaIFRS && IFRS[clave] ? [...gaap, ...IFRS[clave]] : gaap);

  // ── EL ANCLA ────────────────────────────────────────────────────────────────────────────
  // Primero se averigua HASTA CUÁNDO informa esta empresa, mirando los tres flujos que
  // prácticamente todo el mundo etiqueta. Todo lo demás tiene que ser de esa época; si una
  // magnitud lleva años congelada, se descarta en vez de mezclarla con las actuales.
  const crudo = (tags) => flowTTM(fj, tags, asOf, 0, cur, true, null);
  const ancla = [crudo(T(REV, "REV")), crudo(T(NI, "NI")), crudo(T(OCF, "OCF"))]
    .filter(Boolean).map((x) => x.latestEnd).sort().pop() ?? null;
  // Para `skip` (el TTM de hace N trimestres) el listón baja lo que corresponda: pedirle a la
  // ventana del año pasado que sea tan reciente como la de hoy la eliminaría siempre.
  const suelo = (skip) => (ancla ? menosDias(ancla, ANTIGUEDAD_MAX_DIAS + (skip / 4) * 365) : null);

  /**
   * PRIORIDAD: cuatro trimestres FRESCOS › un ejercicio FRESCO › nada. Nunca algo rancio.
   *
   * El orden importa y la vía anual ya no está reservada a las extranjeras. Medido: Duke
   * Energy dejó de publicar ingresos trimestrales discretos en 2017 y NextEra en 2013, pero
   * las dos siguen presentando su 10-K cada año. Con la vía anual restringida, el guardián de
   * antigüedad las dejaba sin ingresos y desaparecían del universo — 45 nombres, un 12 % del
   * índice. Con ella, se les lee el ejercicio completo, que es fresco y correcto.
   *
   * Como `flowTTM` prueba SIEMPRE los trimestres primero, quien los tenga frescos no llega
   * nunca a la vía anual: para la inmensa mayoría no cambia nada.
   */
  const F = (tags, skip = 0) => flowTTM(fj, tags, asOf, skip, cur, true, suelo(skip));
  // ⚠️ Las ACCIONES no estan en USD. `F` busca en la moneda de la empresa y por eso devolvia
  // null para el recuento de acciones recompradas: no fallaba, no encontraba. Ensayo 343.
  const FSH = (tags, skip = 0) => flowTTM(fj, tags, asOf, skip, "shares", true, suelo(skip));
  // Un instante de balance rancio es igual de tóxico que un flujo rancio: el activo de 2026
  // contra el pasivo de 2013 no es un descuadre de la empresa, es un dato muerto. El suelo se
  // PASA A LA BÚSQUEDA para que un tag envejecido no entierre a los siguientes.
  const sueloInst = ancla ? menosDias(ancla, ANTIGUEDAD_MAX_DIAS) : null;
  const IF_ = (tags) => instTagFull(fj, tags, asOf, null, cur, sueloInst);
  const I = (tags) => IF_(tags)?.val ?? null;

  /**
   * El mismo instante UN AÑO ANTES, tal y como se conoce HOY.
   *
   * Beneish y Piotroski comparan cada magnitud contra su valor del ejercicio anterior. Se
   * podría sacar volviendo a llamar a `fundamentalsAsOf` con la fecha de hace un año, que es
   * lo que hacía `backtest.mjs`, pero eso mete un retraso de más: usa la foto que se conocía
   * entonces en vez de la comparativa que la propia empresa publica hoy. Cogiendo el instante
   * anterior dentro de las presentaciones ya disponibles se compara lo mismo que compara el
   * 10-K, y sigue sin haber look-ahead porque todo cumple `filed <= asOf`.
   */
  const IPREV = (tags) => {
    const actual = IF_(tags);
    if (!actual) return null;
    const techo = menosDias(actual.end, 300);         // el cierre de hace ~un año o antes
    for (const t of tags) {
      const u = facts(fj, t, null, cur)?.[cur];
      if (!Array.isArray(u)) continue;
      const filas = u.filter((x) => !x.start && x.filed <= asOf && x.end <= techo);
      if (!filas.length) continue;
      filas.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
      // Sólo vale si de verdad es de hace un año, no de hace cinco.
      if (dias(filas[0].end, actual.end) > 450) continue;
      return filas[0].val;
    }
    return null;
  };

  // Los ingresos se piden con `preferirMayor`: ver el comentario de `flowTTM`.
  const FR = (tags, skip) => flowTTM(fj, tags, asOf, skip, cur, true, suelo(skip), true);
  // REV2 entra AQUÍ, junto a los demás, y no como segundo recurso. Se separó cuando el
  // desempate lo decidía el azar: `OperatingLeaseLeaseIncome` son los ingresos de verdad de un
  // REIT pero una partida menor en cualquier otra empresa, y bastaba con que fuera un trimestre
  // más fresca para pasar a hacer de "ingresos". Con `preferirMayor` ese riesgo desaparece: en
  // una empresa normal el alquiler nunca va a ser mayor que la cifra de negocio, y en un REIT
  // sí lo es porque es la cifra de negocio. Camden Property salía con 10 M en vez de 1.570 M.
  const TODOS_REV = [...T(REV, "REV"), ...REV2];
  const rev = FR(TODOS_REV, 0);
  const revP = FR(TODOS_REV, 4);
  const ni = F(T(NI, "NI")), niP = F(T(NI, "NI"), 4);
  let gp = F(T(GP, "GP"));
  const cost = F(T(COST, "COST"));
  // El margen bruto derivado sólo lleva fecha si los dos sumandos son del MISMO cierre. Si no,
  // el valor se sigue calculando —era el comportamiento previo y hay ratios que dependen de
  // él— pero se marca sin periodo, y la capa de articulación lo tratará como no comprobable
  // en lugar de darlo por bueno. `research/desfase_periodos.mjs` mide cuántos son.
  if (gp == null && rev != null && cost != null) {
    gp = { val: rev.val - cost.val, latestEnd: rev.latestEnd === cost.latestEnd ? rev.latestEnd : null };
  }
  /**
   * RESULTADO DE EXPLOTACIÓN, Y DE DÓNDE SALE.
   *
   * `OperatingIncomeLoss` falta en el 22 % del índice —JNJ, XOM, IBM, CVX, PFE…— y de él
   * cuelgan CUATRO de las cinco métricas de la señal: `roic`, `opm`, `icov` y, vía EBITDA,
   * `lev`. Un solo campo ausente deja al nombre en 1 de 5 y por debajo del mínimo.
   *
   * ⚠️ LO QUE ESAS EMPRESAS SÍ ETIQUETAN NO SIRVE, y por poco no lo uso. Publican
   * `IncomeLossFromContinuingOperationsBeforeIncomeTaxes…`, que es resultado ANTES DE
   * IMPUESTOS: usarlo convertiría `opm` en margen pretax y dejaría `icov` incoherente, porque
   * los intereses ya están restados del numerador. La reconstrucción aritméticamente correcta
   * —pretax + intereses— se midió sobre las 406 empresas que publican las dos cosas y **se
   * rechazó**: desvío mediano del 7,6 % y, lo que la mata, **36 pp de dispersión entre
   * sectores** (3,8 % en consumo defensivo contra 39,9 % en telecos, 14,4 % en utilities).
   * Un sesgo que depende del sector no se puede corregir: cambiaría un hueco conocido por una
   * cobertura sesgada, que es peor. Ver `research/ebit_reconstruccion.mjs`.
   *
   * Lo que sí se acepta se queda DENTRO de la sección de explotación, donde la aritmética es
   * la de la propia cuenta de resultados: 96 % de acierto dentro del ±5 % por la vía del
   * bruto y 91 % por la de ingresos. Rescata poco —14 y 22 nombres de los 145 que no llegan,
   * porque los demás tampoco etiquetan los gastos de explotación— pero lo que rescata, lo
   * rescata bien. Los 122 restantes, casi la mitad financieras, no se arreglan por aquí.
   *
   * Y se exige que los sumandos sean del MISMO cierre, cosa que la derivación de `gp` de
   * arriba no exige: un margen bruto descuadrado estropea una métrica, y un OI descuadrado
   * estropea cuatro.
   */
  let oi = F(T(OI, "OI"));
  let oiFuente = oi != null ? "tag" : null;
  if (oi == null) {
    const opex = F(T(OPEX, "OPEX"));
    if (opex != null) {
      if (gp != null && gp.latestEnd != null && gp.latestEnd === opex.latestEnd) {
        oi = { val: gp.val - opex.val, latestEnd: gp.latestEnd };
        oiFuente = "bruto-menos-opex";
      } else if (rev != null && cost != null && rev.latestEnd === cost.latestEnd && cost.latestEnd === opex.latestEnd && rev.latestEnd != null) {
        oi = { val: rev.val - cost.val - opex.val, latestEnd: rev.latestEnd };
        oiFuente = "ingresos-menos-coste-menos-opex";
      }
    }
  }
  const da = F(T(DA, "DA")), intp = F(T(INT, "INT"));
  const ocf = F(T(OCF, "OCF")), capex = F(T(CAPEX, "CAPEX"));

  const equityI = IF_(T(EQUITY, "EQUITY")), equity = equityI?.val ?? null;
  /**
   * DEUDA — y la ausencia se dice, no se rellena con un cero.
   *
   * Estaba escrito `(largo ?? 0) + (corto ?? 0)`, así que **no encontrar el tag se convertía en
   * "esta empresa no tiene deuda"**. Medido el 24-08-2026: 136 de 497 nombres del índice
   * salían con deuda exactamente cero, y de los primeros 40 revisados, **34 sí tenían
   * conceptos de deuda vivos** — entre ellos CVS (253 B de activo), Cigna (157 B) y Dominion
   * (118 B). De ahí salían un `debtEquity` de 0, un `netDebtEbitda` NEGATIVO (o sea, caja neta)
   * y un `roic` inflado por un capital invertido que sólo contaba el patrimonio.
   *
   * `netDebtEbitda` es UNA DE LAS CINCO MÉTRICAS de la señal de Scora Picks, y la mejor
   * deuda posible puntúa alto. Un cuarto del universo estaba cobrando esa nota gratis.
   *
   * Se buscan más conceptos y, si no aparece ninguno, el resultado es `null`: sin dato no hay
   * ratio, que es incómodo pero cierto. Las obligaciones por arrendamiento NO se cuentan: bajo
   * ASC 842 están en balance, pero meterlas cambiaría la definición de la métrica a mitad de
   * un track record.
   */
  const deudaTotal = I(["DebtLongtermAndShorttermCombinedAmount"]);
  const ltd = I(T(["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations",
                   "SeniorNotesNoncurrent", "SeniorNotes", "NotesPayableNoncurrent",
                   "ConvertibleDebtNoncurrent", "UnsecuredDebt", "SecuredDebt"], "LTD"));
  const ltdC = I(T(["LongTermDebtCurrent", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent",
                    "NotesPayableCurrent", "ShortTermBorrowings", "OtherShortTermBorrowings",
                    "CommercialPaper"], "LTDC"));
  const deuda = deudaTotal ?? (ltd == null && ltdC == null ? null : (ltd ?? 0) + (ltdC ?? 0));
  const cfi = F(T(ICF, "ICF")), cff = F(T(FCF_, "FCF_")), fx = F(FX);
  const dcashCon = F(DCASH_CON_FX), dcashSin = F(DCASH_SIN_FX);
  const dcash = dcashCon ?? dcashSin;
  const div = F(T(DIV, "DIV")), buyb = F(BUYB);
  const assetsI = IF_(["Assets"]), liabI = IF_(T(LIAB, "LIAB")), nciI = IF_(T(NCI, "NCI")), tempI = IF_(TEMPEQ);

  return {
    revTTM: rev?.val ?? null, revPrevTTM: revP?.val ?? null,
    niTTM: ni?.val ?? null, niPrevTTM: niP?.val ?? null,
    gpTTM: gp?.val ?? null, oiTTM: oi?.val ?? null, oiFuente,
    daTTM: da?.val ?? null, interestTTM: intp?.val != null ? Math.abs(intp.val) : null,
    ocfTTM: ocf?.val ?? null, capexTTM: capex?.val != null ? Math.abs(capex.val) : null,
    assets: assetsI?.val ?? null, equity,
    curA: I(T(["AssetsCurrent"], "CURA")), curL: I(T(["LiabilitiesCurrent"], "CURL")),
    cash: I(T(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"], "CASH")),
    debt: deuda,
    // Fase 7 additions for the quality/credit rankers (Altman Z, DuPont 5-factor).
    retainedEarnings: I(["RetainedEarningsAccumulatedDeficit"]),
    pretaxIncome: F(["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"])?.val ?? null,
    shares: sharesAsOf(fj, asOf),
    asOfLatestFiling: rev?.latestFiled ?? ni?.latestFiled ?? null,

    // ── Fase F1 · integridad contable (la partida doble como test de datos) ──────────────
    liabilities: liabI?.val ?? null, minorityInterest: nciI?.val ?? null,
    temporaryEquity: tempI?.val ?? null,
    costTTM: cost?.val ?? null,
    cfiTTM: cfi?.val ?? null, cffTTM: cff?.val ?? null, deltaCashTTM: dcash?.val ?? null,
    deltaCashConFxTTM: dcashCon?.val ?? null, deltaCashSinFxTTM: dcashSin?.val ?? null,
    fxCashTTM: fx?.val ?? null,
    dividendsTTM: div?.val != null ? Math.abs(div.val) : null,
    buybacksTTM: buyb?.val != null ? Math.abs(buyb.val) : null,

    // ── Fase F2 · entradas de los modelos forenses ──────────────────────────────────────
    receivables: I(T(RECV, "RECV")), ppe: I(T(PPE, "PPE")), inventory: I(T(INV, "INV")), goodwill: I(GW),
    // Ensayo 343. `ppeGross` e `depSola`/`amortInt` para la vida util; `sharesRepurchasedTTM`
    // para el precio de recompra. Todos degradan a null si la empresa no los etiqueta.
    ppeGross: I(PPEG),
    depSolaTTM: F(DEPSOLA, 4)?.val ?? null,
    amortIntTTM: F(AMORTINT, 4)?.val ?? null,
    sharesRepurchasedTTM: FSH(SHREP, 4)?.val ?? null,

    // ── Fase F4 · banca y seguros ────────────────────────────────────────────────────────
    niiTTM: F(NII)?.val ?? null,
    intIncTTM: F(INTINC)?.val ?? null,
    nonIntIncTTM: F(NONINT_INC)?.val ?? null,
    nonIntExpTTM: F(NONINT_EXP)?.val ?? null,
    deposits: I(DEPOS), loans: I(LOANS), loanAllowance: I(ALLOW),
    premiumsTTM: F(PREMS)?.val ?? null,
    claimsTTM: F(CLAIMS)?.val ?? null,
    acqCostTTM: F(ACQC)?.val ?? null,
    sgaTTM: F(T(SGA, "SGA"))?.val ?? null, rndTTM: F(RND)?.val ?? null, sbcTTM: F(SBC)?.val ?? null,

    // ── Fase F3 · el ejercicio ANTERIOR, para Beneish y Piotroski ────────────────────────
    // Los flujos vienen de `skip = 4` (mismo criterio, una ventana atrás) y los instantes del
    // cierre de hace ~un año. Ambos con `filed <= asOf`: no hay look-ahead por ningún lado.
    prev: {
      revTTM: revP?.val ?? null,
      niTTM: niP?.val ?? null,
      gpTTM: (() => { const g2 = F(GP, 4); const c2 = F(T(COST, "COST"), 4);
                      return g2?.val ?? (revP && c2 ? revP.val - c2.val : null); })(),
      costTTM: F(T(COST, "COST"), 4)?.val ?? null,
      ocfTTM: F(T(OCF, "OCF"), 4)?.val ?? null,
      sgaTTM: F(T(SGA, "SGA"), 4)?.val ?? null,
      daTTM: F(T(DA, "DA"), 4)?.val ?? null,
      assets: IPREV(["Assets"]),
      equity: IPREV(T(EQUITY, "EQUITY")),
      curA: IPREV(["AssetsCurrent"]), curL: IPREV(["LiabilitiesCurrent"]),
      receivables: IPREV(T(RECV, "RECV")), ppe: IPREV(T(PPE, "PPE")), ppeGross: IPREV(PPEG),
      inventory: IPREV(T(INV, "INV")),
      debt: (() => { const a = IPREV(["LongTermDebtNoncurrent", "LongTermDebt"]);
                     const b = IPREV(["LongTermDebtCurrent", "DebtCurrent"]);
                     return a == null && b == null ? null : (a ?? 0) + (b ?? 0); })(),
      // Para la prueba de dilución de Piotroski basta con las acciones que se conocían hace
      // un año: `sharesAsOf` ya es point-in-time, así que retrasar su fecha de corte basta.
      shares: sharesAsOf(fj, menosDias(asOf, 365)),
    },

    // ── Procedencia: sin esto, un dato anual y uno trimestral son indistinguibles ────────
    currency: cur,
    periodicidad: rev?.periodicidad ?? ni?.periodicidad ?? null,
    taxonomia: usaIFRS ? "ifrs-full" : "us-gaap",
    /** ¿Se puede cruzar el precio de bolsa con estos estados financieros? Falso si la moneda
     *  no es el dólar (capitalización en USD ÷ beneficio en EUR) o si es una extranjera cuyo
     *  ADR no equivale a una acción ordinaria. Lo consume `metricsOf`, que anula los ratios
     *  de valoración en vez de devolver un número creíble y falso. */
    precioComparable: cur === "USD" && esDomestico(fj),

    /**
     * CIERRE DE CADA MAGNITUD. Sin esto no se puede comprobar ninguna identidad contable.
     *
     * `flowTTM` e `instant` eligen la ventana más reciente **de cada tag por separado**, así
     * que el activo puede ser de junio y el pasivo de marzo, o los ingresos de un trimestre
     * más nuevo que el coste de ventas. Eso no es un descuadre de la empresa: es que se están
     * restando dos fotos distintas. Midiéndolo, comparar sin exigir el mismo corte hacía
     * "fallar" el margen bruto en el 36 % de los nombres — todas alarmas falsas.
     *
     * `lib/articulacion.ts` lo usa para declarar NO COMPROBABLE lo que no está alineado, en
     * vez de declararlo incorrecto. No comprobable y erróneo no son lo mismo.
     */
    periodos: {
      rev: rev?.latestEnd ?? null, ni: ni?.latestEnd ?? null,
      gp: gp?.latestEnd ?? null, cost: cost?.latestEnd ?? null,
      ocf: ocf?.latestEnd ?? null, cfi: cfi?.latestEnd ?? null,
      cff: cff?.latestEnd ?? null, deltaCash: dcash?.latestEnd ?? null, fxCash: fx?.latestEnd ?? null,
      dividends: div?.latestEnd ?? null, buybacks: buyb?.latestEnd ?? null,
      assets: assetsI?.end ?? null, liabilities: liabI?.end ?? null,
      equity: equityI?.end ?? null, minorityInterest: nciI?.end ?? null, temporaryEquity: tempI?.end ?? null,
    },
  };
}

/**
 * El mismo paquete un año antes, tal y como se conocía en `asOf`.
 *
 * Piotroski compara nueve magnitudes contra su valor del ejercicio anterior y Beneish ocho, y
 * hasta ahora cada script se lo montaba por su cuenta (`backtest.mjs` llamaba a
 * `fundamentalsAsOf(cik, addMonths(date, -12))`). Con una sola definición, la capa forense y
 * el backtest no pueden divergir — el mismo motivo por el que existen `picksSignal.mjs` y
 * `lib/picks.ts`.
 *
 * Es point-in-time de verdad: retrasa la FECHA DE CORTE, así que sólo ve presentaciones que ya
 * existían hace un año. No mira hacia adelante ni por accidente.
 */
export async function fundamentalsPrevYear(cik, asOf) {
  const y = +asOf.slice(0, 4), m = +asOf.slice(5, 7) - 1, d = +asOf.slice(8, 10);
  const prev = new Date(Date.UTC(y - 1, m, 1));
  const ultimo = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).getUTCDate();
  prev.setUTCDate(Math.min(d, ultimo));
  return fundamentalsAsOf(cik, prev.toISOString().slice(0, 10));
}
