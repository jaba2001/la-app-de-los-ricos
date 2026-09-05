// ─────────────────────────────────────────────────────────────────────────────
// DISTRIBUCIONES SECTORIALES DE FACTORES (F2 · P0-1) — la materia prima de `lib/percentile.ts`.
//
// Calcula, para cada sector, los cuantiles [1,5,10,25,50,75,90,95,99] de cada métrica que
// usa el score. Con eso, "PER 12" deja de valer 7 puntos en todas partes y pasa a ser
// "percentil 78 de Financials (B+)" o "percentil 24 de Utilities (D)", que es lo que
// significa de verdad.
//
// Fuente: EDGAR (gratis, sin clave, ya cacheado por los demás labs) + precios de Yahoo.
// PIT por construcción: sólo mira hasta la fecha de cálculo.
//
// ⚠️ UNIDADES — el error silencioso más fácil de cometer aquí. Cada métrica se emite en la
// MISMA unidad en que `ScoreInputs` la recibe, porque `gradeMetric()` va a comparar contra
// estos cuantiles los valores que ya circulan por la app:
//     porcentaje (0-100): roe, roa, roic, grossMargin, netMargin, grossProfitability,
//                         revenueGrowth, epsGrowth, priceChange1M/3M/6M
//     fracción   (0-1)  : operatingMargin, capexToRevenue, fcfYield
//     ratio             : pe, pb, evEbitda, pfcf, debtEquity, currentRatio,
//                         interestCoverage, netDebtEbitda
// Equivocar una sola de estas convierte un percentil en basura silenciosa: no falla, miente.
//
//   node --experimental-strip-types --no-warnings research/factor_dist.mjs [--limit N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
// El cálculo vive en factorDistCore.mjs para que la foto de hoy y la serie HISTÓRICA
// (factor_dist_history.mjs, la que permite validar v2 sin look-ahead) usen exactamente
// los mismos cuantiles. Si cada una tuviera su código, validar una con la otra no
// probaría nada.
import { collectRows, buildDist } from "./factorDistCore.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
const MIN_N = 8;

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;

const table = await loadSP500Historical();
let members = table ? [...new Set(membersAsOf(table, today) || [])] : CURATED;
if (LIMIT > 0) members = members.slice(0, LIMIT);
console.log(`
  FACTOR DIST · ${members.length} nombres · ${today}
  recogiendo fundamentales (EDGAR, cacheado)…`);

const filas = await collectRows(members, today);
console.log(`  recogidos ${filas.length} nombres (${members.length - filas.length} sin datos suficientes)`);
if (!filas.length) { console.error("  ✖ sin datos — abortando"); process.exit(1); }

const dist = buildDist(filas);

const salida = {
  generatedAt: new Date().toISOString(), asOf: today,
  universe: filas.length, sectors: Object.keys(dist).filter((k) => k !== "ALL").length,
  levels: LEVELS, minSampleN: MIN_N,
  note: "Unidades idénticas a ScoreInputs: % para roe/roa/roic/márgenes/crecimiento/priceChange, fracción para operatingMargin/capexToRevenue/fcfYield, ratio para el resto.",
  dist,
};
writeFileSync(join(OUT, "factor_dist.json"), JSON.stringify(salida, null, 2));
// Copia minificada a public/ — es la que consume la app vía `lib/factorDist.ts`. Se escribe
// aquí para que regenerar las distribuciones actualice la UI en el mismo paso y no se queden
// desincronizadas (el artefacto de research y lo que ve el usuario, siempre a la vez).
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "factor-dist.json");
writeFileSync(PUBLIC, JSON.stringify({ asOf: salida.asOf, dist }));

console.log(`\n  sectores con distribución propia: ${salida.sectors}`);
console.log(`  ${"sector".padEnd(26)}${"n".padStart(5)}   PER (p25 · p50 · p75)`);
for (const [clave, m] of Object.entries(dist).sort((a, b) => (b[1].pe?.n ?? 0) - (a[1].pe?.n ?? 0))) {
  const pe = m.pe;
  if (!pe) continue;
  console.log(`  ${clave.padEnd(26)}${String(pe.n).padStart(5)}   ${pe.q[3].toFixed(1).padStart(6)} · ${pe.q[4].toFixed(1).padStart(6)} · ${pe.q[5].toFixed(1).padStart(6)}`);
}
console.log(`\n  → escrito research/out/factor_dist.json\n`);
