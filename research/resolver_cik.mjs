// ─────────────────────────────────────────────────────────────────────────────
// RESOLUCIÓN DE CIK PARA TICKERS QUE YA NO EXISTEN
//
// El sesgo de supervivencia de este repositorio NO entra por los precios: entra por
// `tickerToCik`. `company_tickers.json` de la SEC sólo contiene tickers VIVOS, así que una
// empresa que salió del índice es invisible **en todas las fechas**, incluidas aquellas en que
// era excelente. Medido el 2026-08-24: **175 tickers** que han sido miembros desde 2010 no
// resuelven — 79 dentro de la ventana 2019-2026 y 152 dentro de 2011-2018.
//
// ⚠️ DOS VÍAS PROBADAS Y DESCARTADAS, ambas por el mismo motivo: no fallan, devuelven un CIK
// **plausible y equivocado**, y un CIK equivocado ingiere los estados financieros de otra
// empresa sin dar ningún error.
//
//   · `browse-edgar?company=TICKER` — busca por NOMBRE, no por símbolo. `ABC` devolvió **Joshua
//     Gold Resources**, una minera cuyo nombre anterior era «ABC Acquisition Corp 1501».
//   · Instantáneas del Internet Archive — no existen para `company_tickers.json`.
//
// LAS TRES QUE SÍ SE USAN, en orden de coste y de fiabilidad:
//
//   1. **La fuente mantenida de miembros actuales**, que ya empareja ticker y CIK. Resuelve los
//      que sólo fallaban por notación (`BF.B` con punto donde la SEC pone guion) y los cambios
//      de nombre de días atrás, que ninguna otra vía puede conocer todavía.
//   2. **`browse-edgar?CIK=<ticker>`**, que busca por SÍMBOLO. Es otra ruta del mismo servicio
//      que la descartada y por eso se confundió con ella.
//   3. **Búsqueda de texto completo** (`efts.sec.gov`), para los que ya no están ni en el índice
//      de símbolos de EDGAR. Es la más ruidosa: `ABC` devuelve **Walt Disney**, dueña de la
//      cadena de televisión.
//
// NINGUNA de las tres se acepta por su cuenta. Lo que decide es `tickerEsDe`: que el emisor
// declare ese símbolo **en un documento suyo y hablando de sí mismo** — la tabla de registro de
// la §12(b), la fórmula del Item 5, o el nombre que le puso a su propio fichero. Es la prueba
// que Joshua Gold y Disney no pasan, y vive en `research/portada.mjs` junto a los cinco
// defectos que tuvo antes de funcionar.
//
// ── Y NO TODAS LAS PRUEBAS VALEN LO MISMO ────────────────────────────────────────────────
//
//   **A** · el emisor declara el símbolo DENTRO del periodo en que el ticker estuvo en el
//           índice. Es prueba directa y **es la única que entra sola**.
//   **B** · lo declara en otro momento de su historia. Necesario para los tickers modernos
//           retroproyectados (`ATGE` figura en 2010-2012, cuando la empresa cotizaba como
//           `DV`) — pero no distingue eso de que OTRA empresa heredara el símbolo después.
//           Life Storage declara `LSI` en 2017-2022, y el `LSI` del índice en 2010-2014 era
//           LSI Corporation, la de semiconductores.
//   **C** · sólo el nombre del fichero. La más débil, y la que más engaña: cuando la puse
//           primera por ser gratis, **104 de 120 resoluciones acabaron descansando en ella**
//           sin que nada mirara el texto, y así entró Wendy's como dueña de `TWC`.
//
// B y C salen marcados como `revisar` y **no se publican**. Entran sólo si una persona los
// confirma en `research/data/cik_revisados.json`. Y lo que no se resuelva se queda **sin
// resolver y a la vista**, no rellenado a ojo: un CIK inventado no da error, da los estados
// financieros de otra empresa.
//
// Y antes de cualquier prueba, dos filtros que descartan a quien NO PUEDE ser el miembro:
// haber presentado informes periódicos dentro del periodo, y **declarar flotante público**. El
// segundo es el único que separa a una matriz cotizada de su filial emisora de deuda, porque
// las dos presentan los mismos documentos —a veces literalmente el mismo, co-firmado— y por
// tanto tienen el mismo nombre, el mismo fichero y el mismo texto. Ver `float_publico.mjs`.
//
//   node --experimental-strip-types --no-warnings research/resolver_cik.mjs [--desde 2010-01-01]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, cikDeMiembrosActuales } from "./universe.mjs";
import { tickerToCikVivo } from "./edgar.mjs";
import { submissions, periodicasTodas, enPeriodo, tickerEsDe } from "./portada.mjs";
import { floatPublico } from "./float_publico.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESDE = arg("--desde", "2010-01-01");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Scora Research contact@scora.app" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Las tres vías ─────────────────────────────────────────────────────────────────────────

