// ─────────────────────────────────────────────────────────────────────────────
// LABORATORIO DEL UNIVERSO AMPLIADO
//
// Mide si dejar que el micro elija DENTRO de cada clase mejora al allocator de producción, que
// sólo puede elegir entre siete cosas. El macro no se toca: los mismos pesos de régimen, los
// mismos regímenes, la misma pasarela de momento absoluto.
//
// HIPÓTESIS PREESPECIFICADA (ensayo 344, escrita antes de correr):
//
//   El universo ampliado mejora el perfil ajustado al riesgo del allocator.
//
//   CRITERIO, fijado ahora y no movible después: se adopta sólo si **Sharpe Y Calmar mejoran
//   los DOS, y en las DOS mitades de la muestra** (2007-2016 y 2017-2026). Cumplir una sola
//   cosa, o cumplirlas sólo en una mitad, es «no concluyente» y se escribe así.
//
//   PREDICCIÓN: el retorno sube (más sitios donde estar) pero el Sharpe mejora poco, porque en
//   risk-on el allocator ya está ~100 % en renta variable y ampliar esa clase cambia QUÉ bolsa,
//   no CUÁNTA. Si el Sharpe subiera mucho, sospechar de la fecha de alta de algún activo antes
//   de celebrarlo.
//
//   Se miden k=1 y k=2 y SE PUBLICAN LOS DOS, gane el que gane.
//
//   node --experimental-strip-types --no-warnings research/universo_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { growthWeights } from "./allocate.mjs";
import { riskReport, correlacion, m2, m2Alpha, captura, asimetria, curtosisExceso, diferenciaSharpe } from "../lib/riskMetrics.ts";
import { CLASES, PESO_A_CLASE, tickersAmpliados, mejoresDeClase } from "./universo_ampliado.mjs";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-06-01";   // BIL existe desde 2007-05-30
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const o = []; let d = from.slice(0, 8) + "01"; while (d <= to) { o.push(d); d = addMonths(d, 1); } return o; };
const END = process.env.BT_END || addMonths(new Date().toISOString().slice(0, 10), -1);
const dates = monthStarts(START, END);

// El universo completo: los 7 de producción más todo lo que la ampliación puede tocar.
const BASE = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
const TODOS = [...new Set([...BASE, ...tickersAmpliados()])];
// Fecha de alta declarada, por ticker (de CLASES). Lo que no está declarado no se limita.
const DESDE = {};
for (const def of Object.values(CLASES)) for (const m of def.miembros) DESDE[m.t] = m.desde;

console.log(`\n  UNIVERSO AMPLIADO · ${dates.length} meses ${dates[0]}→${dates.at(-1)} · ${TODOS.length} activos (producción: ${BASE.length})`);
await preloadStationary();

const cF = new Map(), cM = new Map();
async function fwd1(a, d) {
  if (DESDE[a] && d < DESDE[a]) return null;
  const k = a + d; if (!cF.has(k)) cF.set(k, await fwdReturn(a, d, addMonths(d, 1))); return cF.get(k);
}
async function mom(a, d) {
  if (DESDE[a] && addMonths(d, -12) < DESDE[a]) return null;
  const k = a + d; if (!cM.has(k)) cM.set(k, await fwdReturn(a, addMonths(d, -12), addMonths(d, -1))); return cM.get(k);
}

/**
 * Reparte los pesos de producción entre los mejores de cada clase.
 *
 * ⚠️ Un presupuesto que no se puede colocar —porque ningún miembro de la clase existe aún o
 * ninguno tiene momento— va a CAJA, no se redistribuye entre las demás clases. Redistribuirlo
 * cambiaría la exposición que el régimen decidió, que es justo lo que este experimento NO toca.
 */
function repartir(base, fecha, momentos, k) {
  const w = {};
  const add = (t, x) => { w[t] = (w[t] || 0) + x; };
  for (const [activo, peso] of Object.entries(base)) {
    if (!peso) continue;
    const clase = PESO_A_CLASE[activo];
    if (!clase) { add(activo, peso); continue; }          // el sleeve de BTC no se reparte
    const elegidos = mejoresDeClase(clase, fecha, momentos, k);
    if (!elegidos.length) { add("BIL", peso); continue; }
    for (const e of elegidos) add(e, peso / elegidos.length);
  }
  return w;
}

