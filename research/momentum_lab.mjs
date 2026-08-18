// ─────────────────────────────────────────────────────────────────────────────
// MOMENTUM LAB (2026-08-17) — F0 de PLAN_SEEKINGALPHA_MARKET_MOMENTUM.md §7.9.
//
// La pregunta que decide si el Momentum Suite se construye o se recorta:
//   ¿un compuesto de 7 señales de momentum bate al 12-1m a secas, DESPUÉS de costes,
//   y el gate de régimen reduce de verdad el drawdown?
//
// Mide, punto por punto (nada entra al score sin pasar por aquí):
//   1. IC (Spearman) de CADA componente por separado vs retorno futuro 1M y 3M.
//   2. IC del COMPUESTO vs IC del 12-1m simple. Si no lo bate, el compuesto NO entra.
//   3. IC partido por RÉGIMEN DE CORRELACIÓN (terciles realizados) y por ESTADO DE
//      MERCADO (SPY sobre/bajo su 200dma) — donde la casa ya midió +0.07 / −0.09.
//   4. Spread de deciles (top − bottom) y curva del decil superior NETA de costes.
//   5. Walk-forward: primera mitad vs segunda mitad + IC por año natural.
//   6. Test del GATE: misma cartera con y sin puerta → ¿baja el maxDD ≥20%?
//
// Componentes (todos derivados SOLO de precios, sin fundamentales → rápido y PIT-limpio):
//   mom12_1     retorno total t-12→t-1 (el ancla académica; se salta el último mes)
//   mom12_1_ra  el anterior ÷ volatilidad anualizada (receta MSCI: momentum ajustado por riesgo)
//   mom6_1_ra   ídem con ventana 6m
//   rs_ibd      0.4·ROC63 + 0.2·ROC126 + 0.2·ROC189 + 0.2·ROC252 (receta IBD)
//   rs_spy      12-1m del nombre − 12-1m del SPY (fuerza relativa)
//   dist52w     precio / máximo de 52 semanas (George & Hwang)
//   resid_mom   momentum del residuo tras regresar contra el SPY, ÷ vol residual (Blitz)
//   fip_id      information discreteness = signo(PRET)×(%días neg − %días pos), Da-Gurun-Warachka.
//               MÁS NEGATIVO = información continua = mejor momentum → se invierte el signo.
//   rev1m       retorno del último mes (se mide para CONFIRMAR la reversión a corto,
//               que hoy el score de producción premia al revés)
//
// NO medido aquí, y hay que decirlo: la confirmación por volumen. `prices.mjs` cachea
// {date, raw, adj} sin volumen, así que exigiría cambiar el formato de caché e invalidar
// todo el histórico. Queda para F2 si el resto pasa.
//
// Nota metodológica honesta: el módulo de producción normalizará con z-scores winsorizados
// a ±3 (receta MSCI). Aquí se combina por PERCENTIL transversal, que es lo que ya usan
// qgv_lab/backtest y es más robusto a colas. Para el IC de un componente suelto da igual
// (Spearman es invariante a transformaciones monótonas); solo cambia la MEZCLA, y por eso
// los pesos que salgan de aquí se validan otra vez sobre el módulo real en F2.
//
//   node --experimental-strip-types --no-warnings research/momentum_lab.mjs            # smoke (44 nombres)
//   node --experimental-strip-types --no-warnings research/momentum_lab.mjs --full 400 # run real
//   PX_FROM=2015-01-01 BT_START=2016-07-01 … --full 400                                # ventana larga
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { returnsSeries, fwdReturn, aboveSMA } from "./prices.mjs";
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
// El motor de senales vive en su propio modulo para que `momentum_audit.mjs` audite
// EXACTAMENTE este calculo y no una copia paralela que podria divergir sin avisar.
import { addMonths, monthStarts, mean, std, fx, spearman, loadPanel, idxOnOrBefore, signalsAt, pct } from "./momentumSignals.mjs";

