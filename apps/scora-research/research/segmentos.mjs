// ─────────────────────────────────────────────────────────────────────────────
// INGRESOS POR SEGMENTO — FASE 6
//
// El lado IZQUIERDO del Sankey: de dónde salen los ingresos, por línea de negocio. Es lo único
// del roadmap que `companyfacts` no puede dar, porque no trae ejes dimensionales. Sale del
// documento XBRL de la propia presentación (`lib/segmentos.ts`).
//
// ⚠️ ESTO NO SE PUEDE CORRER SOBRE LAS 500. Cada instancia XBRL pesa entre 1,4 y 4,3 MB y hay
// que descargarla entera: son gigabytes y horas. Por eso la fase 6 estaba condicionada en el
// roadmap. Se corre sobre una MUESTRA y se publica la cobertura medida, no una estimación.
//
// EL CRITERIO DE PUBLICACIÓN ES EL CUADRE. Un desglose cuyas líneas no suman el total declarado
// está mal —niveles mezclados, un eje cruzado, un ejercicio colado— y NO se publica. Es la misma
// regla que el Sankey: antes que una cifra bonita que no cuadra, un hueco que se ve.
//
//   node --experimental-strip-types --no-warnings research/segmentos.mjs --n 40
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { desgloseIngresos } from "../lib/segmentos.ts";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "scora-research alealvarado804@gmail.com", "Accept-Encoding": "gzip, deflate" };
const get = async (u) => {
  const r = await fetch(u, { headers: UA });
  await new Promise((x) => setTimeout(x, 140));
  // ⚠️ COMPROBAR `ok` NO ES OPCIONAL AQUÍ. La SEC devuelve el 404 como un XML válido
  // (`<Error><Code>NoSuchKey</Code>...`), que parsea sin quejarse a CERO contextos — y ese cero
  // se lee como «este documento no tiene segmentos». Me pasó al medir esto.
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
const j = async (u) => (await get(u)).json();

const iN = process.argv.indexOf("--n");
const N = iN >= 0 ? Number(process.argv[iN + 1]) : 40;
if (!Number.isInteger(N) || N < 1) { console.error(`\n  ⛔ --n tiene que ser un entero ≥ 1.\n`); process.exit(2); }

const tabla = await loadSP500Historical();
const universo = membersAsOf(tabla, snapshotDate(tabla));
const tickers = Object.values(await j("https://www.sec.gov/files/company_tickers.json"));
const porTicker = new Map(tickers.map((o) => [o.ticker, String(o.cik_str).padStart(10, "0")]));

// Muestra determinista: los N primeros del universo por orden alfabético. Sin aleatoriedad, para
// que dos ejecuciones sean comparables y la cobertura no dependa de la suerte.
const muestra = [...universo].sort().slice(0, N);
console.log(`\n  INGRESOS POR SEGMENTO\n  muestra: ${muestra.length} de ${universo.length} (los primeros por orden alfabético)\n`);

const filas = [];
for (const t of muestra) {
  const cik = porTicker.get(t) ?? porTicker.get(t.replace(/\./g, "-"));
  if (!cik) { filas.push({ ticker: t, estado: "sin CIK" }); continue; }
  try {
    const s = await j(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const r = s.filings.recent;
    const k = (r.form ?? []).findIndex((f) => f === "10-K");
    // ⚠️ `filings.recent` SE CORTA EN 1.000 ENTRADAS. Un emisor que presenta mucho —Exxon— puede
    // tener su 10-K fuera. No es «no presenta 10-K», es «no está en esta página».
    if (k < 0) { filas.push({ ticker: t, estado: "10-K fuera de las 1.000 recientes" }); continue; }

    const acc = r.accessionNumber[k].replace(/-/g, "");
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
    const nombres = (await j(`${base}/index.json`)).directory.item.map((x) => x.name);
    const inst = nombres.find((n) => /^[a-z0-9]+-\d{8}_htm\.xml$/.test(n));
    if (!inst) { filas.push({ ticker: t, estado: "sin instancia XBRL" }); continue; }

    const d = desgloseIngresos(await (await get(`${base}/${inst}`)).text());
    const cuadra = d.cuadre != null && Math.abs(d.cuadre - 1) <= 0.02;
    filas.push({
      ticker: t, estado: cuadra ? "publicable" : d.lineas.length ? "no cuadra" : "sin desglose",
      periodo: d.periodo.fin, total: d.total, cuadre: d.cuadre, eje: d.eje,
      nivelesMezclados: !!d.nivelesMezclados, motivo: d.motivo ?? null,
      lineas: cuadra ? d.lineas : [],
    });
    const marca = cuadra ? "✓" : d.lineas.length ? "✗" : "·";
    console.log(`  ${marca} ${t.padEnd(6)} ${String(d.lineas.length).padStart(2)} líneas  cuadre ${String(d.cuadre ?? "—").padEnd(7)} ${(d.eje ?? d.motivo ?? "").replace(/^.*:/, "").slice(0, 46)}`);
  } catch (e) {
    filas.push({ ticker: t, estado: "error", motivo: e.message });
    console.log(`  ! ${t.padEnd(6)} ${e.message}`);
  }
}

const cuenta = (e) => filas.filter((f) => f.estado === e).length;
const pub = cuenta("publicable");
console.log(`\n  publicable (cuadra):    ${pub}/${filas.length}  ${(100 * pub / filas.length).toFixed(0)} %`);
console.log(`  con desglose que NO cuadra: ${cuenta("no cuadra")}`);
console.log(`  sin desglose en el XBRL:    ${cuenta("sin desglose")}`);
console.log(`  no se pudo leer:            ${filas.length - pub - cuenta("no cuadra") - cuenta("sin desglose")}`);
const mezclados = filas.filter((f) => f.nivelesMezclados).length;
console.log(`  (de los publicables, ${mezclados} traían DOS NIVELES en el mismo eje y hubo que quitar los padres)`);

writeFileSync(join(AQUI, "out", "segmentos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "documento XBRL del 10-K (companyfacts NO trae ejes dimensionales)",
  criterio: "sólo se publica lo que CUADRA: la suma de las líneas tiene que dar el total declarado ±2 %. Un desglose que no cuadra es un hueco que se ve, no una cifra que se enseña.",
  muestra: filas.length, publicables: pub,
  filas,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/segmentos.json\n`);
