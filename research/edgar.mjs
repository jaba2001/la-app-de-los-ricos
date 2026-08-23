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
  // porque los avisos sólo ven a los que llegan a tener señal. Es el único caso de los 503:
  // el otro ticker con sufijo, `BF-B`, ya viene con guion en el CSV y resuelve solo.
  "BRK.B": "0001067983", // BERKSHIRE HATHAWAY INC (en la SEC: "BRK-B")
};

export async function tickerToCik(ticker) {
  const t = ticker.toUpperCase();
  if (MANUAL_CIK[t]) return MANUAL_CIK[t];
  if (!mem.has("__map")) {
    const j = await getJSON("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", 7);
    const m = {};
    if (j) for (const k in j) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, "0");
    mem.set("__map", m);
  }
  return mem.get("__map")[t] ?? null;
}

async function companyFacts(cik) {
  const key = `facts_${cik}`;
  if (mem.has(key)) return mem.get(key);
  const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, `CIK${cik}.json`);
  mem.set(key, j);
  return j;
}

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

function facts(fj, tag, taxonomy = null) {
  if (taxonomy) return fj?.facts?.[taxonomy]?.[tag]?.units ?? null;
  for (const tax of TAXONOMIAS) {
    const u = fj?.facts?.[tax]?.[tag]?.units;
    if (u) return u;
  }
  return null;
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
    if (!x.start || x.filed > asOf) return false;
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
  const rows = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf);
  if (!rows.length) return null;
  rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return { val: rows[0].val, end: rows[0].end, filed: rows[0].filed };
}

function instant(units, asOf, unit = "USD") {
  return instantFull(units, asOf, unit)?.val ?? null;
}

// Try every tag, keep the window whose latest quarter is the MOST RECENT (tags change
// over time — banks especially — and stale tags must never beat current data).
//
// `cur` es la moneda de presentación. `skip` salta N trimestres hacia atrás (skip=4 → el TTM
// del ejercicio anterior, que es lo que piden Piotroski y Beneish).
//
// LA VÍA ANUAL se decide POR EMPRESA, no por tag, y `permitirAnual` llega ya resuelto desde
// `fundamentalsAsOf`: sólo vale para quien no publica NINGÚN trimestre de ingresos, es decir,
// un presentador 20-F. Esa distinción no es cosmética. El primer intento la aplicaba por tag,
// y entonces bastaba con que UNA magnitud suelta careciera de trimestres para que un filer
// estadounidense cambiara: medido, Aflac pasó de no tener EBITDA a tenerlo, y con él el
// EV/EBITDA y la deuda neta. Más cobertura, sí — pero moviendo cifras ya publicadas de
// empresas que nadie había tocado. Eso es una regresión aunque el número nuevo sea mejor.
function flowTTM(fj, tags, asOf, skip = 0, cur = "USD", permitirAnual = false, minEnd = null) {
  let best = null;
  for (const t of tags) {
    const q = quarters(facts(fj, t), asOf, cur);
    if (q.length >= skip + 4) {
      const s = q.slice(skip, skip + 4);
      if (minEnd && s[0].end < minEnd) continue;         // ventana rancia: ver ANTIGUEDAD_MAX_DIAS
      const cand = { val: s.reduce((a, x) => a + x.val, 0), latestFiled: s[0].filed, latestEnd: s[0].end, periodicidad: "trimestral" };
      if (!best || cand.latestEnd > best.latestEnd) best = cand;
    }
  }
  if (best || !permitirAnual) return best;
  const saltoAnual = skip / 4;                       // skip=4 (un año atrás) → el 2º ejercicio
  if (!Number.isInteger(saltoAnual)) return null;
  for (const t of tags) {
    const a = anuales(facts(fj, t), asOf, cur);
    if (a.length >= saltoAnual + 1) {
      const x = a[saltoAnual];
      if (minEnd && x.end < minEnd) continue;
      const cand = { val: x.val, latestFiled: x.filed, latestEnd: x.end, periodicidad: "anual" };
      if (!best || cand.latestEnd > best.latestEnd) best = cand;
    }
  }
  return best;
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
function instTag(fj, tags, asOf, taxonomy = null, unit = "USD") {
  for (const t of tags) { const v = instant(facts(fj, t, taxonomy), asOf, unit); if (v != null) return v; }
  return null;
}
/** Igual que `instTag` pero devuelve también el cierre, para el mapa de periodos. */
function instTagFull(fj, tags, asOf, taxonomy = null, unit = "USD") {
  for (const t of tags) { const v = instantFull(facts(fj, t, taxonomy), asOf, unit); if (v != null) return v; }
  return null;
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
             "RegulatedAndUnregulatedOperatingRevenue"];             // eléctricas: DUK, NEE, DTE, XEL

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
const NI = ["NetIncomeLoss"];
const GP = ["GrossProfit"];
const COST = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"];
const OI = ["OperatingIncomeLoss"];
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
};

