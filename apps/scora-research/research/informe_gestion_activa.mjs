// ─────────────────────────────────────────────────────────────────────────────
// INFORME DE GESTIÓN ACTIVA — fases 1, 2 y 3 del plan, sobre la serie real
//
// Junta las cuatro cosas que se decidieron atacar:
//   A · temporización (Merton-Henriksson y Treynor-Mazuy con Newey-West)
//   B · la tasa libre de riesgo de verdad (TB3MS), no cero
//   C · atribución de Brinson por CATEGORÍA DE ACTIVO
//   D · el perfil defensivo medido como producto, no como nota al pie
//
// Todo sale de `research/out/growth_series.json`, que es la fase 0. Este fichero no vuelve a
// calcular ningún retorno: si lo hiciera habría dos implementaciones de la misma cosa y se
// separarían, que es como se publican dos verdades a la vez.
//
//   node --experimental-strip-types --no-warnings research/informe_gestion_activa.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { rfMensual } from "./tasaLibre.mjs";
import { riskReport, sharpe, sortino, m2, m2Alpha, captura, asimetria, curtosisExceso,
         correlacion, diferenciaSharpe, maxDrawdown } from "../lib/riskMetrics.ts";
import { mertonHenriksson, treynorMazuy } from "../lib/temporizacion.ts";
import { atribuir, encadenar, encadenarCarino } from "../lib/brinson.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const S = JSON.parse(readFileSync(join(OUT, "growth_series.json"), "utf8"));
const rf = (await rfMensual(S.fechas)).map((x) => (x == null ? 0 : x));
const sinRf = (await rfMensual(S.fechas)).filter((x) => x == null).length;
if (sinRf > 0) { console.error(`\n  ⛔ ${sinRf} meses sin tasa libre de riesgo. No se calcula nada encima.\n`); process.exit(1); }

const E = S.estrategias;
const exceso = (r) => r.map((x, i) => x - rf[i]);
const rfMedia = (rf.reduce((s, x) => s + x, 0) / rf.length) * 12;

console.log(`\n  INFORME DE GESTIÓN ACTIVA · ${S.fechas.length} meses ${S.fechas[0]}→${S.fechas.at(-1)}`);
console.log(`  Tasa libre de riesgo media (TB3MS): ${rfMedia.toFixed(2)} % anual — antes se usaba 0\n`);

// ── B + fase 1 · métricas con la tasa real ───────────────────────────────────────────────
const CARTERAS = [["growth", E.growth.rets], ["defensive", E.defensive.rets],
                  ["bench6040", E.bench6040.rets], ["spy", E.spy.rets]];
const metricas = {};
console.log(`  ${"".padEnd(11)}${"Sharpe0".padStart(9)}${"SharpeRf".padStart(10)}${"SortinoRf".padStart(11)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}${"M2".padStart(8)}${"M2alfa".padStart(8)}${"capt+".padStart(7)}${"capt-".padStart(7)}${"asim".padStart(7)}${"curt".padStart(7)}`);
for (const [n, r] of CARTERAS) {
  const e = exceso(r), eSpy = exceso(E.spy.rets);
  const m = {
    sharpeRf0: +sharpe(r, 0).toFixed(3),
    sharpe: +sharpe(e, 0).toFixed(3),
    sortino: +sortino(e, 0).toFixed(3),
    calmar: +riskReport(r).calmar.toFixed(2),
    maxDrawdown: +maxDrawdown(r).toFixed(1),
    m2: n === "spy" ? null : +m2(e, eSpy, 0).toFixed(2),
    m2Alpha: n === "spy" ? null : +m2Alpha(e, eSpy, 0).toFixed(2),
    capturaAlcista: n === "spy" ? null : captura(r, E.spy.rets, true),
    capturaBajista: n === "spy" ? null : captura(r, E.spy.rets, false),
    asimetria: +asimetria(r).toFixed(3),
    curtosisExceso: +curtosisExceso(r).toFixed(3),
    rhoConSpy: +correlacion(r, E.spy.rets).toFixed(3),
  };
  metricas[n] = m;
  const f = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
  console.log(`  ${n.padEnd(11)}${m.sharpeRf0.toFixed(3).padStart(9)}${m.sharpe.toFixed(3).padStart(10)}${m.sortino.toFixed(3).padStart(11)}${m.calmar.toFixed(2).padStart(8)}${(m.maxDrawdown + "%").padStart(8)}${f(m.m2).padStart(8)}${f(m.m2Alpha).padStart(8)}${f(m.capturaAlcista, 0).padStart(7)}${f(m.capturaBajista, 0).padStart(7)}${m.asimetria.toFixed(2).padStart(7)}${m.curtosisExceso.toFixed(2).padStart(7)}`);
}

