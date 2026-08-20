// ─────────────────────────────────────────────────────────────────────────────
// ¿CALIDAD + BAJA VOLATILIDAD SIRVE COMO SEÑAL DE SCORA PICKS? (Fase 0 de SCORA_PICKS_REGLAS.md)
//
// La opción B del documento de reglas: en vez de intentar acertar qué sube más —que ya se
// midió y no funciona (§7.10/§7.11)— intentar NO PERDER. La literatura respalda mejor esto
// que lo otro, y encaja con lo único que replicó fuera de muestra en toda la investigación:
// el gate mejora el Sharpe, no el retorno.
//
// ═══ CRITERIOS DE ACEPTACIÓN, ESCRITOS ANTES DE VER UN SOLO NÚMERO ═══
//
//   La tesis es "no perder", así que el listón NO es el retorno total:
//
//   1. SHARPE por encima del universo elegible equiponderado, en LAS DOS ventanas.
//   2. DRAWDOWN MÁXIMO menor que esa misma referencia, en LAS DOS ventanas.
//   3. El retorno total no puede quedar MUY por debajo (tolerancia: −15 pp): una cartera
//      que no pierde porque no gana no es un producto.
//   4. Consistencia de signo entre las dos ventanas. Si sólo funciona en una, es ruido.
//
//   Si (1) y (2) se cumplen pero (3) no, la lectura honesta es "reduce riesgo a costa de
//   rentabilidad" — que es un producto legítimo, pero HAY QUE VENDERLO ASÍ.
//   Si falla (1) o (2), la opción B se cae y Scora Picks pasa a la opción C (el paper fund).
//
// Referencias: SPY · RSP (equiponderado) · UNIVERSO EQUIPONDERADO. La tercera es la que
// decide, porque comparte universo y sesgo — lección de §7.10, donde elegir mal el
// benchmark daba el diagnóstico contrario.
//
//   node --experimental-strip-types --no-warnings research/quality_lowvol_lab.mjs [--long] [--cap 400]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";
import { returnsSeries, fwdReturn } from "./prices.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";
import { calcScores } from "../lib/scoring.ts";
import { addMonths, monthStarts, mean, std, fx, spearman, loadPanel, idxOnOrBefore, pct } from "./momentumSignals.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LONG = process.argv.includes("--long");
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;
const CAP = Number(arg("--cap", "400"));
const COST_BPS = 10;
const TOP_N = Number(arg("--top", "25"));   // nº de posiciones, como una cartera real

const today = new Date().toISOString().slice(0, 10);
const START = arg("--from", LONG ? "2011-01-01" : "2019-01-01");
const END = LONG ? "2018-12-01" : addMonths(today, -4);
const fechas = monthStarts(START, END).filter((_, i) => i % 3 === 0);   // trimestral

const table = await loadSP500Historical();
console.log(`\n  CALIDAD + BAJA VOLATILIDAD · ${LONG ? "2011-2018 (fuera de muestra)" : "2019-2026"} · ${fechas.length} trimestres · top ${TOP_N}\n`);

// Volatilidad anualizada a una fecha, desde el panel de precios.
function volAt(p, fecha) {
  const i = idxOnOrBefore(p.dates, fecha);
  if (i < 252) return null;
  const s = std(p.ret.slice(i - 252, i + 1));
  return s ? s * Math.sqrt(252) : null;
}
function fwdDe(p, fecha, meses) {
  const a = idxOnOrBefore(p.dates, fecha), b = idxOnOrBefore(p.dates, addMonths(fecha, meses));
  return a < 0 || b <= a ? null : (Math.exp(p.cum[b] - p.cum[a]) - 1) * 100;
}

const panels = new Map();
const sectorCache = new Map();
const porFecha = new Map();

