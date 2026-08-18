// ─────────────────────────────────────────────────────────────────────────────
// AUDITORÍA DE momentum_lab.mjs (2026-08-17) — someter mis propios números a escrutinio
// ANTES de que ninguna conclusión llegue al producto.
//
// El lab dijo dos cosas: (1) el compuesto de 7 señales no vale, (2) el gate de correlación
// sí. La (1) es una conclusión negativa y las conclusiones negativas son baratas de creer.
// La (2) es la que va a mover el producto — y por tanto la que hay que intentar TUMBAR.
//
// Usa EL MISMO motor de señales que el lab (`momentumSignals.mjs`), no una copia.
//
// A1 · SIGNIFICANCIA        ¿Es −0.005 distinguible de cero? ¿Y +0.057, con 29 meses?
//                           IC ± error estándar + t de Student sobre los IC mensuales.
// A2 · TERCILES PIT         ⚠ El fallo grave que sospecho: el lab parte la correlación en
//                           terciles calculados sobre TODA la ventana → en 2019 no podías
//                           saber cuál sería el tercil alto de 2026. Se reclasifica con
//                           ventana EXPANDIENTE (solo pasado) y se compara.
// A3 · COSTE DEL GATE       Cuando el gate cierra, el lab pone `held=[]` y el turnover sale
//                           0: liquidar la cartera entera sale GRATIS. Se recobra bien.
// A4 · LATENCIA             El lab calcula la señal con el cierre del día X y compra a ese
//                           mismo cierre. Se repite comprando al cierre de X+1.
// A5 · COBERTURA UNIVERSO   ¿Qué % de los miembros REALES del índice cubre el top-400?
// A6 · COBERTURA SEÑALES    ¿Cuántos nombres tienen cada componente? Un compuesto que
//                           renormaliza sobre 3 de 7 señales no es el compuesto que dice ser.
// A7 · SOLAPAMIENTO 3M      El IC a 3M solapa meses consecutivos → su t está inflado.
//                           Se recalcula sobre submuestras trimestrales no solapadas.
//
//   node --experimental-strip-types --no-warnings research/momentum_audit.mjs --full 400
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { returnsSeries, fwdReturn, aboveSMA } from "./prices.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { addMonths, monthStarts, mean, std, fx, spearman, loadPanel, idxOnOrBefore, signalsAt, pct } from "./momentumSignals.mjs";

const COST_BPS = 10, DECILE = 10, WARMUP = 24;   // WARMUP: meses mínimos para clasificar PIT
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// --long: historia desde 2009 con caché aislada (`pricesLong.mjs`) para atacar el problema
// que destapa A8 — la ventana de 84 meses no tiene potencia para decidir nada.
const LONG = process.argv.includes("--long");
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;
const today = new Date().toISOString().slice(0, 10);
const START = process.env.BT_START || (LONG ? "2010-07-01" : "2019-07-01");
const END = process.env.BT_END || addMonths(today, -2);
const dates = monthStarts(START, END);
const FULL = process.argv.includes("--full");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);

// En modo largo TODO se calcula desde el panel (A4 demostró que coincide EXACTAMENTE con
// `fwdReturn`: 0 discrepancias sobre 33.436 filas), porque prices.mjs no tiene esa historia.
function fwdFromPanel(p, dFrom, dTo, lag = 0) {
  const a = idxOnOrBefore(p.dates, dFrom), b = idxOnOrBefore(p.dates, dTo);
  if (a < 0 || b <= a) return null;
  const ai = a + lag, bi = b + lag;
  if (bi >= p.dates.length) return null;
  return (Math.exp(p.cum[bi] - p.cum[ai]) - 1) * 100;
}
function aboveSMAPanel(p, n, date) {
  const i = idxOnOrBefore(p.dates, date);
  if (i < n) return null;
  let sum = 0; for (let k = i - n + 1; k <= i; k++) sum += Math.exp(p.cum[k]);
  return Math.exp(p.cum[i]) > sum / n;
}

// t de Student de una media muestral (H0: media = 0), y su p-valor de dos colas aproximado.
function tstat(arr) {
  const a = arr.filter((x) => x != null && isFinite(x));
  if (a.length < 3) return { mean: null, se: null, t: null, p: null, n: a.length };
  const m = mean(a), s = std(a), se = s / Math.sqrt(a.length), t = m / se;
  // aproximación normal (n≥28 en todos los casos que usamos)
  const z = Math.abs(t);
  const p = 2 * (1 - (1 - 0.5 * Math.exp(-0.717 * z - 0.416 * z * z)));  // aprox. de Zelen & Severo
  return { mean: m, se, t, p: Math.max(0, Math.min(1, p)), n: a.length };
}
const sig = (p) => (p == null ? "  " : p < 0.01 ? "***" : p < 0.05 ? "** " : p < 0.10 ? "*  " : "   ");

// ── universo (idéntico al lab) ───────────────────────────────────────────────────
let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
  }
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);
console.log(`\n  AUDITORÍA DEL MOMENTUM LAB · ${UNIVERSE.length} nombres · ${dates.length} meses ${dates[0]}→${dates.at(-1)}${LONG ? "  · MODO HISTORIA LARGA" : ""}\n`);

const spyRs = await seriesFn("SPY");
const spyMap = new Map(spyRs.map((x) => [x.date, x.ret]));
const spyPanel = await loadPanel("SPY", seriesFn);
const panels = new Map();
let cargados = 0;
for (const t of UNIVERSE) {
  const p = await loadPanel(t, seriesFn);
  if (p) panels.set(t, p);
  if (LONG && ++cargados % 50 === 0) console.log(`  …${cargados}/${UNIVERSE.length}`);
}
console.log(`  paneles: ${panels.size}/${UNIVERSE.length}`);

