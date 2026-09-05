// ─────────────────────────────────────────────────────────────────────────────
// ¿VALUE, MOMENTUM Y GROWTH DILUYEN A LA CALIDAD DENTRO DEL SCORE DE SCORA?
//
// De dónde sale la sospecha. Midiendo Scora Picks salió esto (§3 de SCORA_PICKS_REGLAS.md,
// cartera de 40 contra el universo elegible equiponderado):
//
//     Calidad sola      +53 pp (IC +0,0155)   ·   +31 pp (IC +0,0101)
//     Score v1          +21 pp (IC −0,0009)   ·   −16 pp (IC +0,0173)
//
// El score de PRODUCCIÓN va por detrás de uno de sus propios ingredientes en las dos
// ventanas. Y en 2019-2026 gana +21 pp con un IC indistinguible de cero, o sea que ese
// margen NO viene de ordenar bien el universo. La hipótesis obvia es que los otros tres
// pilares están metiendo ruido encima del único que mide algo.
//
// Es una hipótesis incómoda: el score v1 es lo que la app enseña hoy. Por eso se mide con
// el listón alto y NO se toca nada del producto con lo que salga de aquí.
//
// ═══ HIPÓTESIS Y CRITERIOS, ESCRITOS ANTES DE VER UN SOLO NÚMERO ═══
//
//   H (dilución): el pilar `health` por sí solo bate al `total` en LAS DOS ventanas, y
//   añadirle cualquier otro pilar lo empeora en LAS DOS.
//
//   ✔ CONFIRMADA          si health-solo > total en las dos Y los tres pares
//                          (health+value, health+momentum, health+growth) < health-solo
//                          en las dos.
//   ◐ PARCIAL             si health-solo > total en las dos, pero sólo algunos pilares
//                          estorban de forma consistente. Entonces el culpable tiene
//                          nombre y apellidos, que es más útil que el diagnóstico genérico.
//   ✖ NO CONFIRMADA       si no hay consistencia entre ventanas. Un pilar que sólo estorba
//                          en una ventana es ruido, y ya van cuatro veces en este repo que
//                          un resultado brillante en una sola ventana era un defecto.
//
// CÓMO SE COMBINAN LOS PILARES: por PERCENTIL TRANSVERSAL de cada uno, no sumando puntos.
// Los cuatro pilares tienen topes distintos (health llega mucho más alto que momentum), así
// que sumarlos crudos ya es una ponderación implícita — y compararía dos cosas distintas.
//
// PRECIO OBLIGATORIO: value y momentum no existen sin cotización. Para la ventana antigua se
// inyecta `pricesLong` en `collectRows`; sin eso, 2011-2018 saldría con dos pilares a cero
// y el experimento diría "no diluyen" por construcción.
//
//   node --experimental-strip-types --no-warnings research/pillar_dilution_lab.mjs [--long] [--top 40]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";
import { returnsSeries, fwdReturn } from "./prices.mjs";
import { returnsSeriesLong, rawPriceAsOfLong, momentumLong } from "./pricesLong.mjs";
import { calcScores } from "../lib/scoring.ts";
import { addMonths, monthStarts, mean, std, fx, spearman, loadPanel, idxOnOrBefore, pct } from "./momentumSignals.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LONG = process.argv.includes("--long");
const TOP_N = Number(arg("--top", "40"));
const COST_BPS = 10;
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;
// La fuente de precios tiene que ser la MISMA que alimenta los pilares, o el backtest
// mediría un score calculado con unos precios y unos retornos calculados con otros.
const PX = LONG ? { rawPriceAsOf: rawPriceAsOfLong, momentum: momentumLong } : null;

const today = new Date().toISOString().slice(0, 10);
const START = LONG ? "2011-01-01" : "2019-01-01";
const END = LONG ? "2018-12-01" : addMonths(today, -4);
const fechas = monthStarts(START, END).filter((_, i) => i % 3 === 0);   // trimestral

const table = await loadSP500Historical();
console.log(`\n  ¿DILUYEN LOS PILARES A LA CALIDAD? · ${LONG ? "2011-2018 (fuera de muestra)" : "2019-2026"} · ${fechas.length} trimestres · top ${TOP_N}\n`);

const panels = new Map();
async function panelDe(t) {
  if (!panels.has(t)) panels.set(t, await loadPanel(t, seriesFn));
  return panels.get(t);
}
function fwdDe(p, fecha, meses) {
  const a = idxOnOrBefore(p.dates, fecha), b = idxOnOrBefore(p.dates, addMonths(fecha, meses));
  return a < 0 || b <= a ? null : (Math.exp(p.cum[b] - p.cum[a]) - 1) * 100;
}

