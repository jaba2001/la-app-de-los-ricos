// ─────────────────────────────────────────────────────────────────────────────
// IMPACTO DE PASAR DE BANDAS ABSOLUTAS A PERCENTILES SECTORIALES (F2 · paso 1)
//
// NO cambia nada. Solo responde, con datos, a la pregunta que hay que contestar ANTES de
// tocar `calcScores()`: si sustituimos los 43 umbrales fijos ("pe < 15 → 7 puntos") por
// percentiles dentro del sector, ¿cuántos nombres cambian de nota y cuáles?
//
// Si se moviera el 5% de la cartera sería un retoque; si se mueve la mitad, es un cambio
// de metodología que además parte en dos el track record (`sl_cohort` sella cohortes
// mensuales con el score de ese momento) y hay que decidirlo, versionarlo y anunciarlo.
//
// El score "por percentiles" que se compara aquí es una RÉPLICA de la estructura de
// calcScores() —mismos pilares, mismos topes, mismo peso relativo de cada métrica— con
// una sola diferencia: cada métrica reparte sus puntos según en qué percentil de SU SECTOR
// cae, en vez de contra un umbral fijo. Es una aproximación para medir el impacto, no la
// implementación definitiva: por eso vive aquí y no en lib/.
//
//   node --experimental-strip-types --no-warnings research/score_pctl_impact.mjs [--limit N]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, momentum } from "./prices.mjs";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { metricsOf } from "./fundamentalMetrics.mjs";
import { calcScores, getRating } from "../lib/scoring.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;

const distFile = JSON.parse(readFileSync(join(OUT, "factor_dist.json"), "utf8"));
const DIST = distFile.dist;

// ── recogida ─────────────────────────────────────────────────────────────────────
const table = await loadSP500Historical();
let members = table ? [...new Set(membersAsOf(table, today) || [])] : CURATED;
if (LIMIT > 0) members = members.slice(0, LIMIT);
console.log(`\n  IMPACTO BANDAS → PERCENTILES · ${members.length} nombres · ${today}\n`);

const filas = [];
let hechos = 0;
for (const t of members) {
  hechos++;
  if (hechos % 100 === 0) console.log(`  …${hechos}/${members.length}`);
  try {
    const cik = await tickerToCik(t);
    if (!cik) continue;
    const f = await fundamentalsAsOf(cik, today);
    const raw = await rawPriceAsOf(t, today);
    if (!f || f.revTTM == null || raw == null) continue;
    const sector = (await sicSector(cik)) || null;
    const m = metricsOf(f, raw, await momentum(t, today));
    const inputs = { ...m, sector, marketCap: f.shares > 0 ? raw * f.shares : null };
    // Ambos lados salen ya de la IMPLEMENTACIÓN REAL de producción: la única diferencia es
    // pasarle o no la tabla de distribuciones. Antes esto comparaba contra una réplica del
    // score escrita aquí, que servía para estimar el impacto pero no probaba el código que
    // se va a desplegar. Ahora mide lo que de verdad va a correr.
    const actual = calcScores(inputs);
    const nuevo = calcScores(inputs, DIST);
    filas.push({ ticker: t, sector, actual, nuevo, delta: nuevo.total - actual.total,
      rActual: getRating(actual.total).label, rNuevo: getRating(nuevo.total).label });
  } catch { /* saltar */ }
}
console.log(`  evaluados ${filas.length} nombres\n`);
if (!filas.length) { console.error("  ✖ sin datos"); process.exit(1); }

// ── resultados ───────────────────────────────────────────────────────────────────
const cambian = filas.filter((r) => r.rActual !== r.rNuevo);
const media = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const deltas = filas.map((r) => r.delta).sort((a, b) => a - b);
const mediana = deltas[Math.floor(deltas.length / 2)];

console.log(`  ── CUÁNTO SE MUEVE ──`);
console.log(`  cambian de rating: ${cambian.length}/${filas.length} (${((cambian.length / filas.length) * 100).toFixed(0)}%)`);
console.log(`  delta de score: media ${media(filas.map((r) => r.delta)).toFixed(1)} · mediana ${mediana} · rango [${deltas[0]}, ${deltas.at(-1)}]`);
console.log(`  |delta| > 10 puntos: ${filas.filter((r) => Math.abs(r.delta) > 10).length} nombres`);

