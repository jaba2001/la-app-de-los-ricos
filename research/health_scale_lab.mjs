// ─────────────────────────────────────────────────────────────────────────────
// DOS PREGUNTAS ABIERTAS SOBRE EL SCORE DE PRODUCCIÓN
//
// (1) ¿POR QUÉ EL PILAR `health` PIERDE CONTRA UN PERCENTIL DE 5 MÉTRICAS?
//     Medido en `pillar_dilution_lab`: la calidad de §3 (percentil transversal de
//     grossProfitability, roic, operatingMargin, interestCoverage y −netDebtEbitda) bate al
//     pilar `health` de la app en LAS DOS ventanas: +74 vs −6 pp y +33 vs +22 pp. Son dos
//     cosas que pretenden medir lo mismo, así que la diferencia tiene que estar en CÓMO se
//     mide, no en QUÉ se mide. Hay dos sospechosos y son separables.
//
//     Sospechoso A — EL TOPE. `lib/scoring.ts` da hasta 44 puntos brutos a una no-financiera
//     (10 D/E + 10 circulante + 10 cobertura + 5 deuda/EBITDA + 5 ROIC + 4 rentabilidad
//     bruta) y luego hace `Math.min(30, ...)`. Todo lo que pase de 30 se recorta AL MISMO
//     VALOR. El recorte cae justo donde salen los picks: en la cabeza de la distribución.
//     (Las financieras tienen otro juego de métricas cuyo máximo bruto es exactamente 30,
//     así que a ellas no las recorta nunca.)
//
//     Sospechoso B — LA GRANULARIDAD. Cada métrica sólo puede valer 3 o 4 cantidades
//     ("< 0,3 → 10 · < 0,7 → 7 · < 1,5 → 4 · resto → 0"). Con seis métricas así, los empates
//     no son un accidente: son el resultado esperable.
//
// (2) ¿POR QUÉ EL SCORE v1 GANA +21 pp CON UN IC DE −0,0009?
//     Un IC indistinguible de cero significa que NO ordena el universo. Y aun así su cartera
//     de 40 gana. La explicación candidata es que la relación no sea monótona: que acierte
//     en la cola y no ordene en el medio. Un IC de Spearman promedia el orden ENTERO, así
//     que un decil superior bueno con ocho deciles de ruido da exactamente esto.
//
// ═══ HIPÓTESIS Y CRITERIOS, ESCRITOS ANTES DE VER UN SOLO NÚMERO ═══
//
//   H1 (tope). Una fracción grande de nombres empata EXACTAMENTE en el tope de 30, y ese
//       grupo es más grande entre las no-financieras que entre las financieras. Si el
//       empate en el tope es < 5% del universo, el tope NO es el problema y hay que
//       mirar a la granularidad.
//
//   H2 (la escala pesa más que el juego de métricas). Con LAS MISMAS métricas que usa el
//       pilar y respetando su ramificación por sector, puntuar por PERCENTIL TRANSVERSAL
//       bate a puntuar por bandas — en LAS DOS ventanas. Si sólo pasa en una, es ruido y
//       no se toca nada.
//
//   H3 (no monotonía). El decil superior del score v1 bate a la media del universo mientras
//       la correlación entre índice de decil y retorno es floja. Criterio: monotonía
//       (Spearman decil↔retorno) por debajo de 0,5 con decil 10 por encima de la media,
//       en la ventana donde el IC salió ≈ 0.
//
//   ESTO NO CAMBIA EL SCORE DE LA APP. Es diagnóstico. Cualquier cambio a `scoring.ts`
//   exige su propia validación pareada y pasar los 862 tests golden.
//
//   node --experimental-strip-types --no-warnings research/health_scale_lab.mjs [--long] [--top 40]
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
const HEALTH_CAP = 30;   // el `Math.min(30, …)` de lib/scoring.ts
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;
const PX = LONG ? { rawPriceAsOf: rawPriceAsOfLong, momentum: momentumLong } : null;

const today = new Date().toISOString().slice(0, 10);
const START = LONG ? "2011-01-01" : "2019-01-01";
const END = LONG ? "2018-12-01" : addMonths(today, -4);
const fechas = monthStarts(START, END).filter((_, i) => i % 3 === 0);

// El mismo criterio de rama que `lib/scoring.ts`. Si esto se desincroniza, el experimento
// deja de medir el pilar real — por eso está copiado literal y no reinterpretado.
const esFinanciera = (sector) => sector === "Financial Services" || sector === "Financials";
const MET_FIN = ["roe", "roa", "netMargin", "operatingMargin"];
const MET_NOFIN = ["negDebtEquity", "currentRatio", "interestCoverage", "negNetDebtEbitda", "roic", "grossProfitability"];