const sectorCache = new Map();
const porFecha = new Map();
for (const fecha of fechas) {
  // ⚠️ NO truncar por orden alfabético (ver §3): `membersAsOf` devuelve A→Z.
  const miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
  const filas = await collectRows(miembros, fecha, sectorCache, true, PX);
  const bucket = [];
  for (const f of filas) {
    const p = await panelDe(f.ticker);
    if (!p) continue;
    const fwd3 = LONG ? fwdDe(p, fecha, 3) : await fwdReturn(f.ticker, fecha, addMonths(fecha, 3));
    if (fwd3 == null) continue;
    const s = calcScores({ ...f.m, sector: f.sector });
    bucket.push({
      t: f.ticker, fwd3,
      health: s.health, value: s.value, momentum: s.momentum, growth: s.growth, total: s.total,
      // La "calidad" de §3: percentil de cinco métricas de estados financieros. NO es el
      // pilar `health` (que además lleva ROE, ROA, margen neto y circulante). Se incluye
      // como referencia para poder decir si el problema es el score o el propio pilar.
      gprof: f.m.grossProfitability, roic: f.m.roic, opm: f.m.operatingMargin,
      icov: f.m.interestCoverage, lev: f.m.netDebtEbitda != null ? -f.m.netDebtEbitda : null,
    });
  }
  if (bucket.length >= TOP_N + 10) porFecha.set(fecha, bucket);
  process.stdout.write(`  ${fecha} ${String(bucket.length).padStart(3)} nombres\r`);
}
const fechasOk = [...porFecha.keys()];
console.log(`\n  ${fechasOk.length} trimestres con datos · ${Math.round(mean(fechasOk.map((d) => porFecha.get(d).length)))} nombres de media\n`);
if (fechasOk.length < 8) { console.error("  ✖ muestra insuficiente"); process.exit(1); }

/** Percentil transversal medio de un grupo de claves (mayor = mejor en todas). */
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

const COMBOS = {
  "health (pilar solo)":        ["health"],
  "value (pilar solo)":         ["value"],
  "momentum (pilar solo)":      ["momentum"],
  "growth (pilar solo)":        ["growth"],
  "health + value":             ["health", "value"],
  "health + momentum":          ["health", "momentum"],
  "health + growth":            ["health", "growth"],
  "los 4 pilares (percentil)":  ["health", "value", "momentum", "growth"],
  "SCORE v1 (total, producción)": ["total"],
  "Calidad §3 (5 métricas)":    ["gprof", "roic", "opm", "icov", "lev"],
};

const curvaDe = (rets, porAño = 4) => {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, porAño / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(porAño) : 0, maxDD: mdd * 100 };
};
const ew = curvaDe(fechasOk.map((d) => mean(porFecha.get(d).map((r) => r.fwd3))));

console.log(`  ${"señal".padEnd(30)}${"IC".padStart(9)}${"t".padStart(7)}${"total".padStart(9)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}${"vs EW".padStart(9)}`);
console.log(`  ${"universo EW (sin seleccionar)".padEnd(30)}${"—".padStart(9)}${"—".padStart(7)}${("+" + ew.total.toFixed(0) + "%").padStart(9)}${ew.sharpe.toFixed(2).padStart(8)}${(ew.maxDD.toFixed(1) + "%").padStart(9)}${"—".padStart(9)}`);
console.log(`  ${"-".repeat(79)}`);

const resultados = {};
for (const [nombre, claves] of Object.entries(COMBOS)) {
  const ics = [], rets = [];
  let prev = new Set();
  for (const d of fechasOk) {
    const rows = porFecha.get(d);
    const m = compuesto(rows, claves);
    const xs = [], ys = [];
    for (const r of rows) { const v = m.get(r.t); if (v != null) { xs.push(v); ys.push(r.fwd3); } }
    const s = spearman(xs, ys); if (s != null) ics.push(s);
    const orden = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map((e) => e[0]);
    const byT = new Map(rows.map((r) => [r.t, r]));
    const r = mean(orden.map((t) => byT.get(t)?.fwd3).filter((x) => x != null)) ?? 0;
    const set = new Set(orden); let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    rets.push(r - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100); prev = set;
  }
  const c = curvaDe(rets);
  const t = std(ics) ? mean(ics) / (std(ics) / Math.sqrt(ics.length)) : null;
  resultados[nombre] = { ic: fx(mean(ics)), t: fx(t, 2), total: fx(c.total, 1), sharpe: fx(c.sharpe, 2), maxDD: fx(c.maxDD, 1), vsEW: fx(c.total - ew.total, 1) };
  console.log(`  ${nombre.padEnd(30)}${((mean(ics) >= 0 ? "+" : "") + mean(ics).toFixed(4)).padStart(9)}${(t ?? 0).toFixed(2).padStart(7)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}${(c.maxDD.toFixed(1) + "%").padStart(9)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}`);
}

