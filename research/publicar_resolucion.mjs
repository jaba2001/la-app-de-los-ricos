// ─────────────────────────────────────────────────────────────────────────────
// PUBLICAR LO QUE RESOLVIÓ `resolver_cik.mjs`
//
// El resolutor MIDE (tarda dos horas y escribe su evidencia en `research/out/`). Esto
// PUBLICA: convierte esa evidencia en los dos ficheros que consume el código, y lo hace en
// un paso aparte para que se pueda repetir en segundos sin volver a interrogar a la SEC.
//
// Salen dos cosas, y la segunda es la que casi se me pasa:
//
//   1. `research/data/cik_historicos.json` — ticker muerto → CIK. Devuelve los FUNDAMENTALES
//      de las empresas que salieron del índice, que es por donde entraba el sesgo.
//
//   2. `research/data/alias_ticker.json` — ticker muerto → ticker VIVO de la misma empresa.
//      Devuelve los PRECIOS, y no es un detalle menor: cuando una empresa sólo cambió de
//      símbolo, los proveedores guardan toda su historia bajo el nombre NUEVO. `FB` no
//      devuelve nada de Meta —hoy es un ETF de ProShares—, pero `META` devuelve la serie
//      entera desde 2012. Sin este alias, Meta quedaría bloqueada por símbolo reutilizado y
//      el backtest perdería uno de los mayores miembros del índice por un cambio de nombre.
//
// LA PRUEBA QUE AUTORIZA UN ALIAS es la que `prices.mjs` ya exigía a mano para `BK` y `MMC`:
// **los dos tickers tienen que resolver al MISMO CIK**. Es lo único que distingue «la misma
// empresa con otro nombre» de «un símbolo reasignado a otra compañía», que es el error
// simétrico y mucho peor, porque empalma precios ajenos sin que nada falle.
//
//   node research/publicar_resolucion.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { elegirVivo, convivieron } from "./alias_reglas.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATA = join(AQUI, "data");
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });

const ruta = join(AQUI, "out", "resolucion_cik.json");
if (!existsSync(ruta)) { console.error(`  ✖ falta ${ruta} — corre antes research/resolver_cik.mjs`); process.exit(1); }
const res = JSON.parse(readFileSync(ruta, "utf8"));
const detalle = res.detalle ?? [];
if (!detalle.length) { console.error("  ✖ la resolución no trae ningún ticker"); process.exit(1); }

// ── 1 · El mapa de CIK ────────────────────────────────────────────────────────────────────
//
// Entra el nivel A (el emisor declara el símbolo dentro del periodo en el índice) y lo que
// venga de la fuente de miembros actuales. Los niveles B y C salen del resolutor como
// `revisar` y sólo entran si una persona los confirmó a mano en `cik_revisados.json`, porque
// producen CIK equivocados y creíbles que ninguna regla automática distingue: Wendy's como
// dueña de `TWC`, Life Storage como dueña del `LSI` de 2010-2014.
const revisados = (() => {
  try {
    const p = join(AQUI, "data", "cik_revisados.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8"))?.decisiones ?? {} : {};
  } catch { return {}; }
})();

