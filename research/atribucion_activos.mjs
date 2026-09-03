// ─────────────────────────────────────────────────────────────────────────────
// ¿APORTA CADA UNO DE LOS SIETE ACTIVOS, O ALGUNO SÓLO AÑADE ROTACIÓN?
//
// Última palanca de la búsqueda por el lado de la asignación. Y es la única que se puede hacer
// sin barrer: **dejar fuera uno cada vez**. Siete corridas, cada una contestando una pregunta
// distinta —«¿qué aporta este activo?»— en vez de una rejilla buscando la mejor combinación.
//
// Probar subconjuntos sería 2⁷ = 128 combinaciones, o sea un barrido con otro nombre. Esto es
// atribución: no busca el mejor menú, mide la contribución de cada pieza al que ya hay.
//
// ⚠️ CUANDO SE QUITA UN ACTIVO, SU PESO SE REPARTE PROPORCIONALMENTE entre los que quedan, que
// es lo que pasaría si no existiera. No se manda a liquidez: eso sería otra estrategia.
//
// ⚠️ Y DOS CASOS QUE NO SON COMPARABLES CON LOS DEMÁS, y hay que leerlos aparte:
//   · **SPY** es el 100 % de la cesta de riesgo-on. Quitarlo no mide su aportación: destruye la
//     estrategia. Se corre igual porque el número informa del tamaño de la dependencia.
//   · **BIL** es adonde `applyDualMomentum` manda lo que corta. Sin BIL la puerta de tendencia
//     se queda sin destino, así que quitarlo mide la puerta, no el activo.
//
//   node --experimental-strip-types --no-warnings research/atribucion_activos.mjs
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
  for (const q of [join(AQUI, ".cache", "px", n + ".json"), join(AQUI, ".cache", "px_long", n + ".json")])
    if (existsSync(q)) { try { return new Map(JSON.parse(readFileSync(q, "utf8")).map((o) => [o.date, o.adj ?? o.raw])); } catch { /* siguiente */ } }
  return null;
};
const ACTIVOS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
const PX = {}; for (const a of ACTIVOS) { const m = cargar(a); if (m) PX[a] = m; }
const p = (a, d) => { const m = PX[a]; if (!m) return null;
  for (let i = 0; i < 10; i++) { const k = new Date(new Date(d).getTime() - i * 86400000).toISOString().slice(0, 10); if (m.has(k)) return m.get(k); } return null; };
const menos = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - n); return x.toISOString().slice(0, 10); };

const FUENTE = readFileSync(join(AQUI, "allocate.mjs"), "utf8");
const M = FUENTE.match(/const GROWTH_RISKOFF = (\{[^}]*\})/);
if (!M) { console.error("  ⛔ no se encuentra GROWTH_RISKOFF"); process.exit(1); }
const RISKOFF = JSON.parse(M[1].replace(/([A-Z]+):/g, '"$1":').replace(/,\s*\}/, "}"));

const BTC_DESDE = "2018-06-01", COSTE_BPS = 10, UMBRAL = 50, SLEEVE = 0.05;

await preloadStationary();
const riskOn = [];
for (const f of fechas) { const r = await riskOnAsOf(f); riskOn.push(typeof r === "number" ? r : r?.riskOn ?? null); }
console.log(`\n  ATRIBUCIÓN POR ACTIVO · dejar-fuera-uno · ${fechas.length} meses\n`);

