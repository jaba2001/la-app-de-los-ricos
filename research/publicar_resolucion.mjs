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
// ⚠️ Y «REVISADO» NO SIEMPRE QUIERE DECIR QUE LO MIRARA UNA PERSONA.
//
// `cik_revisados.json` se describe —aquí y en §10— como el fichero de las decisiones
// humanas, y `publicar_resolucion` lo trataba entero como tal. Pero
// `revisar_cik.mjs --proponer` ESCRIBE EN ESE MISMO FICHERO: de las 36 decisiones que
// había el 2026-08-25, **13 las puso la máquina** y 23 una persona. La salvaguarda que este
// código prometía cubría 23 de los 121 CIK publicados, no los 121.
//
// No se descartan, y el motivo está medido: esas 13 son una corroboración automática
// INDEPENDIENTE —el proveedor de precios dice qué empresa llevaba el símbolo y el nombre casa
// al ~100 %— y de hecho CORRIGIERON al resolutor (llevan `cikPropuestoEntonces`, y `TWC` es
// una de ellas). Son Heinz, Airgas, Covidien, Express Scripts, Red Hat, St Jude, Safeway…
// ninguna dudosa.
//
// Lo que sí se arregla es que la diferencia se VEA: la evidencia distingue `+revisado` de
// `+corroborado` y el recuento final los separa, de modo que una tanda de `--proponer` no
// pueda volver a colar propuestas automáticas bajo la etiqueta de revisión humana.
const esHumano = (d) => !/--proponer/.test(String(d?.propuestoPor ?? ""));
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
    entradas.push([f.ticker, d.cik, `${f.evidencia}+${esHumano(d) ? "revisado" : "corroborado"}`]);
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
  // ⚠️ AQUÍ TAMBIÉN, y no darse cuenta costó que 22 propuestas automáticas entraran
  // etiquetadas como revisión humana el mismo día que se arregló la otra vía. Son dos caminos
  // distintos hacia el mismo mapa —uno para lo que el resolutor sí miró y otro para lo que no—
  // y arreglar sólo el primero deja el agujero entero abierto por el segundo.
  entradas.push([t, d.cik, esHumano(d) ? "revisado" : "corroborado"]);
}
const mapa = Object.fromEntries(entradas.map(([t, c]) => [t, c]).sort((a, b) => a[0].localeCompare(b[0])));

// ⚠️ UN MAPA NUEVO NO PUEDE ENCOGER SIN QUE ALGUIEN LO DECIDA.
//
// El resolutor tarda dos horas y desde el 2026-08-29 guarda cada quince nombres, así que
// mientras corre su evidencia está INCOMPLETA por definición. Publicar en ese momento no
// falla: produce un mapa más pequeño, y los CIK que faltan dejan de existir para el sistema —
// las empresas vuelven a ser invisibles y el sesgo de supervivencia regresa en silencio.
// Medido en mitad de una corrida: habría borrado 81 de los 143 publicados.
//
// El umbral no es cero porque una revisión legítima SÍ puede retirar un CIK dudoso, y eso debe
// poder ocurrir sin pelearse con un guardián. Lo que no debe ocurrir es perder un tercio.
// ⚠️ Y este catch tampoco puede tragarse el error, o el guardián se desactiva solo. Si el
// fichero NO EXISTE es la primera publicación y no hay nada que proteger; si existe y no se
// puede leer, el guardián se quedaría mudo justo cuando algo va mal — que es el mismo defecto
// que este guardián existe para evitar, un piso más abajo.
const rutaPrevia = join(DATA, "cik_historicos.json");
let previoMapa = null;
if (existsSync(rutaPrevia)) {
  try {
    previoMapa = JSON.parse(readFileSync(rutaPrevia, "utf8"))?.mapa ?? null;
  } catch (e) {
    console.error(`
  ⛔ ${rutaPrevia} existe pero no se puede leer (${e.message}).`);
    console.error(`     Sin él no se puede comprobar si el mapa nuevo encoge, así que no se publica.`);
    console.error(`     Bórralo a mano si de verdad quieres publicar sin esa comprobación.
`);
    process.exit(1);
  }
}
if (previoMapa) {
  const antes = Object.keys(previoMapa).length, ahora = Object.keys(mapa).length;
  const perdidos = Object.keys(previoMapa).filter((t) => !mapa[t]);
  if (ahora < antes * 0.9) {
    console.error(`
  ⛔ EL MAPA ENCOGERÍA de ${antes} a ${ahora} CIK (${perdidos.length} desaparecen).`);
    console.error(`     Casi siempre esto significa que la evidencia está a medias — el resolutor guarda`);
    console.error(`     cada quince nombres y tarda dos horas. Espera a que termine y vuelve a publicar.`);
    console.error(`     Se pierden, entre otros: ${perdidos.slice(0, 12).join(", ")}`);
    console.error(`     Si el encogimiento es intencionado, --permitir-encoger.
`);
    if (!process.argv.includes("--permitir-encoger")) process.exit(1);
    console.error(`     (--permitir-encoger: se publica igualmente)
`);
  } else if (perdidos.length) {
    console.warn(`  ⚠ ${perdidos.length} CIK dejan de publicarse: ${perdidos.slice(0, 8).join(", ")}`);
  }
}
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