// ⚠️ LA DECISIÓN REVISADA MANDA SOBRE LA DEL RESOLUTOR, y la primera versión de esto hacía lo
// contrario: exigía que el CIK revisado COINCIDIERA con el que había propuesto el resolutor,
// «para que una confirmación no se arrastrara a un candidato que nadie miró». Suena prudente y
// es inútil: el caso principal de la revisión es precisamente **corregir** al resolutor.
// `TWC` es el ejemplo — el resolutor propone Wendy's, la revisión dice Time Warner Cable, y con
// aquella regla la corrección se descartaba en silencio y `TWC` se quedaba sin publicar.
//
// Lo que sí se conserva es el rastro: la decisión guarda a qué candidato se enfrentaba, y si el
// resolutor ha cambiado de opinión desde entonces se avisa en vez de callarlo.
const entradas = [];
const revisionesDesfasadas = [];
for (const f of detalle) {
  const d = revisados[f.ticker];
  if (d && "cik" in d) {
    // Una decisión explícita de rechazo (`cik: null`) también manda: deja constancia de que se
    // miró y de que no entra.
    if (!d.cik) continue;
    if (!/^\d{10}$/.test(d.cik)) continue;
    if (d.cikPropuestoEntonces && d.cikPropuestoEntonces !== f.cik) {
      revisionesDesfasadas.push(`${f.ticker}: se revisó frente a ${d.cikPropuestoEntonces} y el resolutor propone ahora ${f.cik}`);
    }
    entradas.push([f.ticker, d.cik, `${f.evidencia}+revisado`]);
    continue;
  }
  if (!/^\d{10}$/.test(f.cik)) continue;
  if (f.estado === "verificado") entradas.push([f.ticker, f.cik, f.evidencia]);
}
// Y las decisiones sobre tickers que el resolutor no resolvió en absoluto.
for (const [t, d] of Object.entries(revisados)) {
  if (!d?.cik || !/^\d{10}$/.test(d.cik)) continue;
  if (entradas.some(([x]) => x === t)) continue;
  if (detalle.some((f) => f.ticker === t)) continue;
  entradas.push([t, d.cik, "revisado"]);
}
const mapa = Object.fromEntries(entradas.map(([t, c]) => [t, c]).sort((a, b) => a[0].localeCompare(b[0])));
const porRevisar = detalle.filter((f) => f.estado === "revisar" && !mapa[f.ticker]);
if (revisionesDesfasadas.length) {
  console.warn(`
  ⚠ ${revisionesDesfasadas.length} decisiones revisadas contra un candidato que el resolutor ya no propone:`);
  for (const r of revisionesDesfasadas) console.warn(`     ${r}`);
  console.warn(`     Manda la decisión revisada, pero conviene volver a mirarlas.
`);
}
/**
 * ESCRIBIR SIN DEJAR NUNCA UN FICHERO A MEDIAS.
 *
 * `writeFileSync` trunca y luego escribe, así que hay una ventana —corta, pero real— en la que
 * el fichero existe VACÍO o cortado. Daría igual si esto fuera un artefacto de investigación,
 * pero `data/simbolos_reutilizados.json` y `data/cik_historicos.json` los lee CÓDIGO DE
 * PRODUCCIÓN en caliente: `simboloBloqueado` y `tickerToCik`. Y los dos leen dentro de un
 * `try/catch` que ante un JSON roto se queda con `{}` y sigue — o sea que un cron que cayera
 * en esa ventana no fallaría: se quedaría **sin lista de bloqueo**, serviría los precios del
 * instrumento que heredó el símbolo y no lo diría. Exactamente el fallo que estos ficheros
 * existen para impedir, reintroducido por la forma de escribirlos.
 *
 * Con temporal + `rename` el cambio es atómico dentro del mismo volumen: quien lea ve la
 * versión vieja entera o la nueva entera, nunca media.
 */
function escribirAtomico(ruta, texto) {
  const tmp = ruta + ".tmp";
  writeFileSync(tmp, texto);
  renameSync(tmp, ruta);
}

escribirAtomico(join(DATA, "cik_historicos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "research/resolver_cik.mjs → research/publicar_resolucion.mjs",
  evidencia: "research/out/resolucion_cik.json",
  criterio: "nivel A (el emisor declara el símbolo DENTRO del periodo en el índice) o la fuente de miembros actuales. Los niveles B y C sólo entran confirmados a mano en cik_revisados.json.",
  entradas: Object.keys(mapa).length,
  porEvidencia: entradas.reduce((a, [, , e]) => ({ ...a, [e]: (a[e] ?? 0) + 1 }), {}),
  sinPublicar: porRevisar.map((f) => ({ ticker: f.ticker, cik: f.cik, nombre: f.nombre, evidencia: f.evidencia, comprobacion: f.comprobacion })),
  mapa,
}, null, 1));

