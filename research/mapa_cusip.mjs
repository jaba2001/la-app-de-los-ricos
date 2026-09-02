// ─────────────────────────────────────────────────────────────────────────────
// CUSIP → TICKER, POR LA VÍA PÚBLICA
//
// El 13F identifica cada posición por CUSIP, y el mapeo CUSIP→ticker está licenciado. Hay una
// vía pública en dos saltos, y se mide aquí en vez de suponerla:
//
//   1. **CUSIP → nombre y TÍTULO**: los N-PORT de fondos indexados.
//   2. **Nombre → ticker**: `company_tickers.json` de la SEC (10.391 empresas).
//
// El emparejamiento vive en `lib/mapaCusip.ts` para poder fijarlo con tests. Este fichero sólo
// descarga y mide. Esa separación existe porque la primera versión lo tenía todo aquí dentro, y
// por eso cada fallo del normalizador costaba una tanda entera de descargas.
//
// ⚠️ UN FICHERO NO ES «EL MERCADO». Escribí que un solo N-PORT de Vanguard con 545 posiciones
// cubría lo necesario. Falso: un registrante agrupa DECENAS de fondos y cada uno presenta el
// suyo. El primero que salió era de otro fondo y el mapa cubría 28 de 503 nombres, un 6 %. Hay
// que recorrer varias presentaciones y acumular.
//
// ⚠️ Y LA COBERTURA SE MIDE CONTRA EL UNIVERSO PROPIO, no contra los CUSIP encontrados. Un mapa
// del 85 % de un fondo que no tiene tus nombres es un mapa del 0 % para ti. La primera versión
// daba 85 % de emparejamiento con 6 % de universo: la cifra buena tapaba la mala.
//
//   node --experimental-strip-types --no-warnings research/mapa_cusip.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { norm, normSinEspacios, decodificar, resolver } from "../lib/mapaCusip.ts";

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

/**
 * LAS CLASES QUE NO SE DEDUCEN DE LAS LETRAS, revisadas una a una.
 *
 * `BRK-A` y `BRK-B` llevan su clase en el propio ticker y los resuelve `claseDeTicker`. Pero
 * `GOOGL` es la clase A y `GOOG` la C, y eso NO se deduce de las letras: la `L` no significa
 * nada y suponer que sí sería exactamente el tipo de salto que produjo «Wendy's como dueña de
 * TWC». Así que van aquí, a mano, con la evidencia del título del N-PORT que lo demuestra.
 *
 * La clave es `<nombre normalizado>|<letra de clase>`. Cada entrada lleva de dónde sale.
 */
const CLASES_REVISADAS = Object.fromEntries([
  // Alphabet — `ALPHABET INC CAP STK CL C` ↔ 02079K107, `... CL A` ↔ 02079K305 (N-PORT de IVV,
  // presentación 2026-08-27). GOOGM y GOOGN son líneas que no cotizan en el índice.
  [`${norm("ALPHABET INC")}|A`, "GOOGL"],
  [`${norm("ALPHABET INC")}|C`, "GOOG"],
  // Fox Corp — clase A con voto reducido (FOXA) y clase B con voto (FOX).
  [`${norm("FOX CORP")}|A`, "FOXA"],
  [`${norm("FOX CORP")}|B`, "FOX"],
  // News Corp — misma estructura que Fox, mismo emisor original.
  [`${norm("NEWS CORP")}|A`, "NWSA"],
  [`${norm("NEWS CORP")}|B`, "NWS"],
]);

// ── 1 · nombre → ticker, de la SEC ───────────────────────────────────────────────────────
const oficiales = Object.values(await (await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA })).json());
const porNombre = new Map(), porNombreSinEsp = new Map();
for (const o of oficiales) {
  for (const [mapa, clave] of [[porNombre, norm(o.title)], [porNombreSinEsp, normSinEspacios(o.title)]]) {
    if (!mapa.has(clave)) mapa.set(clave, new Set());
    mapa.get(clave).add(o.ticker);
  }
}
console.log(`\n  CUSIP → TICKER\n  company_tickers.json: ${oficiales.length} empresas · ${porNombre.size} nombres normalizados`);

// ── 2 · CUSIP → nombre y título, de los N-PORT ───────────────────────────────────────────
// ⚠️ EL TÍTULO ES LA PIEZA QUE FALTABA. `<name>` dice «ALPHABET INC» para las dos clases;
// `<title>` dice «ALPHABET INC CAP STK CL C». Leyendo sólo el nombre, las dobles clases eran
// irresolubles —y así lo escribí—. La información estaba en el mismo bloque XML.
const pares = new Map();   // cusip → { nombre, titulo }

