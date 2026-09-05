// ─────────────────────────────────────────────────────────────────────────────
// COMPROBADOR DE VALORES IMPOSIBLES
//
// No comprueba que las métricas sean CORRECTAS —eso se hace validando contra los ejercicios
// que publican las propias empresas— sino que no sean **absurdas**. Es una red distinta y
// complementaria: los tests fijan el comportamiento de funciones puras y no ven un fallo de
// extracción; la validación contra ejercicios publicados sólo cubre los nombres que miras a
// mano. Esto barre las 500 y busca lo que no puede ser.
//
// QUÉ ENCONTRÓ el 24-08-2026, en su primera ejecución, sobre 495 nombres: **29 anomalías**,
// de las que 26 eran defectos reales y 3 legítimas.
//
//   · 136 nombres con deuda exactamente CERO porque la ausencia del tag se escribía como 0
//     (CVS con 253 B de activo, Cigna con 157 B). `netDebtEbitda` es una de las cinco
//     métricas de la señal: un cuarto del universo cobraba esa nota gratis.
//   · Los REIT puntuando con una rebanada de sus ingresos: Essex Property con 10 M cuando su
//     cifra es 1.890 M, y un margen bruto del 14.526 %.
//   · Un tag abandonado enterrando a los siguientes de su lista.
//
// Y las 3 que quedan son REALES: GoDaddy, Gartner y Mettler-Toledo tienen patrimonio casi
// nulo por recompras agresivas, así que un ROE de cuatro cifras es aritmética correcta. Un
// comprobador de este tipo NO debe dar cero: debe dar pocas y explicables.
//
//   node --experimental-strip-types --no-warnings research/sanidad_metricas.mjs [--asof …]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/**
 * Los límites son deliberadamente HOLGADOS. No buscan «raro» sino «no puede ser»: un margen
 * bruto del 95 % existe (software), uno del 150 % no. Un límite estrecho llenaría la salida
 * de casos legítimos y el comprobador dejaría de leerse, que es la forma habitual en que
 * muere una alarma.
 */
const REGLAS = [
  ["margen bruto > 100 %",          (m) => m.grossMargin > 100,            "ingresos y coste de conceptos distintos"],
  ["margen bruto < −50 %",          (m) => m.grossMargin < -50,            "ídem, con el componente al revés"],
  ["margen operativo > 100 %",      (m) => m.operatingMargin > 1,          "resultado de explotación mayor que los ingresos"],
  ["margen neto > 200 %",           (m) => m.netMargin > 200,              "ingresos truncados a un componente"],
  ["ROIC > 500 %",                  (m) => m.roic > 500,                   "capital invertido casi nulo (¿falta la deuda?)"],
  ["ROE > 1000 %",                  (m) => m.roe > 1000,                   "patrimonio casi nulo — suele ser REAL (recompras)"],
  ["rent. bruta s/activos > 200 %", (m) => m.grossProfitability > 200,     "margen bruto y activo de periodos distintos"],
  ["PER > 5000",                    (m) => m.pe > 5000,                    "beneficio residual o acciones mal contadas"],
  ["cobertura intereses > 1e5",     (m) => m.interestCoverage > 1e5,       "gasto financiero casi nulo"],
  ["crecim. ingresos > 1000 %",     (m) => m.revenueGrowth > 1000,         "el TTM anterior es de otro concepto"],
  ["capex/ventas > 200 %",          (m) => m.capexToRevenue > 2,           "ingresos truncados"],
  ["deuda/patrimonio > 100",        (m) => m.debtEquity > 100,             "patrimonio residual"],
];

const table = await loadSP500Historical();
if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const miembros = [...new Set(membersAsOf(table, ASOF) || [])];
const filas = await collectRows(miembros, ASOF, new Map(), false, null);
console.log(`\n  SANIDAD DE MÉTRICAS · ${ASOF} · ${filas.length} filas\n`);

const num = (x) => x != null && isFinite(x);
let total = 0;
const anomalias = {};
console.log("  regla                             n   nombres");
for (const [nombre, test, causa] of REGLAS) {
  const malos = filas.filter((f) => { try { return num(test(f.m) ? 1 : null) === false ? false : test(f.m); } catch { return false; } })
                     .filter((f) => Object.values(f.m).some(num));
  total += malos.length;
  anomalias[nombre] = { n: malos.length, causaProbable: causa, tickers: malos.map((f) => f.ticker) };
  console.log(`  ${nombre.padEnd(32)} ${String(malos.length).padStart(3)}   ${malos.slice(0, 8).map((f) => f.ticker).join(" ")}`);
}

// Cobertura: cuántas filas tienen cada métrica. Una caída aquí es tan informativa como una
// anomalía — significa que algo dejó de extraerse.
const claves = Object.keys(filas[0]?.m ?? {});
const cobertura = {};
for (const k of claves) cobertura[k] = filas.filter((f) => num(f.m[k])).length;

console.log(`\n  ${total === 0 ? "✓ ningún valor imposible" : `${total} valores fuera de rango`}`);
console.log(`\n  cobertura por métrica (una caída brusca respecto al artefacto anterior es una alarma):`);
for (const k of claves) {
  const n = cobertura[k];
  const barra = "█".repeat(Math.round(28 * n / filas.length)).padEnd(28, "·");
  console.log(`    ${k.padEnd(20)} ${barra} ${String(n).padStart(3)}/${filas.length}  ${(100 * n / filas.length).toFixed(0)} %`);
}

const ruta = join(OUT, "sanidad_metricas.json");
writeFileSync(ruta, JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: ASOF, filas: filas.length,
  totalAnomalias: total, anomalias, cobertura,
  nota: "Busca valores IMPOSIBLES, no incorrectos. No debe dar cero: debe dar pocas y explicables. Las que quedan hoy son patrimonios casi nulos por recompras, que son reales.",
}, null, 1));
console.log(`\n  → ${ruta}\n`);