/** `fuera` = activo excluido del menú (o null para el menú completo). */
function correr(fuera) {
  const menu = ACTIVOS.filter((a) => a !== fuera);
  const rets = []; let antes = null;
  for (let i = 0; i < fechas.length - 1; i++) {
    const ro = riskOn[i];
    let w;
    if (ro == null || ro < UMBRAL) w = { ...RISKOFF };
    else {
      let btc = 0;
      if (fechas[i] >= BTC_DESDE && fuera !== "BTCUSD") {
        const p0 = p("BTCUSD", fechas[i]), p12 = p("BTCUSD", menos(fechas[i], 12));
        if (p0 && p12 && p0 / p12 - 1 > 0) btc = SLEEVE;
      }
      w = { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
    }
    // El peso del excluido se REPARTE proporcionalmente: es lo que pasaria si no existiera.
    if (fuera) {
      const quitado = w[fuera] ?? 0; w = { ...w, [fuera]: 0 };
      const resto = menu.reduce((s, a) => s + (w[a] ?? 0), 0);
      if (quitado > 0 && resto > 0) for (const a of menu) w[a] = (w[a] ?? 0) * (1 + quitado / resto);
    }
    const mom = {};
    for (const a of menu) {
      const pL = p(a, menos(fechas[i], 12)), pC = p(a, menos(fechas[i], 1));
      mom[a] = pL && pC ? (pC / pL - 1) * 100 : null;
    }
    w = applyDualMomentum(w, mom).weights;
    // Si la puerta manda a un activo excluido, ese peso se queda sin destino: se anula.
    if (fuera) w = { ...w, [fuera]: 0 };
    let rot = 0; if (antes) for (const a of ACTIVOS) rot += Math.abs((w[a] ?? 0) - (antes[a] ?? 0));
    let r = 0, usado = 0;
    for (const a of menu) {
      const peso = w[a] ?? 0; if (!peso) continue;
      const p1 = p(a, fechas[i + 1]), p0 = p(a, fechas[i]);
      if (p1 == null || p0 == null || p0 <= 0) continue;
      r += peso * (p1 / p0 - 1); usado += peso;
    }
    rets.push(usado > 0.5 ? r / usado - rot * (COSTE_BPS / 10000) : 0);
    antes = { ...w };
  }
  const total = (rets.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
  const rotMedia = 0;
  return { total, sharpe: sharpe(rets), maxDD: maxDrawdown(rets) * 100, rotMedia };
}

const base = correr(null);
const pub = G.estrategias.growth.rets.map((x) => x / 100);
const pT = (pub.reduce((a, x) => a * (1 + x), 1) - 1) * 100, pD = maxDrawdown(pub) * 100;
console.log(`  VALIDACIÓN · total ${base.total.toFixed(1)} % vs ${pT.toFixed(1)} %  ·  caída ${base.maxDD.toFixed(1)} % vs ${pD.toFixed(1)} %`);
if (Math.abs(base.total - pT) / Math.abs(pT) > 0.25 || Math.abs(base.maxDD - pD) > 8) { console.error(`\n  ⛔ no reproduce la publicada\n`); process.exit(1); }
console.log(`     ⇒ reproduce la publicada\n`);

const APARTE = { SPY: "es el 100 % de la cesta de riesgo-on: quitarlo destruye la estrategia, no mide su aporte",
  BIL: "es adonde la puerta de tendencia manda lo que corta: sin él se mide la PUERTA, no el activo" };

console.log(`  SIN CADA UNO (el peso se reparte entre los que quedan)`);
console.log(`     activo     total      Δ total   Sharpe    Δ Sharpe   caída`);
const filas = [];
for (const a of ACTIVOS) {
  const r = correr(a);
  const dT = r.total - base.total, dS = r.sharpe - base.sharpe;
  filas.push({ activo: a, total: +r.total.toFixed(1), deltaTotal: +dT.toFixed(1), sharpe: +r.sharpe.toFixed(3), deltaSharpe: +dS.toFixed(3), maxDD: +r.maxDD.toFixed(1), aparte: APARTE[a] ?? null });
  console.log(`     ${a.padEnd(8)}${(r.total.toFixed(1) + " %").padStart(10)}  ${((dT >= 0 ? "+" : "") + dT.toFixed(1)).padStart(8)}   ${r.sharpe.toFixed(3).padStart(6)}   ${((dS >= 0 ? "+" : "") + dS.toFixed(3)).padStart(7)}  ${(r.maxDD.toFixed(1) + " %").padStart(8)}${APARTE[a] ? "   ⚠️ aparte" : ""}`);
}
console.log(`     ${"COMPLETO".padEnd(8)}${(base.total.toFixed(1) + " %").padStart(10)}         —   ${base.sharpe.toFixed(3).padStart(6)}         —  ${(base.maxDD.toFixed(1) + " %").padStart(8)}`);

console.log(`\n  ⚠️ DOS NO SON COMPARABLES CON LOS DEMÁS:`);
for (const [a, motivo] of Object.entries(APARTE)) console.log(`     ${a}: ${motivo}`);

// Los que de verdad se pueden juzgar: los cinco restantes.
const juzgables = filas.filter((f) => !f.aparte);
const noAportan = juzgables.filter((f) => f.deltaSharpe >= -0.005);
console.log(`\n  ⇒ DE LOS CINCO JUZGABLES (${juzgables.map((f) => f.activo).join(" ")}):`);
if (noAportan.length) {
  console.log(`     ${noAportan.length} NO aportan Sharpe — quitarlos no empeora:`);
  for (const f of noAportan) console.log(`       ${f.activo}: Sharpe ${f.sharpe} sin él frente a ${base.sharpe.toFixed(3)} con él   (total ${f.deltaTotal >= 0 ? "+" : ""}${f.deltaTotal} pp)`);
  console.log(`     Eso NO significa quitarlos: un activo que no aporta EN ESTA MUESTRA puede ser el`);
  console.log(`     que salve la siguiente crisis. Significa que la cartera no depende de ellos.`);
} else {
  console.log(`     los cinco aportan Sharpe: quitar cualquiera empeora la cartera`);
}
const masImporta = juzgables.reduce((a, b) => (b.deltaSharpe < a.deltaSharpe ? b : a));
console.log(`     el que más aporta: ${masImporta.activo} (sin él el Sharpe cae ${masImporta.deltaSharpe})`);

writeFileSync(join(AQUI, "out", "atribucion_activos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: fechas.length,
  completo: { total: +base.total.toFixed(1), sharpe: +base.sharpe.toFixed(3), maxDD: +base.maxDD.toFixed(1) },
  sinCadaUno: filas, noAportanSharpe: noAportan.map((f) => f.activo), masImporta: masImporta.activo,
  nota: "Dejar-fuera-uno es ATRIBUCION, no barrido: no busca el mejor menu. SPY y BIL no son comparables con los demas (SPY es toda la cesta de riesgo-on; BIL es el destino de la puerta de tendencia). Un activo que no aporta en esta muestra puede ser el que salve la proxima crisis.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/atribucion_activos.json\n`);