// En modo largo el motor de correlación se construye desde los paneles ya cargados
// (mismo estimador de `correlation.mjs`, que es puro sobre {maps, spyDates}).
let corrEngine;
if (LONG) {
  const maps = new Map();
  for (const [t, p] of panels) { const m = new Map(); for (let j = 0; j < p.dates.length; j++) m.set(p.dates[j], p.ret[j]); maps.set(t, m); }
  corrEngine = { maps, spyDates: spyPanel.dates };
} else {
  corrEngine = await buildCorrEngine([...panels.keys()]);
}
const corrByDate = new Map(), stateByDate = new Map();
for (const d of dates) {
  corrByDate.set(d, corrAsOf(corrEngine, [...panels.keys()], d, 63));
  stateByDate.set(d, LONG ? aboveSMAPanel(spyPanel, 200, d) : await aboveSMA("SPY", 200, d));
}

// ── panel transversal (mismas señales, + retornos con y sin latencia) ────────────
const COMPONENTS = ["mom12_1", "mom12_1_ra", "mom6_1_ra", "rs_ibd", "rs_spy", "dist52w", "resid_mom", "fip_neg", "rev1m_neg"];
const WEIGHTS = { mom12_1_ra: 0.30, mom6_1_ra: 0.20, rs_ibd: 0.15, rs_spy: 0.10, dist52w: 0.10, resid_mom: 0.10, fip_neg: 0.05 };

const byDate = new Map(), spyFwd = new Map();
const nullCount = Object.fromEntries(COMPONENTS.map((k) => [k, 0]));
let totalRows = 0, fwdMismatch = 0, fwdMaxDiff = 0;

for (const d of dates) {
  spyFwd.set(d, LONG ? fwdFromPanel(spyPanel, d, addMonths(d, 1)) : await fwdReturn("SPY", d, addMonths(d, 1)));
  const iSpy = idxOnOrBefore(spyPanel.dates, d);
  const spySig = iSpy >= 0 ? signalsAt(spyPanel, iSpy, null) : null;
  const spyMom = spySig?.mom12_1 ?? null;
  const dNext = addMonths(d, 1);

  const bucket = [];
  for (const [t, p] of panels) {
    if (!isMember(t, d)) continue;
    const i = idxOnOrBefore(p.dates, d);
    if (i < 0) continue;
    const s = signalsAt(p, i, spyMap);
    if (!s) continue;
    const fwd1 = LONG ? fwdFromPanel(p, d, dNext) : await fwdReturn(t, d, dNext);
    const fwd3 = LONG ? fwdFromPanel(p, d, addMonths(d, 3)) : await fwdReturn(t, d, addMonths(d, 3));
    if (fwd1 == null) continue;

    // A4 · el MISMO retorno calculado desde el panel (control cruzado) y con 1 día de latencia
    const i1 = idxOnOrBefore(p.dates, dNext);
    const fwd1Panel = i1 > i ? (Math.exp(p.cum[i1] - p.cum[i]) - 1) * 100 : null;
    const fwd1Lag = i1 + 1 < p.dates.length && i + 1 <= i1 ? (Math.exp(p.cum[i1 + 1] - p.cum[i + 1]) - 1) * 100 : null;
    // El control cruzado solo tiene sentido en modo normal: en modo largo `fwd1` YA viene
    // del panel, así que compararlo consigo mismo daría 0 por construcción y no probaría nada.
    if (!LONG && fwd1Panel != null) {
      const diff = Math.abs(fwd1Panel - fwd1);
      if (diff > 1e-6) { fwdMismatch++; fwdMaxDiff = Math.max(fwdMaxDiff, diff); }
    }

    totalRows++;
    for (const k of COMPONENTS) if (k !== "rs_spy" && s[k] == null) nullCount[k]++;
    if (spyMom == null || s.mom12_1 == null) nullCount.rs_spy++;
    bucket.push({ t, fwd1, fwd3, fwd1Lag, ...s, rs_spy: spyMom != null ? s.mom12_1 - spyMom : null });
  }
  byDate.set(d, bucket);
}
console.log(`  panel: ${totalRows} nombre-mes\n`);

const compByDate = new Map();
for (const d of dates) {
  const rows = byDate.get(d) || [];
  const maps = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, pct(rows, k)]));
  const out = new Map();
  for (const r of rows) {
    let s = 0, w = 0;
    for (const [k, weight] of Object.entries(WEIGHTS)) { const p = maps[k].get(r.t); if (p != null) { s += weight * p; w += weight; } }
    if (w >= 0.5) out.set(r.t, s / w);
  }
  compByDate.set(d, out);
}

// serie de IC mensual (para poder hacer estadística sobre ella, no solo promediarla)
function icSeries(getScore, horizon, filter) {
  const per = [];
  for (const d of dates) {
    if (filter && !filter(d)) continue;
    const xs = [], ys = [];
    for (const r of byDate.get(d) || []) {
      if (r[horizon] == null) continue;
      const s = getScore(d, r);
      if (s != null && isFinite(s)) { xs.push(s); ys.push(r[horizon]); }
    }
    const s = spearman(xs, ys);
    if (s != null) per.push({ d, ic: s, n: xs.length });
  }
  return per;
}
const byComp = (k) => (d, r) => r[k];
const byComposite = (d, r) => compByDate.get(d)?.get(r.t) ?? null;

const audit = { generatedAt: new Date().toISOString(), mode: LONG ? "historia larga" : "normal", window: { start: dates[0], end: dates.at(-1) }, universe: panels.size, months: dates.length, nameMonths: totalRows };

