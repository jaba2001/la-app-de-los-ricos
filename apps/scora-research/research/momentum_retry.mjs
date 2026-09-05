// ─────────────────────────────────────────────────────────────────────────────
// SEGUNDA OPORTUNIDAD PARA EL MOMENTUM — corrigiendo los dos fallos de diseño de la
// primera prueba, que eran míos y no de la idea.
//
// FALLO 1 · El compuesto llevaba REDUNDANCIA. La propia auditoría demostró que `rs_spy`
//   (momentum menos el del SPY) es una traslación constante dentro de cada mes, así que su
//   IC de Spearman es IDÉNTICO al de mom12_1: su 10% de peso estaba duplicando momentum
//   puro en vez de aportar nada. Un compuesto lastrado así no puede juzgarse.
//   → Se prueban variantes sin redundancia y quedándose sólo con lo que aporta.
//
// FALLO 2 · El gate era BINARIO. Dentro o fuera según un umbral. Eso (a) tira información
//   —no es lo mismo una correlación de 0,29 que una de 0,60— y (b) concentra todo el
//   resultado en acertar el corte. El estándar de la literatura (Barroso-Santa Clara) es
//   ESCALAR la exposición de forma continua, no encenderla y apagarla.
//   → Se prueban gates continuos: por correlación y por volatilidad del propio factor.
//
// Referencia: el universo equiponderado, que es el listón honesto (mismo universo, mismo
// sesgo, sin seleccionar). Y con el MDE declarado, que es lo que evita leer ruido.
//
//   node --experimental-strip-types --no-warnings research/momentum_retry.mjs --full 400
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { returnsSeries, fwdReturn } from "./prices.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { addMonths, monthStarts, mean, std, fx, spearman, loadPanel, idxOnOrBefore, signalsAt, pct } from "./momentumSignals.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const COST_BPS = 10, DECILE = 10;
// --long: ventana 2010-2018 con la caché de historia larga. Es el FUERA DE MUESTRA del
// gate: los umbrales absolutos 0,20/0,40 no se estimaron aquí, así que si el resultado
// aguanta en un periodo que no se usó para elegirlos, deja de ser un candidato.
const LONG = process.argv.includes("--long");
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;
const today = new Date().toISOString().slice(0, 10);
const START = process.env.BT_START || (LONG ? "2010-07-01" : "2019-07-01");
const END = process.env.BT_END || (LONG ? "2018-12-01" : addMonths(today, -2));
const dates = monthStarts(START, END);
const FULL = process.argv.includes("--full");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 400);

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
console.log(`\n  MOMENTUM · SEGUNDA OPORTUNIDAD · ${UNIVERSE.length} nombres · ${dates.length} meses\n`);

const spyRs = await seriesFn("SPY");
const spyMap = new Map(spyRs.map((x) => [x.date, x.ret]));
const spyPanel = await loadPanel("SPY", seriesFn);
const panels = new Map();
for (const t of UNIVERSE) { const p = await loadPanel(t, seriesFn); if (p) panels.set(t, p); }
let corrEngine;
if (LONG) {
  // Mismo estimador de correlation.mjs, construido desde los paneles largos ya cargados.
  const maps = new Map();
  for (const [t, p] of panels) { const m = new Map(); for (let j = 0; j < p.dates.length; j++) m.set(p.dates[j], p.ret[j]); maps.set(t, m); }
  corrEngine = { maps, spyDates: spyPanel.dates };
} else {
  corrEngine = await buildCorrEngine([...panels.keys()]);
}
const fwdDe = async (t, p, d) => {
  if (!LONG) return fwdReturn(t, d, addMonths(d, 1));
  const a = idxOnOrBefore(p.dates, d), b = idxOnOrBefore(p.dates, addMonths(d, 1));
  return a < 0 || b <= a ? null : (Math.exp(p.cum[b] - p.cum[a]) - 1) * 100;
};