console.log(`\n  ── MATRIZ DE TRANSICIÓN (actual → nuevo) ──`);
const ORDEN = ["STRONG BUY", "BUY", "CAUTION", "AVOID"];
const matriz = {};
for (const r of filas) { const k = `${r.rActual}→${r.rNuevo}`; matriz[k] = (matriz[k] ?? 0) + 1; }
console.log(`  ${"".padEnd(12)}${ORDEN.map((o) => o.slice(0, 9).padStart(11)).join("")}`);
for (const a of ORDEN) {
  const fila = ORDEN.map((b) => String(matriz[`${a}→${b}`] ?? 0).padStart(11)).join("");
  console.log(`  ${a.padEnd(12)}${fila}`);
}

console.log(`\n  ── POR SECTOR (delta medio del score) ──`);
const porSector = {};
for (const r of filas) { if (!r.sector) continue; (porSector[r.sector] ??= []).push(r.delta); }
for (const [s, ds] of Object.entries(porSector).sort((a, b) => media(b[1]) - media(a[1]))) {
  const m = media(ds);
  console.log(`  ${s.padEnd(24)}${(m >= 0 ? "+" : "") + m.toFixed(1).padStart(6)}   (${ds.length} nombres)  ${m > 3 ? "◄ sube" : m < -3 ? "◄ baja" : ""}`);
}

const sube = [...filas].sort((a, b) => b.delta - a.delta).slice(0, 8);
const baja = [...filas].sort((a, b) => a.delta - b.delta).slice(0, 8);
console.log(`\n  ── QUIÉN MÁS SUBE ──`);
for (const r of sube) console.log(`  ${r.ticker.padEnd(6)} ${(r.sector ?? "—").padEnd(22)} ${String(r.actual.total).padStart(3)} → ${String(r.nuevo.total).padStart(3)}  (${r.delta >= 0 ? "+" : ""}${r.delta})  ${r.rActual} → ${r.rNuevo}`);
console.log(`\n  ── QUIÉN MÁS BAJA ──`);
for (const r of baja) console.log(`  ${r.ticker.padEnd(6)} ${(r.sector ?? "—").padEnd(22)} ${String(r.actual.total).padStart(3)} → ${String(r.nuevo.total).padStart(3)}  (${r.delta >= 0 ? "+" : ""}${r.delta})  ${r.rActual} → ${r.rNuevo}`);

// ── separar NIVEL de REDISTRIBUCIÓN ──────────────────────────────────────────────
// El delta bruto mezcla dos efectos y sólo uno interesa:
//   (a) NIVEL — la escala de percentiles reparte menos puntos que las bandas actuales
//       (con "pe < 25 → 5 de 7", más de la mitad del universo cobra el 71% de la nota;
//       por percentil, el nombre mediano cobra el 43%). Eso baja el score de TODOS por
//       igual y es un problema de CALIBRACIÓN, no del método: se arregla moviendo los
//       escalones o los umbrales de rating. No dice nada sobre si el cambio es bueno.
//   (b) REDISTRIBUCIÓN — quién gana y quién pierde UNOS RESPECTO A OTROS. Esto sí es el
//       efecto de juzgar contra el sector, y es lo único que hay que decidir.
// Para aislar (b) se recalibran los umbrales de rating de modo que la nueva distribución
// de notas tenga las MISMAS proporciones que la actual, y se recuenta con eso.
const deltaMedio = media(filas.map((r) => r.delta));
for (const r of filas) r.deltaRel = r.delta - deltaMedio;

const cuenta = (arr, campo) => arr.reduce((acc, r) => { acc[r[campo]] = (acc[r[campo]] ?? 0) + 1; return acc; }, {});
const distActual = cuenta(filas, "rActual");
const ordenados = [...filas].map((r) => r.nuevo.total).sort((a, b) => b - a);
// Umbrales nuevos = los cortes que reproducen las proporciones de hoy.
const cortes = {};
let acumulado = 0;
for (const etiqueta of ORDEN) {
  acumulado += distActual[etiqueta] ?? 0;
  cortes[etiqueta] = ordenados[Math.min(ordenados.length - 1, acumulado - 1)] ?? 0;
}
const ratingRecal = (total) => {
  for (const etiqueta of ORDEN) if (total >= cortes[etiqueta]) return etiqueta;
  return ORDEN[ORDEN.length - 1];
};
for (const r of filas) r.rNuevoRecal = ratingRecal(r.nuevo.total);
const cambianRecal = filas.filter((r) => r.rActual !== r.rNuevoRecal);