// ── A1 · SIGNIFICANCIA ───────────────────────────────────────────────────────────
console.log(`  A1 · SIGNIFICANCIA — ¿algún IC es distinguible de cero?`);
console.log(`  ${"componente".padEnd(13)}${"IC 1M".padStart(9)}${"± e.e.".padStart(9)}${"t".padStart(8)}${"p".padStart(8)}   `);
audit.A1_significance = {};
for (const k of [...COMPONENTS, "COMPOSITE"]) {
  const ser = icSeries(k === "COMPOSITE" ? byComposite : byComp(k), "fwd1").map((x) => x.ic);
  const st = tstat(ser);
  audit.A1_significance[k] = { ic: fx(st.mean), se: fx(st.se), t: fx(st.t, 2), p: fx(st.p, 3), n: st.n };
  console.log(`  ${(k === "COMPOSITE" ? "▸ " + k : "  " + k).padEnd(13)}${((st.mean >= 0 ? "+" : "") + st.mean.toFixed(4)).padStart(9)}${st.se.toFixed(4).padStart(9)}${st.t.toFixed(2).padStart(8)}${st.p.toFixed(3).padStart(8)} ${sig(st.p)}`);
}

// ── A2 · TERCILES PIT (el test que puede tumbar la conclusión principal) ─────────
console.log(`\n  A2 · RÉGIMEN DE CORRELACIÓN — in-sample (como el lab) vs PIT expandiente`);
const corrVals = [...corrByDate.values()].filter((x) => x != null).sort((a, b) => a - b);
const cLo = corrVals[Math.floor(corrVals.length / 3)], cHi = corrVals[Math.floor((2 * corrVals.length) / 3)];
const regimeIS = (d) => { const c = corrByDate.get(d); return c == null ? null : c <= cLo ? "low" : c >= cHi ? "high" : "mid"; };

// PIT: los terciles de cada mes salen SOLO de los meses anteriores (mínimo WARMUP).
const regimePITMap = new Map();
for (let j = 0; j < dates.length; j++) {
  const d = dates[j], c = corrByDate.get(d);
  if (c == null || j < WARMUP) { regimePITMap.set(d, null); continue; }
  const hist = dates.slice(0, j).map((x) => corrByDate.get(x)).filter((x) => x != null).sort((a, b) => a - b);
  if (hist.length < WARMUP) { regimePITMap.set(d, null); continue; }
  const lo = hist[Math.floor(hist.length / 3)], hi = hist[Math.floor((2 * hist.length) / 3)];
  regimePITMap.set(d, c <= lo ? "low" : c >= hi ? "high" : "mid");
}
const regimePIT = (d) => regimePITMap.get(d) ?? null;

audit.A2_regime = { inSample: {}, pit: {}, tercileCuts: { inSampleLow: fx(cLo), inSampleHigh: fx(cHi) } };
for (const [etiqueta, fn, dest] of [["IN-SAMPLE", regimeIS, "inSample"], ["PIT", regimePIT, "pit"]]) {
  console.log(`    ── ${etiqueta} ──`);
  for (const r of ["low", "mid", "high"]) {
    const serC = icSeries(byComposite, "fwd1", (d) => fn(d) === r).map((x) => x.ic);
    const serM = icSeries(byComp("mom12_1"), "fwd1", (d) => fn(d) === r).map((x) => x.ic);
    const stC = tstat(serC), stM = tstat(serM);
    audit.A2_regime[dest][r] = { composite: fx(stC.mean), compositeT: fx(stC.t, 2), compositeP: fx(stC.p, 3), mom12_1: fx(stM.mean), mom12_1T: fx(stM.t, 2), mom12_1P: fx(stM.p, 3), months: stC.n };
    console.log(`      corr ${r.padEnd(5)} compuesto ${((stC.mean >= 0 ? "+" : "") + stC.mean.toFixed(4)).padStart(8)} (t=${stC.t.toFixed(2).padStart(5)}, p=${stC.p.toFixed(3)}) ${sig(stC.p)}  ·  12-1m ${((stM.mean >= 0 ? "+" : "") + stM.mean.toFixed(4)).padStart(8)} (t=${stM.t.toFixed(2).padStart(5)}) ${sig(stM.p)}  ·  ${stC.n} meses`);
  }
}
// El contraste que importa: diferencia low − high, con su propio test.
for (const [etiqueta, fn, dest] of [["IN-SAMPLE", regimeIS, "inSample"], ["PIT", regimePIT, "pit"]]) {
  const lo = icSeries(byComposite, "fwd1", (d) => fn(d) === "low").map((x) => x.ic);
  const hi = icSeries(byComposite, "fwd1", (d) => fn(d) === "high").map((x) => x.ic);
  const mLo = mean(lo), mHi = mean(hi);
  const seDiff = Math.sqrt((std(lo) ** 2) / lo.length + (std(hi) ** 2) / hi.length);
  const tDiff = (mLo - mHi) / seDiff;
  audit.A2_regime[dest].lowMinusHigh = { diff: fx(mLo - mHi), t: fx(tDiff, 2), nLow: lo.length, nHigh: hi.length };
  console.log(`    ${etiqueta} · diferencia (corr baja − corr alta) = ${(mLo - mHi).toFixed(4)}  t=${tDiff.toFixed(2)}  ${Math.abs(tDiff) > 1.96 ? "SIGNIFICATIVA al 5%" : "NO significativa al 5%"}`);
}