/** Momento absoluto, generalizado a todo el universo: lo que no bate a cero se va a caja. */
function pasarelaAbsoluta(w, momentos) {
  const out = { ...w };
  for (const t of Object.keys(out)) {
    if (t === "BIL" || t === "SHV" || t === "IEF") continue;     // refugios, como en producción
    const m = momentos[t];
    if (m != null && m <= 0) { out.BIL = (out.BIL || 0) + out[t]; out[t] = 0; }
  }
  return out;
}

async function run(paso) {
  const rets = [], pesos = [], elegidosPorMes = []; let prev = {};
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const momentos = {};
    for (const t of TODOS) momentos[t] = await mom(t, date);
    const w = paso(date, macro, momentos);
    let gross = 0;
    for (const [t, wt] of Object.entries(w)) {
      if (!wt) continue;
      const r = await fwd1(t, date);
      if (r == null) continue;
      gross += wt * r;
    }
    let turn = 0;
    for (const t of new Set([...Object.keys(w), ...Object.keys(prev)])) turn += Math.abs((w[t] || 0) - (prev[t] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100);
    pesos.push(Object.fromEntries(Object.entries(w).filter(([, x]) => x > 0.0001).map(([t, x]) => [t, +x.toFixed(4)])));
    elegidosPorMes.push(Object.keys(w).filter((t) => w[t] > 0.0001));
    prev = w;
  }
  return { rets, pesos, elegidosPorMes };
}

// ── Las tres corridas ────────────────────────────────────────────────────────────────────
const pasoProduccion = (date, macro, momentos) =>
  pasarelaAbsoluta(growthWeights(macro.risk_on, momentos.BTCUSD), momentos);
const pasoAmpliado = (k) => (date, macro, momentos) =>
  pasarelaAbsoluta(repartir(growthWeights(macro.risk_on, momentos.BTCUSD), date, momentos, k), momentos);
const pasoSPY = () => ({ SPY: 1 });

const prod = await run(pasoProduccion);
const amp1 = await run(pasoAmpliado(1));
const amp2 = await run(pasoAmpliado(2));
// ⚠️ AÑADIDO DESPUES de ver fallar k=1 y k=2, y por tanto EXPLORATORIO, no preespecificado.
// Se etiqueta asi a proposito. Es ademas la lectura fiel de la peticion original —"toma
// TODOS los activos"—: en vez de que el momento ELIJA uno por clase, se tienen TODOS los
// miembros de la clase a partes iguales. Es una hipotesis distinta: diversificar, no
// seleccionar.
const ampAll = await run(pasoAmpliado(99));
const spy = await run(pasoSPY);

const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };
const mitad = Math.floor(dates.length / 2);
const linea = (nombre, r) => {
  const rep = riskReport(r, spy.rets);
  const a = riskReport(r.slice(0, mitad), spy.rets.slice(0, mitad));
  const b = riskReport(r.slice(mitad), spy.rets.slice(mitad));
  console.log(`  ${nombre.padEnd(24)}${("+" + tot(r).toFixed(0) + "%").padStart(8)}${String(rep.sharpe).padStart(8)}${String(rep.calmar).padStart(8)}${(rep.maxDrawdown + "%").padStart(8)}` +
              `${String(a.sharpe).padStart(9)}${String(a.calmar).padStart(8)}${String(b.sharpe).padStart(9)}${String(b.calmar).padStart(8)}`);
  return { rep, mitad1: a, mitad2: b, total: +tot(r).toFixed(1) };
};

console.log(`\n  ${"".padEnd(24)}${"total".padStart(8)}${"Sharpe".padStart(8)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}${"Sh 1ª½".padStart(9)}${"Cal 1ª".padStart(8)}${"Sh 2ª½".padStart(9)}${"Cal 2ª".padStart(8)}`);
const rProd = linea("Producción (7 activos)", prod.rets);
const rAmp1 = linea(`Ampliado k=1 (${TODOS.length})`, amp1.rets);
const rAmp2 = linea(`Ampliado k=2 (${TODOS.length})`, amp2.rets);
const rAmpAll = linea("Ampliado TODOS (exploratorio)", ampAll.rets);
const rSpy = linea("SPY", spy.rets);

