// ─────────────────────────────────────────────────────────────────────────────
// CUÁNTO DEL UNIVERSO PUEDE PUNTUAR, Y POR QUÉ NO PUEDE EL RESTO
//
// La señal de calidad necesita al menos 3 de 5 métricas (`MIN_METRICAS`). El 2026-08-25,
// 143 de 498 miembros del índice —el 28,7 %— no llegaban. Eso no es un detalle de cobertura:
// es que **casi un tercio del universo no recibe nota**, y los que no la reciben no son
// empresas oscuras sino JNJ, LLY, MRK, PFE, XOM, CVX, COP, IBM y AXP.
//
// ⚠️ ESTE GUION EXISTE PORQUE SIN ÉL NO SE PUEDE JUZGAR NINGÚN ARREGLO.
//
// Cuando se toca la extracción de fundamentales, la pregunta que importa no es «¿sube la
// cobertura?» sino «¿sube sin cambiar lo que ya se calculaba?». Sin una medición reproducible
// y versionada, un arreglo que rescata 80 nombres y estropea 20 se ve igual que uno que
// rescata 60 y no estropea ninguno. Hasta ahora esta medición se hacía a mano, se leía una
// vez y se tiraba — que es exactamente cómo se pierde la capacidad de comparar.
//
// LO QUE MIDE, y en este orden porque el segundo explica el primero:
//
//   1. Cobertura de las cinco métricas de la señal, y cuántos nombres quedan por debajo del
//      mínimo.
//   2. Cobertura de los CAMPOS CRUDOS de los que dependen. Esto es lo que convierte el
//      informe en accionable: `roic`, `opm`, `icov` y —vía EBITDA— `lev` cuelgan TODAS de
//      `oiTTM`, así que un solo campo ausente tumba cuatro de las cinco métricas y deja al
//      nombre en 1 de 5. Sin esta segunda tabla, «falta cobertura» no dice dónde mirar.
//   3. El reparto por sector de los que no llegan, y el patrón exacto de qué les falta.
//
//   node --experimental-strip-types --no-warnings research/cobertura_metricas.mjs [--asof YYYY-MM-DD]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, renameSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { metricsOf } from "./fundamentalMetrics.mjs";
import { METRICAS_CALIDAD, MIN_METRICAS, metricasDe } from "./picksSignal.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));

/**
 * De qué campo crudo depende cada métrica. Copiado a mano de `fundamentalMetrics.mjs`, y por
 * eso hay un test que comprueba que sigue coincidiendo: si allí cambia una fórmula y aquí no,
 * este informe seguiría dando una explicación plausible y equivocada de por qué falta una nota.
 */
const DEPENDE_DE = {
  gprof: ["assets", "gpTTM"],
  roic: ["equity", "debt", "oiTTM"],
  opm: ["revTTM", "oiTTM"],
  icov: ["interestTTM", "oiTTM"],
  lev: ["oiTTM", "daTTM", "debt"], // ebitda = oiTTM + daTTM
};
const CAMPOS = [...new Set(Object.values(DEPENDE_DE).flat())].sort();

const tabla = await loadSP500Historical();
if (!tabla?.length) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const miembros = membersAsOf(tabla, ASOF);
console.log(`\n  COBERTURA DE MÉTRICAS · ${ASOF} · ${miembros.length} miembros\n`);

const filas = [];
let n = 0;
for (const t of miembros) {
  n++;
  if (n % 50 === 0) process.stdout.write(`\r  ${n}/${miembros.length}…`);
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* sigue */ }
  if (!cik) { filas.push({ t, cik: null, sector: null, campos: {}, metricas: {} }); continue; }
  let f = null;
  try { f = await fundamentalsAsOf(cik, ASOF); } catch { /* sigue */ }
  let sector = null;
  try { sector = (await sicSector(cik)) || null; } catch { /* sigue */ }
  const campos = Object.fromEntries(CAMPOS.map((c) => [c, f?.[c] != null]));
  // `metricasDe` espera la forma de `collectRows`: {ticker, m}. El precio no hace falta —
  // ninguna de las cinco métricas de calidad lo usa— y pedirlo aquí gastaría cuota sin motivo.
  const m = f ? metricsOf(f, 0, null) : {};
  const vals = metricasDe({ ticker: t, m });
  const metricas = Object.fromEntries(METRICAS_CALIDAD.map((k) => [k, vals[k] != null && isFinite(vals[k])]));
  filas.push({ t, cik, sector, campos, metricas });
}
process.stdout.write("\r" + " ".repeat(30) + "\r");