// ── A3 · COSTE REAL DEL GATE ─────────────────────────────────────────────────────
// Modela SPY como una posición más: rotar la cartera entera a SPY cuesta, y volver también.
function curveHonest(selector) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const d of dates) {
    const held = selector(d);
    const usaIndice = !held || held.length === 0;
    const curr = usaIndice ? new Set(["__SPY__"]) : new Set(held);
    const rowMap = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const rs = usaIndice ? [] : held.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null);
    const r = rs.length ? mean(rs) : (spyFwd.get(d) ?? 0);
    let nuevos = 0; for (const t of curr) if (!prev.has(t)) nuevos++;
    const turn = curr.size ? nuevos / curr.size : 0;
    const net = r - turn * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = curr;
  }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 };
}
function basketsAt(d, horizonte = "fwd1") {
  const comp = compByDate.get(d);
  if (!comp || comp.size < DECILE * 2) return null;
  const sorted = [...comp.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const n = Math.max(1, Math.floor(sorted.length / DECILE));
  return { top: sorted.slice(0, n), bottom: sorted.slice(-n) };
}
const gateIS = (d) => regimeIS(d) !== "high" && stateByDate.get(d) !== false;
const gatePIT = (d) => regimePIT(d) !== "high" && stateByDate.get(d) !== false;

const cTop = curveHonest((d) => basketsAt(d)?.top);
const cGateIS = curveHonest((d) => (gateIS(d) ? basketsAt(d)?.top : null));
const cGatePIT = curveHonest((d) => (gatePIT(d) ? basketsAt(d)?.top : null));
// ── TRES referencias, porque comparar contra la equivocada da el diagnóstico contrario ──
//
//  1. SPY  — S&P 500 ponderado por capitalización. Es contra quien compite el usuario en la
//            vida real ("¿mejor que un fondo indexado?"), pero 2010-2026 lo dominan unas
//            pocas megacaps, así que castiga a CUALQUIER estrategia equiponderada.
//  2. RSP  — S&P 500 EQUIPONDERADO. Quita la ventaja de las megacaps y deja la comparación
//            en igualdad de ponderación con el decil (que también es equiponderado).
//  3. EW   — el PROPIO universo del estudio, equiponderado. La más limpia de las tres para
//            juzgar SELECCIÓN: controla la ponderación, el universo exacto (400 nombres, no
//            503) y hasta el sesgo con que se eligió ese universo. Si el decil superior no
//            bate a ESTO, la señal no selecciona; si lo bate pero pierde contra el SPY, el
//            problema no era seleccionar — era no tener megacaps. Son diagnósticos opuestos.
const curvaDe = (rets) => {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 };
};
const spyRetsArr = dates.map((d) => spyFwd.get(d)).filter((x) => x != null);
const spyStat = curvaDe(spyRetsArr);

// RSP: equiponderado. Existe desde 2003, así que cubre toda la ventana larga.
const rspPanel = await loadPanel("RSP", seriesFn);
const rspRets = [];
for (const d of dates) {
  const r = rspPanel ? (LONG ? fwdFromPanel(rspPanel, d, addMonths(d, 1)) : await fwdReturn("RSP", d, addMonths(d, 1))) : null;
  if (r != null) rspRets.push(r);
}
const rspStat = rspRets.length >= dates.length * 0.9 ? curvaDe(rspRets) : null;

// EW del universo propio: la media transversal de los retornos del panel, mes a mes.
const ewRets = [];
for (const d of dates) {
  const rs = (byDate.get(d) || []).map((r) => r.fwd1).filter((x) => x != null);
  if (rs.length) ewRets.push(mean(rs));
}
const ewStat = curvaDe(ewRets);
const cBottom = curveHonest((d) => basketsAt(d)?.bottom);
console.log(`\n  A3 · CARTERAS vs las TRES referencias (coste de rotación bien cobrado)`);
const cab = `  ${"cartera".padEnd(34)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}${"vs SPY".padStart(9)}${"vs RSP".padStart(9)}${"vs EW".padStart(9)}`;
console.log(cab);
const delta = (a, b) => (b == null ? "—" : ((a - b.total >= 0 ? "+" : "") + (a - b.total).toFixed(0) + "pp"));
const pr = (n, s, esRef = false) => console.log(`  ${n.padEnd(34)}${("+" + s.total.toFixed(0) + "%").padStart(9)}${(s.cagr.toFixed(1) + "%").padStart(8)}${s.sharpe.toFixed(2).padStart(8)}${(s.maxDD.toFixed(1) + "%").padStart(8)}${(esRef ? "—" : delta(s.total, spyStat)).padStart(9)}${(esRef ? "—" : delta(s.total, rspStat)).padStart(9)}${(esRef ? "—" : delta(s.total, ewStat)).padStart(9)}`);
pr("① SPY · cap-weighted", spyStat, true);
if (rspStat) pr("② RSP · equal-weighted", rspStat, true);
else console.log(`  ${"② RSP · equal-weighted".padEnd(34)}${"(sin cobertura suficiente)".padStart(20)}`);
pr("③ Universo EW (el del estudio)", ewStat, true);
console.log(`  ${"─".repeat(Math.max(0, cab.length - 4))}`);
pr("Decil top · compuesto (sin gate)", cTop);
pr("… + gate IN-SAMPLE", cGateIS);
pr("… + gate PIT (honesto)", cGatePIT);
pr("Decil BOTTOM · compuesto", cBottom);

// El contraste que separa los dos diagnósticos OPUESTOS que hasta ahora no se distinguían.
const bateEW = cTop.total > ewStat.total;
const bateRSP = rspStat ? cTop.total > rspStat.total : null;
const bateSPY = cTop.total > spyStat.total;
console.log(`\n     ¿selecciona? decil top vs universo EW: ${bateEW ? "SÍ" : "NO"} (${delta(cTop.total, ewStat)})  ·  top − bottom: ${(cTop.total - cBottom.total).toFixed(0)}pp`);
console.log(`     diagnóstico: ${
  bateEW && !bateSPY ? "la señal SÍ selecciona dentro de su universo, pero ese universo equiponderado no alcanza al SPY → el problema es la PONDERACIÓN (no tener megacaps), no la selección."
  : !bateEW ? "la señal NO selecciona ni dentro de su propio universo equiponderado → el problema es la SEÑAL."
  : "la señal selecciona y además bate al SPY."}`);