const COST_BPS = 10;                                  // por lado, igual que qgv_lab
const DECILE = Number(process.env.DECILE || 10);      // no de cestas
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// ── universo y fechas ────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const START = process.env.BT_START || "2019-07-01";   // PX_FROM=2018-06 + 13m de calentamiento
const END = process.env.BT_END || addMonths(today, -2); // deja hueco al retorno futuro 1M
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
  } else console.log("  ⚠ no se pudo cargar la membresía histórica del S&P 500 → universo CURATED");
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);

console.log(`\n  MOMENTUM LAB · ${UNIVERSE.length} nombres · ${dates.length} meses ${dates[0]}→${dates.at(-1)}\n  descargando precios…`);

// ── carga de paneles ─────────────────────────────────────────────────────────────
const spyRs = await returnsSeries("SPY");
const spyMap = new Map(spyRs.map((x) => [x.date, x.ret]));
const spyPanel = await loadPanel("SPY");
if (!spyPanel) { console.error("  ✖ sin serie de SPY — abortando"); process.exit(1); }

const panels = new Map();
let loaded = 0;
for (const t of UNIVERSE) {
  const p = await loadPanel(t);
  if (p) panels.set(t, p);
  if (++loaded % 50 === 0) console.log(`  …${loaded}/${UNIVERSE.length}`);
}
console.log(`  paneles cargados: ${panels.size}/${UNIVERSE.length}`);

// correlación realizada (el régimen que ya usa el producto) + estado de mercado
console.log(`  construyendo motor de correlación…`);
const corrEngine = await buildCorrEngine([...panels.keys()]);
const corrByDate = new Map(), stateByDate = new Map();
for (const d of dates) {
  corrByDate.set(d, corrAsOf(corrEngine, [...panels.keys()], d, 63));
  const i = idxOnOrBefore(spyPanel.dates, d);
  stateByDate.set(d, i >= 0 ? await aboveSMA("SPY", 200, d) : null);
}
const corrVals = [...corrByDate.values()].filter((x) => x != null).sort((a, b) => a - b);
const cLo = corrVals[Math.floor(corrVals.length / 3)] ?? null;
const cHi = corrVals[Math.floor((2 * corrVals.length) / 3)] ?? null;
const corrRegime = (d) => { const c = corrByDate.get(d); return c == null || cLo == null ? null : c <= cLo ? "low" : c >= cHi ? "high" : "mid"; };

// ── panel transversal: señales + retornos futuros ────────────────────────────────
const COMPONENTS = ["mom12_1", "mom12_1_ra", "mom6_1_ra", "rs_ibd", "rs_spy", "dist52w", "resid_mom", "fip_neg", "rev1m_neg"];
const WEIGHTS = { mom12_1_ra: 0.30, mom6_1_ra: 0.20, rs_ibd: 0.15, rs_spy: 0.10, dist52w: 0.10, resid_mom: 0.10, fip_neg: 0.05 };
// AVISO sobre rs_spy, que el propio lab demuestra: rs_spy = mom12_1 − (12-1m del SPY), y el
// segundo término es CONSTANTE dentro del mes. Restar una constante a todo el corte transversal
// no altera el orden ⇒ su IC de Spearman es IDÉNTICO al de mom12_1 (se comprueba en la tabla).
// O sea: como señal de RANKING no aporta nada y su 0.10 de peso está duplicando momentum puro.
// Solo aportaría (a) como filtro ABSOLUTO (rs_spy > 0), o (b) medida contra el ETF de SECTOR,
// que sí varía dentro del mes. Se deja medido, no borrado, para que el dato quede a la vista.

const byDate = new Map();
const spyFwd = new Map();
for (const d of dates) {
  spyFwd.set(d, await fwdReturn("SPY", d, addMonths(d, 1)));
  const iSpy = idxOnOrBefore(spyPanel.dates, d);
  const spySig = iSpy >= 0 ? signalsAt(spyPanel, iSpy, null) : null;
  const spyMom = spySig?.mom12_1 ?? null;

  const bucket = [];
  for (const [t, p] of panels) {
    if (!isMember(t, d)) continue;
    const i = idxOnOrBefore(p.dates, d);
    if (i < 0) continue;
    const s = signalsAt(p, i, spyMap);
    if (!s) continue;
    const fwd1 = await fwdReturn(t, d, addMonths(d, 1));
    const fwd3 = await fwdReturn(t, d, addMonths(d, 3));
    if (fwd1 == null) continue;
    bucket.push({ t, fwd1, fwd3, ...s, rs_spy: spyMom != null ? s.mom12_1 - spyMom : null });
  }
  byDate.set(d, bucket);
}
const nm = [...byDate.values()].reduce((s, b) => s + b.length, 0);
console.log(`  panel: ${nm} nombre-mes (media ${(nm / dates.length).toFixed(0)}/mes)\n`);
if (nm === 0) { console.error("  ✖ panel vacío — ¿PX_FROM cubre 13 meses antes de BT_START?"); process.exit(1); }