// ── Fase F1/F2 (2026-08-22) — lo que piden la capa de integridad contable y los modelos
// forenses (Beneish, Piotroski completo, articulación de caja y patrimonio). Cobertura medida
// sobre las 586 empresas en caché; está anotada porque un modelo que exige TODAS sus entradas
// sólo existe donde están todas: Beneish sale en el 37,5 % del índice y en el 8 % de la banca.
const ICF = ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"];
const FCF_ = ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"];
const DCASH = ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
               "CashAndCashEquivalentsPeriodIncreaseDecrease"];
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
const INV = ["InventoryNet"];
const GW = ["Goodwill"];
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
  const IF_ = (tags) => {
    const v = instTagFull(fj, tags, asOf, null, cur);
    // Un instante de balance rancio es igual de tóxico que un flujo rancio: el activo de 2026
    // contra el pasivo de 2013 no es un descuadre de la empresa, es un dato muerto.
    return v && ancla && v.end < menosDias(ancla, ANTIGUEDAD_MAX_DIAS) ? null : v;
  };
  const I = (tags) => IF_(tags)?.val ?? null;

  const rev = F(T(REV, "REV"), 0) ?? F(REV2, 0);
  const revP = F(T(REV, "REV"), 4) ?? F(REV2, 4);
  const ni = F(T(NI, "NI")), niP = F(T(NI, "NI"), 4);
  let gp = F(GP);
  const cost = F(T(COST, "COST"));
  // El margen bruto derivado sólo lleva fecha si los dos sumandos son del MISMO cierre. Si no,
  // el valor se sigue calculando —era el comportamiento previo y hay ratios que dependen de
  // él— pero se marca sin periodo, y la capa de articulación lo tratará como no comprobable
  // en lugar de darlo por bueno. `research/desfase_periodos.mjs` mide cuántos son.
  if (gp == null && rev != null && cost != null) {
    gp = { val: rev.val - cost.val, latestEnd: rev.latestEnd === cost.latestEnd ? rev.latestEnd : null };
  }
  const oi = F(T(OI, "OI")), da = F(T(DA, "DA")), intp = F(T(INT, "INT"));
  const ocf = F(T(OCF, "OCF")), capex = F(T(CAPEX, "CAPEX"));

  const equityI = IF_(T(EQUITY, "EQUITY")), equity = equityI?.val ?? null;
  const ltd = I(["LongTermDebtNoncurrent", "LongTermDebt"]);
  const ltdC = I(["LongTermDebtCurrent", "DebtCurrent"]);
  const cfi = F(T(ICF, "ICF")), cff = F(T(FCF_, "FCF_")), dcash = F(T(DCASH, "DCASH")), fx = F(FX);
  const div = F(T(DIV, "DIV")), buyb = F(BUYB);
  const assetsI = IF_(["Assets"]), liabI = IF_(LIAB), nciI = IF_(T(NCI, "NCI")), tempI = IF_(TEMPEQ);

  return {
    revTTM: rev?.val ?? null, revPrevTTM: revP?.val ?? null,
    niTTM: ni?.val ?? null, niPrevTTM: niP?.val ?? null,
    gpTTM: gp?.val ?? null, oiTTM: oi?.val ?? null,
    daTTM: da?.val ?? null, interestTTM: intp?.val != null ? Math.abs(intp.val) : null,
    ocfTTM: ocf?.val ?? null, capexTTM: capex?.val != null ? Math.abs(capex.val) : null,
    assets: assetsI?.val ?? null, equity,
    curA: I(["AssetsCurrent"]), curL: I(["LiabilitiesCurrent"]),
    cash: I(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
    debt: (ltd ?? 0) + (ltdC ?? 0),
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
    fxCashTTM: fx?.val ?? null,
    dividendsTTM: div?.val != null ? Math.abs(div.val) : null,
    buybacksTTM: buyb?.val != null ? Math.abs(buyb.val) : null,

    // ── Fase F2 · entradas de los modelos forenses ──────────────────────────────────────
    receivables: I(T(RECV, "RECV")), ppe: I(T(PPE, "PPE")), inventory: I(T(INV, "INV")), goodwill: I(GW),
    sgaTTM: F(T(SGA, "SGA"))?.val ?? null, rndTTM: F(RND)?.val ?? null, sbcTTM: F(SBC)?.val ?? null,

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