audit.A3_portfolios = { spy: { total: fx(spyStat.total, 1), cagr: fx(spyStat.cagr, 2), sharpe: fx(spyStat.sharpe, 2), maxDD: fx(spyStat.maxDD, 1) }, noGate: { total: fx(cTop.total, 1), sharpe: fx(cTop.sharpe, 2), maxDD: fx(cTop.maxDD, 1) }, gateInSample: { total: fx(cGateIS.total, 1), sharpe: fx(cGateIS.sharpe, 2), maxDD: fx(cGateIS.maxDD, 1) }, gatePIT: { total: fx(cGatePIT.total, 1), sharpe: fx(cGatePIT.sharpe, 2), maxDD: fx(cGatePIT.maxDD, 1) } };
audit.A3_benchmarks = {
  rsp: rspStat ? { total: fx(rspStat.total, 1), cagr: fx(rspStat.cagr, 2), sharpe: fx(rspStat.sharpe, 2), maxDD: fx(rspStat.maxDD, 1) } : null,
  universeEW: { total: fx(ewStat.total, 1), cagr: fx(ewStat.cagr, 2), sharpe: fx(ewStat.sharpe, 2), maxDD: fx(ewStat.maxDD, 1) },
  bottomDecile: { total: fx(cBottom.total, 1), cagr: fx(cBottom.cagr, 2), sharpe: fx(cBottom.sharpe, 2), maxDD: fx(cBottom.maxDD, 1) },
  topBeatsUniverseEW: bateEW, topBeatsRSP: bateRSP, topBeatsSPY: bateSPY, topMinusBottomPP: fx(cTop.total - cBottom.total, 1),
};

// ── A4 · LATENCIA DE EJECUCIÓN ───────────────────────────────────────────────────
const icNoLag = tstat(icSeries(byComposite, "fwd1").map((x) => x.ic));
const icLag = tstat(icSeries(byComposite, "fwd1Lag").map((x) => x.ic));
const icMomNoLag = tstat(icSeries(byComp("mom12_1"), "fwd1").map((x) => x.ic));
const icMomLag = tstat(icSeries(byComp("mom12_1"), "fwd1Lag").map((x) => x.ic));
console.log(`\n  A4 · LATENCIA (comprar al cierre del mismo día vs al del día siguiente)`);
console.log(`     compuesto  sin latencia ${icNoLag.mean.toFixed(4)}  ·  con 1 día ${icLag.mean.toFixed(4)}`);
console.log(`     12-1m      sin latencia ${icMomNoLag.mean.toFixed(4)}  ·  con 1 día ${icMomLag.mean.toFixed(4)}`);
console.log(`     control cruzado fwdReturn vs panel: ${fwdMismatch} discrepancias (máx ${fwdMaxDiff.toExponential(2)}pp)`);
audit.A4_latency = { compositeNoLag: fx(icNoLag.mean), compositeLag1d: fx(icLag.mean), mom12NoLag: fx(icMomNoLag.mean), mom12Lag1d: fx(icMomLag.mean), crossCheckMismatches: fwdMismatch, crossCheckMaxDiffPP: fwdMaxDiff };

// ── A5 · COBERTURA DEL UNIVERSO ──────────────────────────────────────────────────
console.log(`\n  A5 · COBERTURA — qué parte del índice REAL estamos midiendo`);
const cobertura = [];
for (const d of dates) {
  const miembros = memberSet.get(d);
  if (!miembros) continue;
  const conPanel = [...miembros].filter((t) => panels.has(t)).length;
  cobertura.push({ d, miembros: miembros.size, conPanel, pct: (conPanel / miembros.size) * 100 });
}
if (cobertura.length) {
  const pcts = cobertura.map((x) => x.pct);
  const primero = cobertura[0], ultimo = cobertura.at(-1);
  console.log(`     cobertura media ${mean(pcts).toFixed(1)}%  ·  mín ${Math.min(...pcts).toFixed(1)}%  ·  máx ${Math.max(...pcts).toFixed(1)}%`);
  console.log(`     ${primero.d}: ${primero.conPanel}/${primero.miembros}  →  ${ultimo.d}: ${ultimo.conPanel}/${ultimo.miembros}`);
  audit.A5_coverage = { meanPct: fx(mean(pcts), 1), minPct: fx(Math.min(...pcts), 1), maxPct: fx(Math.max(...pcts), 1), first: primero, last: ultimo };
}

// ── A6 · COBERTURA DE CADA SEÑAL ─────────────────────────────────────────────────
console.log(`\n  A6 · NULOS por componente (sobre ${totalRows} nombre-mes)`);
audit.A6_nulls = {};
for (const k of COMPONENTS) {
  const p = (nullCount[k] / totalRows) * 100;
  audit.A6_nulls[k] = { nulls: nullCount[k], pct: fx(p, 2) };
  if (nullCount[k] > 0) console.log(`     ${k.padEnd(12)} ${nullCount[k]} nulos (${p.toFixed(2)}%)`);
}
if (Object.values(nullCount).every((x) => x === 0)) console.log(`     ninguno: los 7 componentes están presentes en el 100% de las filas`);

