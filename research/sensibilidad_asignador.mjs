// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTÁ LA CONFIGURACIÓN ACTUAL EN EL PICO DE SU PROPIA REJILLA?
//
// Brinson dice que el 96 % de la ventaja de Scora está en la ASIGNACIÓN, y es lo que menos
// hemos atacado. Pero antes de barrer parámetros buscando algo mejor —que es como se sobreajusta
// una estrategia— hay una pregunta más barata y bastante más importante:
//
//   **¿Los valores que ya usamos son el MÁXIMO de su rejilla, o están en medio de una meseta?**
//
// La diferencia decide cómo hay que leer TODO lo publicado:
//   · Si el ajuste actual es el mejor de la rejilla, las cifras publicadas son optimistas por
//     construcción, aunque nadie barriera a propósito: alguien eligió ese número mirando datos.
//   · Si está en medio y la curva es plana, las cifras son robustas y se puede confiar en ellas.
//
// ⚠️ ESTO NO ES UN BARRIDO Y NO GASTA ENSAYO. No se busca el mejor valor ni se propone cambiar
// nada: se mide la FORMA de la superficie alrededor de donde ya estamos. Un barrido pregunta
// «¿cuál gana?»; esto pregunta «¿cuánto depende de que acertáramos?».
//
// La palanca principal del asignador de crecimiento está a la vista en `lib/allocation.ts`:
//
//     if (riskOn < 50) return { ...GROWTH_RISKOFF };
//
// Ese **50** es el parámetro. Se reutilizan las cestas de producción y se varía sólo ese número,
// más la manga de BTC (5 %), que es el otro valor elegido a mano.
//
//   node --experimental-strip-types --no-warnings research/sensibilidad_asignador.mjs
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
const px = (t) => {
  const n = ALIAS[t] ?? t;
  for (const p of [join(AQUI, ".cache", "px", n + ".json"), join(AQUI, ".cache", "px_long", n + ".json")])
    if (existsSync(p)) { try { return new Map(JSON.parse(readFileSync(p, "utf8")).map((o) => [o.date, o.adj ?? o.raw])); } catch { /* siguiente */ } }
  return null;
};
const ACTIVOS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
const PX = {}; for (const a of ACTIVOS) { const m = px(a); if (m) PX[a] = m; }
const enOAntes = (a, d) => { const m = PX[a]; if (!m) return null;
  for (let i = 0; i < 10; i++) { const k = new Date(new Date(d).getTime() - i * 86400000).toISOString().slice(0, 10); if (m.has(k)) return m.get(k); } return null; };

// La disponibilidad DECLARADA de BTC, no la que haya en cache.
const BTC_DESDE = "2018-06-01";
const COSTE_BPS = 10;

await preloadStationary();
console.log(`\n  SENSIBILIDAD DEL ASIGNADOR · ${fechas.length} meses\n`);

// La serie de riskOn, una sola vez: las variantes sólo cambian el UMBRAL, no el indicador.
const riskOn = [];
for (const f of fechas) { const r = await riskOnAsOf(f); riskOn.push(typeof r === "number" ? r : r?.riskOn ?? null); }
const validos = riskOn.filter((x) => x != null).length;
console.log(`  serie riskOn: ${validos}/${fechas.length} meses con valor · rango ${Math.min(...riskOn.filter((x) => x != null)).toFixed(0)}-${Math.max(...riskOn.filter((x) => x != null)).toFixed(0)}`);

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