// Significación de las diferencias de Sharpe, con la tasa real.
console.log(`\n  SIGNIFICACIÓN (Jobson-Korkie/Memmel, con tasa real):`);
const significacion = {};
for (const [c, cn] of [[E.growth.rets, "growth"], [E.defensive.rets, "defensive"]]) {
  for (const [b, bn] of [[E.spy.rets, "spy"], [E.bench6040.rets, "bench6040"]]) {
    const d = diferenciaSharpe(exceso(c), exceso(b));
    significacion[`${cn}_vs_${bn}`] = d;
    console.log(`    ${cn.padEnd(10)} vs ${bn.padEnd(10)} Δ ${String(d.diferencia).padStart(7)} · ρ ${d.rho} · t ${String(d.t).padStart(5)} → ${d.significativo ? "SIGNIFICATIVO" : "no"}`);
  }
}

// ── A · temporización, con Newey-West ────────────────────────────────────────────────────
console.log(`\n  TEMPORIZACIÓN (Newey-West; el alfa mide habilidad de SELECCIÓN, γ la de TIMING):`);
const temporizacion = {};
for (const [c, cn] of [[E.growth.rets, "growth"], [E.defensive.rets, "defensive"]]) {
  for (const [b, bn] of [[E.spy.rets, "spy"], [E.bench6040.rets, "bench6040"]]) {
    const mh = mertonHenriksson(c, b, rf), tm = treynorMazuy(c, b, rf);
    temporizacion[`${cn}_vs_${bn}`] = { mertonHenriksson: mh, treynorMazuy: tm };
    console.log(`    ${cn.padEnd(10)} vs ${bn.padEnd(10)} MH γ t=${String(mh.gammaT).padStart(5)} ${mh.significativo ? "SIG" : "no "} (β ${mh.betaBajista}→${mh.betaAlcista}) · TM γ t=${String(tm.gammaT).padStart(5)} ${tm.significativo ? "SIG" : "no "} · alfa t=${mh.alfaT}`);
  }
}

// ── C · Brinson por categoría de activo ──────────────────────────────────────────────────
// La referencia es el 60/40: 60 % renta variable (SPY) y 40 % duración (IEF). Para las clases
// que la referencia NO tiene, su retorno de clase es el del activo representativo — no tenerlas
// sigue siendo una decisión de asignación y hay que valorarla.
const CLASE = { SPY: "renta variable", TLT: "duracion", IEF: "duracion", GLD: "metales",
                DBC: "materias primas", BIL: "caja", BTCUSD: "cripto" };
const REPRESENTANTE = { "renta variable": "SPY", duracion: "IEF", metales: "GLD",
                        "materias primas": "DBC", caja: "BIL", cripto: "BTCUSD" };
const PESO_REF = { "renta variable": 0.6, duracion: 0.4 };

