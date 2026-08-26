// ─────────────────────────────────────────────────────────────────────────────
// ¿SE PUEDE RECONSTRUIR EL RESULTADO DE EXPLOTACIÓN CUANDO LA EMPRESA NO LO ETIQUETA?
//
// FASE 2 DEL ROADMAP. **Este guion no cambia ni un número del score.** Su producto es una
// decisión, y va en fase aparte justamente para que la decisión se tome mirando datos y no
// mirando lo cómodo que sería que saliera bien.
//
// EL PROBLEMA. `oiTTM` sale de un único tag, `OperatingIncomeLoss`, y de él cuelgan cuatro de
// las cinco métricas de la señal. Falta en el 22 % del índice, y a 112 de los 145 nombres que
// no llegan al mínimo les falta precisamente eso. Entre ellos JNJ, LLY, MRK, PFE, XOM, CVX,
// COP, IBM y AXP — no son empresas oscuras, son las mayores del índice.
//
// EL REFLEJO EQUIVOCADO. Lo que esas empresas SÍ etiquetan es
// `IncomeLossFromContinuingOperationsBeforeIncomeTaxes…`, que es resultado **antes de
// impuestos**, no de explotación. Usarlo tal cual convertiría `opm` en margen pretax y dejaría
// `icov` aritméticamente incoherente, porque los intereses ya están restados del numerador.
// La reconstrucción correcta es **EBIT = pretax + intereses**.
//
// LO QUE MIDE. Sobre las empresas que publican AMBAS cosas —el OI de verdad y el pretax—,
// cuánto se desvía la reconstrucción del valor real. Y lo mide **por sector**, porque esa es
// la pregunta que decide: un sesgo uniforme se puede corregir, uno que depende del sector no.
// Si el desvío correlaciona con el sector, aplicar la reconstrucción cambiaría un sesgo
// conocido (falta cobertura) por otro desconocido (cobertura sesgada), que es peor.
//
// Mide además la vía alternativa, que se queda DENTRO de la sección de explotación:
// `OI = GrossProfit − OperatingExpenses`.
//
// ⚠️ CRITERIO DE ACEPTACIÓN, ESCRITO ANTES DE MIRAR EL RESULTADO:
//     · desvío mediano absoluto  < 5 %
//     · dispersión entre sectores (peor mediana − mejor mediana) < 5 pp
//   Si no se cumple, NO se implementa como sustituto silencioso. «No se puede» es un
//   desenlace válido de esta fase.
//
//   node --experimental-strip-types --no-warnings research/ebit_reconstruccion.mjs [--asof YYYY-MM-DD]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, sicSector } from "./edgar.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
const CACHE = join(AQUI, ".cache");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));

const OI = "OperatingIncomeLoss";
const PRETAX = [
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
];
const INT = ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense", "InterestExpenseNonoperating"];
const GP = ["GrossProfit"];
// ⚠️ `CostsAndExpenses` NO es alternativa de `OperatingExpenses`, y meterlas en la misma lista
// fue un defecto de la primera versión de ESTE guion: `CostsAndExpenses` son los costes
// TOTALES —coste de ventas incluido—, así que `bruto − CostsAndExpenses` descuenta el coste de
// ventas dos veces. Producía desvíos de −2.368 % (Centene) y −665 % (Darden) que parecían decir
// algo del método y sólo decían que yo había mezclado dos conceptos distintos.
const OPEX = ["OperatingExpenses"];
// La tercera vía, que no necesita `GrossProfit`: reconstruir desde la línea de arriba.
const REVT = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"];
const COGS = ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold", "CostOfServices"];

/**
 * Sólo EJERCICIOS COMPLETOS de un 10-K, y con la duración comprobada.
 *
 * ⚠️ Sin la comprobación de duración esto compararía un trimestre contra un año y daría un
 * desvío del 75 % que no dice nada del método — es el mismo defecto que ya produjo TTM
 * imposibles en este repo. El margen de 40 días absorbe los ejercicios de 52/53 semanas.
 */
const anual = (arr) => (arr ?? []).filter((x) =>
  x.form === "10-K" && x.fp === "FY" && x.start && x.end &&
  Math.abs((new Date(x.end) - new Date(x.start)) / 86400000 - 365) < 40);

const valorEn = (g, tags, fin) => {
  for (const t of [tags].flat()) {
    const u = Object.values(g[t]?.units ?? {})[0];
    const f = anual(u).filter((x) => x.end === fin).at(-1);
    if (f) return f.val;
  }
  return null;
};

const tabla = await loadSP500Historical();
const miembros = membersAsOf(tabla, ASOF);
console.log(`\n  RECONSTRUCCIÓN DE EBIT · ${ASOF} · ${miembros.length} miembros`);
console.log(`  Criterio escrito ANTES: desvío mediano |·| < 5 % y dispersión entre sectores < 5 pp\n`);