// ── 2 · Los alias de precio ───────────────────────────────────────────────────────────────
const UA = { "User-Agent": "Scora Research contact@scora.app" };
let vivos = null;
try {
  const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA });
  if (r.ok) vivos = await r.json();
} catch { /* sin red no se pueden generar alias */ }

if (!vivos) {
  console.error("  ✖ la SEC no responde: no se pueden generar los alias (el mapa de CIK sí se ha escrito)");
  console.log(`\n  → research/data/cik_historicos.json  ·  ${Object.keys(mapa).length} tickers muertos\n`);
  process.exit(1);
}

// ⚠️ UN CIK NO IDENTIFICA UNA ACCIÓN: IDENTIFICA UNA EMPRESA.
//
// La primera versión de esto se quedaba, cuando un CIK tenía varios tickers vivos, con el
// primero por orden alfabético «para que el resultado fuera estable». El resultado estable era
// **`BF.B → BF-A`**: a la clase B de Brown-Forman le habría dado los precios de la clase A, que
// son otra acción con otro precio y otros derechos de voto.
//
// Y el reflejo del mismo error: `DISCA` y `DISCK` son dos clases de Discovery que hoy son
// **la misma** `WBD`. Aliasar las dos a `WBD` mete en la cartera dos posiciones distintas con
// serie idéntica, que es doble conteo disfrazado.
//
// ⚠️ Pero «dos muertos apuntan al mismo vivo» NO basta como motivo de rechazo, y la primera
// versión de esta regla lo usaba así: tumbaba también a `SYMC` y `NLOK`, que reclaman los dos a
// `GEN` sin ser clases — son la misma empresa en momentos distintos (Symantec → NortonLifeLock
// → Gen Digital). Lo que separa un caso del otro es si los dos **convivieron en el índice**:
// dos clases cotizan a la vez, una cadena de renombres no. Es el mismo criterio que usa la
// regla de conflicto del resolutor, y por el mismo motivo.
//
// Regla: un alias sólo vale cuando la correspondencia es **uno a uno**, contando como uno solo
// a los tickers que se suceden en el tiempo.
const tickersDeCik = new Map();
for (const k in vivos) {
  const cik = String(vivos[k].cik_str).padStart(10, "0");
  const t = String(vivos[k].ticker).toUpperCase();
  if (!tickersDeCik.has(cik)) tickersDeCik.set(cik, new Set());
  tickersDeCik.get(cik).add(t);
}

const alias = {};
const detalleAlias = [];
const alias_descartados = [];
// Quién reclama a quién, guardando el periodo de cada uno para poder distinguir clases
// simultáneas de renombres sucesivos.
const periodo = new Map(detalle.map((f) => [f.ticker, { desde: f.desde, hasta: f.hasta }]));
const reclamantes = new Map();
for (const [muerto, cik] of Object.entries(mapa)) {
  const vivosDelCik = tickersDeCik.get(cik);
  if (!vivosDelCik?.size) continue;
  const vivo = elegirVivo(muerto, vivosDelCik);
  if (!vivo || vivo === muerto) continue;
  if (!reclamantes.has(vivo)) reclamantes.set(vivo, []);
  reclamantes.get(vivo).push(muerto);
}
/**
 * ¿Convivió este ticker en el índice con otro que reclama el mismo símbolo vivo?
 *
 * Devuelve el rival, null si no hay ninguno, o `"?"` si NO SE PUEDE SABER — que no es lo
 * mismo y aquí falla en cerrado. `periodo` se construye desde `detalle`, o sea desde lo que
 * el resolutor llegó a resolver; una decisión revisada a mano que rescatara un ticker de
 * `noResueltos` estaría en `mapa` y NO en `periodo`, y la versión anterior devolvía null
 * —«no hay conflicto»— concediéndole el alias sin haber comprobado nada. Hoy no ocurre (los
 * 121 publicados salen todos de `detalle`), pero el día que ocurra el fallo sería exactamente
 * el que este fichero existe para evitar: dos clases de la misma empresa entrando como dos
 * posiciones con serie idéntica, que es doble conteo disfrazado.
 */
