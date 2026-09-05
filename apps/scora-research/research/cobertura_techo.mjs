// ─────────────────────────────────────────────────────────────────────────────
// EL TECHO: SI ARREGLÁRAMOS CADA CAMPO, ¿A CUÁNTOS RESCATARÍA DE VERDAD?
//
// `cobertura_metricas.mjs` contesta QUÉ falta: de 503 miembros, 144 no llegan al mínimo de
// 3 de 5 métricas, y el campo ausente más repetido es `oiTTM` (111 de los 144). De ahí sale
// el reflejo natural —«arreglemos `oiTTM` y recuperamos casi un tercio del universo»— y ese
// reflejo puede estar equivocado, porque **contar ausencias no es contar rescates**.
//
// LA DIFERENCIA, QUE ES TODA LA PREGUNTA. A una empresa le pueden faltar TRES campos. Arreglar
// uno la deja igual de fuera: sigue sin llegar a 3 de 5. Así que el número que decide si vale
// la pena construir la jerarquía de tags no es «a cuántos les falta `oiTTM`» (111) sino
// «cuántos CRUZAN el umbral si `oiTTM` aparece» — que es necesariamente menor, y puede ser
// mucho menor.
//
// ⚠️ Y HAY UNA TRAMPA CONCRETA QUE ESTO DESTAPA. La vía de reconstrucción que SÍ pasó el
// criterio preescrito de la fase 2 (`ebit_reconstruccion.json`: desvío mediano 0 %, dispersión
// sectorial 0, frente al 7,6 % y 36,1 pp de la vía pretax, que queda descartada) es
// `GrossProfit − OperatingExpenses`. Pero esa vía **necesita `gpTTM`**, y a 86 de los 144 les
// falta también `gpTTM`. O sea: la única vía estadísticamente aceptable no se puede aplicar
// justo donde más falta hace. Este guion mide exactamente cuánto de ese solape hay.
//
// CÓMO LO MIDE. Para cada campo (y para los pares que importan) recalcula la señal SUPONIENDO
// ese campo presente, y cuenta cuántos de los que hoy no llegan cruzarían el umbral. No estima
// nada: reevalúa la misma regla de 3 de 5 sobre los mismos nombres.
//
//   node --experimental-strip-types --no-warnings research/cobertura_techo.mjs [--asof YYYY-MM-DD]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { metricsOf } from "./fundamentalMetrics.mjs";
import { MIN_METRICAS } from "./picksSignal.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));

// Copiado de `cobertura_metricas.mjs`, que a su vez lo copia de `fundamentalMetrics.mjs`.
// Si allí cambia una fórmula y aquí no, este informe daría una explicación plausible y falsa.
const DEPENDE_DE = {
  gprof: ["assets", "gpTTM"],
  roic: ["equity", "debt", "oiTTM"],
  opm: ["revTTM", "oiTTM"],
  icov: ["interestTTM", "oiTTM"],
  lev: ["oiTTM", "daTTM", "debt"],
};
const CAMPOS = [...new Set(Object.values(DEPENDE_DE).flat())].sort();

/** Métricas que se pueden calcular si `presentes` son los campos disponibles. */
const cuenta = (presentes) =>
  Object.values(DEPENDE_DE).filter((deps) => deps.every((d) => presentes.has(d))).length;

const tabla = await loadSP500Historical();
if (!tabla?.length) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const miembros = [...new Set(membersAsOf(tabla, ASOF) || [])];
console.log(`\n  TECHO DE COBERTURA · ${ASOF} · ${miembros.length} miembros\n`);

const filas = [];
for (const t of miembros) {
  try {
    const cik = await tickerToCik(t);
    if (!cik) continue;
    const f = await fundamentalsAsOf(cik, ASOF);
    if (!f) continue;
    const m = metricsOf(f, null, null);
    const presentes = new Set(CAMPOS.filter((c) => f[c] != null && Number.isFinite(Number(f[c]))));
    filas.push({ t, sector: (await sicSector(cik)) || null, presentes: [...presentes], n: cuenta(presentes) });
  } catch { /* saltar */ }
}

const bajo = filas.filter((f) => f.n < MIN_METRICAS);
console.log(`  con señal (≥${MIN_METRICAS}/5): ${filas.length - bajo.length}   ·   bajo el mínimo: ${bajo.length}  (${(bajo.length / filas.length * 100).toFixed(1)} %)\n`);

