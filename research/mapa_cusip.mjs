// ─────────────────────────────────────────────────────────────────────────────
// CUSIP → TICKER, POR LA VÍA PÚBLICA
//
// El 13F identifica cada posición por CUSIP, y el mapeo CUSIP→ticker está licenciado. Pero hay
// una vía pública en dos saltos, y la mido aquí en vez de suponerla:
//
//   1. **CUSIP → nombre**: los N-PORT de fondos indexados, con `cusip`, `name`, `isin` y `lei`.
//
//      ⚠️ **UN FICHERO NO ES «EL MERCADO», y eso me costó una premisa.** Escribí que un solo
//      N-PORT de Vanguard con 545 posiciones cubría lo necesario. Es falso: un registrante como
//      «Vanguard Index Funds» agrupa DECENAS de fondos —500 Index, Growth, Value, Small-Cap…— y
//      cada uno presenta su propio N-PORT. El primero que salió era de otro fondo, y el mapa
//      resultante cubría **28 de los 503 nombres del universo, un 6 %**.
//
//      Hay que recorrer VARIAS presentaciones y acumular. Y comprobar la cobertura contra el
//      universo propio, no contra el total de CUSIP encontrados: un mapa del 85 % de un fondo que
//      no tiene tus nombres es un mapa del 0 % para ti.
//   2. **Nombre → ticker**: `company_tickers.json` de la SEC (10.391 empresas).
//
// ⚠️ EL SEGUNDO SALTO ES UN EMPAREJAMIENTO POR NOMBRE, o sea la misma familia de trampa que el
// nivel B de los CIK — la que produjo «Wendy's como dueña de TWC». Aquí es más segura porque el
// primer salto es un CUSIP exacto, pero el segundo sigue siendo textual: **lo que no case sin
// ambigüedad se queda fuera y se dice**, nunca se elige el candidato más probable.
//
// Y una lección barata: sin decodificar las entidades XML, «Moelis &amp; Co» no casa con nada.
// Eso ya mordió la primera vez que medí esto.
//
//   node --experimental-strip-types --no-warnings research/mapa_cusip.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "scora-research alealvarado804@gmail.com", "Accept-Encoding": "gzip, deflate" };
const j = async (u) => { const r = await fetch(u, { headers: UA }); return r.ok ? r.json() : null; };

/** Fondos indexados amplios: entre unos pocos cubren el mercado estadounidense. */
const FONDOS = [
  // iShares Trust presenta el N-PORT del Core S&P 500 (IVV), que tiene EXACTAMENTE el universo
  // que Scora sigue. Va primero por eso: los demás rellenan lo que quede.
  ["iShares Trust", "0001100663"],
  ["Vanguard Index Funds", "0000036405"],
  ["Vanguard Institutional Index Funds", "0000862084"],
];

const decodificar = (s) => String(s)
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");

/**
 * Normaliza un nombre societario para poder compararlo.
 *
 * ⚠️ CUATRO DIFERENCIAS REALES entre lo que dice un N-PORT y lo que dice `company_tickers.json`,
 * todas encontradas al medir por qué fallaban nombres grandes del S&P 500:
 *
 *   · **Sufijo de estado.** «APPLIED MATERIALS INC /DE», «BANK OF AMERICA CORP /DE/».
 *   · **`&` frente a `AND`.** «Air Products & Chemicals» contra «AIR PRODUCTS AND CHEMICALS».
 *   · **Orden de palabras.** La SEC conserva la vieja convención de apellido primero:
 *     «SMITH A O CORP» es A. O. Smith. Se ordenan los tokens, que lo resuelve sin adivinar —y si
 *     dos empresas distintas colisionaran, quedarían AMBIGUAS y fuera, que es lo correcto.
 *   · **Convención del ticker.** La SEC escribe `BRK-B` y la tabla del índice `BRK.B`.
 *
 * Sin estas cuatro, la cobertura del universo se quedaba en el 74 % con los datos ya descargados:
 * el cuello no era la cobertura de los fondos sino esta función.
 */
const norm = (s) => decodificar(s).toUpperCase()
  .replace(/\/[A-Z]{2,}\/?\s*$/g, " ")                 // sufijo de estado: /DE, /DE/
  .replace(/&/g, " AND ")
  .replace(/[.,'"()]/g, " ")
  .replace(/\b(INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|PLC|HOLDINGS?|GROUP|THE|CLASS [A-C]|COM|NEW|LLC|LP|SA|NV|AG|TRUST|REIT)\b/g, " ")
  .replace(/\s+/g, " ").trim()
  .split(" ").sort().join(" ");                        // orden de palabras: «SMITH A O» = «A O SMITH»

/** `BRK-B` (SEC) → `BRK.B` (tabla del índice). La misma convención que ya normaliza universe.mjs. */
const normTicker = (t) => String(t).replace(/-/g, ".");

// ── 1 · nombre → ticker, de la SEC ───────────────────────────────────────────────────────
const oficiales = Object.values(await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA })).json());
const porNombre = new Map();
for (const o of oficiales) {
  const k = norm(o.title);
  if (!porNombre.has(k)) porNombre.set(k, new Set());
  porNombre.get(k).add(o.ticker);
}
console.log(`\n  CUSIP → TICKER\n  company_tickers.json: ${oficiales.length} empresas · ${porNombre.size} nombres normalizados`);