// compuesto = media ponderada de los percentiles PRESENTES (renormalizada)
const compByDate = new Map();
for (const d of dates) {
  const rows = byDate.get(d) || [];
  const maps = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, pct(rows, k)]));
  const out = new Map();
  for (const r of rows) {
    let s = 0, w = 0;
    for (const [k, weight] of Object.entries(WEIGHTS)) { const p = maps[k].get(r.t); if (p != null) { s += weight * p; w += weight; } }
    if (w >= 0.5) out.set(r.t, s / w);   // exige ≥50% del peso presente
  }
  compByDate.set(d, out);
}

// ── 1+2. IC por componente y del compuesto ───────────────────────────────────────
function icOf(getScore, horizon, filter) {
  const per = [];
  for (const d of dates) {
    if (filter && !filter(d)) continue;
    const rows = (byDate.get(d) || []).filter((r) => r[horizon] != null);
    const xs = [], ys = [];
    for (const r of rows) { const s = getScore(d, r); if (s != null && isFinite(s)) { xs.push(s); ys.push(r[horizon]); } }
    const s = spearman(xs, ys);
    if (s != null) per.push(s);
  }
  return { ic: mean(per), n: per.length, hit: per.length ? per.filter((x) => x > 0).length / per.length : null };
}
const byComp = (k) => (d, r) => r[k];
const byComposite = (d, r) => compByDate.get(d)?.get(r.t) ?? null;

const icTable = {};
for (const k of COMPONENTS) icTable[k] = { fwd1: icOf(byComp(k), "fwd1"), fwd3: icOf(byComp(k), "fwd3") };
icTable.COMPOSITE = { fwd1: icOf(byComposite, "fwd1"), fwd3: icOf(byComposite, "fwd3") };

console.log(`  ${"componente".padEnd(14)}${"IC 1M".padStart(9)}${"IC 3M".padStart(9)}${"acierto".padStart(10)}${"meses".padStart(7)}`);
for (const [k, v] of Object.entries(icTable)) {
  const mark = k === "COMPOSITE" ? "▸ " : "  ";
  console.log(`${mark}${k.padEnd(14)}${(v.fwd1.ic >= 0 ? "+" : "") + v.fwd1.ic.toFixed(4).padStart(8)}${(v.fwd3.ic >= 0 ? "+" : "") + v.fwd3.ic.toFixed(4).padStart(8)}${((v.fwd1.hit * 100).toFixed(0) + "%").padStart(10)}${String(v.fwd1.n).padStart(7)}`);
}

// ── 3. IC por régimen de correlación y estado de mercado ─────────────────────────
const regimes = {
  "corr baja": (d) => corrRegime(d) === "low",
  "corr media": (d) => corrRegime(d) === "mid",
  "corr alta": (d) => corrRegime(d) === "high",
  "SPY > 200dma": (d) => stateByDate.get(d) === true,
  "SPY < 200dma": (d) => stateByDate.get(d) === false,
};
const icRegime = {};
console.log(`\n  IC del compuesto por régimen (vs 12-1m simple):`);
for (const [name, f] of Object.entries(regimes)) {
  const c = icOf(byComposite, "fwd1", f), m = icOf(byComp("mom12_1"), "fwd1", f);
  icRegime[name] = { composite: fx(c.ic), mom12_1: fx(m.ic), months: c.n };
  console.log(`    ${name.padEnd(14)} compuesto ${(c.ic >= 0 ? "+" : "") + c.ic.toFixed(4)}   12-1m ${(m.ic >= 0 ? "+" : "") + m.ic.toFixed(4)}   (${c.n} meses)`);
}