const pct = (x, tot) => (tot ? (100 * x) / tot : 0);
const conCik = filas.filter((f) => f.cik);
const nCampo = Object.fromEntries(CAMPOS.map((c) => [c, conCik.filter((f) => f.campos[c]).length]));
const nMetrica = Object.fromEntries(METRICAS_CALIDAD.map((k) => [k, conCik.filter((f) => f.metricas[k]).length]));
const cuentaMetricas = (f) => METRICAS_CALIDAD.filter((k) => f.metricas[k]).length;
const bajoMinimo = conCik.filter((f) => cuentaMetricas(f) < MIN_METRICAS);
const sinCik = filas.filter((f) => !f.cik);

console.log(`  CAMPOS CRUDOS (sobre ${conCik.length} con CIK):`);
for (const c of CAMPOS) {
  const usadoPor = Object.entries(DEPENDE_DE).filter(([, ds]) => ds.includes(c)).map(([k]) => k);
  console.log(`    ${c.padEnd(12)} ${String(nCampo[c]).padStart(4)}  ${pct(nCampo[c], conCik.length).toFixed(1).padStart(5)}%   → ${usadoPor.join(", ")}`);
}
console.log(`\n  MÉTRICAS DE LA SEÑAL:`);
for (const k of METRICAS_CALIDAD) console.log(`    ${k.padEnd(12)} ${String(nMetrica[k]).padStart(4)}  ${pct(nMetrica[k], conCik.length).toFixed(1).padStart(5)}%`);

console.log(`\n  CON SEÑAL (≥${MIN_METRICAS}/5): ${conCik.length - bajoMinimo.length}   ·   BAJO EL MÍNIMO: ${bajoMinimo.length}  (${pct(bajoMinimo.length, conCik.length).toFixed(1)} %)`);
if (sinCik.length) console.log(`  Sin CIK (no llegan ni a intentarlo): ${sinCik.length} — ${sinCik.map((f) => f.t).join(" ")}`);

// ── Por qué no llegan ────────────────────────────────────────────────────────────────────
// El patrón de campos ausentes es lo accionable: si el mismo campo aparece en casi todos, el
// arreglo es uno solo y no cinco.
const culpables = {};
for (const f of bajoMinimo) for (const c of CAMPOS) if (!f.campos[c]) culpables[c] = (culpables[c] ?? 0) + 1;
console.log(`\n  QUÉ LES FALTA A LOS ${bajoMinimo.length} QUE NO LLEGAN:`);
for (const [c, k] of Object.entries(culpables).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${c.padEnd(12)} le falta a ${String(k).padStart(3)}  (${pct(k, bajoMinimo.length).toFixed(0).padStart(3)} % de ellos)`);
}

const porSector = {};
for (const f of bajoMinimo) (porSector[f.sector ?? "(sin sector)"] ??= []).push(f.t);
console.log(`\n  REPARTO POR SECTOR:`);
for (const [s, ts] of Object.entries(porSector).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(s).slice(0, 24).padEnd(25)} ${String(ts.length).padStart(3)}  ${ts.slice(0, 8).join(" ")}${ts.length > 8 ? " …" : ""}`);
}

const ruta = join(OUT, "cobertura_metricas.json");
const tmp = ruta + ".tmp";
writeFileSync(tmp, JSON.stringify({
  generatedAt: new Date().toISOString(),
  fuente: "research/cobertura_metricas.mjs",
  asOf: ASOF,
  minMetricas: MIN_METRICAS,
  miembros: miembros.length,
  conCik: conCik.length,
  sinCik: sinCik.map((f) => f.t),
  campos: Object.fromEntries(CAMPOS.map((c) => [c, { n: nCampo[c], pct: +pct(nCampo[c], conCik.length).toFixed(1), usadoPor: Object.entries(DEPENDE_DE).filter(([, ds]) => ds.includes(c)).map(([k]) => k) }])),
  metricas: Object.fromEntries(METRICAS_CALIDAD.map((k) => [k, { n: nMetrica[k], pct: +pct(nMetrica[k], conCik.length).toFixed(1) }])),
  conSenal: conCik.length - bajoMinimo.length,
  bajoMinimo: bajoMinimo.length,
  pctBajoMinimo: +pct(bajoMinimo.length, conCik.length).toFixed(1),
  culpables,
  porSector: Object.fromEntries(Object.entries(porSector).map(([s, ts]) => [s, ts])),
  dependeDe: DEPENDE_DE,
}, null, 1));
renameSync(tmp, ruta);
console.log(`\n  → research/out/cobertura_metricas.json\n`);