const table = await loadSP500Historical();
console.log(`\n  EL PILAR health: TOPE, GRANULARIDAD Y MONOTONÍA · ${LONG ? "2011-2018 (fuera de muestra)" : "2019-2026"} · ${fechas.length} trimestres\n`);

const panels = new Map();
async function panelDe(t) { if (!panels.has(t)) panels.set(t, await loadPanel(t, seriesFn)); return panels.get(t); }
function fwdDe(p, fecha, meses) {
  const a = idxOnOrBefore(p.dates, fecha), b = idxOnOrBefore(p.dates, addMonths(fecha, meses));
  return a < 0 || b <= a ? null : (Math.exp(p.cum[b] - p.cum[a]) - 1) * 100;
}

const sectorCache = new Map();
const porFecha = new Map();
for (const fecha of fechas) {
  const miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;   // nunca truncar (§3)
  const filas = await collectRows(miembros, fecha, sectorCache, true, PX);
  const bucket = [];
  for (const f of filas) {
    const p = await panelDe(f.ticker);
    if (!p) continue;
    const fwd3 = LONG ? fwdDe(p, fecha, 3) : await fwdReturn(f.ticker, fecha, addMonths(fecha, 3));
    if (fwd3 == null) continue;
    const s = calcScores({ ...f.m, sector: f.sector });
    bucket.push({
      t: f.ticker, fwd3, fin: esFinanciera(f.sector),
      health: s.health, v1: s.total,
      // Las métricas del propio pilar, con el signo puesto para que "mayor = mejor" en
      // todas: sin eso, un percentil sobre D/E premiaría al más endeudado.
      roe: f.m.roe, roa: f.m.roa, netMargin: f.m.netMargin, operatingMargin: f.m.operatingMargin,
      negDebtEquity: f.m.debtEquity != null ? -f.m.debtEquity : null,
      currentRatio: f.m.currentRatio, interestCoverage: f.m.interestCoverage,
      negNetDebtEbitda: f.m.netDebtEbitda != null ? -f.m.netDebtEbitda : null,
      roic: f.m.roic, grossProfitability: f.m.grossProfitability,
    });
  }
  if (bucket.length >= TOP_N + 10) porFecha.set(fecha, bucket);
  process.stdout.write(`  ${fecha} ${String(bucket.length).padStart(3)} nombres\r`);
}
const fechasOk = [...porFecha.keys()];
console.log(`\n  ${fechasOk.length} trimestres · ${Math.round(mean(fechasOk.map((d) => porFecha.get(d).length)))} nombres de media\n`);
if (fechasOk.length < 8) { console.error("  ✖ muestra insuficiente"); process.exit(1); }

// ── H1 · ¿CUÁNTA GENTE EMPATA EN EL TOPE? ───────────────────────────────────────────────
const enTope = [], enTopeFin = [], enTopeNoFin = [], distintos = [], mayorEmpate = [];
for (const d of fechasOk) {
  const rows = porFecha.get(d);
  const nofin = rows.filter((r) => !r.fin), fin = rows.filter((r) => r.fin);
  enTope.push(rows.filter((r) => r.health >= HEALTH_CAP).length / rows.length * 100);
  if (nofin.length) enTopeNoFin.push(nofin.filter((r) => r.health >= HEALTH_CAP).length / nofin.length * 100);
  if (fin.length) enTopeFin.push(fin.filter((r) => r.health >= HEALTH_CAP).length / fin.length * 100);
  const cuenta = new Map();
  for (const r of rows) cuenta.set(r.health, (cuenta.get(r.health) ?? 0) + 1);
  distintos.push(cuenta.size);
  mayorEmpate.push(Math.max(...cuenta.values()) / rows.length * 100);
}
console.log(`  ── H1 · ¿SATURA EL PILAR? ──`);
console.log(`  Nombres empatados EXACTAMENTE en el tope de ${HEALTH_CAP}   ${mean(enTope).toFixed(1)}%  del universo`);
console.log(`     · entre NO financieras (tope bruto 44 → recortado)  ${mean(enTopeNoFin).toFixed(1)}%`);
console.log(`     · entre financieras (tope bruto 30 → nunca recorta) ${mean(enTopeFin).toFixed(1)}%`);
console.log(`  Valores distintos que toma el pilar                     ${mean(distintos).toFixed(1)} de ${Math.round(mean(fechasOk.map((d) => porFecha.get(d).length)))} nombres`);
console.log(`  Mayor grupo de empatados                                ${mean(mayorEmpate).toFixed(1)}% del universo`);
const h1 = mean(enTope) >= 5;
console.log(`  → ${h1 ? "✔ el tope SÍ satura" : "✖ el tope no satura; mirar a la granularidad"}\n`);

