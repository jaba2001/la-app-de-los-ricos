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

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99];
const MIN_N = 8;   // por debajo de esto, un cuantil sectorial es una anécdota, no una distribución

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;

// Las dos grafías de sector que conviven en el proyecto (FMP dice "Financial Services",
// GICS y EDGAR dicen "Financials"). Se emiten AMBAS para que `lookupDist` acierte venga
// de donde venga el nombre — el mismo criterio que ya siguen los mapas de scoring.ts.
const SECTOR_ALIASES = {
  "Financials": ["Financial Services"], "Financial Services": ["Financials"],
  "Materials": ["Basic Materials"], "Basic Materials": ["Materials"],
};

function quantile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/** Métricas de un nombre, en las unidades de ScoreInputs. null donde no se pueda calcular. */
function metricsOf(f, raw, mom) {
  const mcap = f.shares > 0 && raw > 0 ? raw * f.shares : null;
  const ev = mcap != null ? mcap + (f.debt ?? 0) - (f.cash ?? 0) : null;
  const fcf = f.ocfTTM != null && f.capexTTM != null ? f.ocfTTM - f.capexTTM : null;
  const ebitda = f.oiTTM != null && f.daTTM != null ? f.oiTTM + f.daTTM : null;
  const invested = (f.equity ?? 0) + (f.debt ?? 0);
  const pos = (x) => (x != null && isFinite(x) && x > 0 ? x : null);

  return {
    // Valoración — sólo con denominador positivo: un PER negativo no es "barato", es otra cosa,
    // y meterlo en la distribución contamina los cuantiles bajos justo donde más duele.
    pe: mcap != null && pos(f.niTTM) ? mcap / f.niTTM : null,
    pb: mcap != null && pos(f.equity) ? mcap / f.equity : null,
    evEbitda: ev != null && pos(ebitda) ? ev / ebitda : null,
    pfcf: mcap != null && pos(fcf) ? mcap / fcf : null,
    // Rentabilidad (porcentaje)
    roe: pos(f.equity) && f.niTTM != null ? (f.niTTM / f.equity) * 100 : null,
    roa: pos(f.assets) && f.niTTM != null ? (f.niTTM / f.assets) * 100 : null,
    roic: invested > 0 && f.oiTTM != null ? ((f.oiTTM * 0.79) / invested) * 100 : null,
    grossMargin: pos(f.revTTM) && f.gpTTM != null ? (f.gpTTM / f.revTTM) * 100 : null,
    netMargin: pos(f.revTTM) && f.niTTM != null ? (f.niTTM / f.revTTM) * 100 : null,
    grossProfitability: pos(f.assets) && f.gpTTM != null ? (f.gpTTM / f.assets) * 100 : null,
    // Fracciones
    operatingMargin: pos(f.revTTM) && f.oiTTM != null ? f.oiTTM / f.revTTM : null,
    capexToRevenue: pos(f.revTTM) && f.capexTTM != null ? f.capexTTM / f.revTTM : null,
    fcfYield: mcap != null && fcf != null ? fcf / mcap : null,
    // Solidez (ratios)
    debtEquity: pos(f.equity) ? (f.debt ?? 0) / f.equity : null,
    currentRatio: pos(f.curL) && f.curA != null ? f.curA / f.curL : null,
    interestCoverage: pos(f.interestTTM) && f.oiTTM != null ? f.oiTTM / f.interestTTM : null,
    netDebtEbitda: pos(ebitda) ? ((f.debt ?? 0) - (f.cash ?? 0)) / ebitda : null,
    // Crecimiento (porcentaje)
    revenueGrowth: pos(f.revPrevTTM) && f.revTTM != null ? (f.revTTM / f.revPrevTTM - 1) * 100 : null,
    epsGrowth: pos(f.niPrevTTM) && f.niTTM != null ? (f.niTTM / f.niPrevTTM - 1) * 100 : null,
    // Momentum (porcentaje)
    priceChange1M: mom?.m1 ?? null,
    priceChange3M: mom?.m3 ?? null,
    priceChange6M: mom?.m6 ?? null,
  };
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