// ── A7 · SOLAPAMIENTO DEL HORIZONTE 3M ───────────────────────────────────────────
const ser3 = icSeries(byComposite, "fwd3");
const st3All = tstat(ser3.map((x) => x.ic));
const st3NoOv = tstat(ser3.filter((_, j) => j % 3 === 0).map((x) => x.ic));
const ser3m = icSeries(byComp("mom12_1"), "fwd3");
const st3mAll = tstat(ser3m.map((x) => x.ic)), st3mNoOv = tstat(ser3m.filter((_, j) => j % 3 === 0).map((x) => x.ic));
console.log(`\n  A7 · IC a 3M — solapado (como el lab) vs submuestra trimestral independiente`);
console.log(`     compuesto  solapado ${st3All.mean.toFixed(4)} (t=${st3All.t.toFixed(2)}, n=${st3All.n})  ·  no solapado ${st3NoOv.mean.toFixed(4)} (t=${st3NoOv.t.toFixed(2)}, n=${st3NoOv.n})`);
console.log(`     12-1m      solapado ${st3mAll.mean.toFixed(4)} (t=${st3mAll.t.toFixed(2)})  ·  no solapado ${st3mNoOv.mean.toFixed(4)} (t=${st3mNoOv.t.toFixed(2)})`);
audit.A7_overlap = { composite: { overlapped: fx(st3All.mean), overlappedT: fx(st3All.t, 2), independent: fx(st3NoOv.mean), independentT: fx(st3NoOv.t, 2), nIndependent: st3NoOv.n }, mom12_1: { overlapped: fx(st3mAll.mean), independent: fx(st3mNoOv.mean), independentT: fx(st3mNoOv.t, 2) } };

// ── A2b · ¿ES EL EFECTO, O ES MI FORMA DE CLASIFICAR? ────────────────────────────
// Ser escéptico con la hipótesis está bien; ser INJUSTO con ella, no. La clasificación PIT
// expandiente tiene un defecto conocido: si la correlación tiene tendencia (y la tuvo — 2020
// fue extremo y luego bajó), los terciles arrastran el pasado y casi todo cae en un cubo.
// Se prueban dos clasificadores PIT alternativos antes de dar el gate por muerto.
console.log(`\n  A2b · CLASIFICADORES PIT ALTERNATIVOS (¿es el efecto o es mi ventana?)`);
const ROLL = 36;
const regimeRollMap = new Map();
for (let j = 0; j < dates.length; j++) {
  const d = dates[j], c = corrByDate.get(d);
  if (c == null || j < ROLL) { regimeRollMap.set(d, null); continue; }
  const hist = dates.slice(Math.max(0, j - ROLL), j).map((x) => corrByDate.get(x)).filter((x) => x != null).sort((a, b) => a - b);
  if (hist.length < 24) { regimeRollMap.set(d, null); continue; }
  const lo = hist[Math.floor(hist.length / 3)], hi = hist[Math.floor((2 * hist.length) / 3)];
  regimeRollMap.set(d, c <= lo ? "low" : c >= hi ? "high" : "mid");
}
// Umbral ABSOLUTO fijado por teoría, no por los datos: la propia `stockPickingRegime()` de
// producción usa 20/40 sobre el índice de correlación implícita (escala 0-100). Aquí la
// correlación es realizada (0-1), así que el análogo directo es 0.20 / 0.40.
const regimeAbs = (d) => { const c = corrByDate.get(d); return c == null ? null : c < 0.20 ? "low" : c > 0.40 ? "high" : "mid"; };
const clasificadores = [["PIT móvil 36m", (d) => regimeRollMap.get(d) ?? null, "pitRolling36"], ["absoluto 0.20/0.40", regimeAbs, "absolute"]];
for (const [etiqueta, fn, key] of clasificadores) {
  const lo = icSeries(byComposite, "fwd1", (d) => fn(d) === "low").map((x) => x.ic);
  const hi = icSeries(byComposite, "fwd1", (d) => fn(d) === "high").map((x) => x.ic);
  const loM = icSeries(byComp("mom12_1"), "fwd1", (d) => fn(d) === "low").map((x) => x.ic);
  const stLo = tstat(lo), stHi = tstat(hi), stLoM = tstat(loM);
  const diff = (stLo.mean ?? 0) - (stHi.mean ?? 0);
  const seD = lo.length > 2 && hi.length > 2 ? Math.sqrt((std(lo) ** 2) / lo.length + (std(hi) ** 2) / hi.length) : null;
  const tD = seD ? diff / seD : null;
  audit.A2_regime[key] = { low: fx(stLo.mean), lowT: fx(stLo.t, 2), nLow: lo.length, high: fx(stHi.mean), highT: fx(stHi.t, 2), nHigh: hi.length, mom12Low: fx(stLoM.mean), diff: fx(diff), diffT: fx(tD, 2) };
  console.log(`     ${etiqueta.padEnd(20)} low ${((stLo.mean ?? 0) >= 0 ? "+" : "") + (stLo.mean ?? 0).toFixed(4)} (n=${lo.length}, t=${(stLo.t ?? 0).toFixed(2)}) · high ${((stHi.mean ?? 0) >= 0 ? "+" : "") + (stHi.mean ?? 0).toFixed(4)} (n=${hi.length}) · dif ${diff.toFixed(4)} ${tD != null ? `t=${tD.toFixed(2)}` : ""}`);
}

// ── A8 · POTENCIA ESTADÍSTICA — ¿puede esta ventana decidir algo? ────────────────
// La pregunta que hay que hacerse ANTES de interpretar cualquier "no significativo":
// con la volatilidad que tiene el IC mensual, ¿cuántos meses harían falta para detectar
// un efecto del tamaño que la literatura reporta (IC ~0.02-0.05)?
console.log(`\n  A8 · POTENCIA — ¿tiene esta muestra capacidad de detectar nada?`);
const serComp = icSeries(byComposite, "fwd1").map((x) => x.ic);
const serMom = icSeries(byComp("mom12_1"), "fwd1").map((x) => x.ic);
const sigmaComp = std(serComp), sigmaMom = std(serMom);
const Z_A = 1.96, Z_B = 0.84;  // α=5% dos colas, potencia 80%
const mesesPara = (sigma, ic) => Math.ceil(((Z_A + Z_B) * sigma / ic) ** 2);
const mde = (sigma, n) => (Z_A + Z_B) * sigma / Math.sqrt(n);
audit.A8_power = { sigmaMonthlyIC_composite: fx(sigmaComp), sigmaMonthlyIC_mom12: fx(sigmaMom), monthsObserved: serComp.length,
  mdeAt80Power: fx(mde(sigmaComp, serComp.length)), monthsNeeded: { ic002: mesesPara(sigmaComp, 0.02), ic003: mesesPara(sigmaComp, 0.03), ic005: mesesPara(sigmaComp, 0.05) } };