const filas = [];
let n = 0;
for (const t of miembros) {
  n++;
  if (n % 50 === 0) process.stdout.write(`\r  ${n}/${miembros.length}…`);
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* sigue */ }
  if (!cik) continue;
  const p = join(CACHE, `CIK${cik}.json`);
  if (!existsSync(p)) continue;          // sólo lo ya cacheado: esto es una medición, no una descarga
  let g = null;
  try { g = JSON.parse(readFileSync(p, "utf8"))?.facts?.["us-gaap"] ?? null; } catch { continue; }
  if (!g?.[OI]) continue;                 // sin OI real no hay contra qué comparar
  const oiFilas = anual(Object.values(g[OI].units ?? {})[0]);
  if (!oiFilas.length) continue;
  const fin = oiFilas.map((x) => x.end).sort().at(-1);
  const real = oiFilas.filter((x) => x.end === fin).at(-1)?.val;
  if (real == null || real === 0) continue;

  const px = valorEn(g, PRETAX, fin);
  const iv = valorEn(g, INT, fin);
  const gp = valorEn(g, GP, fin);
  const ox = valorEn(g, OPEX, fin);
  let sector = null;
  try { sector = (await sicSector(cik)) || null; } catch { /* sigue */ }

  filas.push({
    t, sector, ejercicio: fin, real,
    viaPretax: px != null ? px + (iv ?? 0) : null,
    teniaIntereses: iv != null,
    viaBruto: gp != null && ox != null ? gp - ox : null,
    viaIngresos: (() => { const rv = valorEn(g, REVT, fin), cg = valorEn(g, COGS, fin); return rv != null && cg != null && ox != null ? rv - cg - ox : null; })(),
  });
}
process.stdout.write("\r" + " ".repeat(30) + "\r");

const mediana = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const desvio = (rec, real) => (rec == null ? null : ((rec - real) / Math.abs(real)) * 100);

const resumen = {};
for (const via of ["viaPretax", "viaBruto", "viaIngresos"]) {
  const ds = filas.map((f) => ({ ...f, d: desvio(f[via], f.real) })).filter((f) => f.d != null && isFinite(f.d));
  const abs = ds.map((f) => Math.abs(f.d));
  const porSector = {};
  for (const f of ds) (porSector[f.sector ?? "(sin sector)"] ??= []).push(Math.abs(f.d));
  const medianasSector = Object.entries(porSector)
    .filter(([, xs]) => xs.length >= 5)               // menos de 5 no es una mediana, es una anécdota
    .map(([s, xs]) => ({ sector: s, n: xs.length, mediana: +mediana(xs).toFixed(1) }))
    .sort((a, b) => a.mediana - b.mediana);
  const disp = medianasSector.length >= 2 ? medianasSector.at(-1).mediana - medianasSector[0].mediana : null;
  resumen[via] = {
    n: ds.length,
    medianaAbs: abs.length ? +mediana(abs).toFixed(1) : null,
    dentroDel5: abs.length ? +((100 * abs.filter((x) => x < 5).length) / abs.length).toFixed(0) : null,
    dispersionSectorial: disp == null ? null : +disp.toFixed(1),
    porSector: medianasSector,
    peores: ds.slice().sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 8).map((f) => ({ t: f.t, d: +f.d.toFixed(1) })),
  };
}

for (const [via, r] of Object.entries(resumen)) {
  const nombre = via === "viaPretax" ? "EBIT = pretax + intereses"
    : via === "viaBruto" ? "EBIT = bruto − gastos de explotación"
    : "EBIT = ingresos − coste de ventas − gastos de explotación";
  console.log(`  ── ${nombre} ──`);
  console.log(`     empresas comparables: ${r.n}   ·   desvío mediano |·|: ${r.medianaAbs} %   ·   dentro del ±5 %: ${r.dentroDel5} %`);
  console.log(`     dispersión entre sectores: ${r.dispersionSectorial ?? "—"} pp`);
  for (const s of r.porSector) console.log(`       ${String(s.sector).slice(0, 24).padEnd(25)} n=${String(s.n).padStart(3)}  mediana ${String(s.mediana).padStart(6)} %`);
  console.log(`     peores: ${r.peores.map((x) => `${x.t} ${x.d > 0 ? "+" : ""}${x.d}%`).join(" · ")}`);
  const pasa = r.medianaAbs != null && r.medianaAbs < 5 && r.dispersionSectorial != null && r.dispersionSectorial < 5;
  console.log(`     → ${pasa ? "✅ CUMPLE el criterio" : "❌ NO cumple el criterio"} (mediana < 5 % y dispersión < 5 pp)\n`);
}

const ruta = join(OUT, "ebit_reconstruccion.json");
const tmp = ruta + ".tmp";
writeFileSync(tmp, JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/ebit_reconstruccion.mjs", asOf: ASOF,
  criterio: { medianaAbsMax: 5, dispersionSectorialMax: 5, escritoAntesDeMirar: true },
  resumen, filas,
}, null, 1));
renameSync(tmp, ruta);
console.log(`  → research/out/ebit_reconstruccion.json\n`);
