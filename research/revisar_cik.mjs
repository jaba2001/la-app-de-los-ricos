// ─────────────────────────────────────────────────────────────────────────────
// REVISAR A MANO UN TICKER QUE EL RESOLUTOR NO PUDO VERIFICAR SOLO
//
// `resolver_cik.mjs` acepta por su cuenta el nivel A —el emisor declara el símbolo en un
// documento suyo dentro del periodo en el índice— y manda los niveles B y C aquí, porque
// producen CIK equivocados y creíbles: Wendy's quedó como dueña del ticker de Time Warner
// Cable, y LSI Industries (que cotiza como `LYTS`) como dueña de `LSI`.
//
// Hace dos cosas:
//
//   · **Pone la evidencia delante.** Por cada candidato: quién es según la SEC, sus nombres
//     anteriores, cuántos informes presentó DENTRO del periodo, y qué dice cada una de las tres
//     pruebas por separado — de modo que se vea si la única que pasa es la débil.
//
//   · **Propone**, cuando hay corroboración de dos fuentes independientes. El resolutor sólo
//     mira a la SEC, y la SEC no guarda tickers históricos; el proveedor de precios sí guarda
//     el NOMBRE de la empresa que llevaba cada símbolo. Cuando ese nombre coincide con los
//     `formerNames` del CIK **y** las fechas cuadran, la decisión deja de ser un juicio y pasa
//     a ser una comprobación. Ver `UMBRAL_NOMBRE` y la regla que lo acompaña.
//
// Todo queda en `research/data/cik_revisados.json`, con su motivo y su evidencia, y una
// decisión ya escrita nunca se pisa: si una persona decidió algo, manda sobre la regla.
//
//   node research/revisar_cik.mjs TWC LSI CBS      (sólo mira, no escribe)
//   node research/revisar_cik.mjs --pendientes --proponer
//   node research/revisar_cik.mjs --sin-resolver --proponer   (los que no resolvió en absoluto)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical } from "./universe.mjs";
import { submissions, periodicasTodas, enPeriodo, tickerEsDe, ficheroLlevaTicker, nombresVigentesEn, mismoNombre } from "./portada.mjs";
import { floatPublico } from "./float_publico.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "Scora Research contact@scora.app" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rutaRes = join(AQUI, "out", "resolucion_cik.json");
const res = existsSync(rutaRes) ? JSON.parse(readFileSync(rutaRes, "utf8")) : { detalle: [], noResueltos: [] };

let pedidos = process.argv.slice(2).filter((x) => !x.startsWith("--")).map((x) => x.toUpperCase());
if (process.argv.includes("--pendientes")) {
  pedidos = (res.detalle ?? []).filter((f) => f.estado === "revisar").map((f) => f.ticker);
}
// Los que el resolutor no resolvió EN ABSOLUTO. Aquí es donde más rinde la búsqueda por
// nombre: el resolutor sólo sabe buscar por símbolo y por texto, y para una empresa muerta
// hace años ninguna de las dos encuentra nada — pero «Whole Foods Market Inc» sí.
if (process.argv.includes("--sin-resolver")) {
  for (const x of res.noResueltos ?? []) if (!pedidos.includes(x.ticker)) pedidos.push(x.ticker);
}
// ⚠️ ESTE FICHERO ES UN SCRIPT, NO UNA BIBLIOTECA. Importarlo lo ejecutaba, y eso ya ha pasado
// TRES veces en esta sesión: el guardián de datos reescribió los mapas al importar el
// publicador, `revisar_cik.mjs` lanzó una auditoría de 86 CIK al importar `float_publico.mjs`,
// y una verificación dirigida abortó con el mensaje de uso al importar esto. Las funciones
// puras se han movido a `portada.mjs` y `alias_reglas.mjs`; aquí queda sólo el guion.
if (!process.argv[1] || fileURLToPath(import.meta.url) !== process.argv[1]) {
  throw new Error("research/revisar_cik.mjs es un script: ejecútalo, no lo importes. Las funciones puras están en portada.mjs y alias_reglas.mjs.");
}
if (!pedidos.length) { console.error("  uso: node research/revisar_cik.mjs TWC LSI   |   --pendientes   |   --sin-resolver"); process.exit(1); }