for (const fecha of fechas) {
  let miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
  if (CAP > 0) miembros = miembros.slice(0, CAP);
  // Sin exigir precio: la señal de calidad sale de los estados financieros, y exigirlo
  // limitaba el estudio a 2018+ (donde arranca la caché de precios) sin avisar.
  const filas = await collectRows(miembros, fecha, sectorCache, false);
  const bucket = [];
  for (const f of filas) {
    if (!panels.has(f.ticker)) panels.set(f.ticker, await loadPanel(f.ticker, seriesFn));
    const p = panels.get(f.ticker);
    if (!p) continue;
    const vol = volAt(p, fecha);
    const fwd3 = LONG ? fwdDe(p, fecha, 3) : await fwdReturn(f.ticker, fecha, addMonths(fecha, 3));
    if (vol == null || fwd3 == null) continue;
    bucket.push({
      t: f.ticker, fwd3, vol,
      // CALIDAD — lo que hace que un negocio aguante, no lo que hace que suba.
      gprof: f.m.grossProfitability, roic: f.m.roic, opm: f.m.operatingMargin,
      icov: f.m.interestCoverage, lev: f.m.netDebtEbitda != null ? -f.m.netDebtEbitda : null,
      lowvol: -vol,
      v1: calcScores({ ...f.m, sector: f.sector }).total,
    });
  }
  if (bucket.length >= 40) porFecha.set(fecha, bucket);
  process.stdout.write(`  ${fecha} ${String(bucket.length).padStart(3)}\r`);
}
const fechasOk = [...porFecha.keys()];
console.log(`\n  ${fechasOk.length} trimestres con datos\n`);
if (fechasOk.length < 8) { console.error("  ✖ muestra insuficiente"); process.exit(1); }

// Percentil transversal medio de un grupo de métricas (mayor = mejor en todas).
function compuesto(rows, claves) {
  const maps = claves.map((k) => pct(rows, k));
  const out = new Map();
  for (const r of rows) {
    let s = 0, n = 0;
    for (const m of maps) { const p = m.get(r.t); if (p != null) { s += p; n++; } }
    if (n >= Math.ceil(claves.length / 2)) out.set(r.t, s / n);
  }
  return out;
}
const SEÑALES = {
  "Calidad": ["gprof", "roic", "opm", "icov", "lev"],
  "Baja volatilidad": ["lowvol"],
  "Calidad + baja vol": ["gprof", "roic", "opm", "icov", "lev", "lowvol", "lowvol", "lowvol", "lowvol", "lowvol"], // 50/50 en peso
  "Score v1 (actual)": ["v1"],
};

const curvaDe = (rets, porAño = 4) => {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  const años = rets.length / porAño;
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 1 / años) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(porAño) : 0, maxDD: mdd * 100 };
};

// Referencia que decide para SELECCIÓN: el universo elegible, equiponderado.
const ew = curvaDe(fechasOk.map((d) => mean(porFecha.get(d).map((r) => r.fwd3))));

// Y las dos que decide para PRODUCTO: batir al universo equiponderado demuestra que la
// señal selecciona; batir al SPY es lo que un cliente puede comparar con un fondo indexado.
// No son la misma pregunta y confundirlas es lo que se corrigió en §7.10 del plan.
async function refDe(ticker) {
  const p = await loadPanel(ticker, seriesFn);
  if (!p) return null;
  const rets = [];
  for (const d of fechasOk) { const r = fwdDe(p, d, 3); if (r != null) rets.push(r); }
  return rets.length >= fechasOk.length * 0.9 ? curvaDe(rets) : null;
}
const spy = await refDe("SPY");
const rsp = await refDe("RSP");

console.log(`  ${"cartera".padEnd(24)}${"IC".padStart(9)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}${"vs EW".padStart(9)}`);
const fila = (n, c) => console.log(`  ${n.padEnd(24)}${"—".padStart(9)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${(c.cagr.toFixed(1) + "%").padStart(8)}${c.sharpe.toFixed(2).padStart(8)}${(c.maxDD.toFixed(1) + "%").padStart(9)}${"—".padStart(9)}`);
if (spy) fila("① SPY (cap-weighted)", spy);
if (rsp) fila("② RSP (equiponderado)", rsp);
fila("③ universo EW", ew);
console.log(`  ${"-".repeat(74)}`);