console.log(`\n  ── SEPARANDO LOS DOS EFECTOS ──`);
console.log(`  (a) NIVEL: la escala de percentiles da ${deltaMedio.toFixed(1)} puntos menos de media a TODO el universo.`);
console.log(`      Es calibración, no metodología — se corrige con los escalones o los umbrales de rating.`);
console.log(`  (b) REDISTRIBUCIÓN: una vez recalibrados los umbrales para mantener las mismas proporciones,`);
console.log(`      cambian de rating ${cambianRecal.length}/${filas.length} (${((cambianRecal.length / filas.length) * 100).toFixed(0)}%) — ESTE es el impacto real del cambio.`);
console.log(`      umbrales recalibrados: ${ORDEN.map((o) => `${o} ≥ ${cortes[o]}`).join(" · ")}`);

const subeRel = [...filas].sort((a, b) => b.deltaRel - a.deltaRel).slice(0, 6);
const bajaRel = [...filas].sort((a, b) => a.deltaRel - b.deltaRel).slice(0, 6);
console.log(`\n  ── REDISTRIBUCIÓN REAL: quién gana posiciones ──`);
for (const r of subeRel) console.log(`  ${r.ticker.padEnd(6)} ${(r.sector ?? "—").padEnd(22)} ${r.deltaRel >= 0 ? "+" : ""}${r.deltaRel.toFixed(0).padStart(3)} vs la media   ${r.rActual} → ${r.rNuevoRecal}`);
console.log(`\n  ── REDISTRIBUCIÓN REAL: quién pierde posiciones ──`);
for (const r of bajaRel) console.log(`  ${r.ticker.padEnd(6)} ${(r.sector ?? "—").padEnd(22)} ${r.deltaRel >= 0 ? "+" : ""}${r.deltaRel.toFixed(0).padStart(3)} vs la media   ${r.rActual} → ${r.rNuevoRecal}`);

const pctCambio = (cambianRecal.length / filas.length) * 100;
const veredicto = pctCambio < 10
  ? "RETOQUE — se mueve poco; se puede activar con una nota de versión y sin partir el track record."
  : pctCambio < 30
    ? "CAMBIO REAL — hay que versionar el score en sl_cohort y avisar, pero es asumible."
    : "CAMBIO DE METODOLOGÍA — se mueve demasiado para colarlo: exige versionar el track record, decidir si se recalcula el histórico y anunciarlo.";
console.log(`\n  VEREDICTO (sobre la redistribución, ya sin el sesgo de nivel): ${veredicto}\n`);

writeFileSync(join(OUT, "score_pctl_impact.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: today, universe: filas.length,
  ratingChangesRaw: cambian.length,
  levelShift: +deltaMedio.toFixed(2),
  recalibratedCuts: cortes,
  ratingChangesAfterRecalibration: cambianRecal.length,
  ratingChangePct: +pctCambio.toFixed(1),
  deltaMean: +media(filas.map((r) => r.delta)).toFixed(2), deltaMedian: mediana,
  deltaRange: [deltas[0], deltas.at(-1)], transitions: matriz,
  bySector: Object.fromEntries(Object.entries(porSector).map(([s, ds]) => [s, { deltaMean: +media(ds).toFixed(2), n: ds.length }])),
  biggestGainers: sube.map((r) => ({ ticker: r.ticker, sector: r.sector, from: r.actual.total, to: r.nuevo.total, delta: r.delta, ratingFrom: r.rActual, ratingTo: r.rNuevo })),
  biggestLosers: baja.map((r) => ({ ticker: r.ticker, sector: r.sector, from: r.actual.total, to: r.nuevo.total, delta: r.delta, ratingFrom: r.rActual, ratingTo: r.rNuevo })),
  verdict: veredicto,
}, null, 2));
console.log(`  → escrito research/out/score_pctl_impact.json\n`);
