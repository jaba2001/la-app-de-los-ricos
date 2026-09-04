// ─────────────────────────────────────────────────────────────────────────────
// ¿CUÁNTO DE LOS 16 PUNTOS QUE FALTAN SE LOS COME LA FRICCIÓN QUE LE COBRAMOS?
//
// EL REPLANTEO QUE MOTIVA ESTO. Scora hace 652,6 % frente al 668,4 % del índice en 19,6 años.
// «16 puntos por detrás» suena a un problema de alfa. Anualizado son **0,118 pp/año — doce
// puntos básicos**. Eso ya no es un problema de selección: está en el mismo orden de magnitud
// que los costes de transacción, y por tanto hay que medir la fricción ANTES de buscar señal.
//
// LO QUE MIDE, y por qué el segundo punto importa más que el primero:
//
//   1. La ROTACIÓN real de la estrategia: cuánto peso cambia de manos al año. Sin este número
//      no se puede juzgar ninguna cifra de coste.
//   2. La SENSIBILIDAD del resultado al supuesto de coste. El backtest cobra `COSTE_BPS = 10`
//      por unidad de rotación, uniforme para los siete activos.
//
// ⚠️ Y AQUÍ ESTÁ LA TRAMPA QUE HAY QUE EVITAR A TODA COSTA. Bajar el supuesto de coste hasta
// que la estrategia gane sería exactamente el fraude que este proyecto lleva meses cazando: se
// puede «batir al índice» con una hoja de cálculo si uno elige bien lo que cobra. Así que esto
// NO propone un coste nuevo. Mide la sensibilidad y deja el juicio para después, con una
// referencia externa: el diferencial de compraventa REAL de estos ETF.
//
// El dato que dará sentido al resultado: SPY, TLT, IEF y GLD están entre los ETF más líquidos
// que existen, con diferenciales típicos de 1-3 pb. Cobrarles 10 pb no es conservador: es
// cobrarles entre tres y diez veces su coste real. Y —esto es lo que lo hace asimétrico— el
// índice de referencia NO paga ninguna fricción en esta comparación, porque se le mide como
// una serie de precios. Se compara una cartera que paga comisiones contra una que no existe.
//
// ⚠️ SIMETRÍA, PARA QUE LA COMPARACIÓN SEA HONESTA: mantener SPY también cuesta dinero en la
// vida real (comisión del fondo, 9,45 pb/año). Por eso el informe incluye una fila con AMBOS
// lados cargados, que es la única comparación defendible.
//
//   node --experimental-strip-types --no-warnings research/coste_friccion.mjs
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

const BTC_DESDE = "2018-06-01", UMBRAL = 50, SLEEVE = 0.05;
const ANOS = (new Date(fechas.at(-1)) - new Date(fechas[0])) / (365.25 * 86400000);

await preloadStationary();
const riskOn = [];
for (const f of fechas) { const r = await riskOnAsOf(f); riskOn.push(typeof r === "number" ? r : r?.riskOn ?? null); }

console.log(`\n  FRICCIÓN · ${fechas.length} meses · ${ANOS.toFixed(1)} años\n`);