const resultados = {};
for (const [nombre, claves] of Object.entries(SEÑALES)) {
  const ics = [], rets = [];
  let prev = new Set();
  for (const d of fechasOk) {
    const rows = porFecha.get(d);
    const m = compuesto(rows, claves);
    const xs = [], ys = [];
    for (const r of rows) { const v = m.get(r.t); if (v != null) { xs.push(v); ys.push(r.fwd3); } }
    const s = spearman(xs, ys); if (s != null) ics.push(s);
    const orden = [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).slice(0, TOP_N);
    const byT = new Map(rows.map((r) => [r.t, r]));
    const r = mean(orden.map((t) => byT.get(t)?.fwd3).filter((x) => x != null)) ?? 0;
    const set = new Set(orden); let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    rets.push(r - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100); prev = set;
  }
  const c = curvaDe(rets);
  resultados[nombre] = { ic: fx(mean(ics)), total: fx(c.total, 1), cagr: fx(c.cagr, 2), sharpe: fx(c.sharpe, 2), maxDD: fx(c.maxDD, 1), vsEW: fx(c.total - ew.total, 1) };
  console.log(`  ${nombre.padEnd(24)}${(mean(ics) >= 0 ? "+" : "") + mean(ics).toFixed(4)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${(c.cagr.toFixed(1) + "%").padStart(8)}${c.sharpe.toFixed(2).padStart(8)}${(c.maxDD.toFixed(1) + "%").padStart(9)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}`);
}

// ── criterios, evaluados sin margen de interpretación ────────────────────────────
const b = resultados["Calidad + baja vol"];
const c1 = b.sharpe > ew.sharpe;
const c2 = b.maxDD > ew.maxDD;          // menos negativo = drawdown menor
const c3 = b.vsEW > -15;
console.log(`\n  CRITERIOS (escritos antes de correr esto):`);
console.log(`    ${c1 ? "✔" : "✖"}  Sharpe por encima del universo EW (${b.sharpe} vs ${ew.sharpe.toFixed(2)})`);
console.log(`    ${c2 ? "✔" : "✖"}  Drawdown menor que el universo EW (${b.maxDD}% vs ${ew.maxDD.toFixed(1)}%)`);
console.log(`    ${c3 ? "✔" : "✖"}  Retorno no muy por debajo (${b.vsEW}pp, tolerancia −15pp)`);
const pasa = [c1, c2, c3].filter(Boolean).length;
console.log(`\n  ${pasa}/3 en esta ventana. ${LONG ? "(fuera de muestra)" : "Falta la ventana larga: --long"}`);

writeFileSync(join(OUT, LONG ? "quality_lowvol_lab_oos.json" : "quality_lowvol_lab.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), window: LONG ? "2011-2018" : "2019-2026",
  quarters: fechasOk.length, topN: TOP_N, universeEW: { total: fx(ew.total, 1), cagr: fx(ew.cagr, 2), sharpe: fx(ew.sharpe, 2), maxDD: fx(ew.maxDD, 1) },
  benchmarks: { spy: spy ? { total: fx(spy.total,1), sharpe: fx(spy.sharpe,2), maxDD: fx(spy.maxDD,1) } : null,
                rsp: rsp ? { total: fx(rsp.total,1), sharpe: fx(rsp.sharpe,2), maxDD: fx(rsp.maxDD,1) } : null },
  results: resultados, criteria: { sharpeAboveEW: c1, drawdownBelowEW: c2, returnNotFarBelow: c3, passed: pasa },
}, null, 2));
console.log(`  → escrito research/out/${LONG ? "quality_lowvol_lab_oos.json" : "quality_lowvol_lab.json"}\n`);