const periodos = [];
for (let i = 0; i < S.fechas.length; i++) {
  const w = E.growth.pesos[i], r = S.retornosActivo[i];
  const acc = {};
  for (const [t, clase] of Object.entries(CLASE)) {
    if (!acc[clase]) acc[clase] = { peso: 0, aporte: 0 };
    const wt = w[t] || 0;
    if (!wt) continue;
    const rt = r[t];
    if (rt == null) continue;                    // sin precio: no entra (ya lo vigila la fase 0)
    acc[clase].peso += wt;
    acc[clase].aporte += wt * rt;
  }
  const entradas = Object.keys(REPRESENTANTE).map((clase) => {
    const a = acc[clase] ?? { peso: 0, aporte: 0 };
    const rRef = r[REPRESENTANTE[clase]];
    return {
      categoria: clase,
      pesoCartera: a.peso,
      pesoReferencia: PESO_REF[clase] ?? 0,
      retornoCartera: a.peso > 0 ? a.aporte / a.peso : null,
      retornoReferencia: rRef ?? 0,
    };
  });
  periodos.push(atribuir(entradas, 1e-9));
}
const cadena = encadenar(periodos);
const carino = encadenarCarino(periodos);
console.log(`\n  ATRIBUCIÓN DE BRINSON por categoría de activo, contra el 60/40 (${cadena.periodos} meses):`);
console.log(`    los ${cadena.periodos} periodos cuadran individualmente: ${cadena.todosCuadran ? "✓ SÍ" : "✗ NO"}`);
console.log(`    asignación (CUÁNTO en cada clase) : ${cadena.asignacion >= 0 ? "+" : ""}${cadena.asignacion.toFixed(1)} pp`);
console.log(`    selección  (CUÁL dentro de la clase): ${cadena.seleccion >= 0 ? "+" : ""}${cadena.seleccion.toFixed(1)} pp`);
console.log(`    suma                                : ${(cadena.asignacion + cadena.seleccion).toFixed(1)} pp = retorno activo sumado ${cadena.retornoActivoSumado.toFixed(1)} pp`);
console.log(`
    ⚠️ La suma ARITMÉTICA no explica el compuesto: ${cadena.retornoActivoSumado.toFixed(1)} pp contra ${cadena.retornoActivoCompuesto.toFixed(1)} pp,`);
console.log(`       un residuo de ${cadena.residuoComposicion.toFixed(1)} pp. Con el encadenado de CARINO las contribuciones sí suman el compuesto:`);
console.log(`         asignación ${carino.asignacion >= 0 ? "+" : ""}${carino.asignacion.toFixed(1)} pp · selección ${carino.seleccion >= 0 ? "+" : ""}${carino.seleccion.toFixed(1)} pp` +
            ` = ${(carino.asignacion + carino.seleccion).toFixed(1)} pp (residuo ${carino.residuo.toExponential(1)})`);
console.log(`         reparto: ${(100 * carino.asignacion / (carino.asignacion + carino.seleccion)).toFixed(1)} % asignación · ${(100 * carino.seleccion / (carino.asignacion + carino.seleccion)).toFixed(1)} % selección`);

// Por clase, acumulado.
const porClase = {};
for (const p of periodos) for (const f of p.filas) {
  if (!porClase[f.categoria]) porClase[f.categoria] = { asignacion: 0, seleccion: 0, pesoMedio: 0 };
  porClase[f.categoria].asignacion += f.asignacion;
  porClase[f.categoria].seleccion += f.seleccion;
  porClase[f.categoria].pesoMedio += f.pesoCartera / periodos.length;
}
console.log(`\n    ${"clase".padEnd(18)}${"peso medio".padStart(12)}${"asignación".padStart(13)}${"selección".padStart(12)}`);
for (const [c, v] of Object.entries(porClase).sort((a, b) => b[1].asignacion - a[1].asignacion)) {
  console.log(`    ${c.padEnd(18)}${(100 * v.pesoMedio).toFixed(1).padStart(11)}%${v.asignacion.toFixed(1).padStart(13)}${v.seleccion.toFixed(1).padStart(12)}`);
}

writeFileSync(join(OUT, "informe_gestion_activa.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  ventana: { desde: S.fechas[0], hasta: S.fechas.at(-1), meses: S.fechas.length },
  tasaLibreRiesgo: { fuente: "FRED TB3MS (letras 3 meses, mensual)", mediaAnual: +rfMedia.toFixed(3),
    nota: "Antes se usaba 0 en todas las metricas publicadas. Con la tasa real el Sharpe de growth pasa de 1,01 a 0,87." },
  metricas, significacion, temporizacion,
  brinson: { referencia: "60/40 (SPY 60 % / IEF 40 %)", convenio: "dos factores; la interaccion va en seleccion",
    ...cadena, carino, porClase },
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/informe_gestion_activa.json\n`);