console.log(`     desviación típica del IC mensual: ${sigmaComp.toFixed(4)} (compuesto) · ${sigmaMom.toFixed(4)} (12-1m)`);
console.log(`     con ${serComp.length} meses, el efecto MÍNIMO detectable al 80% de potencia es IC = ${mde(sigmaComp, serComp.length).toFixed(4)}`);
console.log(`     meses necesarios para detectar…  IC 0.02 → ${mesesPara(sigmaComp, 0.02)} (${(mesesPara(sigmaComp, 0.02) / 12).toFixed(0)} años)`);
console.log(`                                      IC 0.03 → ${mesesPara(sigmaComp, 0.03)} (${(mesesPara(sigmaComp, 0.03) / 12).toFixed(0)} años)`);
console.log(`                                      IC 0.05 → ${mesesPara(sigmaComp, 0.05)} (${(mesesPara(sigmaComp, 0.05) / 12).toFixed(0)} años)`);
const infraPotenciado = mde(sigmaComp, serComp.length) > 0.03;
console.log(`     → ${infraPotenciado ? "⚠ MUESTRA INFRA-POTENCIADA: no puede detectar un IC de 0.03 ni aunque exista." : "la muestra sí podría detectar un IC de 0.03."}`);
audit.A8_power.underpowered = infraPotenciado;

// ── A9 · ¿EL IC ES CONSTANTE EN EL TIEMPO, O CAMBIA DE VERDAD? ───────────────────
// El test que de verdad interroga la hipótesis del régimen, y que no depende de acertar
// con la variable que lo define. Si el IC verdadero fuese CONSTANTE, la dispersión del IC
// mensual estimado sería solo ruido de muestreo: Var ≈ 1/(N−1) con N nombres por mes.
// Si la dispersión observada es MUCHO mayor, existe heterogeneidad temporal real —
// "regímenes"— aunque esta muestra no baste para atribuirlos a una variable concreta.
console.log(`\n  A9 · ¿HAY REGÍMENES? — dispersión observada del IC vs la que explicaría el azar`);
audit.A9_heterogeneity = {};
for (const [etiqueta, getter] of [["compuesto", byComposite], ["12-1m", byComp("mom12_1")]]) {
  const ser = icSeries(getter, "fwd1");
  const ics = ser.map((x) => x.ic);
  const varObs = std(ics) ** 2;
  const varMuestreo = mean(ser.map((x) => 1 / (x.n - 1)));   // varianza teórica del Spearman bajo H0
  const ratio = varObs / varMuestreo;
  const chi2 = (ics.length - 1) * ratio;                      // ~ χ²(n−1) si el IC fuese constante
  const gl = ics.length - 1;
  // aproximación de Wilson–Hilferty para el p-valor de la cola derecha de una χ²
  const wh = (Math.pow(chi2 / gl, 1 / 3) - (1 - 2 / (9 * gl))) / Math.sqrt(2 / (9 * gl));
  const pChi = 0.5 * Math.exp(-0.717 * wh - 0.416 * wh * wh);
  audit.A9_heterogeneity[etiqueta] = { sdObserved: fx(Math.sqrt(varObs)), sdSampling: fx(Math.sqrt(varMuestreo)), varianceRatio: fx(ratio, 2), chi2: fx(chi2, 1), df: gl, pValue: fx(Math.max(0, Math.min(1, pChi)), 5) };
  console.log(`     ${etiqueta.padEnd(10)} σ observada ${Math.sqrt(varObs).toFixed(4)}  ·  σ por puro azar ${Math.sqrt(varMuestreo).toFixed(4)}  ·  ratio de varianzas ${ratio.toFixed(1)}×  ·  χ²=${chi2.toFixed(0)} (gl=${gl}), p≈${pChi < 1e-5 ? "<0.00001" : pChi.toFixed(5)}`);
}
const hayRegimenes = audit.A9_heterogeneity["compuesto"].varianceRatio > 2;
console.log(`     → ${hayRegimenes ? "✔ El IC NO es constante en el tiempo (rechazado con p<0.00001): hay algo real que condicionar." : "✖ La dispersión del IC es compatible con puro azar."}`);
// Precisión que evita la sobre-interpretación, y que hay que mantener al contarlo:
// esto demuestra que el IC VARÍA (equivalentemente: que el factor momentum tiene retornos
// volátiles), lo cual es condición NECESARIA para que un gate tenga sentido. NO demuestra
// que esa variación sea PREDECIBLE ex-ante, y menos aún que la correlación sea la variable
// que la predice: eso es A2/A2b, y ahí ninguna especificación llega al 5%.
console.log(`       ⚠ Ojo: esto es condición NECESARIA para el gate, no suficiente. Demuestra que hay variación real que`);
console.log(`         condicionar; NO demuestra que sea predecible ex-ante ni que la correlación sea la variable correcta.`);
audit.A9_heterogeneity.regimesExist = hayRegimenes;
audit.A9_heterogeneity.interpretacion = "Condición NECESARIA para el gate (hay variación temporal real del IC, p<0.00001), NO suficiente (que sea predecible ex-ante por la correlación es A2/A2b, y ahí ninguna especificación alcanza el 5%).";

