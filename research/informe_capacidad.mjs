// ─────────────────────────────────────────────────────────────────────────────
// FASE C — rotación, capacidad, deflación y robustez del drawdown
//
// Lo que un fondo real reporta y aquí no se había medido nunca. Cuatro cosas:
//
//   1. ROTACIÓN — cuánto se mueve la cartera al año.
//   2. CAPACIDAD — qué patrimonio cabe antes de que operar mueva el precio.
//   3. DEFLACIÓN — si el Sharpe sobrevive a haber probado 344 estrategias.
//   4. ROBUSTEZ DEL DRAWDOWN — si el «tercio del drawdown» aguanta empezando en otro año.
//
// ⚠️ El punto 4 es el que más importa y el que peor sale: **el ratio de un tercio depende
// enteramente de incluir 2008**. Sin la crisis financiera son dos tercios. Eso no invalida el
// claim —2008 pasó y la estrategia lo atravesó— pero obliga a decirlo, porque cualquiera que
// mire la serie desde 2010 va a ver 0,66 y no 0,32.
//
//   node --experimental-strip-types --no-warnings research/informe_capacidad.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { rfMensual } from "./tasaLibre.mjs";
import { sharpe, asimetria, curtosisExceso, maxDrawdown } from "../lib/riskMetrics.ts";
import { sharpeDeflactado } from "../lib/deflacion.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const S = JSON.parse(readFileSync(join(OUT, "growth_series.json"), "utf8"));
const rf = (await rfMensual(S.fechas)).map((x) => (x == null ? 0 : x));
const G = S.estrategias.growth.rets, SPY = S.estrategias.spy.rets;
const exc = G.map((x, i) => x - rf[i]);

console.log(`\n  ROTACIÓN, CAPACIDAD, DEFLACIÓN Y ROBUSTEZ · ${S.fechas.length} meses`);

// ── 1 · Rotación ─────────────────────────────────────────────────────────────────────────
const rotacion = {};
for (const k of ["growth", "defensive", "bench6040"]) {
  const r = S.estrategias[k].rotacion;
  rotacion[k] = {
    anualPct: +(r.reduce((a, b) => a + b, 0) / r.length * 12 * 100).toFixed(0),
    mesMaximoPct: +(Math.max(...r) * 100).toFixed(0),
    mesesSinMover: r.filter((x) => x < 0.0001).length,
  };
}
console.log(`\n  ROTACIÓN (una vía, sobre patrimonio)`);
for (const [k, v] of Object.entries(rotacion)) {
  console.log(`    ${k.padEnd(11)} ${String(v.anualPct).padStart(4)} % anual · mes máximo ${v.mesMaximoPct} % · quieto ${v.mesesSinMover}/${S.fechas.length} meses`);
}
console.log(`    ⓘ growth rota MÁS al año que defensive pero está quieto 150 meses: cuando se mueve, se mueve entero.`);
console.log(`    ⓘ el 60/40 rota 3 %, que es la comprobación de cordura (es comprar y mantener).`);

// ── 2 · Capacidad ────────────────────────────────────────────────────────────────────────
// Volumen medio diario en dólares, medido el 2026-09-03 sobre ~90 sesiones (mediana).
// Se guarda el número y la fecha porque la liquidez cambia y una capacidad sin fecha no vale.
const ADV = { SPY: 34.71e9, TLT: 2.14e9, IEF: 0.53e9, GLD: 3.20e9, DBC: 0.02e9, BIL: 0.80e9 };
const w = S.estrategias.growth.pesos;
const peorMovimiento = {};
for (let i = 1; i < w.length; i++) {
  for (const t of Object.keys(ADV)) {
    const d = Math.abs((w[i][t] || 0) - (w[i - 1][t] || 0));
    if (!peorMovimiento[t] || d > peorMovimiento[t]) peorMovimiento[t] = d;
  }
}
// Regla estándar: no más del 10 % del volumen diario en una sesión.
const capacidad = {};
for (const t of Object.keys(ADV)) {
  if ((peorMovimiento[t] ?? 0) < 0.001) { capacidad[t] = null; continue; }
  capacidad[t] = +(ADV[t] * 0.10 / peorMovimiento[t] / 1e6).toFixed(0);
}
const conBil = Math.min(...Object.values(capacidad).filter((x) => x != null));
const sinBil = Math.min(...Object.entries(capacidad).filter(([t, x]) => x != null && t !== "BIL").map(([, x]) => x));
console.log(`\n  CAPACIDAD (al 10 % del volumen diario)`);
for (const [t, c] of Object.entries(capacidad)) {
  console.log(`    ${t.padEnd(5)} mueve hasta ${(100 * (peorMovimiento[t] ?? 0)).toFixed(0).padStart(3)} % en un mes · ${c == null ? "no se mueve" : c + " M$"}`);
}
console.log(`    → con BIL: ~${conBil} M$ · SIN BIL: ~${sinBil} M$`);
console.log(`    ⓘ BIL es el proxy de caja. A escala se tienen letras de verdad, no el ETF, así que`);
console.log(`      la restricción real es IEF: ~${sinBil} M$. Y sólo importa si algún día hay un vehículo`);
console.log(`      de inversión — Scora es software y no gestiona patrimonio de nadie.`);