// ── 4. deciles y curvas netas de costes ──────────────────────────────────────────
function basketsAt(d) {
  const comp = compByDate.get(d);
  if (!comp || comp.size < DECILE * 2) return null;
  const sorted = [...comp.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const n = Math.max(1, Math.floor(sorted.length / DECILE));
  return { top: sorted.slice(0, n), bottom: sorted.slice(-n) };
}
function curve(selector) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const d of dates) {
    const held = selector(d) || [];
    const rowMap = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const rs = held.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null);
    const r = rs.length ? mean(rs) : (spyFwd.get(d) ?? 0);   // sin cesta → índice
    const set = new Set(held); let ch = 0; for (const t of set) if (!prev.has(t)) ch++;
    const turn = set.size ? ch / set.size : 0;
    const net = r - turn * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = set;
  }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100, turnover: null, rets };
}
const spyRetsArr = dates.map((d) => spyFwd.get(d)).filter((x) => x != null);
const spyStat = (() => { let eq = 1, peak = 1, mdd = 0; for (const r of spyRetsArr) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); } return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / spyRetsArr.length) - 1) * 100, sharpe: std(spyRetsArr) ? mean(spyRetsArr) / std(spyRetsArr) * Math.sqrt(12) : 0, maxDD: mdd * 100 }; })();

// spread bruto top − bottom (sin costes: es una medida de señal, no una cartera)
const spreads = [];
for (const d of dates) {
  const b = basketsAt(d);
  if (!b) continue;
  const rowMap = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
  const top = mean(b.top.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null));
  const bot = mean(b.bottom.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null));
  if (top != null && bot != null) spreads.push(top - bot);
}
const topCurve = curve((d) => basketsAt(d)?.top);
const mom12Curve = curve((d) => {
  const rows = (byDate.get(d) || []).filter((r) => r.mom12_1 != null);
  if (rows.length < DECILE * 2) return null;
  const n = Math.max(1, Math.floor(rows.length / DECILE));
  return rows.sort((a, b) => b.mom12_1 - a.mom12_1).slice(0, n).map((r) => r.t);
});

// ── 6. test del gate ─────────────────────────────────────────────────────────────
// gate = 0 cuando la correlación está en el tercil alto O el SPY está bajo su 200dma.
// Se miden las DOS salidas posibles, porque no son la misma apuesta:
//   • → SPY  : deja de SELECCIONAR pero mantiene la beta (es lo que hace la Capa C del plan).
//   • → caja : deja de seleccionar Y quita la beta (market timing; otra cosa, y más agresiva).
// El criterio del plan se evalúa sobre la variante → SPY, que es la que corresponde a la
// Capa C. La de caja se reporta al lado para no esconder que existe.
const gateOn = (d) => corrRegime(d) !== "high" && stateByDate.get(d) !== false;
const gatedCurve = curve((d) => (gateOn(d) ? basketsAt(d)?.top : null));
const gatedCashCurve = (() => {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const d of dates) {
    const held = (gateOn(d) ? basketsAt(d)?.top : null) || [];
    const rowMap = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const rs = held.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null);
    const r = rs.length ? mean(rs) : 0;                    // sin cesta → caja (0%)
    const set = new Set(held); let ch = 0; for (const t of set) if (!prev.has(t)) ch++;
    const net = r - (set.size ? ch / set.size : 0) * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = set;
  }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 };
})();
// > 0 = el gate MEJORA (drawdown menos profundo) · < 0 = lo EMPEORA.
const ddCut = topCurve.maxDD !== 0 ? (1 - gatedCurve.maxDD / topCurve.maxDD) * 100 : null;
const ddCutCash = topCurve.maxDD !== 0 ? (1 - gatedCashCurve.maxDD / topCurve.maxDD) * 100 : null;