// ── H2 · MISMAS MÉTRICAS, OTRA ESCALA ───────────────────────────────────────────────────
/** Percentil transversal medio, con el juego de métricas que el pilar usaría para cada
 *  nombre y calculado DENTRO de su rama: las financieras se comparan con financieras. Sin
 *  eso no se aislaría la escala, se estaría cambiando también contra quién se compara. */
function healthPctl(rows) {
  const out = new Map();
  for (const [grupo, claves] of [[rows.filter((r) => r.fin), MET_FIN], [rows.filter((r) => !r.fin), MET_NOFIN]]) {
    if (grupo.length < 8) continue;
    const maps = claves.map((k) => pct(grupo, k));
    for (const r of grupo) {
      let s = 0, n = 0;
      for (const m of maps) { const p = m.get(r.t); if (p != null) { s += p; n++; } }
      if (n >= Math.ceil(claves.length / 2)) out.set(r.t, s / n);
    }
  }
  return out;
}
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
const CALIDAD5 = ["grossProfitability", "roic", "operatingMargin", "interestCoverage", "negNetDebtEbitda"];

const SEÑALES = {
  "health · BANDAS (la app)":      (rows) => new Map(rows.map((r) => [r.t, r.health])),
  "health · PERCENTIL (mismo set)": healthPctl,
  "Calidad §3 · PERCENTIL (5 mét.)": (rows) => compuesto(rows, CALIDAD5),
  "SCORE v1 · BANDAS (la app)":    (rows) => new Map(rows.map((r) => [r.t, r.v1])),
};

