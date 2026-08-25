// ─────────────────────────────────────────────────────────────────────────────
// ¿TENÍA ESE CIK ACCIONES EN MANOS DEL PÚBLICO?
//
// Un miembro del S&P 500 es, por definición, una empresa con capital flotante. Una FILIAL que
// sólo emite deuda presenta 10-K igual que su matriz —a menudo el MISMO documento, co-firmado—
// pero no tiene float. Y eso las hace indistinguibles para todas las pruebas anteriores:
//
//   · el nombre coincide (CSC Holdings se llamó «Cablevision Systems Corp» hasta 1998),
//   · el fichero coincide (`cvc-03312016x10q.htm` lo presentan las dos),
//   · y el texto coincide, porque es literalmente el mismo texto.
//
// `dei:EntityPublicFloat` sí las separa, y de forma tajante: la matriz de Cablevision declara
// 8.030 M$ de flotante y CSC Holdings devuelve **404 — ninguna observación**. Comprobado
// también contra Apple (709.920 M$) y Time Warner Cable (50.400 M$).
//
// Esto NO decide por sí solo quién es el dueño de un ticker: decide quién NO puede serlo.
//
//   node research/float_publico.mjs             (audita los CIK publicados)
//   node research/float_publico.mjs 0000784681  (consulta uno suelto)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Scora Research contact@scora.app" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Flotante máximo declarado por ese CIK dentro de un periodo (o en toda su historia si no se
 * acota). Devuelve `null` cuando la SEC no tiene ninguna observación — que es la señal.
 */
export async function floatPublico(cik, desde = null, hasta = null) {
  try {
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/dei/EntityPublicFloat.json`, { headers: UA });
    if (!r.ok) return { max: null, n: 0, estado: r.status };
    const u = (await r.json())?.units?.USD ?? [];
    if (!u.length) return { max: null, n: 0, estado: 200 };
    const dentro = desde && hasta ? u.filter((x) => x.end >= desde && x.end <= hasta) : u;
    const usar = dentro.length ? dentro : u;
    return { max: Math.max(...usar.map((x) => x.val)), n: u.length, enPeriodo: dentro.length, estado: 200 };
  } catch {
    return { max: null, n: 0, estado: "red" };
  }
}

// ⚠️ NADA DE LO QUE SIGUE SE EJECUTA AL IMPORTAR ESTE FICHERO.
//
// `floatPublico` es una función que otros módulos usan como filtro, pero este fichero es
// además un script con efectos: audita, imprime y escribe en `research/out/`. Sin esta guarda,
// importarlo lo EJECUTA — y eso ya pasó dos veces en esta sesión: el guardián de datos
// reescribió los mapas al importar el publicador, y `revisar_cik.mjs` lanzó una auditoría de
// 86 CIK sólo por pedir prestada una función.
const esEntrada = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (!esEntrada) { /* importado como biblioteca: sólo se exporta `floatPublico` */ }
else {

// ── Modo consulta suelta ──────────────────────────────────────────────────────────────────
const sueltos = process.argv.slice(2).filter((x) => /^\d{10}$/.test(x));
if (sueltos.length) {
  for (const c of sueltos) {
    const f = await floatPublico(c);
    console.log(`  ${c}  ${f.max == null ? "SIN FLOTANTE DECLARADO" : `${(f.max / 1e9).toFixed(2)} mil M$ (${f.n} observaciones)`}`);
    await sleep(300);
  }
  process.exit(0);
}

// ── Auditoría de lo publicado ─────────────────────────────────────────────────────────────
const rutaMapa = join(AQUI, "data", "cik_historicos.json");
const rutaRes = join(AQUI, "out", "resolucion_cik.json");
if (!existsSync(rutaRes)) { console.error("  ✖ falta research/out/resolucion_cik.json"); process.exit(1); }
const detalle = JSON.parse(readFileSync(rutaRes, "utf8")).detalle ?? [];
const mapa = existsSync(rutaMapa) ? JSON.parse(readFileSync(rutaMapa, "utf8")).mapa ?? {} : null;

// Si el mapa aún no está publicado se auditan los verificados, que es lo que se publicaría.
const objetivo = mapa && Object.keys(mapa).length
  ? Object.entries(mapa).map(([ticker, cik]) => ({ ticker, cik }))
  : detalle.filter((f) => f.estado === "verificado").map((f) => ({ ticker: f.ticker, cik: f.cik }));

console.log(`\n  ${objetivo.length} CIK a comprobar${mapa && Object.keys(mapa).length ? " (los publicados)" : " (los verificados; el mapa aún no está publicado)"}\n`);

const filas = [];
let n = 0;
for (const { ticker, cik } of objetivo) {
  const fila = detalle.find((f) => f.ticker === ticker);
  await sleep(200);
  const f = await floatPublico(cik, fila?.desde, fila?.hasta);
  filas.push({ ticker, cik, nombre: fila?.nombre ?? "", evidencia: fila?.evidencia ?? "", floatMax: f.max, observaciones: f.n, enPeriodo: f.enPeriodo ?? 0 });
  process.stdout.write(`\r  ${String(++n).padStart(3)}/${objetivo.length}  ${ticker.padEnd(8)} ${f.max == null ? "sin flotante" : (f.max / 1e9).toFixed(1) + " mil M$"}          `);
}
console.log("\n");

const sinFloat = filas.filter((f) => f.floatMax == null);
const pequenos = filas.filter((f) => f.floatMax != null && f.floatMax < 1e9);
console.log(`  con flotante: ${filas.length - sinFloat.length}   ·   SIN flotante declarado: ${sinFloat.length}   ·   por debajo de 1.000 M$: ${pequenos.length}\n`);
if (sinFloat.length) {
  console.log("  ── SIN FLOTANTE: no pueden haber sido miembros del S&P 500 con ese CIK ──");
  for (const f of sinFloat) console.log(`    ${f.ticker.padEnd(8)} ${f.cik}  ${String(f.nombre).slice(0, 40).padEnd(41)} [${f.evidencia}]`);
}
if (pequenos.length) {
  console.log("\n  ── FLOTANTE MENOR DE 1.000 M$: sospechoso para un miembro del índice ──");
  for (const f of pequenos.sort((a, b) => a.floatMax - b.floatMax)) console.log(`    ${f.ticker.padEnd(8)} ${f.cik}  ${(f.floatMax / 1e6).toFixed(0).padStart(6)} M$  ${String(f.nombre).slice(0, 36)} [${f.evidencia}]`);
}

writeFileSync(join(OUT, "float_publico.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  criterio: "dei:EntityPublicFloat de la SEC. Un miembro del S&P 500 tiene capital flotante; una filial que sólo emite deuda presenta los mismos documentos que su matriz pero no declara flotante.",
  comprobados: filas.length, sinFlotante: sinFloat.length, menoresDe1000M: pequenos.length,
  detalle: filas.sort((a, b) => a.ticker.localeCompare(b.ticker)),
}, null, 1));
console.log(`\n  → research/out/float_publico.json\n`);

}
