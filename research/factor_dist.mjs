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
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, momentum } from "./prices.mjs";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { metricsOf, SECTOR_ALIASES } from "./fundamentalMetrics.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
const MIN_N = 8;   // por debajo de esto, un cuantil sectorial es una anécdota, no una distribución

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;


function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}


const table = await loadSP500Historical();
let members = table ? [...new Set(membersAsOf(table, today) || [])] : CURATED;
if (LIMIT > 0) members = members.slice(0, LIMIT);
console.log(`\n  FACTOR DIST · ${members.length} nombres · ${today}\n  recogiendo fundamentales (EDGAR, cacheado)…`);

const filas = [];
let hechos = 0, fallos = 0;
for (const t of members) {
  hechos++;
  if (hechos % 100 === 0) console.log(`  …${hechos}/${members.length}`);
  try {
    const cik = await tickerToCik(t);
    if (!cik) { fallos++; continue; }
    const f = await fundamentalsAsOf(cik, today);
    const raw = await rawPriceAsOf(t, today);
    if (!f || f.revTTM == null || raw == null) { fallos++; continue; }
    const sector = (await sicSector(cik)) || null;
    const mom = await momentum(t, today);
    filas.push({ ticker: t, sector, m: metricsOf(f, raw, mom) });
  } catch { fallos++; }
}
console.log(`  recogidos ${filas.length} nombres (${fallos} sin datos suficientes)`);

const METRICAS = Object.keys(filas[0]?.m ?? {});
if (!METRICAS.length) { console.error("  ✖ sin datos — abortando"); process.exit(1); }

// Agrupación: cada nombre entra en su sector, en los alias de su sector, y en "ALL".
const grupos = new Map();
const push = (clave, fila) => { if (!grupos.has(clave)) grupos.set(clave, []); grupos.get(clave).push(fila); };
for (const fila of filas) {
  push("ALL", fila);
  if (fila.sector) {
    push(fila.sector, fila);
    for (const alias of SECTOR_ALIASES[fila.sector] ?? []) push(alias, fila);
  }
}

const dist = {};
for (const [clave, rows] of grupos) {
  const porMetrica = {};
  for (const metrica of METRICAS) {
    const vals = rows.map((r) => r.m[metrica]).filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (vals.length < MIN_N) continue;   // sin muestra suficiente no se emite: mejor caer a ALL
    porMetrica[metrica] = { q: LEVELS.map((p) => +quantile(vals, p).toFixed(4)), n: vals.length };
  }
  if (Object.keys(porMetrica).length) dist[clave] = porMetrica;
}

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