const curvaDe = (rets, porAño = 4) => {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return { total: (eq - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(porAño) : 0, maxDD: mdd * 100 };
};
const ew = curvaDe(fechasOk.map((d) => mean(porFecha.get(d).map((r) => r.fwd3))));

console.log(`  ── H2 · MISMAS MÉTRICAS, ESCALA DISTINTA (cartera de ${TOP_N}) ──`);
console.log(`  ${"señal".padEnd(34)}${"IC".padStart(9)}${"total".padStart(9)}${"Sharpe".padStart(8)}${"vs EW".padStart(9)}${"empates*".padStart(10)}`);
console.log(`  ${"universo EW (sin seleccionar)".padEnd(34)}${"—".padStart(9)}${("+" + ew.total.toFixed(0) + "%").padStart(9)}${ew.sharpe.toFixed(2).padStart(8)}${"—".padStart(9)}${"—".padStart(10)}`);
const resultados = {};
for (const [nombre, fn] of Object.entries(SEÑALES)) {
  const ics = [], rets = [], ambig = [];
  let prev = new Set();
  for (const d of fechasOk) {
    const rows = porFecha.get(d);
    const m = fn(rows);
    const xs = [], ys = [];
    for (const r of rows) { const v = m.get(r.t); if (v != null) { xs.push(v); ys.push(r.fwd3); } }
    const s = spearman(xs, ys); if (s != null) ics.push(s);
    const orden = [...m.entries()].sort((a, b) => b[1] - a[1]);
    // *empates: cuántos nombres comparten el valor del que ocupa el puesto TOP_N. Mide la
    // ambigüedad real de la frontera de la cartera: si 60 nombres empatan en el puesto 40,
    // la cartera se decide por el orden de lectura del fichero, no por la señal.
    const corte = orden[Math.min(TOP_N, orden.length) - 1]?.[1];
    ambig.push(orden.filter((e) => e[1] === corte).length);
    const sel = orden.slice(0, TOP_N).map((e) => e[0]);
    const byT = new Map(rows.map((r) => [r.t, r]));
    const r = mean(sel.map((t) => byT.get(t)?.fwd3).filter((x) => x != null)) ?? 0;
    const set = new Set(sel); let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    rets.push(r - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100); prev = set;
  }
  const c = curvaDe(rets);
  resultados[nombre] = { ic: fx(mean(ics)), total: fx(c.total, 1), sharpe: fx(c.sharpe, 2), vsEW: fx(c.total - ew.total, 1), empatesEnElCorte: fx(mean(ambig), 1) };
  console.log(`  ${nombre.padEnd(34)}${((mean(ics) >= 0 ? "+" : "") + mean(ics).toFixed(4)).padStart(9)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${mean(ambig).toFixed(1).padStart(10)}`);
}
console.log(`  * empates: nombres que comparten el valor del puesto ${TOP_N}. Si son muchos, la cartera la decide el desempate, no la señal.`);
const escalaGana = resultados["health · PERCENTIL (mismo set)"].vsEW > resultados["health · BANDAS (la app)"].vsEW;
console.log(`  → en esta ventana, cambiar SÓLO la escala ${escalaGana ? "MEJORA" : "no mejora"} (${resultados["health · PERCENTIL (mismo set)"].vsEW}pp vs ${resultados["health · BANDAS (la app)"].vsEW}pp)\n`);

// ── H3 · ¿ORDENA EL SCORE, O SÓLO ACIERTA EN LA COLA? ───────────────────────────────────
function deciles(clave) {
  const suma = Array.from({ length: 10 }, () => []);
  for (const d of fechasOk) {
    const rows = [...porFecha.get(d)].filter((r) => r[clave] != null).sort((a, b) => a[clave] - b[clave]);
    const n = rows.length;
    for (let i = 0; i < n; i++) suma[Math.min(9, Math.floor(i / n * 10))].push(rows[i].fwd3);
  }
  return suma.map((a) => (a.length ? mean(a) : null));
}
const mediaUniverso = mean(fechasOk.flatMap((d) => porFecha.get(d).map((r) => r.fwd3)));
console.log(`  ── H3 · RETORNO MEDIO A 3 MESES POR DECIL (D1 = peor score) ──`);
console.log(`  ${"señal".padEnd(20)}${["D1","D2","D3","D4","D5","D6","D7","D8","D9","D10"].map((x) => x.padStart(6)).join("")}${"monot.".padStart(9)}`);
const monotonia = {};
for (const clave of ["v1", "health"]) {
  const ds = deciles(clave);
  const idx = ds.map((_, i) => i + 1).filter((_, i) => ds[i] != null);
  const val = ds.filter((x) => x != null);
  const mono = spearman(idx, val);
  monotonia[clave] = { deciles: ds.map((x) => fx(x, 2)), monotonia: fx(mono, 2), d10MenosMedia: fx(ds[9] - mediaUniverso, 2) };
  console.log(`  ${(clave === "v1" ? "SCORE v1" : "pilar health").padEnd(20)}${ds.map((x) => (x == null ? "—" : x.toFixed(1)).padStart(6)).join("")}${(mono ?? 0).toFixed(2).padStart(9)}`);
}
console.log(`  media del universo: ${mediaUniverso.toFixed(2)}%  ·  monot. = Spearman entre nº de decil y retorno (1,00 sería orden perfecto)`);
const m = monotonia.v1;
console.log(`  → score v1: decil superior ${m.d10MenosMedia >= 0 ? "+" : ""}${m.d10MenosMedia} pp sobre la media, con monotonía ${m.monotonia}`);
console.log(`     ${Math.abs(m.monotonia) < 0.5 && m.d10MenosMedia > 0 ? "✔ H3: acierta en la cola SIN ordenar el universo — coherente con un IC ≈ 0" : "✖ H3 no se cumple en esta ventana"}\n`);

writeFileSync(join(OUT, `health_scale_lab${LONG ? "_oos" : ""}.json`), JSON.stringify({
  generatedAt: new Date().toISOString(), window: LONG ? "2011-2018" : "2019-2026",
  quarters: fechasOk.length, topN: TOP_N,
  H1_saturacion: { pctEnTope: fx(mean(enTope), 1), pctEnTopeNoFinancieras: fx(mean(enTopeNoFin), 1), pctEnTopeFinancieras: fx(mean(enTopeFin), 1),
                   valoresDistintos: fx(mean(distintos), 1), mayorGrupoEmpatadoPct: fx(mean(mayorEmpate), 1), topeSatura: h1 },
  H2_escala: { universeEW: { total: fx(ew.total, 1), sharpe: fx(ew.sharpe, 2) }, señales: resultados, cambiarEscalaMejora: escalaGana },
  H3_monotonia: { mediaUniverso: fx(mediaUniverso, 2), ...monotonia },
}, null, 2));
console.log(`  → escrito research/out/health_scale_lab${LONG ? "_oos" : ""}.json\n`);