/** Cuántos de `bajo` cruzan el umbral si aparecen los campos de `arreglo`. */
function rescatados(arreglo) {
  return bajo.filter((f) => cuenta(new Set([...f.presentes, ...arreglo])) >= MIN_METRICAS);
}

// ── 1. Un campo cada vez ────────────────────────────────────────────────────────────────
console.log(`  SI APARECIERA CADA CAMPO, POR SEPARADO:`);
console.log(`     campo           les falta   RESCATA   (rescatados / ausencias)`);
const porCampo = {};
for (const c of CAMPOS) {
  const ausente = bajo.filter((f) => !f.presentes.includes(c)).length;
  if (!ausente) continue;
  const r = rescatados([c]).length;
  porCampo[c] = { ausenteEn: ausente, rescata: r, ratio: ausente ? +(r / ausente).toFixed(2) : null };
  console.log(`     ${c.padEnd(14)}${String(ausente).padStart(8)}${String(r).padStart(10)}   ${ausente ? (r / ausente * 100).toFixed(0) + " %" : "—"}`);
}

// ── 2. Los pares que el roadmap tiene que decidir ───────────────────────────────────────
const PARES = [["oiTTM", "gpTTM"], ["oiTTM", "interestTTM"], ["oiTTM", "daTTM"], ["oiTTM", "debt"], ["gpTTM", "interestTTM"]];
console.log(`\n  Y EN PAREJA (arreglar dos cosas a la vez):`);
const porPar = {};
for (const p of PARES) {
  const r = rescatados(p).length;
  porPar[p.join("+")] = r;
  const suelto = Math.max(porCampo[p[0]]?.rescata ?? 0, porCampo[p[1]]?.rescata ?? 0);
  console.log(`     ${p.join(" + ").padEnd(26)}${String(r).padStart(5)}   (el mejor de los dos por separado: ${suelto})`);
}

// ── 3. El techo absoluto ────────────────────────────────────────────────────────────────
const techo = rescatados(CAMPOS).length;
console.log(`\n  TECHO ABSOLUTO (todos los campos presentes): ${techo} de ${bajo.length} rescatables`);
if (techo < bajo.length) {
  const irrecuperables = bajo.filter((f) => cuenta(new Set(CAMPOS)) < MIN_METRICAS).length;
  console.log(`     ${bajo.length - techo} NO se rescatan ni con todos los campos: les falta el dato en origen, no el tag.`);
}

// ── 4. Quiénes son los que sí se rescatarían con la vía aceptable ───────────────────────
const conGp = rescatados(["oiTTM"]).filter((f) => f.presentes.includes("gpTTM"));
console.log(`\n  ⚠️ LA VÍA QUE PASÓ EL CRITERIO (GrossProfit − OperatingExpenses) NECESITA gpTTM:`);
console.log(`     de los ${rescatados(["oiTTM"]).length} que rescataría un oiTTM perfecto, sólo ${conGp.length} tienen gpTTM`);
console.log(`     → el resto necesitaría la vía pretax, que el criterio preescrito RECHAZÓ (7,6 % / 36,1 pp)`);
console.log(`     ejemplos rescatables: ${conGp.slice(0, 12).map((f) => f.t).join(" ")}`);

// ── 5. Reparto sectorial de los que no llegan ───────────────────────────────────────────
const porSector = {};
for (const f of bajo) { const s = f.sector ?? "(sin sector)"; porSector[s] = (porSector[s] ?? 0) + 1; }
console.log(`\n  LOS QUE NO LLEGAN, POR SECTOR:`);
for (const [s, n] of Object.entries(porSector).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`     ${s.padEnd(24)}${String(n).padStart(4)}`);

writeFileSync(join(OUT, "cobertura_techo.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/cobertura_techo.mjs", asOf: ASOF,
  minMetricas: MIN_METRICAS, miembros: filas.length, conSenal: filas.length - bajo.length, bajoMinimo: bajo.length,
  porCampo, porPar, techoAbsoluto: techo,
  viaAceptableCubre: conGp.length, rescatablesPorOi: rescatados(["oiTTM"]).length,
  porSector,
  nota: "RESCATA no es lo mismo que AUSENTE EN: a una empresa le pueden faltar tres campos, y arreglar uno la deja igual de fuera. La via de reconstruccion que paso el criterio preescrito (GrossProfit - OperatingExpenses) necesita gpTTM, que falta en la mayoria de los mismos nombres: ese solape es el que limita el rescate real.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/cobertura_techo.json\n`);