// VARIANTES DEL COMPUESTO. La original iba con rs_spy dentro (redundante) y con dist52w,
// que resultó predecir AL REVÉS. Se prueban quitando lo que sobra, no añadiendo nada nuevo:
// si la idea vale, tiene que valer con menos piezas, no con más.
const VARIANTES = {
  "original (7 señales)": { mom12_1_ra: 0.30, mom6_1_ra: 0.20, rs_ibd: 0.15, rs_spy: 0.10, dist52w: 0.10, resid_mom: 0.10, fip_neg: 0.05 },
  "sin rs_spy (redundante)": { mom12_1_ra: 0.33, mom6_1_ra: 0.22, rs_ibd: 0.17, dist52w: 0.11, resid_mom: 0.11, fip_neg: 0.06 },
  "sin rs_spy ni dist52w": { mom12_1_ra: 0.37, mom6_1_ra: 0.25, rs_ibd: 0.19, resid_mom: 0.12, fip_neg: 0.07 },
  "sólo los de IC positivo": { fip_neg: 0.5, resid_mom: 0.5 },
  "12-1m a secas": { mom12_1_ra: 1 },
};

const byDate = new Map(), corrByDate = new Map();
for (const d of dates) {
  corrByDate.set(d, corrAsOf(corrEngine, [...panels.keys()], d, 63));
  const iSpy = idxOnOrBefore(spyPanel.dates, d);
  const spyMom = iSpy >= 0 ? signalsAt(spyPanel, iSpy, null)?.mom12_1 ?? null : null;
  const bucket = [];
  for (const [t, p] of panels) {
    if (!isMember(t, d)) continue;
    const i = idxOnOrBefore(p.dates, d);
    if (i < 0) continue;
    const s = signalsAt(p, i, spyMap);
    if (!s) continue;
    const fwd1 = await fwdDe(t, p, d);
    if (fwd1 == null) continue;
    bucket.push({ t, fwd1, ...s, rs_spy: spyMom != null ? s.mom12_1 - spyMom : null });
  }
  byDate.set(d, bucket);
}
const fechasOk = dates.filter((d) => (byDate.get(d) || []).length >= 30);

function compuesto(d, pesos) {
  const rows = byDate.get(d) || [];
  const maps = Object.fromEntries(Object.keys(pesos).map((k) => [k, pct(rows, k)]));
  const out = new Map();
  for (const r of rows) {
    let s = 0, w = 0;
    for (const [k, peso] of Object.entries(pesos)) { const p = maps[k].get(r.t); if (p != null) { s += peso * p; w += peso; } }
    if (w >= 0.5) out.set(r.t, s / w);
  }
  return out;
}

// Referencia: universo equiponderado.
const ewRets = fechasOk.map((d) => mean((byDate.get(d) || []).map((r) => r.fwd1)));
const curvaDe = (rets) => { let eq = 1, peak = 1, mdd = 0; for (const r of rets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); } return { total: (eq - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 }; };
const ew = curvaDe(ewRets);

console.log(`  ── VARIANTES DEL COMPUESTO (decil superior, neto de costes) ──`);
console.log(`  ${"variante".padEnd(26)}${"IC".padStart(9)}${"t".padStart(7)}${"total".padStart(9)}${"vs EW".padStart(9)}${"Sharpe".padStart(8)}`);
console.log(`  ${"universo EW".padEnd(26)}${"—".padStart(9)}${"—".padStart(7)}${("+" + ew.total.toFixed(0) + "%").padStart(9)}${"—".padStart(9)}${ew.sharpe.toFixed(2).padStart(8)}`);