function conviveConOtroReclamante(muerto, vivo) {
  const a = periodo.get(muerto);
  if (!a) return "?";
  for (const otro of reclamantes.get(vivo) ?? []) {
    if (otro === muerto) continue;
    const b = periodo.get(otro);
    if (!b) continue;
    if (convivieron(a, b)) return otro;
  }
  return null;
}
for (const [muerto, cik] of Object.entries(mapa)) {
  const vivosDelCik = tickersDeCik.get(cik) ?? new Set();
  const fila = detalle.find((f) => f.ticker === muerto);
  const anotar = (motivo) => alias_descartados.push({ de: muerto, cik, nombre: fila?.nombre ?? "", motivo });
  if (!vivosDelCik.size) continue;                       // la empresa ya no cotiza: no hay a dónde apuntar
  const vivo = elegirVivo(muerto, vivosDelCik);
  if (!vivo) { anotar(`el CIK tiene ${vivosDelCik.size} tickers vivos (${[...vivosDelCik].sort().join(", ")}) y ninguno es claramente la acción ordinaria`); continue; }
  if (vivo === muerto) continue;
  const rival = conviveConOtroReclamante(muerto, vivo);
  if (rival === "?") { anotar(`no consta su periodo en el índice, así que no se puede comprobar si convivió con otro reclamante de «${vivo}»: sin esa comprobación no se concede el alias`); continue; }
  if (rival) { anotar(`convivió en el índice con «${rival}» y los dos apuntan a «${vivo}»: eran clases distintas de la misma empresa y hoy son una sola`); continue; }
  alias[muerto] = vivo;
  detalleAlias.push({ de: muerto, a: vivo, cik, nombre: fila?.nombre ?? "", enElIndice: `${fila?.desde}→${fila?.hasta}` });
}

escribirAtomico(join(DATA, "alias_ticker.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "research/publicar_resolucion.mjs",
  criterio: "los dos tickers resuelven al MISMO CIK en la SEC —la misma prueba que `prices.mjs` exige a mano para BK y MMC— Y la correspondencia es uno a uno: un CIK con varios tickers vivos no identifica una sola acción (BF.B habría cogido los precios de BF-A), y dos tickers muertos que apuntan al mismo vivo eran clases distintas (DISCA y DISCK son hoy WBD).",
  entradas: Object.keys(alias).length,
  descartados: alias_descartados,
  alias,
  detalle: detalleAlias.sort((a, b) => a.de.localeCompare(b.de)),
}, null, 1));

console.log(`\n  CIK publicados: ${Object.keys(mapa).length}   ·   alias de ticker: ${Object.keys(alias).length}   ·   pendientes de revisar a mano: ${porRevisar.length}\n`);
if (porRevisar.length) {
  console.log(`  ── SIN PUBLICAR, esperando revisión a mano (${porRevisar.length}) ──`);
  console.log(`  Confírmalos o recházalos en research/data/cik_revisados.json\n`);
  for (const f of porRevisar.slice().sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    console.log(`    ${f.ticker.padEnd(8)} ${f.cik}  ${String(f.nombre).slice(0, 32).padEnd(33)} [${f.evidencia}] ${f.desde}→${f.hasta}`);
    console.log(`             ${f.comprobacion}`);
  }
  console.log("");
}
for (const a of detalleAlias.sort((x, y) => x.de.localeCompare(y.de))) {
  console.log(`    ${a.de.padEnd(8)} → ${a.a.padEnd(7)} ${a.cik}  ${String(a.nombre).slice(0, 34).padEnd(35)} ${a.enElIndice}`);
}
console.log(`\n  → research/data/cik_historicos.json  ·  research/data/alias_ticker.json\n`);