/** Vía 2: EDGAR por SÍMBOLO. Devuelve un candidato o null. */
async function porSimbolo(ticker) {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=5&output=atom`;
  try {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) return null;
    const t = await r.text();
    const c = t.match(/<cik>(\d+)<\/cik>/i);
    return c ? [{ cik: c[1].padStart(10, "0"), peso: 1 }] : null;
  } catch { return null; }
}

/**
 * Vía 3: texto completo, acotado a 10-K dentro del periodo en el índice.
 *
 * Devuelve los CIK distintos ordenados por número de apariciones. El emisor menciona su propio
 * símbolo en la portada y casi siempre alguna vez más, así que suele encabezar la lista — pero
 * el orden aquí es sólo el orden en que se prueban, no una decisión.
 */
async function porTextoCompleto(ticker, desde, hasta, paginas) {
  // El índice de texto completo empieza en 2001; pedir antes devuelve vacío sin avisar.
  const a = desde < "2001-01-01" ? "2001-01-01" : desde;
  const cuenta = new Map();
  for (let p = 0; p < paginas; p++) {
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${ticker}"`)}&forms=10-K&startdt=${a}&enddt=${hasta}&from=${p * 10}`;
    let j = null;
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) break;
      j = await r.json();
    } catch { break; }
    const hits = j?.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) {
      const c = h?._source?.ciks?.[0];
      if (c) cuenta.set(c, (cuenta.get(c) ?? 0) + 1);
    }
    await sleep(240);
  }
  return [...cuenta.entries()].sort((x, y) => y[1] - x[1]).map(([cik, peso]) => ({ cik: String(cik).padStart(10, "0"), peso }));
}

// ── El universo del problema ──────────────────────────────────────────────────────────────
const table = await loadSP500Historical();
if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const primera = new Map(), ultima = new Map();
for (const fila of table) {
  if (fila.date < DESDE) continue;
  for (const t of fila.tickers) { if (!primera.has(t)) primera.set(t, fila.date); ultima.set(t, fila.date); }
}
const solo = arg("--solo", null);
const pendientes = [];
for (const t of primera.keys()) if (!(await tickerToCikVivo(t))) pendientes.push(t);
pendientes.sort();
if (solo) {
  const q = new Set(solo.split(",").map((x) => x.trim().toUpperCase()));
  // `--solo` sirve para depurar sobre casos concretos; NO escribe el fichero de salida, para
  // no dejar en `out/` una resolución parcial que parezca completa.
  for (const t of q) if (!primera.has(t)) { primera.set(t, DESDE); ultima.set(t, new Date().toISOString().slice(0, 10)); }
  pendientes.length = 0;
  pendientes.push(...q);
}
console.log(`\n  ${pendientes.length} tickers sin CIK entre los miembros del índice desde ${DESDE}\n`);

const deLaFuente = (await cikDeMiembrosActuales()) ?? new Map();

/**
 * ¿Puede este CIK ser de este ticker, o ya es de otro que estaba en el índice A LA VEZ?
 *
 * Un cambio de nombre nunca solapa: el ticker viejo sale del índice el día que entra el nuevo.
 * Dos tickers distintos que conviven en el índice son, por definición, dos empresas distintas.
 * Es lo que separa «FB es Meta» de «ABC es Disney».
 */
const duenoConocido = new Map();
for (const [tk, ck] of deLaFuente) if (primera.has(tk)) duenoConocido.set(ck, tk);
// Se amplía a TODOS los miembros históricos que la SEC siga reconociendo, no sólo a los del
// índice actual: cuantos más dueños conocidos, más choques detectables.
//
// ⚠️ Pero conviene saber hasta dónde llega, porque yo di por hecho que llegaba más lejos. Esta
// regla **sólo conoce miembros del índice**. El caso que la motivó —`TWC` (Time Warner Cable)
// resuelto al CIK 30697, que es el de **Wendy's**, porque «The Wendy's Company» bautiza sus
// ficheros `twc_…`— NO se caza aquí: Wendy's cotiza como `WEN` y **nunca estuvo en el S&P
// 500**, así que su CIK no choca con nada. Comprobado, no supuesto. Ése es el motivo de que los
// niveles B y C salgan a revisión a mano en vez de publicarse.
for (const tk of primera.keys()) {
  if (duenoConocido.has(tk)) continue;
  const ck = await tickerToCikVivo(tk);
  if (ck && !duenoConocido.has(ck)) duenoConocido.set(ck, tk);
}
function chocaConOtro(cik, ticker) {
  const otro = duenoConocido.get(cik);
  if (!otro || otro === ticker) return null;
  const solapan = primera.get(ticker) <= ultima.get(otro) && primera.get(otro) <= ultima.get(ticker);
  return solapan ? otro : null;
}

// ── Resolución ────────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ INCREMENTAL, y no por comodidad: sin esto una corrida de dos horas que muera al 90 % lo
 * pierde TODO.
 *
 * Este guion escribía su evidencia una sola vez, al final. El 2026-08-29 murió por el camino
 * —el proceso de fondo no sobrevivió al cierre de la sesión— con 116 de 213 nombres ya
 * interrogados a la SEC, y no quedó ni uno. Es el mismo defecto que el backtest tenía con la
 * memoria: el trabajo caro hecho, el resultado sin escribir, y nada que lo diga.
 *
 * Ahora hereda lo ya resuelto y guarda cada pocos nombres. `--rehacer` fuerza empezar de cero.
 */
const REHACER = process.argv.includes("--rehacer");
const yaResuelto = new Map();
if (!REHACER && !solo) {
  // ⚠️ EL CATCH NO SE TRAGA CUALQUIER COSA, y la primera versión de esto sí lo hacía.
  //
  // «No hay fichero previo» es normal y se sigue sin él. Un fallo de programación NO: la
  // primera versión olvidó importar `readFileSync`, el `ReferenceError` cayó en un catch
  // vacío, y la herencia simplemente no ocurrió — sin error, sin aviso, y con la corrida
  // repitiendo dos horas de trabajo ya hecho. Es el mismo defecto que este repo lleva días
  // cazando en otros sitios: el catch que convierte un error en un silencio.
  const rutaPrev = join(OUT, "resolucion_cik.json");
  if (existsSync(rutaPrev)) {
    let prev = null;
    try {
      prev = JSON.parse(readFileSync(rutaPrev, "utf8"));
    } catch (e) {
      console.warn(`  ⚠ la evidencia previa existe pero no se puede leer (${e.message}): se resuelve todo de nuevo`);
    }
    if (prev) {
      for (const f of prev.detalle ?? []) if (f.cik) yaResuelto.set(f.ticker, f);
      // Los «sin resolver» también se heredan: son una respuesta —se buscó y no había— y volver
      // a buscarlos cuesta lo mismo para llegar al mismo sitio.
      for (const f of prev.noResueltos ?? []) yaResuelto.set(f.ticker, { ...f, __sinResolver: true });
    }
  }
}

const filas = [];
const sinResolver = [];
let n = 0;

/**
 * Guarda la evidencia. Se llama cada pocos nombres y al final, no sólo al final: heredar lo ya
 * resuelto no sirve de nada si el fichero del que se hereda nunca llega a escribirse.
 *
 * Temporal + rename, como el resto de lo que escribe este repo: una corrida que muera a mitad
 * de la escritura dejaría un JSON cortado, y quien lo lea se queda con `{}` sin enterarse.
 */
const guardar = () => {
  const ver = filas.filter((f) => f.estado === "verificado");
  const rev = filas.filter((f) => f.estado === "revisar");
  const nivel = (x) => filas.filter((f) => f.evidencia === x);
  const ruta = join(OUT, "resolucion_cik.json");
  const tmp = ruta + ".tmp";
  writeFileSync(tmp, JSON.stringify({
    generatedAt: new Date().toISOString(), desde: DESDE,
    pendientes: pendientes.length, verificados: ver.length, aRevisar: rev.length, sinResolver: sinResolver.length,
    porEvidencia: { A: nivel("A").length, B: nivel("B").length, C: nivel("C").length, fuente: nivel("fuente").length },
    mapa: Object.fromEntries(filas.map((f) => [f.ticker, f.cik]).sort((a, b) => a[0].localeCompare(b[0]))),
    detalle: filas, noResueltos: sinResolver,
    nota: "Sólo el nivel A (el emisor declara el símbolo DENTRO del periodo en el índice) y la fuente de miembros actuales entran solos. Los niveles B y C quedan como `revisar`: producen CIK equivocados y creíbles —Wendy's como dueña de TWC, Life Storage como dueña del LSI de 2010-2014— y ninguna regla automática los distingue.",
  }, null, 1));
  renameSync(tmp, ruta);
};

if (yaResuelto.size) console.log(`  ${yaResuelto.size} ya resueltos en una corrida anterior: se heredan sin volver a preguntar (--rehacer para forzar)
`);

for (const ticker of pendientes) {
  n++;
  const heredado = yaResuelto.get(ticker);
  if (heredado) {
    if (heredado.__sinResolver) { const { __sinResolver, ...f } = heredado; sinResolver.push(f); }
    else filas.push(heredado);
    continue;
  }
  const desde = primera.get(ticker), hasta = ultima.get(ticker);
  const traza = (m) => process.stdout.write(`\r  ${String(n).padStart(3)}/${pendientes.length}  ${ticker.padEnd(8)} ${m.slice(0, 62).padEnd(63)}`);

  // Vía 1 — gratis y autoritativa: la fuente empareja ticker y CIK ella misma, así que no
  // necesita la prueba de la portada (que además falla en los renombrados de hace días).
  const dela = deLaFuente.get(ticker) ?? deLaFuente.get(ticker.split(".").join("-"));
  if (dela) {
    const s = await submissions(dela);
    filas.push({
      ticker, cik: dela, nombre: s?.name ?? "", via: "fuente mantenida", evidencia: "fuente",
      desde, hasta, tickersSEC: (s?.tickers ?? []).join(","),
      nombresAntiguos: (s?.formerNames ?? []).map((f) => f.name).slice(0, 4).join(" · "),
      comprobacion: "la fuente de miembros actuales empareja ticker y CIK", estado: "verificado",
    });
    traza("✓ fuente mantenida");
    await sleep(200);
    continue;
  }

  // Vías 2 y 3 — candidatos a probar, sin duplicados y sin los que chocan con otro miembro.
  traza("buscando…");
  await sleep(200);
  const cands = [];
  const vistos = new Set();
  const anota = (lista, via) => { for (const c of lista ?? []) if (!vistos.has(c.cik)) { vistos.add(c.cik); cands.push({ ...c, via }); } };
  anota(await porSimbolo(ticker), "browse-edgar por símbolo");
  await sleep(200);
  anota(await porTextoCompleto(ticker, desde, hasta, ticker.length <= 2 ? 6 : 3), "texto completo");

  if (!cands.length) {
    sinResolver.push({ ticker, desde, hasta, motivo: "ninguna de las tres vías devuelve candidato" });
    traza("— sin candidatos");
    continue;
  }

  // ── Cribado barato ANTES de descargar un solo documento ────────────────────────────────
  // Los informes pesan entre 1 y 14 MB; probar seis candidatos a cuatro documentos cada uno,
  // dos veces (dentro del periodo y en toda la historia), son cientos de megas por ticker. Lo
  // que se puede descartar con dos peticiones de JSON se descarta aquí.
  const vivos = [];
  const descartes = [];
  for (const c of cands.slice(0, 8)) {
    const choque = chocaConOtro(c.cik, ticker);
    if (choque) { descartes.push(`${c.cik} es ${choque}, que estaba en el índice a la vez`); continue; }
    await sleep(200);
    const s = await submissions(c.cik);
    if (!s) { descartes.push(`${c.cik} sin submissions`); continue; }
    const todas = await periodicasTodas(s);
    // Si no presentó NINGÚN informe periódico mientras el ticker estaba en el índice, no era
    // ese miembro del índice. Esto solo elimina a las SPAC y a las empresas recientes.
    const dentro = enPeriodo(todas, desde, hasta);
    if (!dentro.length) { descartes.push(`${c.cik} (${s.name}) sin informes periódicos en el periodo`); continue; }
    // ¿Tenía acciones en manos del público? Un miembro del S&P 500 sí, por definición; una
    // filial que sólo emite deuda presenta los mismos documentos que su matriz y no. Es lo
    // que separa a Cablevision de CSC Holdings, y lo que habría matado aquí mismo el
    // `HNZ → Solo Cup` que se coló por el patrón de cita.
    await sleep(200);
    const fl = await floatPublico(c.cik, desde, hasta);
    if (fl.max == null) { descartes.push(`${c.cik} (${s.name}) no declara flotante público: no pudo ser miembro del índice`); continue; }
    vivos.push({ ...c, sub: s, todas, dentro });
    if (vivos.length >= 4) break;
  }

  // ── Pass 1: nivel A sobre todos los supervivientes. Pass 2: nivel B, sólo si nadie pasó ──
  let elegido = null;
  // ⚠️ SÓLO EL NIVEL A SE ACEPTA SOLO. Los otros dos producen CIK equivocados y creíbles, y no
  // hay ninguna regla automática que los distinga:
  //
  //   · **C** (nombre del fichero) — `twc_wr10qq3-12.htm` es de **Wendy's**, «The Wendy's
  //     Company», y por ahí el ticker de Time Warner Cable acabó apuntando a una hamburguesería.
  //   · **B** (el símbolo declarado en OTRO momento) — Life Storage declara `LSI` en sus
  //     informes de 2017-2022, pero el `LSI` del índice en 2010-2014 era **LSI Corporation**,
  //     la de semiconductores que compró Avago. La prueba de nivel B no distingue «esta empresa
  //     usó ese ticker antes o después» de «otra empresa heredó ese ticker».
  //
  // Y la regla de conflicto tampoco alcanza, porque sólo conoce miembros del índice: Wendy's
  // (`WEN`) nunca estuvo en el S&P 500, así que su CIK no choca con nada.
  //
  // Por eso B y C salen como `revisar` y NO los publica `publicar_resolucion.mjs`. Entran sólo
  // si una persona los confirma en `research/data/cik_revisados.json`.
  const anotar = (v, nivel, motivo) => ({
    ticker, cik: v.cik, nombre: v.sub.name ?? "", via: v.via, evidencia: nivel, desde, hasta,
    tickersSEC: (v.sub.tickers ?? []).join(","),
    nombresAntiguos: (v.sub.formerNames ?? []).map((f) => f.name).slice(0, 4).join(" · "),
    comprobacion: motivo, estado: nivel === "A" || nivel === "fuente" ? "verificado" : "revisar",
  });
  // ⚠️ EL ORDEN DE LAS PRUEBAS DECIDE EL RESULTADO, y la primera versión lo tenía al revés.
  //
  // La prueba del nombre del fichero es gratis (no descarga nada), así que la puse la primera.
  // Consecuencia: se quedaba con el primer candidato que tuviera un fichero `{ticker}-…` y
  // **104 de 120 resoluciones acabaron descansando en la más débil de las tres pruebas**, sin
  // que ninguna llegara a mirar el texto. Así entró Wendy's como dueña de `TWC`.
  //
  // Ahora va al final: primero el TEXTO —donde el emisor declara su símbolo— sobre todos los
  // candidatos y en las dos ventanas, y sólo si nadie pasa se recurre al nombre del fichero,
  // que además queda anotado como evidencia de nivel «C» para poder revisarla aparte.
  const pasadas = [
    ["A", (v) => tickerEsDe(v.cik, ticker, v.sub.name, v.dentro, { intentos: 3, sinFichero: true }), (m) => m],
    ["B", (v) => tickerEsDe(v.cik, ticker, v.sub.name, v.todas, { intentos: 3, sinFichero: true }), (m) => `fuera del periodo en el índice — ${m}`],
    ["C", (v) => tickerEsDe(v.cik, ticker, v.sub.name, v.dentro, { soloFichero: true }), (m) => m],
  ];
  for (const [nivel, prueba, texto] of pasadas) {
    for (const v of vivos) {
      traza(`${nivel} · ${String(v.sub.name).slice(0, 30)}`);
      const r = await prueba(v);
      if (r.ok) { elegido = anotar(v, nivel, texto(r.motivo)); break; }
      if (nivel === "A") descartes.push(`${v.cik} (${v.sub.name}): ${r.motivo}`);
    }
    if (elegido) break;
  }

  if (elegido) { filas.push(elegido); traza(`✓${elegido.evidencia === "A" ? "" : elegido.evidencia} ${String(elegido.nombre).slice(0, 40)}`); }
  // Cada quince nombres, por si esto muere: quince es poco trabajo que perder y pocas
  // escrituras de más.
  if (!solo && n % 15 === 0) guardar();
  else { sinResolver.push({ ticker, desde, hasta, motivo: "ningún candidato declara el símbolo en su portada", descartes: descartes.slice(0, 6) }); traza("✗ ningún candidato pasa la portada"); }
}
console.log("\n");

// ── Resultado ─────────────────────────────────────────────────────────────────────────────
const porNivel = (x) => filas.filter((f) => f.evidencia === x);
const verificados = filas.filter((f) => f.estado === "verificado");
const aRevisar = filas.filter((f) => f.estado === "revisar");
console.log(`  VERIFICADOS (entran solos): ${verificados.length}   ·   a revisar a mano: ${aRevisar.length}   ·   sin resolver: ${sinResolver.length}`);
console.log(`     nivel A (símbolo en portada dentro del periodo): ${porNivel("A").length}`);
console.log(`     nivel B (símbolo en portada, otro momento):      ${porNivel("B").length}`);
console.log(`     nivel C (sólo el nombre del fichero — el más débil): ${porNivel("C").length}`);
console.log(`     fuente mantenida (empareja ticker y CIK):        ${porNivel("fuente").length}\n`);

for (const f of verificados.slice().sort((a, b) => a.ticker.localeCompare(b.ticker))) {
  console.log(`    ${f.ticker.padEnd(8)} ${f.cik}  ${String(f.nombre).slice(0, 36).padEnd(37)} [${f.evidencia}]`);
}
if (aRevisar.length) {
  console.log(`
  ── A REVISAR A MANO (${aRevisar.length}) — NO se publican hasta confirmarlos en research/data/cik_revisados.json ──`);
  for (const f of aRevisar.sort((a, b) => a.ticker.localeCompare(b.ticker))) {
    console.log(`    ${f.ticker.padEnd(8)} ${f.cik}  ${String(f.nombre).slice(0, 30).padEnd(31)} [${f.evidencia}] ${f.desde}→${f.hasta}`);
    console.log(`             ${f.comprobacion}`);
  }
}
if (sinResolver.length) {
  console.log(`\n  ── SIN RESOLVER (${sinResolver.length}) ──`);
  console.log(`    ${sinResolver.map((x) => x.ticker).join(" ")}`);
}

if (solo) {
  console.log("\n  (--solo: prueba de depuración, no se escribe research/out/resolucion_cik.json)\n");
  for (const s of sinResolver) if (s.descartes?.length) console.log(`    ${s.ticker}: ${s.descartes.join("\n              ")}`);
  process.exit(0);
}

// Aquí sólo se escribe la EVIDENCIA. Convertirla en los ficheros que consume el código es un
// paso aparte —`research/publicar_resolucion.mjs`— porque esto tarda dos horas y aquello dos
// segundos: separarlos permite rehacer los mapas sin volver a interrogar a la SEC entera.
guardar();
console.log(`\n  → ${ruta}\n`);