console.log(`\n  ${"cartera".padEnd(30)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}`);
const line = (n, s) => console.log(`  ${n.padEnd(30)}${("+" + s.total.toFixed(0) + "%").padStart(9)}${(s.cagr.toFixed(1) + "%").padStart(8)}${s.sharpe.toFixed(2).padStart(8)}${(s.maxDD.toFixed(1) + "%").padStart(8)}`);
line("SPY comprar y mantener", spyStat);
line("Decil top · 12-1m simple", mom12Curve);
line("Decil top · COMPUESTO", topCurve);
line("Decil top · COMPUESTO + gate→SPY", gatedCurve);
line("Decil top · COMPUESTO + gate→caja", gatedCashCurve);
console.log(`\n  spread medio top−bottom (bruto, 1M): ${mean(spreads) >= 0 ? "+" : ""}${mean(spreads).toFixed(2)}pp/mes · ${spreads.length} meses`);
console.log(`  el gate estuvo ABIERTO ${dates.filter(gateOn).length}/${dates.length} meses`);
const ddWord = (v) => (v == null ? "n/a" : v >= 0 ? `MEJORA el maxDD un ${v.toFixed(0)}%` : `EMPEORA el maxDD un ${Math.abs(v).toFixed(0)}%`);
console.log(`  gate→SPY: ${ddWord(ddCut)} · gate→caja: ${ddWord(ddCutCash)}`);

// Diagnóstico (NO es criterio de aceptación — los criterios se escribieron antes de correr
// esto y no se tocan): ¿el compuesto bate al MEJOR componente suelto? Si no, lo honesto es
// publicar el componente suelto y tirar el compuesto a la basura.
const singles = COMPONENTS.map((k) => [k, icTable[k].fwd1.ic]).sort((a, b) => b[1] - a[1]);
const [bestName, bestIc] = singles[0];
const beatsBest = icTable.COMPOSITE.fwd1.ic > bestIc;
console.log(`\n  diagnóstico · mejor componente suelto: ${bestName} (IC ${bestIc >= 0 ? "+" : ""}${bestIc.toFixed(4)}) · el compuesto ${beatsBest ? "LO BATE" : "NO lo bate"} (${icTable.COMPOSITE.fwd1.ic.toFixed(4)})`);
if (!beatsBest) console.log(`    → si esto se repite en el run completo, la lectura honesta es publicar "${bestName}" solo y no montar el compuesto.`);

// ── 5. walk-forward: mitades + año natural ───────────────────────────────────────
const half = Math.floor(dates.length / 2);
const firstHalf = new Set(dates.slice(0, half)), secondHalf = new Set(dates.slice(half));
const icH1 = icOf(byComposite, "fwd1", (d) => firstHalf.has(d));
const icH2 = icOf(byComposite, "fwd1", (d) => secondHalf.has(d));
const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
const icByYear = {};
for (const y of years) { const r = icOf(byComposite, "fwd1", (d) => d.startsWith(y)); if (r.n >= 6) icByYear[y] = fx(r.ic); }
console.log(`\n  walk-forward · 1ª mitad (${dates[0]}→${dates[half - 1]}): IC ${icH1.ic >= 0 ? "+" : ""}${icH1.ic.toFixed(4)}  ·  2ª mitad (${dates[half]}→${dates.at(-1)}): IC ${icH2.ic >= 0 ? "+" : ""}${icH2.ic.toFixed(4)}`);
console.log(`  IC por año: ${Object.entries(icByYear).map(([y, v]) => `${y} ${v >= 0 ? "+" : ""}${v}`).join(" · ")}`);

// ── veredicto contra los criterios ESCRITOS ANTES de ver los números ─────────────
const c1 = icTable.COMPOSITE.fwd1.ic > icTable.mom12_1.fwd1.ic;
const c2 = icH1.ic > 0.03 && icH2.ic > 0.03;
const c3 = mean(spreads) > 0 && topCurve.total > mom12Curve.total;
const c4 = ddCut != null && ddCut >= 20;
const criteria = {
  "compuesto bate al 12-1m simple (IC)": c1,
  "IC > 0.03 en ambas mitades": c2,
  "spread de deciles positivo y curva ≥ 12-1m tras costes": c3,
  "el gate recorta el maxDD ≥20%": c4,
};
console.log(`\n  CRITERIOS DE ACEPTACIÓN (§7.9 del plan, escritos antes de correr esto):`);
for (const [k, v] of Object.entries(criteria)) console.log(`    ${v ? "✔" : "✖"}  ${k}`);
const passed = Object.values(criteria).filter(Boolean).length;
const verdict = passed === 4
  ? "CONSTRUIR — el compuesto y el gate se ganan su sitio en el score (F2/F3)."
  : passed >= 2
    ? "CONSTRUIR PARCIAL — se quedan los componentes con IC propio y la página /momentum como CONTEXTO; el compuesto NO entra en el score hasta que pase todo."
    : "NO CONSTRUIR el compuesto — recortar a percentiles sectoriales + revisiones de EPS + /momentum como contexto de mercado. El 12-1m actual se queda como está.";