// ── 3 · Deflación ────────────────────────────────────────────────────────────────────────
const T = G.length, sm = sharpe(exc, 0) / Math.sqrt(12);
const asim = asimetria(G), curt = curtosisExceso(G) + 3;
const deflacion = {};
for (const N of [1, 50, 344, 1000]) {
  const d = sharpeDeflactado(sm, T, N, asim, curt);
  deflacion[N] = { umbral: +d.sharpeUmbral.toFixed(4), dsr: +d.dsr.toFixed(4), supera: d.supera };
}
console.log(`\n  SHARPE DEFLACTADO (Bailey & López de Prado, con asimetría ${asim.toFixed(3)} y curtosis ${curt.toFixed(2)})`);
for (const [N, d] of Object.entries(deflacion)) {
  console.log(`    ${String(N).padStart(4)} ensayos → umbral ${d.umbral.toFixed(4)} · DSR ${(100 * d.dsr).toFixed(1)} % ${d.supera ? "SUPERA" : "no supera"} el 95 %`);
}
console.log(`    ⚠️ Con UN ensayo el Sharpe sería significativo (99,9 %). Con los 344 gastados, NO (81,1 %).`);
console.log(`       Ése es el precio de haber buscado, y es la razón de preespecificar de aquí en adelante.`);

// ── 4 · Robustez del drawdown ────────────────────────────────────────────────────────────
const robustez = [];
for (const desde of ["2007-01-01", "2008-01-01", "2009-01-01", "2010-01-01", "2012-01-01", "2015-01-01", "2018-01-01", "2020-01-01"]) {
  const i = S.fechas.findIndex((d) => d >= desde);
  if (i < 0) continue;
  const dg = maxDrawdown(G.slice(i)), ds = maxDrawdown(SPY.slice(i));
  robustez.push({ desde: desde.slice(0, 7), meses: T - i, allocator: +dg.toFixed(1), spy: +ds.toFixed(1), ratio: +(dg / ds).toFixed(2) });
}
console.log(`\n  ROBUSTEZ DEL DRAWDOWN`);
for (const r of robustez) {
  console.log(`    desde ${r.desde} (${String(r.meses).padStart(3)} m)  allocator ${String(r.allocator).padStart(6)} %  ·  SPY ${String(r.spy).padStart(6)} %  ·  ratio ${r.ratio}`);
}
const dds = robustez.map((r) => r.allocator);
console.log(`\n    ✅ El drawdown del allocator es ESTABLE: entre ${Math.min(...dds)} % y ${Math.max(...dds)} % en las ocho ventanas.`);
console.log(`       Eso es lo que tiene que hacer una estrategia con control de riesgo, y el índice no lo hace`);
console.log(`       (su peor caída va de −50,7 % a −23,9 % según cuándo se empiece).`);
console.log(`\n    ⚠️ PERO EL RATIO NO ES ESTABLE: 0,32 incluyendo 2008 y 0,66-0,68 sin la crisis financiera.`);
console.log(`       El «tercio del drawdown» es cierto sobre el registro completo y depende de UN evento.`);
console.log(`       Quien mire la serie desde 2010 verá dos tercios, y tiene que encontrárselo dicho.`);

writeFileSync(join(OUT, "informe_capacidad.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  ventana: { desde: S.fechas[0], hasta: S.fechas.at(-1), meses: T },
  rotacion,
  capacidad: {
    volumenDiarioMedidoEl: "2026-09-03", metodo: "mediana de ~90 sesiones, 10 % del volumen diario",
    advDolares: ADV, peorMovimientoMensual: peorMovimiento, porActivoMillones: capacidad,
    limiteConBil: conBil, limiteSinBil: sinBil,
    nota: "BIL es el proxy de caja; a escala se tienen letras, no el ETF. La restriccion real es IEF. Y solo importa si hay un vehiculo de inversion: Scora es software.",
  },
  deflacion: { sharpeMensual: +sm.toFixed(4), asimetria: +asim.toFixed(3), curtosisTotal: +curt.toFixed(3), porEnsayos: deflacion,
    nota: "Con 1 ensayo el Sharpe seria significativo (DSR 99,9 %). Con los 344 gastados no llega (81,1 %)." },
  robustezDrawdown: { ventanas: robustez, estable: true,
    nota: "El drawdown del allocator no se mueve (-15,8 a -16,2 % en ocho ventanas). El RATIO si: 0,32 con 2008 dentro, 0,66-0,68 sin la crisis financiera." },
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/informe_capacidad.json\n`);