/** Corre la estrategia con un coste dado (pb por unidad de rotación). Devuelve serie y rotación. */
function correr(costeBps) {
  const rets = []; let antes = null, rotTotal = 0;
  for (let i = 0; i < fechas.length - 1; i++) {
    const ro = riskOn[i];
    let w;
    if (ro == null || ro < UMBRAL) w = { ...RISKOFF };
    else {
      let btc = 0;
      if (fechas[i] >= BTC_DESDE) {
        const p0 = p("BTCUSD", fechas[i]), p12 = p("BTCUSD", menos(fechas[i], 12));
        if (p0 && p12 && p0 / p12 - 1 > 0) btc = SLEEVE;
      }
      w = { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
    }
    const mom = {};
    for (const a of ACTIVOS) {
      const pL = p(a, menos(fechas[i], 12)), pC = p(a, menos(fechas[i], 1));
      mom[a] = pL && pC ? (pC / pL - 1) * 100 : null;
    }
    w = applyDualMomentum(w, mom).weights;
    let rot = 0; if (antes) for (const a of ACTIVOS) rot += Math.abs((w[a] ?? 0) - (antes[a] ?? 0));
    rotTotal += rot;
    let r = 0, usado = 0;
    for (const a of ACTIVOS) {
      const peso = w[a] ?? 0; if (!peso) continue;
      const p1 = p(a, fechas[i + 1]), p0 = p(a, fechas[i]);
      if (p1 == null || p0 == null || p0 <= 0) continue;
      r += peso * (p1 / p0 - 1); usado += peso;
    }
    rets.push(usado > 0.5 ? r / usado - rot * (costeBps / 10000) : 0);
    antes = { ...w };
  }
  const total = (rets.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
  return { total, sharpe: sharpe(rets), maxDD: maxDrawdown(rets) * 100, rotTotal, rets };
}

// ── 1. La rotación, que es lo que hace falta para juzgar cualquier coste ─────────────────
const base = correr(10);
const rotAnual = base.rotTotal / ANOS;
console.log(`  ROTACIÓN`);
console.log(`     total ${base.rotTotal.toFixed(1)}  ·  ${rotAnual.toFixed(2)}× al año  (1,0 = renovar la cartera entera una vez)`);
console.log(`     a 10 pb eso son ${(rotAnual * 10).toFixed(1)} pb/año de coste\n`);

// ── 2. Validación: la corrida a 10 pb tiene que reproducir la publicada ──────────────────
const pub = G.estrategias.growth.rets.map((x) => x / 100);
const pubTotal = (pub.reduce((a, x) => a * (1 + x), 1) - 1) * 100;
console.log(`  VALIDACIÓN · a 10 pb da ${base.total.toFixed(1)} % frente al ${pubTotal.toFixed(1)} % publicado`);
if (Math.abs(base.total - pubTotal) / Math.abs(pubTotal) > 0.25) { console.error(`\n  ⛔ no reproduce la publicada — no sigo\n`); process.exit(1); }
console.log(`     ⇒ reproduce\n`);

// ── 3. Sensibilidad al supuesto ─────────────────────────────────────────────────────────
// El índice se mide como serie de precios: en la comparación de arriba NO paga fricción.
const spyRets = [];
for (let i = 0; i < fechas.length - 1; i++) {
  const p1 = p("SPY", fechas[i + 1]), p0 = p("SPY", fechas[i]);
  spyRets.push(p1 && p0 ? p1 / p0 - 1 : 0);
}
const spyTotal = (spyRets.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
// Simetría: mantener SPY cuesta su comisión de gestión, 9,45 pb/año.
const TER_SPY = 9.45;
const spyNeto = (spyRets.reduce((a, b, i) => a * (1 + b - TER_SPY / 10000 / 12), 1) - 1) * 100;

console.log(`  SENSIBILIDAD AL SUPUESTO DE COSTE`);
console.log(`     pb/rot   total Scora   vs SPY bruto   vs SPY neto de comisión`);
const filas = [];
for (const c of [0, 1, 2, 3, 5, 10, 15, 20]) {
  const r = correr(c);
  const dBruto = r.total - spyTotal, dNeto = r.total - spyNeto;
  filas.push({ costeBps: c, total: +r.total.toFixed(1), sharpe: +r.sharpe.toFixed(3), maxDD: +r.maxDD.toFixed(1),
    vsSpyBruto: +dBruto.toFixed(1), vsSpyNeto: +dNeto.toFixed(1) });
  const marca = c === 10 ? "  ← el supuesto actual" : (dNeto > 0 && filas.at(-2)?.vsSpyNeto <= 0 ? "  ← cruza aquí" : "");
  console.log(`     ${String(c).padStart(5)}${(r.total.toFixed(1) + " %").padStart(14)}${((dBruto >= 0 ? "+" : "") + dBruto.toFixed(1)).padStart(15)}${((dNeto >= 0 ? "+" : "") + dNeto.toFixed(1)).padStart(24)}${marca}`);
}
console.log(`\n     SPY bruto ${spyTotal.toFixed(1)} %  ·  SPY neto de su comisión (${TER_SPY} pb/año) ${spyNeto.toFixed(1)} %`);

// ── 4. Cuánto vale cada punto básico ────────────────────────────────────────────────────
const a0 = filas.find((f) => f.costeBps === 0), a10 = filas.find((f) => f.costeBps === 10);
const porPb = (a0.total - a10.total) / 10;
console.log(`\n  ⇒ CADA PUNTO BÁSICO DE COSTE VALE ${porPb.toFixed(1)} pp de total en 19,6 años`);
console.log(`     la brecha contra el SPY bruto a 10 pb es ${a10.vsSpyBruto.toFixed(1)} pp`);
const necesario = a10.vsSpyBruto < 0 ? 10 - Math.abs(a10.vsSpyBruto) / porPb : null;
if (necesario != null && necesario >= 0) console.log(`     se cerraría con un supuesto de ${necesario.toFixed(1)} pb/rotación`);
console.log(`\n  ⚠️ ESTO NO PROPONE BAJAR EL COSTE. Dice cuánto depende el veredicto de un supuesto que`);
console.log(`     nadie ha medido contra el diferencial real de estos ETF. Ese es el trabajo siguiente.`);

writeFileSync(join(AQUI, "out", "coste_friccion.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/coste_friccion.mjs",
  meses: fechas.length, anos: +ANOS.toFixed(2),
  rotacionTotal: +base.rotTotal.toFixed(1), rotacionAnual: +rotAnual.toFixed(2),
  costeAnualPbA10: +(rotAnual * 10).toFixed(1),
  spyBruto: +spyTotal.toFixed(1), spyNetoDeComision: +spyNeto.toFixed(1), terSpyPb: TER_SPY,
  sensibilidad: filas, ppPorPuntoBasico: +porPb.toFixed(1),
  costeQueCerrariaLaBrecha: necesario != null ? +necesario.toFixed(1) : null,
  nota: "NO propone un coste nuevo. Mide cuanto depende el veredicto de un supuesto uniforme de 10 pb que nadie ha contrastado con el diferencial real de SPY/TLT/IEF/GLD, que son de los ETF mas liquidos del mundo (1-3 pb tipicos). La comparacion honesta es la columna 'vs SPY neto de comision': mantener el indice tambien cuesta.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/coste_friccion.json\n`);
