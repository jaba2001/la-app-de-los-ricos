// ─────────────────────────────────────────────────────────────────────────────
// LA CADENCIA Y LA VENTANA DE LA PUERTA — dos palancas nunca tocadas
//
// Mismo método que `sensibilidad_asignador.mjs`, y por la misma razón: NO se busca el mejor
// valor, se mide **cuánto depende el resultado de que acertáramos**. Un barrido pregunta «¿cuál
// gana?»; esto pregunta «¿cuánto de lo publicado es la elección y cuánto la estrategia?».
//
// Dos palancas que nadie ha tocado y que están elegidas por convención, no por medición:
//
//   1. **LA CADENCIA.** Se rebalancea cada mes. ¿Por qué un mes? Si trimestral rinde igual,
//      estamos pagando rotación —10 pb por lado— por nada. Y si mensual es mucho mejor, la
//      estrategia depende de reaccionar rápido, que es una fragilidad distinta y hay que saberla.
//
//   2. **LA VENTANA DE LA PUERTA DE TENDENCIA.** El 12-1 es la convención académica (Jegadeesh-
//      Titman), no una medición sobre esta cartera. Es la pieza que, medida ayer, convierte una
//      caída del −52,9 % en una del −17,2 %: **es lo que más protege de todo el asignador**, y
//      su parámetro nunca se ha comprobado.
//
// ⚠️ NO GASTA ENSAYO Y NO SE PROPONE CAMBIAR NADA. Si sale que otra ventana rinde más, eso NO
// es una mejora: es una advertencia de que el resultado dependía de un número elegido a dedo.
//
//   node --experimental-strip-types --no-warnings research/sensibilidad_cadencia.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { riskOnAsOf, preloadStationary } from "./regimeStationary.mjs";
import { applyDualMomentum } from "./allocate.mjs";
import { sharpe, maxDrawdown } from "../lib/riskMetrics.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(AQUI, "out", "growth_series.json"), "utf8"));
if (!/PORCENTAJE/i.test(G.unidades ?? "")) { console.error("\n  ⛔ unidades no declaradas\n"); process.exit(1); }
const fechas = G.fechas;

const ALIAS = { BTCUSD: "BTC-USD" };
const cargar = (t) => {
  const n = ALIAS[t] ?? t;
  for (const p of [join(AQUI, ".cache", "px", n + ".json"), join(AQUI, ".cache", "px_long", n + ".json")])
    if (existsSync(p)) { try { return new Map(JSON.parse(readFileSync(p, "utf8")).map((o) => [o.date, o.adj ?? o.raw])); } catch { /* siguiente */ } }
  return null;
};
const ACTIVOS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
const PX = {}; for (const a of ACTIVOS) { const m = cargar(a); if (m) PX[a] = m; }
const p = (a, d) => { const m = PX[a]; if (!m) return null;
  for (let i = 0; i < 10; i++) { const k = new Date(new Date(d).getTime() - i * 86400000).toISOString().slice(0, 10); if (m.has(k)) return m.get(k); } return null; };
const menos = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - n); return x.toISOString().slice(0, 10); };

const BTC_DESDE = "2018-06-01", COSTE_BPS = 10, UMBRAL = 50, SLEEVE = 0.05;
// ⚠️ LA CESTA SE LEE DEL CODIGO DE PRODUCCION, NO SE COPIA. La primera version de estos dos
// analisis la escribio de memoria y la escribio MAL —TLT e IEF intercambiados, GLD 0,10 en vez
// de 0,15 y un 5 % de BIL que no existe— y **la validacion doble paso igual**: el total y la
// caida seguian cuadrando porque la puerta de tendencia domina el resultado. Dos numeros
// tampoco bastan para validar un modelo. Ahora se parsea del fichero: si alguien cambia la
// cesta, esto se entera o falla.
const FUENTE = readFileSync(join(AQUI, "allocate.mjs"), "utf8");
const M_RISKOFF = FUENTE.match(/const GROWTH_RISKOFF = (\{[^}]*\})/);
if (!M_RISKOFF) { console.error("  ⛔ no se encuentra GROWTH_RISKOFF en allocate.mjs"); process.exit(1); }
const RISKOFF = JSON.parse(M_RISKOFF[1].replace(/([A-Z]+):/g, '"$1":').replace(/,\s*\}/, "}"));