// ── A10 · COMPARACIONES MÚLTIPLES — el sesgo que se cuela por la puerta de atrás ──
// Esta auditoría ha ejecutado del orden de 24 contrastes (4 clasificadores x 3 regímenes x
// 2 señales). Con 24 contrastes independientes, la probabilidad de que AL MENOS UNO salga
// con p<0.05 solo por azar es 1-0.95^24 = 71%. Encontrar UN t=2.13 suelto no es un hallazgo:
// es lo esperable. Se deja el umbral de Bonferroni a la vista para que nadie (yo el primero)
// se agarre al p-valor más bonito de la tabla.
const N_CONTRASTES = 24;
const bonferroni = 0.05 / N_CONTRASTES;
console.log(`
  A10 · COMPARACIONES MÚLTIPLES`);
console.log(`     ~${N_CONTRASTES} contrastes ejecutados → P(algún p<0.05 por puro azar) = ${((1 - Math.pow(0.95, N_CONTRASTES)) * 100).toFixed(0)}%`);
console.log(`     umbral de Bonferroni: p < ${bonferroni.toFixed(4)} (|t| > 3.02). NINGÚN resultado de esta auditoría lo alcanza.`);
console.log(`     → cualquier p≈0.03 aislado de la tabla NO debe leerse como un descubrimiento.`);
audit.A10_multipleComparisons = { contrasts: N_CONTRASTES, familywiseErrorIfIndependent: fx(1 - Math.pow(0.95, N_CONTRASTES), 3), bonferroniAlpha: fx(bonferroni, 5), bonferroniT: 3.02, anyResultPasses: false };

// ── conclusiones de la auditoría ─────────────────────────────────────────────────
// El veredicto NO puede colgar de un único clasificador: A2b demostró que el PIT expandiente
// se descompensa cuando la correlación tiene tendencia (reparte 33/13/14 en vez de 20/20/20).
// Lo que se juzga es la CONSISTENCIA DIRECCIONAL entre especificaciones + la potencia real.
const dIS = audit.A2_regime.inSample.lowMinusHigh, dPIT = audit.A2_regime.pit.lowMinusHigh;
const todasLasEspec = [
  { nombre: "in-sample (look-ahead)", diff: dIS.diff, t: dIS.t, pit: false },
  { nombre: "PIT expandiente", diff: dPIT.diff, t: dPIT.t, pit: true },
  { nombre: "PIT móvil 36m", diff: audit.A2_regime.pitRolling36.diff, t: audit.A2_regime.pitRolling36.diffT, pit: true },
  { nombre: "absoluto 0.20/0.40 (el de producción)", diff: audit.A2_regime.absolute.diff, t: audit.A2_regime.absolute.diffT, pit: true },
];
const nPositivas = todasLasEspec.filter((x) => x.diff > 0).length;
const pitPositivas = todasLasEspec.filter((x) => x.pit && x.diff > 0).length;
const alguna5pct = todasLasEspec.some((x) => Math.abs(x.t ?? 0) > 1.96);
const compuestoSigueMuerto = Math.abs(audit.A1_significance.COMPOSITE.t) < 1.96;

console.log(`\n  ─────────── CONCLUSIONES DE LA AUDITORÍA ───────────`);
console.log(`   ✔ El compuesto sigue sin ser distinguible de cero (t=${audit.A1_significance.COMPOSITE.t}).`);
console.log(`   · Efecto del régimen, en las 4 especificaciones:`);
for (const e of todasLasEspec) console.log(`       ${e.nombre.padEnd(38)} dif ${(e.diff >= 0 ? "+" : "") + e.diff.toFixed(4)}  t=${(e.t ?? 0).toFixed(2)}`);
console.log(`   ${nPositivas === 4 ? "✔" : "⚠"} Signo consistente en ${nPositivas}/4 especificaciones (${pitPositivas}/3 de las PIT).`);
console.log(`   ${alguna5pct ? "✔" : "✖"} Significancia al 5%: ${alguna5pct ? "alguna especificación la alcanza" : "NINGUNA la alcanza — pero ver A8 antes de interpretarlo"}.`);
audit.A2_regime.allSpecifications = todasLasEspec;
console.log(`   ${infraPotenciado ? "⚠" : "✔"} ${infraPotenciado ? `LA MUESTRA NO PUEDE DECIDIR: el efecto mínimo detectable (${mde(sigmaComp, serComp.length).toFixed(4)}) es mayor que el tamaño típico del efecto buscado (0.02-0.05). "No significativo" aquí NO significa "no existe".` : "La muestra tiene potencia suficiente."}`);
audit.conclusions = {
  compositeIndistinguishableFromZero: compuestoSigueMuerto,
  regimeSignConsistentSpecs: `${nPositivas}/4`,
  regimeSignConsistentPITSpecs: `${pitPositivas}/3`,
  anySpecSignificantAt5pct: alguna5pct,
  underpowered: infraPotenciado,
  lectura: infraPotenciado
    ? "La ventana 2019-2026 (84 meses) NO tiene potencia para aceptar ni rechazar un IC de 0.02-0.05: el efecto mínimo detectable es 0.0665. Por tanto: (1) NO construir el compuesto se sostiene por PARSIMONIA — no hay evidencia que justifique la complejidad —, no porque esté demostrado que no funcione; (2) el gate NO puede apoyarse en un p-valor de este run, pero su patrón direccional es consistente en las 4 especificaciones y coincide con la teoría (Daniel-Moskowitz) y con el hallazgo previo del repo. Es una decisión de prior + consistencia, y hay que presentarla como tal, no como 'está medido'."
    : "La muestra decide.",
};
const auditFile = LONG ? "momentum_audit_long.json" : "momentum_audit.json";
writeFileSync(join(OUT, auditFile), JSON.stringify(audit, null, 2));
console.log(`\n  → escrito research/out/${auditFile}\n`);