// Los símbolos que la auditoría ha bloqueado: no se les da alias (ver abajo). Si el fichero no
// está, no se bloquea nada y el comportamiento es el de antes — pero se dice.
const bloqueados = (() => {
  const r = join(DATA, "simbolos_reutilizados.json");
  if (!existsSync(r)) { console.warn("  ⚠ falta data/simbolos_reutilizados.json: los alias se generan sin comprobar bloqueos"); return {}; }
  try { return JSON.parse(readFileSync(r, "utf8"))?.bloqueados ?? {}; } catch { console.warn("  ⚠ data/simbolos_reutilizados.json ilegible: los alias se generan sin comprobar bloqueos"); return {}; }
})();

const alias = {};
const detalleAlias = [];
const alias_descartados = [];
// Quién reclama a quién, guardando el periodo de cada uno para poder distinguir clases
// simultáneas de renombres sucesivos.
// ⚠️ EL PERIODO SALE DE TODO LO QUE SE CONOCE, no sólo de lo que el resolutor resolvió.
//
// `noResueltos` también trae `desde` y `hasta` — que el resolutor no encontrara el CIK no
// significa que no supiera cuándo estuvo el ticker en el índice. Construir el mapa sólo desde
// `detalle` dejaba sin periodo justo a los que entran por revisión, y sin periodo la regla de
// convivencia no puede comprobar nada: falla en cerrado y les niega el alias. Pasó de verdad
// con 22 tickers el 2026-08-25, y el síntoma fue un test en rojo, no un error.
const periodo = new Map([...detalle, ...(res.noResueltos ?? [])].map((f) => [f.ticker, { desde: f.desde, hasta: f.hasta }]));
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
  // ⚠️ UN SÍMBOLO BLOQUEADO NO RECIBE ALIAS, y darle uno crea una contradicción.
  //
  // El bloqueo lo decide la auditoría MIRANDO LA SERIE DE PRECIOS; este guion sólo mira CIK, así
  // que cuando discrepan manda el que tiene la evidencia. `CHK` lo enseñó: Chesapeake quebró,
  // sus acciones se cancelaron y hoy cotiza como `EXE` con el MISMO CIK — así que la regla del
  // CIK autoriza el alias. Pero la serie de `EXE` empieza el 2021-02-10 y `CHK` estuvo en el
  // índice de 2010 a 2018: **el alias no cubre ni un día del periodo para el que haría falta**.
  // Lo único que aportaría es desactivar el bloqueo y servir la cotización de una acción distinta
  // de la que estuvo en el índice.
  if (bloqueados[muerto]) { anotar(`está bloqueado por la auditoría de símbolos (${String(bloqueados[muerto]).slice(0, 80)}), y el bloqueo se decide mirando la serie de precios, que es más evidencia que el CIK`); continue; }
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

const marca = (e, m) => e === m || e.endsWith("+" + m);   // «revisado» y «A+revisado» son la misma via
const nHumano = entradas.filter(([, , e]) => marca(e, "revisado")).length;
const nAuto = entradas.filter(([, , e]) => marca(e, "corroborado")).length;
console.log(`\n  CIK publicados: ${Object.keys(mapa).length}   ·   alias de ticker: ${Object.keys(alias).length}   ·   pendientes de revisar a mano: ${porRevisar.length}\n`);
console.log(`  Con decisión sobre el resolutor: ${nHumano} revisados por una PERSONA · ${nAuto} corroborados por revisar_cik --proponer (máquina, NO revisión humana)`);
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