await preloadStationary();
const riskOn = [];
for (const f of fechas) { const r = await riskOnAsOf(f); riskOn.push(typeof r === "number" ? r : r?.riskOn ?? null); }
console.log(`\n  SENSIBILIDAD · cadencia y ventana de la puerta · ${fechas.length} meses\n`);

/** `cada` = rebalancear cada N meses. `ventLarga`/`ventCorta` = la puerta de tendencia. */
function correr({ cada = 1, ventLarga = 12, ventCorta = 1 } = {}) {
  const rets = []; let antes = null, w = null;
  for (let i = 0; i < fechas.length - 1; i++) {
    // ⚠️ ENTRE REBALANCEOS LOS PESOS SE MANTIENEN, no se recalculan. Recalcular y no operar
    // seria hacer trampa: mediria una cartera que reacciona sin pagar la rotacion.
    if (i % cada === 0 || w == null) {
      const ro = riskOn[i];
      if (ro == null || ro < UMBRAL) w = { ...RISKOFF };
      else {
        let btc = 0;
        if (fechas[i] >= BTC_DESDE && SLEEVE > 0) {
          const p0 = p("BTCUSD", fechas[i]), p12 = p("BTCUSD", menos(fechas[i], ventLarga));
          if (p0 && p12 && p0 / p12 - 1 > 0) btc = SLEEVE;
        }
        w = { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
      }
      const mom = {};
      for (const a of ACTIVOS) {
        const pL = p(a, menos(fechas[i], ventLarga)), pC = p(a, menos(fechas[i], ventCorta));
        mom[a] = pL && pC ? (pC / pL - 1) * 100 : null;
      }
      w = applyDualMomentum(w, mom).weights;
    }
    let rot = 0;
    if (antes) for (const a of ACTIVOS) rot += Math.abs((w[a] ?? 0) - (antes[a] ?? 0));
    const coste = rot * (COSTE_BPS / 10000);
    let r = 0, usado = 0;
    for (const a of ACTIVOS) {
      const peso = w[a] ?? 0; if (!peso) continue;
      const p1 = p(a, fechas[i + 1]), p0 = p(a, fechas[i]);
      if (p1 == null || p0 == null || p0 <= 0) continue;
      r += peso * (p1 / p0 - 1); usado += peso;
    }
    rets.push(usado > 0.5 ? r / usado - coste : 0);
    antes = { ...w };
  }
  const total = (rets.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
  // La rotacion media anual, para poder ver si la cadencia se paga sola.
  return { total, sharpe: sharpe(rets), maxDD: maxDrawdown(rets) * 100 };
}

// ── LA MISMA VALIDACIÓN DOBLE que ayer: total Y caída, o no se sigue ────────────────────
const base = correr();
const pub = G.estrategias.growth.rets.map((x) => x / 100);
const pubTotal = (pub.reduce((a, b) => a * (1 + b), 1) - 1) * 100, pubDD = maxDrawdown(pub) * 100;
console.log(`  VALIDACIÓN · con los valores de producción (mensual, 12-1):`);
console.log(`     total ${base.total.toFixed(1)} % vs ${pubTotal.toFixed(1)} % publicado   ·   caída ${base.maxDD.toFixed(1)} % vs ${pubDD.toFixed(1)} %`);
if (Math.abs(base.total - pubTotal) / Math.abs(pubTotal) > 0.25 || Math.abs(base.maxDD - pubDD) > 8) {
  console.error(`\n  ⛔ la reconstrucción no reproduce la estrategia publicada. Se para.\n`); process.exit(1);
}
console.log(`     ⇒ reproduce la estrategia publicada\n`);

// ── PALANCA 1 · la cadencia ─────────────────────────────────────────────────────────────
const CADENCIAS = [[1, "mensual (producción)"], [2, "bimestral"], [3, "trimestral"], [6, "semestral"], [12, "anual"]];
console.log(`  PALANCA 1 · CADENCIA DE REBALANCEO`);
console.log(`     cadencia                total      Sharpe   caída`);
const porCadencia = CADENCIAS.map(([c, n]) => { const r = correr({ cada: c }); return { cada: c, nombre: n, total: +r.total.toFixed(1), sharpe: +r.sharpe.toFixed(3), maxDD: +r.maxDD.toFixed(1) }; });
for (const r of porCadencia) console.log(`     ${r.nombre.padEnd(22)}${(r.total + " %").padStart(10)}   ${String(r.sharpe).padStart(6)}  ${(r.maxDD + " %").padStart(7)}`);
const mejorC = porCadencia.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
const dispC = (Math.max(...porCadencia.map((r) => r.total)) - Math.min(...porCadencia.map((r) => r.total))) / Math.abs(base.total) * 100;
console.log(`     mejor por Sharpe: ${mejorC.nombre} · dispersión ${dispC.toFixed(0)} % del resultado de producción`);

// ── PALANCA 2 · la ventana de la puerta de tendencia ────────────────────────────────────
const VENTANAS = [[3, 1], [6, 1], [9, 1], [12, 1], [18, 1], [24, 1], [12, 0]];
console.log(`\n  PALANCA 2 · VENTANA DE LA PUERTA DE TENDENCIA (producción = 12-1)`);
console.log(`     ventana        total      Sharpe   caída`);
const porVentana = VENTANAS.map(([L, C]) => { const r = correr({ ventLarga: L, ventCorta: C }); return { ventana: `${L}-${C}`, total: +r.total.toFixed(1), sharpe: +r.sharpe.toFixed(3), maxDD: +r.maxDD.toFixed(1) }; });
for (const r of porVentana) console.log(`     ${r.ventana.padEnd(12)}${(r.total + " %").padStart(11)}   ${String(r.sharpe).padStart(6)}  ${(r.maxDD + " %").padStart(7)}${r.ventana === "12-1" ? "   ← producción" : ""}`);
const mejorV = porVentana.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
const dispV = (Math.max(...porVentana.map((r) => r.total)) - Math.min(...porVentana.map((r) => r.total))) / Math.abs(base.total) * 100;

// ── EL VEREDICTO: ¿pico o meseta, en cada palanca? ──────────────────────────────────────
const cadEnPico = mejorC.cada === 1;
const venEnPico = mejorV.ventana === "12-1";
console.log(`\n  ⇒ VEREDICTO`);
console.log(`     CADENCIA: producción (mensual) ${cadEnPico ? "ES la mejor de la rejilla" : `NO es la mejor — gana ${mejorC.nombre}`}`);
console.log(`               dispersión ${dispC.toFixed(0)} %`);
console.log(`     VENTANA:  producción (12-1) ${venEnPico ? "ES la mejor de la rejilla" : `NO es la mejor — gana ${mejorV.ventana}`}`);
console.log(`               dispersión ${dispV.toFixed(0)} %`);
for (const [nombre, enPico, disp] of [["cadencia", cadEnPico, dispC], ["ventana", venEnPico, dispV]]) {
  if (enPico) console.log(`     ⚠️ La ${nombre} de producción es el máximo de su rejilla: firma de parámetro ajustado.`);
  else if (disp < 15) console.log(`     ✅ La ${nombre} está en meseta y la dispersión es baja (${disp.toFixed(0)} %): el resultado NO depende de haber acertado ese número.`);
  else console.log(`     ⚠️ La ${nombre} no está en el pico, pero la dispersión es ALTA (${disp.toFixed(0)} %): el número importa aunque no se eligiera el mejor.`);
}

writeFileSync(join(AQUI, "out", "sensibilidad_cadencia.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: fechas.length,
  validacion: { total: +base.total.toFixed(1), publicado: +pubTotal.toFixed(1), maxDD: +base.maxDD.toFixed(1), publicadoDD: +pubDD.toFixed(1) },
  porCadencia, porVentana, cadenciaEnPico: cadEnPico, ventanaEnPico: venEnPico,
  dispersionCadenciaPct: +dispC.toFixed(1), dispersionVentanaPct: +dispV.toFixed(1),
  nota: "NO es un barrido y no gasta ensayo: mide la FORMA de la superficie alrededor del ajuste actual. Si otra configuracion rinde mas, eso NO es una mejora — es una advertencia de que el resultado dependia de un numero elegido a dedo.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/sensibilidad_cadencia.json\n`);