console.log(`\n  VEREDICTO (${passed}/4): ${verdict}\n`);

const out = {
  generatedAt: new Date().toISOString(),
  universe: panels.size, requested: UNIVERSE.length, full: FULL,
  window: { start: dates[0], end: dates.at(-1), months: dates.length }, nameMonths: nm,
  costBps: COST_BPS, decile: DECILE, weights: WEIGHTS,
  corrTerciles: { low: fx(cLo), high: fx(cHi) },
  ic: Object.fromEntries(Object.entries(icTable).map(([k, v]) => [k, { fwd1: fx(v.fwd1.ic), fwd3: fx(v.fwd3.ic), hitRate: fx(v.fwd1.hit, 3), months: v.fwd1.n }])),
  icByRegime: icRegime,
  icWalkForward: { firstHalf: fx(icH1.ic), secondHalf: fx(icH2.ic), byYear: icByYear },
  portfolios: {
    spy: { total: fx(spyStat.total, 1), cagr: fx(spyStat.cagr, 2), sharpe: fx(spyStat.sharpe, 2), maxDD: fx(spyStat.maxDD, 1) },
    mom12_1_top: { total: fx(mom12Curve.total, 1), cagr: fx(mom12Curve.cagr, 2), sharpe: fx(mom12Curve.sharpe, 2), maxDD: fx(mom12Curve.maxDD, 1) },
    composite_top: { total: fx(topCurve.total, 1), cagr: fx(topCurve.cagr, 2), sharpe: fx(topCurve.sharpe, 2), maxDD: fx(topCurve.maxDD, 1) },
    composite_top_gated_spy: { total: fx(gatedCurve.total, 1), cagr: fx(gatedCurve.cagr, 2), sharpe: fx(gatedCurve.sharpe, 2), maxDD: fx(gatedCurve.maxDD, 1) },
    composite_top_gated_cash: { total: fx(gatedCashCurve.total, 1), cagr: fx(gatedCashCurve.cagr, 2), sharpe: fx(gatedCashCurve.sharpe, 2), maxDD: fx(gatedCashCurve.maxDD, 1) },
  },
  spreadTopMinusBottom: { meanPPPerMonth: fx(mean(spreads), 3), months: spreads.length },
  gate: { openMonths: dates.filter(gateOn).length, totalMonths: dates.length, maxDDImprovementPctToSpy: fx(ddCut, 1), maxDDImprovementPctToCash: fx(ddCutCash, 1) },
  diagnostics: { bestSingleComponent: bestName, bestSingleIC: fx(bestIc), compositeBeatsBestSingle: beatsBest, componentRanking: singles.map(([k, v]) => ({ component: k, ic: fx(v) })) },
  caveats: [
    FULL ? "universo = miembros del S&P 500 point-in-time (membresía histórica)" : "⚠ universo CURATED: 43 supervivientes de gran capitalización → SESGO DE SUPERVIVENCIA. Solo vale como smoke test.",
    "confirmación por volumen NO medida (prices.mjs no cachea volumen)",
    "z-scores sector-relativos NO aplicados: F0 combina por percentil de universo",
    "deciles sobre un universo pequeño = cestas de pocos nombres → ruido alto",
  ],
  criteria, passed, verdict,
};
const fname = FULL ? "momentum_lab.json" : "momentum_lab_smoke.json";
writeFileSync(join(OUT, fname), JSON.stringify(out, null, 2));
console.log(`  → escrito research/out/${fname}\n`);