/** Corre la estrategia con un umbral y una manga de BTC dados. Todo lo demas, igual. */
function correr(umbral, sleeve) {
  const rets = []; let antes = null;
  for (let i = 0; i < fechas.length - 1; i++) {
    const ro = riskOn[i];
    let w;
    if (ro == null) w = { ...RISKOFF };
    else if (ro < umbral) w = { ...RISKOFF };
    else {
      // 12-1 de BTC, la misma puerta que produccion, y solo desde su disponibilidad declarada.
      let btc = 0;
      if (fechas[i] >= BTC_DESDE && sleeve > 0) {
        const p0 = enOAntes("BTCUSD", fechas[i]);
        const d12 = new Date(fechas[i]); d12.setUTCMonth(d12.getUTCMonth() - 12);
        const p12 = enOAntes("BTCUSD", d12.toISOString().slice(0, 10));
        if (p0 && p12 && p0 / p12 - 1 > 0) btc = sleeve;
      }
      w = { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
    }
    // ⚠️ LA PUERTA DE TENDENCIA, QUE SE ME OLVIDABA Y LO CAMBIA TODO. Produccion es
    // growthWeights → applyDualMomentum: los activos con 12-1 negativo se van a liquidez. Sin
    // ella la caida maxima sale -52,9 % en vez de -17,2 %. Y mi validacion NO lo cazo porque
    // solo miraba el TOTAL, que coincidia por casualidad (645,9 frente a 652,6). Una validacion
    // de un solo numero deja pasar una estrategia completamente distinta.
    const momentos = {};
    for (const a of ACTIVOS) {
      const p0 = enOAntes(a, fechas[i]);
      const d12 = new Date(fechas[i]); d12.setUTCMonth(d12.getUTCMonth() - 12);
      const d1 = new Date(fechas[i]); d1.setUTCMonth(d1.getUTCMonth() - 1);
      const p12 = enOAntes(a, d12.toISOString().slice(0, 10)), p1 = enOAntes(a, d1.toISOString().slice(0, 10));
      momentos[a] = p12 && p1 ? (p1 / p12 - 1) * 100 : null;
    }
    w = applyDualMomentum(w, momentos).weights;
    // Rotacion a 10 pb por lado sobre el cambio de pesos.
    let rot = 0;
    if (antes) for (const a of ACTIVOS) rot += Math.abs((w[a] ?? 0) - (antes[a] ?? 0));
    const coste = (rot / 2) * 2 * (COSTE_BPS / 10000);
    let r = 0, usado = 0;
    for (const a of ACTIVOS) {
      const peso = w[a] ?? 0; if (!peso) continue;
      const p1 = enOAntes(a, fechas[i + 1]), p0 = enOAntes(a, fechas[i]);
      if (p1 == null || p0 == null || p0 <= 0) continue;
      r += peso * (p1 / p0 - 1); usado += peso;
    }
    rets.push(usado > 0.5 ? r / usado - coste : 0);
    antes = w;
  }
  const total = (rets.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
  return { total, sharpe: sharpe(rets), maxDD: maxDrawdown(rets) * 100, rets };
}

// ── VALIDACION: con los valores de PRODUCCION hay que reproducir la serie publicada ──────
const base = correr(50, 0.05);
const pub = G.estrategias.growth.rets.map((x) => x / 100);
const pubTotal = (pub.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
console.log(`\n  VALIDACIÓN · con umbral 50 y manga 5 % (los de producción):`);
console.log(`     reconstruido ${base.total.toFixed(1)} %   ·   publicado ${pubTotal.toFixed(1)} %   ·   diferencia ${(base.total - pubTotal).toFixed(1)} pp`);
// ⚠️ SE VALIDA EL TOTAL **Y** LA CAIDA. Con solo el total, esta reconstruccion pasaba mientras
// le faltaba la puerta de tendencia: el total coincidia por casualidad y la caida era -52,9 %
// contra -17,2 %. Una validacion de un numero no valida una estrategia.
const pubDD = maxDrawdown(pub) * 100;
console.log(`     caida reconstruida ${base.maxDD.toFixed(1)} %   ·   publicada ${pubDD.toFixed(1)} %`);
const fiable = Math.abs(base.total - pubTotal) / Math.max(1, Math.abs(pubTotal)) < 0.25
            && Math.abs(base.maxDD - pubDD) < 8;
if (!fiable) {
  console.error(`
  ⛔ la reconstruccion NO reproduce la estrategia publicada (total o caida).`);
  console.error(`     Se para: medir la sensibilidad de OTRA estrategia no informa de nada.
`);
  process.exit(1);
}
if (!fiable) {
  console.log(`     ⚠️ La reconstrucción NO reproduce la serie publicada de cerca. Los NIVELES de`);
  console.log(`        abajo no son comparables con lo publicado — pero la FORMA de la superficie`);
  console.log(`        (que es lo que se pregunta) sigue siendo informativa, porque todas las`);
  console.log(`        variantes comparten exactamente el mismo sesgo de reconstrucción.`);
}

// ── LA REJILLA, declarada antes de mirar ────────────────────────────────────────────────
const UMBRALES = [30, 35, 40, 45, 50, 55, 60, 65, 70];
const MANGAS = [0, 0.025, 0.05, 0.10];
console.log(`\n  LA FORMA DE LA SUPERFICIE · umbral del riskOn (producción = 50)`);
console.log(`     umbral    total      Sharpe   caída`);
const porUmbral = UMBRALES.map((u) => { const r = correr(u, 0.05); return { umbral: u, total: +r.total.toFixed(1), sharpe: +r.sharpe.toFixed(3), maxDD: +r.maxDD.toFixed(1) }; });
for (const r of porUmbral)
  console.log(`     ${String(r.umbral).padStart(6)}${(r.total + " %").padStart(11)}   ${String(r.sharpe).padStart(6)}  ${(r.maxDD + " %").padStart(7)}${r.umbral === 50 ? "   ← producción" : ""}`);

const mejorT = porUmbral.reduce((a, b) => (b.total > a.total ? b : a));
const mejorS = porUmbral.reduce((a, b) => (b.sharpe > a.sharpe ? b : a));
console.log(`\n     mejor por total:  umbral ${mejorT.umbral} (${mejorT.total} %)`);
console.log(`     mejor por Sharpe: umbral ${mejorS.umbral} (${mejorS.sharpe})`);

console.log(`\n  MANGA DE BTC (producción = 5 %)`);
const porManga = MANGAS.map((m) => { const r = correr(50, m); return { manga: m, total: +r.total.toFixed(1), sharpe: +r.sharpe.toFixed(3), maxDD: +r.maxDD.toFixed(1) }; });
for (const r of porManga)
  console.log(`     ${(r.manga * 100).toFixed(1).padStart(5)} %${(r.total + " %").padStart(11)}   ${String(r.sharpe).padStart(6)}  ${(r.maxDD + " %").padStart(7)}${r.manga === 0.05 ? "   ← producción" : ""}`);

// ── EL VEREDICTO: ¿pico o meseta? ───────────────────────────────────────────────────────
const enPico = mejorT.umbral === 50 || mejorS.umbral === 50;
const tot = porUmbral.map((r) => r.total);
const dispersion = (Math.max(...tot) - Math.min(...tot)) / Math.abs(porUmbral.find((r) => r.umbral === 50).total) * 100;
console.log(`\n  ⇒ VEREDICTO`);
console.log(`     el umbral de producción (50) ${enPico ? "ES EL MEJOR de la rejilla" : "NO es el mejor: está en la meseta"}`);
console.log(`     dispersión de la rejilla: ${dispersion.toFixed(0)} % del resultado de producción`);
if (enPico) {
  console.log(`     ⚠️ Que el valor de producción sea el máximo de su propia rejilla es la firma de un`);
  console.log(`        parámetro AJUSTADO, aunque nadie barriera a propósito. Las cifras publicadas`);
  console.log(`        heredan ese optimismo y hay que decirlo al publicarlas.`);
} else {
  console.log(`     ✅ El valor de producción NO es el máximo: no se eligió por ser el que más rendía.`);
  console.log(`        Eso es evidencia a favor de que las cifras publicadas no están infladas por ajuste.`);
}

writeFileSync(join(AQUI, "out", "sensibilidad_asignador.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: fechas.length,
  validacion: { reconstruido: +base.total.toFixed(1), publicado: +pubTotal.toFixed(1), fiable },
  porUmbral, porManga, mejorPorTotal: mejorT.umbral, mejorPorSharpe: mejorS.umbral,
  produccionEnPico: enPico, dispersionPct: +dispersion.toFixed(1),
  nota: "NO es un barrido y no gasta ensayo: no se busca el mejor valor sino la FORMA de la superficie alrededor del ajuste actual. Que produccion sea el maximo de su rejilla seria la firma de un parametro ajustado.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/sensibilidad_asignador.json\n`);