// INCREMENTAL en modo masivo: lo ya decidido no se vuelve a mirar. Sin esto, reanudar tras
// agotar la cuota del proveedor —que pasa cada ~50 consultas— repite desde el principio todo
// el trabajo de EDGAR y vuelve a quedarse en el mismo sitio. Con `--proponer` una decisión
// escrita nunca se pisa, así que saltarla no cambia el resultado: sólo el tiempo.
if (process.argv.includes("--proponer") && (process.argv.includes("--pendientes") || process.argv.includes("--sin-resolver"))) {
  const rutaDec = join(AQUI, "data", "cik_revisados.json");
  let ya = {};
  try { if (existsSync(rutaDec)) ya = JSON.parse(readFileSync(rutaDec, "utf8"))?.decisiones ?? {}; } catch { ya = {}; }
  const antes = pedidos.length;
  pedidos = pedidos.filter((t) => !ya[t]);
  if (antes !== pedidos.length) console.log(`
  ${antes - pedidos.length} ya tenían decisión escrita y se saltan; quedan ${pedidos.length}`);
}

const table = await loadSP500Historical();
const primera = new Map(), ultima = new Map();
for (const f of table ?? []) {
  if (f.date < "2010-01-01") continue;
  for (const t of f.tickers) { if (!primera.has(t)) primera.set(t, f.date); ultima.set(t, f.date); }
}

/**
 * QUIÉN ERA ESE TICKER, SEGÚN EL PROVEEDOR DE PRECIOS.
 *
 * `resolver_cik.mjs` sólo mira a la SEC, y la SEC no guarda tickers históricos. Tiingo sí
 * guarda el NOMBRE de la empresa que llevaba cada símbolo, y eso convierte muchas revisiones
 * de «a ojo» en «contra una fuente»: `TWC` devuelve «Time Warner Cable Inc», que casa con los
 * `formerNames` del CIK 1377013 y descarta a Wendy's sin discusión.
 *
 * ⚠️ CON UNA CONDICIÓN, y sin ella este atajo se vuelve una trampa: cuando un símbolo se
 * reutiliza, Tiingo devuelve al ÚLTIMO dueño, no al nuestro. `LSI` devuelve «Life Storage Inc»
 * (hasta 2023), pero el `LSI` que estuvo en el índice en 2010-2014 era LSI Corporation, la de
 * semiconductores. Lo que separa un caso del otro es la **fecha final**: la de TWC es el
 * 2016-05-26 y el índice lo tuvo hasta el 2016-05-17 —nueve días—, mientras que la de LSI queda
 * nueve AÑOS más tarde. Si no casa, el nombre que da Tiingo no habla de nuestra empresa.
 */
async function identidadTiingo(ticker, hasta) {
  const TOK = process.env.TIINGO_TOKEN || "";
  if (!TOK) return { estado: "sin token" };
  try {
    const r = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}?token=${TOK}`, { headers: { "Content-Type": "application/json" } });
    if (r.status === 429 || r.status === 403) return { estado: "cuota" };
    if (!r.ok) return { estado: `HTTP ${r.status}` };
    const j = await r.json();
    const fin = String(j?.endDate ?? "").slice(0, 10);
    const dias = fin ? Math.round((new Date(fin) - new Date(hasta)) / 86400000) : null;
    return {
      estado: "ok", nombre: j?.name ?? "", mercado: j?.exchangeCode ?? "",
      desde: String(j?.desde ?? j?.startDate ?? "").slice(0, 10), hasta: fin, dias,
      // 400 días: el mismo margen que usa `simbolos_reutilizados.mjs` para la cola. Si el
      // proveedor NO da fecha final —`BNI`, `NOVL`— eso no es prueba de reutilización: se
      // deja pasar aquí y decide el reloj de la SEC, que es el último informe del candidato.
      hablaDeNuestraEmpresa: dias == null || dias <= 400,
      sinFecha: dias == null,
    };
  } catch { return { estado: "red" }; }
}

/**
 * BÚSQUEDA POR NOMBRE — la vía que estaba descartada y que ahora sí sirve.
 *
 * `browse-edgar?company=` se descartó al principio porque buscar «ABC» por nombre devuelve
 * *Joshua Gold Resources* (su nombre anterior era «ABC Acquisition Corp 1501»). Pero eso era
 * buscar un TICKER como si fuera un nombre. Con el nombre de verdad —«Whole Foods Market
 * Inc», «Burlington Northern Santa Fe», «Medco Health Solutions»— la búsqueda es precisa,
 * y el nombre lo da ahora el proveedor de precios.
 *
 * Sigue sin aceptarse nada por su cuenta: lo que devuelva pasa por las mismas comprobaciones.
 */
async function porNombre(nombre) {
  if (!nombre) return [];
  // La SEC indexa por el principio del nombre; los sufijos societarios sólo estorban.
  const limpio = nombre.replace(/\b(Inc|Corp|Corporation|Co|Company|Ltd|PLC|LLC|Holdings?|Group)\b\.?/gi, " ").replace(/[^A-Za-z0-9 &]/g, " ").replace(/\s+/g, " ").trim();
  if (limpio.length < 4) return [];
  try {
    const r = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(limpio)}&type=10-K&dateb=&owner=include&count=10&output=atom`, { headers: UA });
    if (!r.ok) return [];
    const t = await r.text();
    return [...t.matchAll(/<cik>(\d+)<\/cik>/gi)].map((m) => m[1].padStart(10, "0"));
  } catch { return []; }
}

