// ─────────────────────────────────────────────────────────────────────────────
// DESFASE ENTRE MAGNITUDES (diagnóstico de la Fase F1)
//
// `flowTTM` e `instant` eligen la ventana más reciente **de cada tag por separado**. Es lo
// correcto para no dejar fuera un dato bueno por culpa de otro que va retrasado, pero tiene
// una consecuencia que nadie había medido: dos magnitudes del mismo paquete pueden ser de
// cierres distintos, y restarlas o dividirlas mezcla dos fotos.
//
// Importa más de lo que parece. `gpTTM` se DERIVA como ingresos − coste de ventas cuando la
// empresa no publica margen bruto, y de `gpTTM` sale `grossProfitability`, que es una de las
// CINCO métricas de la señal de Scora Picks. Si los dos sumandos son de trimestres distintos,
// esa métrica es un número plausible y equivocado.
//
// Esto no propone ningún arreglo: cuantifica. Sin la cifra, "habría que alinear los periodos"
// es una opinión.
//
//   node --experimental-strip-types --no-warnings research/desfase_periodos.mjs [--asof …] [--max N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf } from "./edgar.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));
const MAX = Number(arg("--max", "0")) || Infinity;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const table = await loadSP500Historical();
if (!table) { console.error("sin tabla de miembros"); process.exit(1); }
const miembros = [...new Set(membersAsOf(table, ASOF) || [])].slice(0, MAX);

// Parejas que se restan o dividen entre sí en algún punto del sistema.
const PAREJAS = [
  ["rev", "cost", "margen bruto derivado (→ grossProfitability, señal de Picks)"],
  ["rev", "gp", "margen bruto (%)"],
  ["rev", "ni", "margen neto"],
  ["assets", "liabilities", "identidad del balance"],
  ["assets", "equity", "identidad del balance"],
  ["ocf", "cfi", "flujo neto de caja"],
  ["ni", "ocf", "devengos de Sloan"],
  ["gp", "assets", "grossProfitability (flujo ÷ instante)"],
];

const dias = (a, b) => Math.abs(Math.round((new Date(a) - new Date(b)) / 86400000));
const cuenta = {};
for (const [a, b] of PAREJAS) cuenta[`${a}|${b}`] = { ambos: 0, mismo: 0, desfases: [] };
let n = 0;
const derivadoSinFecha = [];

for (const t of miembros) {
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* red */ }
  if (!cik) continue;
  let f = null;
  try { f = await fundamentalsAsOf(cik, ASOF); } catch { /* saltar */ }
  if (!f?.periodos) continue;
  n++;
  if (f.gpTTM != null && f.periodos.gp == null) derivadoSinFecha.push(t);
  for (const [a, b] of PAREJAS) {
    const pa = f.periodos[a], pb = f.periodos[b];
    const c = cuenta[`${a}|${b}`];
    if (!pa || !pb) continue;
    c.ambos++;
    if (pa === pb) c.mismo++;
    else c.desfases.push({ ticker: t, dias: dias(pa, pb), a: pa, b: pb });
  }
  if (n % 100 === 0) process.stdout.write(`    ${n} nombres…\n`);
}

console.log(`\n  Desfase entre magnitudes · ${ASOF} · ${n} nombres\n`);
// El REPARTO importa más que la media, que va dominada por unos pocos casos extremos. Un
// desfase de un trimestre entre dos magnitudes es incómodo pero tolerable; uno de años
// significa que un tag dejó de usarse y se está restando una cifra de 2026 de otra de 2011.
// Son dos problemas distintos y hay que poder separarlos.
const TRAMOS = [["≤1 trim", 100], ["≤6 meses", 190], ["≤1 año", 380], ["≤3 años", 1100], [">3 años", Infinity]];
console.log("  pareja                con ambos  mismo cierre │" + TRAMOS.map(([e]) => e.padStart(9)).join("") + "   mediana");
const resumen = {};
for (const [a, b, desc] of PAREJAS) {
  const c = cuenta[`${a}|${b}`];
  const pct = c.ambos ? (100 * c.mismo / c.ambos).toFixed(1) : "—";
  const ds = c.desfases.map((d) => d.dias).sort((x, y) => x - y);
  const mediana = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  const hist = {};
  let prev = 0;
  for (const [etq, lim] of TRAMOS) { hist[etq] = ds.filter((d) => d > prev && d <= lim).length; prev = lim; }
  console.log(`  ${(a + " ↔ " + b).padEnd(21)} ${String(c.ambos).padStart(4)}     ${pct.padStart(5)} %    │` +
    TRAMOS.map(([e]) => String(hist[e]).padStart(9)).join("") + `   ${String(mediana).padStart(5)} d   ${desc}`);
  resumen[`${a}|${b}`] = {
    descripcion: desc, ambos: c.ambos, mismoCierre: c.mismo,
    pctMismoCierre: c.ambos ? +(100 * c.mismo / c.ambos).toFixed(1) : null,
    desalineados: ds.length, medianaDiasDesalineados: mediana,
    desfaseMaxDias: ds.length ? ds[ds.length - 1] : 0,
    reparto: hist,
    peores: c.desfases.sort((x, y) => y.dias - x.dias).slice(0, 15),
  };
}
console.log(`\n  margen bruto DERIVADO de dos cierres distintos: ${derivadoSinFecha.length} nombres`);
if (derivadoSinFecha.length) console.log(`    ${derivadoSinFecha.slice(0, 20).join(" ")}${derivadoSinFecha.length > 20 ? " …" : ""}`);

const ruta = join(OUT, "desfase_periodos.json");
writeFileSync(ruta, JSON.stringify({ generatedAt: new Date().toISOString(), asOf: ASOF, medidos: n, parejas: resumen, margenBrutoDerivadoDesalineado: derivadoSinFecha }, null, 1));
console.log(`\n  → ${ruta}\n`);