// ⚠️ `indexOf` DEVUELVE -1 CUANDO LA OPCIÓN NO ESTÁ, y `argv[-1 + 1]` es `argv[0]`: la ruta de
// node.exe. `Number("C:\...\node.exe")` es NaN, el `|| 25` no salta porque la cadena es truthy, y
// `indices.length < NaN` es SIEMPRE falso: el bucle no ejecutaba el cuerpo ni una vez y el script
// contestaba «sin NPORT-P» —que se lee como «este registrante no presenta nada»— con 1.477
// presentaciones delante. Funcionó las veces anteriores sólo porque se pasó la opción a mano.
const iPres = process.argv.indexOf("--presentaciones");
const POR_REGISTRANTE = iPres >= 0 ? Number(process.argv[iPres + 1]) : 25;
if (!Number.isInteger(POR_REGISTRANTE) || POR_REGISTRANTE < 1) {
  console.error(`\n  ⛔ --presentaciones tiene que ser un entero ≥ 1, llegó "${process.argv[iPres + 1]}".\n`);
  process.exit(2);
}

for (const [nombre, cik] of FONDOS) {
  const s = await j(`https://data.sec.gov/submissions/CIK${cik}.json`);
  const r = s?.filings?.recent ?? {};
  const indices = [];
  for (let k = 0; k < (r.form ?? []).length && indices.length < POR_REGISTRANTE; k++) {
    if (String(r.form[k]).startsWith("NPORT-P")) indices.push(k);
  }
  // «Cero seleccionadas de N presentaciones» no es una respuesta: es un fallo de selección. Sin
  // esta distinción, el defecto de `--presentaciones` de arriba se leía como un dato del mundo.
  const total = (r.form ?? []).length;
  if (!indices.length) {
    if (total > 0) {
      console.error(`\n  ⛔ ${nombre}: 0 NPORT-P seleccionadas de ${total} presentaciones.`);
      console.error(`     Un registrante de fondos SIEMPRE tiene NPORT-P. Esto es un fallo de selección.\n`);
      process.exit(1);
    }
    console.log(`  ⚠ ${nombre}: sin presentaciones (¿CIK equivocado?)`);
    continue;
  }

  let nuevos = 0, leidas = 0;
  for (const i of indices) {
    const acc = r.accessionNumber[i].replace(/-/g, "");
    const res = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/primary_doc.xml`, { headers: UA });
    await new Promise((x) => setTimeout(x, 130));
    if (!res.ok) continue;
    leidas++;
    const txt = await res.text();
    for (const b of txt.match(/<invstOrSec>[\s\S]*?<\/invstOrSec>/g) ?? []) {
      if (!/<assetCat>EC<\/assetCat>/.test(b)) continue;      // sólo renta variable
      const c = b.match(/<cusip>([^<]+)<\/cusip>/)?.[1]?.trim();
      const nom = b.match(/<name>([^<]+)<\/name>/)?.[1];
      const tit = b.match(/<title>([^<]+)<\/title>/)?.[1];
      if (c && nom && !pares.has(c)) {
        pares.set(c, { nombre: decodificar(nom).trim(), titulo: tit ? decodificar(tit).trim() : null });
        nuevos++;
      }
    }
  }
  console.log(`  ${nombre}: ${leidas} presentaciones · ${nuevos} CUSIP nuevos`);
}
const conTitulo = [...pares.values()].filter((v) => v.titulo).length;
console.log(`  CUSIP con nombre: ${pares.size} · con título (que trae la clase): ${conTitulo}`);

// ── 3 · Unir los dos saltos ──────────────────────────────────────────────────────────────
const tabla = await loadSP500Historical();
const universo = new Set(membersAsOf(tabla, snapshotDate(tabla)));

const mapa = {}, ambiguos = [], sinCasar = [];
const porVia = {};
for (const [cusip, { nombre, titulo }] of pares) {
  // Primero la clave normal; si no hay nadie, la clave sin espacios (JP MORGAN / JPMORGAN).
  let cands = porNombre.get(norm(nombre));
  let via2 = "nombre";
  if (!cands?.size) { cands = porNombreSinEsp.get(normSinEspacios(nombre)); via2 = "sin espacios"; }
  if (!cands?.size) { sinCasar.push({ cusip, nombre, titulo }); continue; }

  const r = resolver([...cands], { universo, titulo, tabla: CLASES_REVISADAS });
  if (!r.ticker) { ambiguos.push({ cusip, nombre, titulo, candidatos: r.candidatos }); continue; }
  mapa[cusip] = { ticker: r.ticker.replace(/-/g, "."), nombre, titulo, via: r.via, clave: via2 };
  porVia[r.via] = (porVia[r.via] ?? 0) + 1;
}

const n = pares.size;
const pc = (x) => `${x}/${n}  ${(100 * x / n).toFixed(0)} %`;
console.log(`\n  emparejado sin ambigüedad: ${pc(Object.keys(mapa).length)}`);
console.log(`  ambiguo (sigue sin poder decidirse): ${pc(ambiguos.length)}`);
console.log(`  sin casar por nombre:      ${pc(sinCasar.length)}`);
console.log(`  por vía: ${Object.entries(porVia).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

// ── 4 · ¿Y cuánto de MI universo queda cubierto? ─────────────────────────────────────────
const cubiertos = new Set(Object.values(mapa).map((v) => v.ticker).filter((t) => universo.has(t)));
console.log(`\n  del universo de Scora (${universo.size}): con CUSIP conocido ${cubiertos.size}  ${(100 * cubiertos.size / universo.size).toFixed(0)} %`);
const faltan = [...universo].filter((t) => !cubiertos.has(t));
if (faltan.length) console.log(`  sin CUSIP: ${faltan.slice(0, 25).join(" ")}${faltan.length > 25 ? ` … (+${faltan.length - 25})` : ""}`);

if (ambiguos.length) {
  console.log(`\n  ejemplos que SIGUEN ambiguos (se quedan fuera, no se elige el más probable):`);
  for (const a of ambiguos.slice(0, 6)) {
    console.log(`    ${a.cusip}  ${(a.titulo ?? a.nombre).slice(0, 40).padEnd(40)} → ${a.candidatos.join(" / ")}`);
  }
}

// ⚠️ EL CRITERIO ES LA COBERTURA DEL UNIVERSO, no el % de aciertos del emparejamiento.
const cobertura = cubiertos.size / universo.size;
if (cobertura < 0.9) {
  console.error(`\n  ⛔ sólo el ${(100 * cobertura).toFixed(0)} % del universo tiene CUSIP conocido.`);
  console.error(`     El 13F identifica por CUSIP: sin este mapa, esas carteras no se pueden leer.`);
  console.error(`     Añade fondos a FONDOS o sube --presentaciones antes de seguir.\n`);
}

// ⚠️ NO PISAR UN ARTEFACTO BUENO CON UNO PEOR. El 2026-09-02 este script falló entero por el
// defecto de `--presentaciones` y aun así ESCRIBIÓ un mapa de 0 entradas encima de uno de 3.381.
// Un fallo que además destruye la evidencia anterior cuesta el doble. Es el mismo incidente que
// el `--no-sweep` que publicó `barridoUmbrales: null` sobre el artefacto del backtest.
const DESTINO = join(AQUI, "data", "cusip_ticker.json");
const FORZAR = process.argv.includes("--forzar");
try {
  const previo = JSON.parse(readFileSync(DESTINO, "utf8"));
  const antes = Object.keys(previo.mapa ?? {}).length;
  const ahora = Object.keys(mapa).length;
  if (!FORZAR && antes > 0 && ahora < antes * 0.95) {
    console.error(`\n  ⛔ NO SE ESCRIBE: el mapa nuevo tiene ${ahora} entradas y el que hay ${antes}.`);
    console.error(`     Una caída así es un fallo de descarga, no un dato. El artefacto anterior se`);
    console.error(`     conserva. Si de verdad quieres reemplazarlo, pasa --forzar.\n`);
    process.exit(1);
  }
} catch { /* no había artefacto previo: se escribe */ }

writeFileSync(DESTINO, JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "N-PORT de fondos indexados (CUSIP→nombre+título) + company_tickers.json de la SEC (nombre→ticker)",
  criterio: "sólo entra lo que se resuelve SIN ADIVINAR: candidato único, intersección con el universo, la clase que declara el título, o la tabla revisada a mano. Lo que sigue ambiguo se lista aparte y NO se resuelve por probabilidad.",
  coberturaUniverso: Number((100 * cobertura).toFixed(1)),
  total: n, porVia,
  mapa, ambiguos, sinCasar,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/data/cusip_ticker.json\n`);