// ── 2 · CUSIP → nombre, de los N-PORT ────────────────────────────────────────────────────
const pares = new Map();   // cusip → nombre
// Cuántas presentaciones se recorren por registrante. Cada fondo del grupo presenta la suya, así
// que con una sola se cae en el fondo equivocado — ver la nota de la cabecera.
const POR_REGISTRANTE = Number((process.argv[process.argv.indexOf("--presentaciones") + 1]) || 25);

for (const [nombre, cik] of FONDOS) {
  const s = await j(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = s?.filings?.recent ?? {};
  const indices = [];
  for (let k = 0; k < (r.form ?? []).length && indices.length < POR_REGISTRANTE; k++) {
    if (String(r.form[k]).startsWith("NPORT-P")) indices.push(k);
  }
  if (!indices.length) { console.log(`  ⚠ ${nombre}: sin NPORT-P`); continue; }

  let nuevos = 0, leidas = 0;
  for (const i of indices) {
    const acc = r.accessionNumber[i].replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/primary_doc.xml`;
    const res = await fetch(url, { headers: UA });
    await new Promise((x) => setTimeout(x, 130));
    if (!res.ok) continue;
    leidas++;
    const txt = await res.text();
    for (const b of txt.match(/<invstOrSec>[\s\S]*?<\/invstOrSec>/g) ?? []) {
      if (!/<assetCat>EC<\/assetCat>/.test(b)) continue;      // sólo renta variable
      const c = b.match(/<cusip>([^<]+)<\/cusip>/)?.[1]?.trim();
      const nom = b.match(/<name>([^<]+)<\/name>/)?.[1];
      if (c && nom && !pares.has(c)) { pares.set(c, decodificar(nom).trim()); nuevos++; }
    }
  }
  console.log(`  ${nombre}: ${leidas} presentaciones · ${nuevos} CUSIP nuevos`);
}
console.log(`  CUSIP con nombre: ${pares.size}`);

// ── 3 · Unir los dos saltos ──────────────────────────────────────────────────────────────
const mapa = {};
const ambiguos = [], sinCasar = [];
for (const [cusip, nombre] of pares) {
  const cands = porNombre.get(norm(nombre));
  if (!cands || cands.size === 0) { sinCasar.push({ cusip, nombre }); continue; }
  if (cands.size > 1) { ambiguos.push({ cusip, nombre, candidatos: [...cands] }); continue; }
  mapa[cusip] = { ticker: normTicker([...cands][0]), nombre };
}

const n = pares.size;
console.log(`\n  emparejado sin ambigüedad: ${Object.keys(mapa).length}/${n}  ${(100 * Object.keys(mapa).length / n).toFixed(0)} %`);
console.log(`  ambiguo (varias clases):   ${ambiguos.length}/${n}  ${(100 * ambiguos.length / n).toFixed(0)} %`);
console.log(`  sin casar:                 ${sinCasar.length}/${n}  ${(100 * sinCasar.length / n).toFixed(0)} %`);

// ── 4 · ¿Y cuánto de MI universo queda cubierto? ─────────────────────────────────────────
// Es la pregunta que importa: un mapa del 83 % del mercado no sirve si le faltan los nombres
// que Scora sigue.
const tabla = await loadSP500Historical();
const universo = new Set(membersAsOf(tabla, snapshotDate(tabla)));
const cubiertos = new Set(Object.values(mapa).map((v) => v.ticker).filter((t) => universo.has(t)));
console.log(`\n  del universo de Scora (${universo.size}): con CUSIP conocido ${cubiertos.size}  ${(100 * cubiertos.size / universo.size).toFixed(0)} %`);
const faltan = [...universo].filter((t) => !cubiertos.has(t));
if (faltan.length) console.log(`  sin CUSIP: ${faltan.slice(0, 20).join(" ")}${faltan.length > 20 ? ` … (+${faltan.length - 20})` : ""}`);

if (ambiguos.length) {
  console.log(`\n  ejemplos ambiguos (se quedan FUERA, no se elige el más probable):`);
  for (const a of ambiguos.slice(0, 5)) console.log(`    ${a.cusip}  ${a.nombre.padEnd(34)} → ${a.candidatos.join(" / ")}`);
}

// ⚠️ EL CRITERIO ES LA COBERTURA DEL UNIVERSO, no el % de aciertos del emparejamiento. La
// primera versión daba un 85 % de emparejamiento y sólo el 6 % del universo: la cifra buena
// tapaba la mala.
const cobertura = cubiertos.size / universo.size;
if (cobertura < 0.8) {
  console.error(`\n  ⛔ sólo el ${(100 * cobertura).toFixed(0)} % del universo tiene CUSIP conocido.`);
  console.error(`     El 13F identifica por CUSIP: sin este mapa, esas carteras no se pueden leer.`);
  console.error(`     Añade más fondos a FONDOS o sube --presentaciones antes de seguir.\n`);
}

writeFileSync(join(AQUI, "data", "cusip_ticker.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "N-PORT de fondos indexados (CUSIP→nombre) + company_tickers.json de la SEC (nombre→ticker)",
  criterio: "sólo entra lo que casa SIN AMBIGÜEDAD. Los ambiguos y los que no casan se listan aparte y NO se resuelven adivinando.",
  total: n,
  mapa, ambiguos, sinCasar,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/data/cusip_ticker.json\n`);