// ── Contraste PAREADO: es el que tiene potencia ─────────────────────────────────────────
// Comparar dos IC medios a ojo repetiría el error que ya cazó la auditoría del momentum:
// con el MDE de esta muestra ninguno de los dos sería distinguible de cero por separado.
// Pero mismo universo, misma fecha y mismos retornos ⇒ el ruido común se cancela y lo que
// se contrasta es la DIFERENCIA trimestre a trimestre.
function pareado(clavesA, clavesB) {
  const dif = [];
  for (const d of fechasOk) {
    const rows = porFecha.get(d);
    const ma = compuesto(rows, clavesA), mb = compuesto(rows, clavesB);
    const xa = [], ya = [], xb = [], yb = [];
    for (const r of rows) {
      const a = ma.get(r.t), b = mb.get(r.t);
      if (a != null) { xa.push(a); ya.push(r.fwd3); }
      if (b != null) { xb.push(b); yb.push(r.fwd3); }
    }
    const sa = spearman(xa, ya), sb = spearman(xb, yb);
    if (sa != null && sb != null) dif.push(sa - sb);
  }
  const m = mean(dif), s = std(dif);
  return { dif: m, t: s ? m / (s / Math.sqrt(dif.length)) : null, gana: dif.filter((x) => x > 0).length, n: dif.length, mde: 2.8 * s / Math.sqrt(dif.length) };
}

console.log(`\n  ── CONTRASTE PAREADO (health solo − alternativa), IC trimestre a trimestre ──`);
const pares = {
  "health − SCORE v1": pareado(["health"], ["total"]),
  "health − (health+value)": pareado(["health"], ["health", "value"]),
  "health − (health+momentum)": pareado(["health"], ["health", "momentum"]),
  "health − (health+growth)": pareado(["health"], ["health", "growth"]),
  "Calidad §3 − SCORE v1": pareado(["gprof", "roic", "opm", "icov", "lev"], ["total"]),
};
for (const [n, p] of Object.entries(pares)) {
  console.log(`  ${n.padEnd(30)}${((p.dif >= 0 ? "+" : "") + p.dif.toFixed(4)).padStart(9)}  t=${(p.t ?? 0).toFixed(2).padStart(5)}  gana ${p.gana}/${p.n}  (MDE ${p.mde.toFixed(4)})`);
}

// ── Veredicto contra lo preespecificado ─────────────────────────────────────────────────
const R = (k) => resultados[k].vsEW;
const healthBateTotal = R("health (pilar solo)") > R("SCORE v1 (total, producción)");
const empeoran = ["value", "momentum", "growth"].filter((x) => R(`health + ${x}`) < R("health (pilar solo)"));
console.log(`\n  EN ESTA VENTANA:`);
console.log(`   · health solo ${healthBateTotal ? "BATE" : "NO bate"} al score v1  (${R("health (pilar solo)")}pp vs ${R("SCORE v1 (total, producción)")}pp)`);
console.log(`   · pilares que EMPEORAN a health al añadirlos: ${empeoran.length ? empeoran.join(", ") : "ninguno"}`);
console.log(`   · la Calidad de §3 ${R("Calidad §3 (5 métricas)") > R("health (pilar solo)") ? "bate" : "no bate"} al pilar health (${R("Calidad §3 (5 métricas)")}pp vs ${R("health (pilar solo)")}pp)`);
console.log(`\n  ⚠ Una sola ventana no concluye nada. El veredicto exige LAS DOS: correr también con --long.\n`);

writeFileSync(join(OUT, `pillar_dilution_lab${LONG ? "_oos" : ""}.json`), JSON.stringify({
  generatedAt: new Date().toISOString(), window: LONG ? "2011-2018" : "2019-2026",
  quarters: fechasOk.length, topN: TOP_N, nombresMedios: Math.round(mean(fechasOk.map((d) => porFecha.get(d).length))),
  universeEW: { total: fx(ew.total, 1), sharpe: fx(ew.sharpe, 2), maxDD: fx(ew.maxDD, 1) },
  señales: resultados,
  pareados: Object.fromEntries(Object.entries(pares).map(([k, v]) => [k, { dif: fx(v.dif), t: fx(v.t, 2), gana: v.gana, n: v.n, mde: fx(v.mde) }])),
  ventana: { healthBateTotal, pilaresQueEmpeoran: empeoran },
}, null, 2));
console.log(`  → escrito research/out/pillar_dilution_lab${LONG ? "_oos" : ""}.json\n`);