/** Los mismos candidatos que baraja el resolutor, para poder comparar con lo que eligió. */
async function candidatos(ticker, desde, hasta, nombreProveedor) {
  const vistos = new Map();
  try {
    const r = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=5&output=atom`, { headers: UA });
    if (r.ok) { const c = (await r.text()).match(/<cik>(\d+)<\/cik>/i); if (c) vistos.set(c[1].padStart(10, "0"), "por símbolo"); }
  } catch { /* sigue con la otra vía */ }
  await sleep(250);
  const a = desde < "2001-01-01" ? "2001-01-01" : desde;
  for (let p = 0; p < 4; p++) {
    try {
      const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${ticker}"`)}&forms=10-K&startdt=${a}&enddt=${hasta}&from=${p * 10}`, { headers: UA });
      if (!r.ok) break;
      const hits = (await r.json())?.hits?.hits ?? [];
      if (!hits.length) break;
      for (const h of hits) { const c = String(h?._source?.ciks?.[0] ?? "").padStart(10, "0"); if (c && !vistos.has(c)) vistos.set(c, "texto completo"); }
    } catch { break; }
    await sleep(250);
  }
  // La vía por nombre va la última porque necesita el nombre que da el proveedor de precios,
  // pero es la más precisa de todas cuando ese nombre existe.
  if (nombreProveedor) {
    await sleep(250);
    for (const c of await porNombre(nombreProveedor)) if (!vistos.has(c)) vistos.set(c, "por nombre");
  }
  return [...vistos.entries()].map(([cik, via]) => ({ cik, via }));
}

/**
 * LA REGLA DE CORROBORACIÓN, que es lo que hace esto escalable sin bajar el listón.
 *
 * Un candidato queda propuesto cuando **dos fuentes independientes dicen que es la misma
 * empresa** y las fechas cuadran:
 *
 *   1. el proveedor de precios da un nombre para ese ticker, y su última cotización cae dentro
 *      del margen de la salida del índice (si no, ese nombre es del heredero del símbolo);
 *   2. ese nombre coincide con el nombre actual o con alguno de los `formerNames` del CIK;
 *   3. y el CIK presentó informes periódicos DENTRO del periodo en el índice.
 *
 * `TWC` lo pasa con las tres: «Time Warner Cable Inc» hasta el 2016-05-26 (nueve días después
 * de salir), 100 % de coincidencia con los `formerNames` del CIK 1377013, y 28 informes dentro
 * del periodo. Wendy's no pasa ninguna.
 */
const UMBRAL_NOMBRE = 0.6;
const PROPONER = process.argv.includes("--proponer");
const propuestas = {};

for (const ticker of pedidos) {
  const desde = primera.get(ticker), hasta = ultima.get(ticker);
  if (!desde) { console.log(`\n  ${ticker}: no figura como miembro del índice desde 2010`); continue; }
  const eligio = (res.detalle ?? []).find((f) => f.ticker === ticker);
  console.log(`\n${"═".repeat(96)}`);
  console.log(`  ${ticker}   ·   en el índice ${desde} → ${hasta}`);
  if (eligio) console.log(`  el resolutor propuso ${eligio.cik} («${eligio.nombre}»), evidencia [${eligio.evidencia}]: ${eligio.comprobacion}`);
  const id = await identidadTiingo(ticker, hasta);
  if (id.estado === "ok") {
    console.log(`  el proveedor de precios dice que ${ticker} era «${id.nombre}» (${id.mercado}), cotizando hasta ${id.hasta}`);
    console.log(`  ${id.hablaDeNuestraEmpresa
      ? (id.sinFecha ? `→ sin fecha final; decidirá el último informe de cada candidato` : `→ termina ${id.dias} días después de salir del índice: SÍ habla de nuestra empresa`)
      : `→ ⚠ termina ${id.dias} días después de salir del índice, así que este nombre puede ser de otra empresa. Caben las dos cosas y no se distinguen solas: Apollo (APOL) salió del índice en 2013 y siguió cotizando hasta 2017 siendo la misma; Life Storage heredó el símbolo LSI años después de que lo dejara LSI Corporation. Decide una persona.`}`);
  } else console.log(`  el proveedor de precios no da identidad (${id.estado})`);
  console.log(`${"═".repeat(96)}`);

  let mejor = null;
  for (const c of (await candidatos(ticker, desde, hasta, id.estado === "ok" ? id.nombre : null)).slice(0, 8)) {
    await sleep(200);
    const s = await submissions(c.cik);
    if (!s) { console.log(`\n    ${c.cik}  (la SEC no responde)`); continue; }
    const todas = await periodicasTodas(s);
    const dentro = enPeriodo(todas, desde, hasta);
    console.log(`\n    ${c.cik}  ${String(s.name).slice(0, 42).padEnd(43)} vía ${c.via}${c.cik === eligio?.cik ? "   ← el propuesto" : ""}`);
    if (s.formerNames?.length) console.log(`        antes: ${s.formerNames.map((f) => `${f.name} (hasta ${String(f.to).slice(0, 10)})`).join(" · ").slice(0, 120)}`);
    console.log(`        tickers hoy: ${(s.tickers ?? []).join(",") || "(ninguno)"}   ·   SIC: ${String(s.sicDescription ?? "?").slice(0, 40)}`);
    // El parecido se calcula SIEMPRE, aunque las fechas no cuadren. Si no, un caso como `APOL`
    // —Apollo Education Group salió del índice en 2013 y siguió cotizando hasta que la
    // compraron en 2017— llega a la revisión humana sin la evidencia que lo resuelve, que es
    // justamente que el nombre coincide al 100 %. Lo que la fecha decide es si se puede
    // PROPONER solo, no si el dato se enseña.
    let sim = 0;
    if (id.estado === "ok" && id.nombre) {
      const vigentes = nombresVigentesEn(s, desde, hasta);
      sim = vigentes.length ? Math.max(...vigentes.map((n) => mismoNombre(id.nombre, n))) : 0;
      const marca = sim >= UMBRAL_NOMBRE ? (id.hablaDeNuestraEmpresa ? "   ← COINCIDE" : "   ← coincide, pero la fecha no cuadra: decide una persona") : "";
      console.log(`        se llamaba entonces: ${vigentes.join(" / ").slice(0, 70) || "(no consta)"}`);
      console.log(`        parecido con «${id.nombre}»: ${(sim * 100).toFixed(0)} %${marca}`);
    }
    console.log(`        informes periódicos: ${todas.length} en total, ${dentro.length} dentro del periodo${dentro.length ? ` (${dentro.at(-1).fecha} → ${dentro[0].fecha})` : ""}`);
    if (!dentro.length) { console.log(`        → no presentó nada mientras el ticker estaba en el índice: no puede ser`); continue; }

    // ⚠️ ¿TENÍA ACCIONES EN MANOS DEL PÚBLICO? Una filial que sólo emite deuda presenta los
    // MISMOS documentos que su matriz —a veces literalmente el mismo, co-firmado—, así que
    // nombre, fichero y texto coinciden y ninguna prueba anterior las separa. `CSC Holdings`
    // llegó a proponerse como dueña de `CVC` por eso. El flotante sí las separa: la matriz de
    // Cablevision declara 8.030 M$ y CSC Holdings no declara ninguno.
    await sleep(200);
    const fl = await floatPublico(c.cik, desde, hasta);
    console.log(`        flotante público: ${fl.max == null ? "NINGUNO declarado → no pudo ser miembro del índice" : (fl.max / 1e9).toFixed(2) + " mil M$"}`);
    if (fl.max == null) continue;

    const soloFich = dentro.filter((x) => ficheroLlevaTicker(x.doc, ticker, s.name)).slice(0, 3).map((x) => x.doc);
    // ⚠️ LAS PRUEBAS DE TEXTO SON CARAS Y NO DECIDEN AQUÍ. Descargan hasta seis documentos de
    // varios MB por candidato, y en modo masivo eso son dos horas y media para 35 tickers. Lo
    // que decide una propuesta es la identidad corroborada —el nombre que el proveedor asocia
    // al símbolo y su fecha final—, no el texto; y además el resolutor ya probó el texto de
    // todos estos candidatos y por eso están aquí. Se conservan para la inspección de un
    // ticker suelto, que es cuando hacen falta todos los datos delante.
    if (!PROPONER) {
      const A = await tickerEsDe(c.cik, ticker, s.name, dentro, { intentos: 3, sinFichero: true });
      const B = A.ok ? null : await tickerEsDe(c.cik, ticker, s.name, todas, { intentos: 3, sinFichero: true });
      console.log(`        [A] texto dentro del periodo  : ${A.ok ? "✓ " + A.motivo : "✗ " + A.motivo}`);
      if (B) console.log(`        [B] texto en cualquier fecha  : ${B.ok ? "✓ " + B.motivo : "✗ " + B.motivo}`);
    }
    console.log(`        [C] ficheros con el ticker    : ${soloFich.join(", ") || "(ninguno)"}`);
    const ultimo = todas.length ? todas.map((x) => x.fecha).sort().at(-1) : null;
    const dejoDePresentar = ultimo != null && Math.round((new Date(ultimo) - new Date(hasta)) / 86400000) <= 400;
    if (id.sinFecha && sim >= UMBRAL_NOMBRE) console.log(`        último informe del candidato: ${ultimo} → ${dejoDePresentar ? "cuadra con la salida del índice" : "⚠ sigue presentando mucho después"}`);
    // ⚠️ `id.hablaDeNuestraEmpresa` es OBLIGATORIO, y va escrito aparte para que no se pierda:
    // desde que el parecido se calcula siempre, sin esta condición `LSI` volvería a proponerse
    // como Life Storage — el nombre casa al 100 %, y lo único que lo desmiente es que esa serie
    // termina nueve años después de que el ticker saliera del índice.
    //
    // Y se guarda el MEJOR, no el primero que pasa el umbral: en `TWC` había un segundo
    // candidato al 67 %, y con «el primero que pase» habría ganado él de haber salido antes.
    if (id.hablaDeNuestraEmpresa && sim >= UMBRAL_NOMBRE && (!id.sinFecha || dejoDePresentar)) {
      if (!mejor || sim > mejor.sim) mejor = { cik: c.cik, sim, nombre: s.name, antes: s.formerNames?.[0]?.name ?? null, informes: dentro.length };
    }
  }

  if (mejor) {
    propuestas[ticker] = {
      cik: mejor.cik,
      motivo: `identidad corroborada: el proveedor de precios dice que ${ticker} era «${id.nombre}» hasta ${id.hasta}`
        + `${id.dias == null ? "" : ` (${id.dias} días tras salir del índice)`}, coincide al ${(mejor.sim * 100).toFixed(0)} % con «${mejor.nombre}»`
        + `${mejor.antes ? ` / «${mejor.antes}»` : ""}, y ese CIK presentó ${mejor.informes} informes dentro del periodo`,
      revisadoEl: new Date().toISOString().slice(0, 10),
      // Contra qué candidato se decidió. Si el resolutor cambia de opinión en una pasada futura,
      // la decisión sigue mandando pero el publicador avisa de que conviene volver a mirarla.
      cikPropuestoEntonces: eligio?.cik ?? null,
      propuestoPor: "research/revisar_cik.mjs --proponer",
    };
    console.log(`\n    ★ PROPUESTO: ${ticker} → ${mejor.cik} («${mejor.nombre}», ${(mejor.sim * 100).toFixed(0)} %)`);
  }
}

// ── Resultado ─────────────────────────────────────────────────────────────────────────────
const sinPropuesta = pedidos.filter((t) => !propuestas[t]);
console.log(`\n${"═".repeat(96)}`);
console.log(`  propuestos por identidad corroborada: ${Object.keys(propuestas).length} de ${pedidos.length}`);
for (const [t, d] of Object.entries(propuestas)) console.log(`    ${t.padEnd(8)} → ${d.cik}   ${d.motivo.slice(0, 110)}`);
if (sinPropuesta.length) {
  console.log(`\n  Sin propuesta — decisión enteramente humana (${sinPropuesta.length}):`);
  console.log(`    ${sinPropuesta.join(" ")}`);
}

if (PROPONER) {
  const ruta = join(AQUI, "data", "cik_revisados.json");
  const previo = existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : { decisiones: {} };
  if (!previo.decisiones) previo.decisiones = {};
  // Una decisión ya escrita NUNCA se pisa: si una persona decidió algo, manda sobre la regla.
  let nuevas = 0;
  for (const [t, d] of Object.entries(propuestas)) {
    if (previo.decisiones[t]) continue;
    previo.decisiones[t] = d;
    nuevas++;
  }
  writeFileSync(ruta, JSON.stringify(previo, null, 1));
  console.log(`\n  → ${nuevas} decisiones nuevas en research/data/cik_revisados.json (las existentes no se tocan)`);
} else {
  console.log(`\n  (sin --proponer no se escribe nada)`);
}
console.log(`  Después: node research/publicar_resolucion.mjs\n`);