// ── El criterio, aplicado tal cual se escribió ───────────────────────────────────────────
const cumple = (r) =>
  r.rep.sharpe > rProd.rep.sharpe && r.rep.calmar > rProd.rep.calmar &&
  r.mitad1.sharpe > rProd.mitad1.sharpe && r.mitad1.calmar > rProd.mitad1.calmar &&
  r.mitad2.sharpe > rProd.mitad2.sharpe && r.mitad2.calmar > rProd.mitad2.calmar;

console.log(`\n  CRITERIO (Sharpe Y Calmar mejores, en las DOS mitades):`);
for (const [n, r] of [["k=1", rAmp1], ["k=2", rAmp2], ["todos (exploratorio)", rAmpAll]]) {
  console.log(`    ${n}: ${cumple(r) ? "✅ SE CUMPLE" : "❌ no se cumple"}`);
}

// Significación de la mejor diferencia de Sharpe frente a producción.
for (const [n, r, s] of [["k=1", rAmp1, amp1], ["k=2", rAmp2, amp2], ["todos", rAmpAll, ampAll]]) {
  const d = diferenciaSharpe(s.rets, prod.rets);
  console.log(`    ${n} vs producción: ΔSharpe ${d.diferencia} · ρ ${d.rho} · t ${d.t} → ${d.significativo ? "significativo" : "NO significativo"}`);
}

// ── Qué elige de verdad, que es la pregunta original ─────────────────────────────────────
const cuenta = {};
for (const mes of amp1.elegidosPorMes) for (const t of mes) cuenta[t] = (cuenta[t] || 0) + 1;
console.log(`\n  QUÉ ELIGE (k=1, meses en cartera de ${dates.length}):`);
console.log("    " + Object.entries(cuenta).sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${t}:${n}`).join("  "));

const nuevos = Object.keys(cuenta).filter((t) => !BASE.includes(t));
console.log(`\n  Activos NUEVOS que llegó a tener: ${nuevos.length ? nuevos.join(" ") : "ninguno"}`);

writeFileSync(join(OUT, "universo_lab.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: dates.length, ventana: { desde: dates[0], hasta: dates.at(-1) },
  hipotesis: "El universo ampliado mejora el perfil ajustado al riesgo. CRITERIO: Sharpe Y Calmar mejores que producción en las DOS mitades. Ensayo 344, preespecificado.",
  universo: { produccion: BASE, ampliado: TODOS },
  resultados: { produccion: rProd, ampliadoK1: rAmp1, ampliadoK2: rAmp2, ampliadoTodos: rAmpAll, spy: rSpy },
  criterio: { k1: cumple(rAmp1), k2: cumple(rAmp2), todos: cumple(rAmpAll), notaTodos: "EXPLORATORIO: añadido tras ver fallar k=1 y k=2, no preespecificado" },
  significacion: {
    k1: diferenciaSharpe(amp1.rets, prod.rets), k2: diferenciaSharpe(amp2.rets, prod.rets),
  },
  mesesEnCartera: cuenta,
  metricasFase1: {
    produccion: { m2: +m2(prod.rets, spy.rets).toFixed(2), m2Alpha: +m2Alpha(prod.rets, spy.rets).toFixed(2),
      capturaAlcista: captura(prod.rets, spy.rets, true), capturaBajista: captura(prod.rets, spy.rets, false),
      asimetria: +asimetria(prod.rets).toFixed(3), curtosis: +curtosisExceso(prod.rets).toFixed(3),
      rhoConIndice: +correlacion(prod.rets, spy.rets).toFixed(3) },
    ampliadoK1: { m2: +m2(amp1.rets, spy.rets).toFixed(2), m2Alpha: +m2Alpha(amp1.rets, spy.rets).toFixed(2),
      capturaAlcista: captura(amp1.rets, spy.rets, true), capturaBajista: captura(amp1.rets, spy.rets, false),
      asimetria: +asimetria(amp1.rets).toFixed(3), curtosis: +curtosisExceso(amp1.rets).toFixed(3),
      rhoConIndice: +correlacion(amp1.rets, spy.rets).toFixed(3) },
  },
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/universo_lab.json\n`);