const resultados = {};
const scoresPorVariante = new Map();
for (const [nombre, pesos] of Object.entries(VARIANTES)) {
  const porFecha = new Map(fechasOk.map((d) => [d, compuesto(d, pesos)]));
  scoresPorVariante.set(nombre, porFecha);
  const ics = [];
  for (const d of fechasOk) {
    const m = porFecha.get(d), rows = byDate.get(d) || [];
    const xs = [], ys = [];
    for (const r of rows) { const v = m.get(r.t); if (v != null) { xs.push(v); ys.push(r.fwd1); } }
    const s = spearman(xs, ys); if (s != null) ics.push(s);
  }
  const rets = [];
  let prev = new Set();
  for (const d of fechasOk) {
    const m = porFecha.get(d), rows = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const orden = [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const n = Math.max(1, Math.floor(orden.length / DECILE));
    const held = orden.slice(0, n);
    const r = mean(held.map((t) => rows.get(t)?.fwd1).filter((x) => x != null));
    const set = new Set(held); let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    rets.push((r ?? 0) - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100); prev = set;
  }
  const c = curvaDe(rets);
  const t = std(ics) ? mean(ics) / (std(ics) / Math.sqrt(ics.length)) : 0;
  resultados[nombre] = { ic: fx(mean(ics)), t: fx(t, 2), total: fx(c.total, 1), vsEW: fx(c.total - ew.total, 1), sharpe: fx(c.sharpe, 2), rets };
  console.log(`  ${nombre.padEnd(26)}${(mean(ics) >= 0 ? "+" : "") + mean(ics).toFixed(4)}${t.toFixed(2).padStart(7)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}`);
}

// ── GATES: binario (como antes) vs CONTINUOS ─────────────────────────────────────
// El continuo escala la exposición en vez de encenderla y apagarla: con correlación baja
// se va al 100%, con alta se reduce suavemente, y lo que no se invierte va al índice.
const corrVals = [...corrByDate.values()].filter((x) => x != null).sort((a, b) => a - b);
const cLo = corrVals[Math.floor(corrVals.length / 3)], cHi = corrVals[Math.floor((2 * corrVals.length) / 3)];
const mejorVariante = Object.entries(resultados).sort((a, b) => b[1].vsEW - a[1].vsEW)[0][0];
const porFechaMejor = scoresPorVariante.get(mejorVariante);

function conGate(peso) {
  const rets = []; let prev = new Set();
  for (let j = 0; j < fechasOk.length; j++) {
    const d = fechasOk[j];
    const m = porFechaMejor.get(d), rows = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const orden = [...m.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const n = Math.max(1, Math.floor(orden.length / DECILE));
    const held = orden.slice(0, n);
    const rSel = mean(held.map((t) => rows.get(t)?.fwd1).filter((x) => x != null)) ?? 0;
    const rEW = ewRets[j] ?? 0;
    const w = peso(d);                                   // 0..1 en la cesta, el resto al índice
    const set = new Set(held); let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    const coste = (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100 * w;
    rets.push(w * rSel + (1 - w) * rEW - coste); prev = set;
  }
  return curvaDe(rets);
}
// ⚠️ cLo y cHi de arriba son terciles de TODA la ventana: en 2019 nadie conocía el tercil
// alto de 2026. Usarlos es look-ahead, y es EXACTAMENTE el error que la auditoría del
// momentum ya cazó una vez (A2: el efecto se desplomaba al clasificar PIT). Así que junto a
// cada gate in-sample va su gemelo PIT, con los cortes calculados sólo con el pasado.
const WARMUP = 24;
const cortesPIT = new Map();
for (let j = 0; j < dates.length; j++) {
  const d = dates[j];
  if (j < WARMUP) { cortesPIT.set(d, null); continue; }
  const hist = dates.slice(0, j).map((x) => corrByDate.get(x)).filter((x) => x != null).sort((a, b) => a - b);
  if (hist.length < WARMUP) { cortesPIT.set(d, null); continue; }
  cortesPIT.set(d, { lo: hist[Math.floor(hist.length / 3)], hi: hist[Math.floor((2 * hist.length) / 3)] });
}
const rampa = (c, lo, hi) => (c == null || lo == null || hi <= lo ? 0.5 : Math.max(0, Math.min(1, (hi - c) / (hi - lo))));

const gates = {
  "sin gate": () => 1,
  "binario in-sample": (d) => (corrByDate.get(d) ?? 1) >= cHi ? 0 : 1,
  "continuo in-sample": (d) => rampa(corrByDate.get(d), cLo, cHi),
  // — los honestos —
  "continuo PIT": (d) => { const k = cortesPIT.get(d); return k ? rampa(corrByDate.get(d), k.lo, k.hi) : 1; },
  "continuo PIT, suelo 0,3": (d) => { const k = cortesPIT.get(d); return k ? 0.3 + 0.7 * rampa(corrByDate.get(d), k.lo, k.hi) : 1; },
  // — umbral absoluto, el que ya usa producción (0,20/0,40): no se estima de los datos —
  "continuo absoluto 0,20-0,40": (d) => rampa(corrByDate.get(d), 0.20, 0.40),
};
console.log(`\n  ── GATES sobre la mejor variante ("${mejorVariante}") ──`);
console.log(`  ${"gate".padEnd(26)}${"total".padStart(9)}${"vs EW".padStart(9)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}`);
const resGates = {};
for (const [nombre, f] of Object.entries(gates)) {
  const c = conGate(f);
  resGates[nombre] = { total: fx(c.total, 1), vsEW: fx(c.total - ew.total, 1), sharpe: fx(c.sharpe, 2), maxDD: fx(c.maxDD, 1) };
  console.log(`  ${nombre.padEnd(26)}${("+" + c.total.toFixed(0) + "%").padStart(9)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}${(c.maxDD.toFixed(1) + "%").padStart(9)}`);
}

// El veredicto SÓLO puede mirar los gates honestos: los in-sample están en la tabla para
// enseñar cuánto infla el look-ahead (+44pp que se quedan en −2pp al calcular los cortes
// con sólo el pasado), no para ganar la comparación.
const HONESTOS = ["sin gate", "continuo PIT", "continuo PIT, suelo 0,3", "continuo absoluto 0,20-0,40"];
const mejorGate = Object.entries(resGates).filter(([k]) => HONESTOS.includes(k) && k !== "sin gate")
  .sort((a, b) => b[1].sharpe - a[1].sharpe)[0];
const sinGate = resGates["sin gate"];
const gateAportaRiesgo = mejorGate[1].sharpe > sinGate.sharpe;
const gateAportaRetorno = mejorGate[1].vsEW > 0;
console.log(`\n  ── lo que aporta el gate, ya sin look-ahead ──`);
console.log(`     Sharpe  ${sinGate.sharpe} (sin gate) → ${mejorGate[1].sharpe} ("${mejorGate[0]}")`);
console.log(`     maxDD   ${sinGate.maxDD}% → ${mejorGate[1].maxDD}%`);
console.log(`     vs EW   ${sinGate.vsEW}pp → ${mejorGate[1].vsEW}pp`);
const veredicto = gateAportaRetorno
  ? `el gate honesto "${mejorGate[0]}" bate a no seleccionar (${mejorGate[1].vsEW >= 0 ? "+" : ""}${mejorGate[1].vsEW}pp, Sharpe ${mejorGate[1].sharpe} vs ${ew.sharpe.toFixed(2)}). Candidato serio, pendiente de fuera de muestra.`
  : gateAportaRiesgo
    ? `NINGUNA variante genera retorno extra, pero el gate honesto sí mejora el RIESGO (Sharpe ${sinGate.sharpe}→${mejorGate[1].sharpe}, maxDD ${sinGate.maxDD}%→${mejorGate[1].maxDD}%). El momentum no es fuente de alfa aquí; el gate es gestión de riesgo, y como tal se sostiene.`
    : "ni las variantes ni los gates honestos aportan.";
console.log(`
  VEREDICTO: ${veredicto}`);
console.log(`  (con ${Object.keys(VARIANTES).length + Object.keys(gates).length} combinaciones probadas, el mejor de la tabla está sesgado al alza: hace falta fuera de muestra antes de creérselo)\n`);

writeFileSync(join(OUT, LONG ? "momentum_retry_oos.json" : "momentum_retry.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), months: fechasOk.length, universe: panels.size,
  universeEW: { total: fx(ew.total, 1), sharpe: fx(ew.sharpe, 2) },
  variants: Object.fromEntries(Object.entries(resultados).map(([k, v]) => [k, { ic: v.ic, t: v.t, total: v.total, vsEW: v.vsEW, sharpe: v.sharpe }])),
  gates: resGates, bestVariant: mejorVariante, bestHonestGate: mejorGate[0], gateImprovesRisk: gateAportaRiesgo, gateAddsReturn: gateAportaRetorno, verdict: veredicto,
  contrasts: Object.keys(VARIANTES).length + Object.keys(gates).length,
}, null, 2));
console.log(`  → escrito research/out/momentum_retry.json\n`);
