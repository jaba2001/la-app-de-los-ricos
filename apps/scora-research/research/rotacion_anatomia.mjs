// ─────────────────────────────────────────────────────────────────────────────
// ¿DE DÓNDE SALEN LAS 3,45 VUELTAS DE CARTERA AL AÑO?
//
// POR QUÉ IMPORTA. La brecha contra el índice es de 0,118 pp/año. La rotación medida es de
// 3,45× al año, que al supuesto actual de 10 pb cuesta **34,5 pb/año**: el triple de la brecha
// entera. Así que dónde se genera esa rotación importa mucho más que cualquier señal nueva.
//
// LAS DOS PREGUNTAS, y la segunda es la que puede cambiar algo:
//
//   1. ¿QUÉ ACTIVO la genera? Si se concentra en uno caro de operar, el supuesto uniforme de
//      10 pb está mintiendo en la dirección que más duele.
//
//   2. ¿DE QUÉ TAMAÑO son los movimientos? Ésta es la importante. El backtest supone que cada
//      mes se vuelve EXACTAMENTE a los pesos objetivo, pagando comisión por cada micro-ajuste
//      de deriva. **Ninguna implementación real hace eso.** Cualquiera pone una banda de
//      no-operar: si el peso se ha ido tres décimas, no se toca. Si resulta que buena parte de
//      la rotación son ajustes minúsculos, entonces el coste que le cobramos no corresponde a
//      la estrategia sino a una forma de ejecutarla que nadie usaría.
//
// ⚠️ LA BANDA DE NO-OPERAR NO ES UN PARÁMETRO QUE SE BARRE. Aquí sólo se MIDE cuánta rotación
// cae por debajo de varios umbrales, que es un hecho descriptivo de la serie. Elegir una banda
// y volver a correr la estrategia con ella SÍ sería un ensayo, y no se hace en este guion.
// Este informe dice cuánto habría que ganar; no lo cobra.
//
//   node --experimental-strip-types --no-warnings research/rotacion_anatomia.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { riskOnAsOf, preloadStationary } from "./regimeStationary.mjs";
import { applyDualMomentum } from "./allocate.mjs";

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

console.log(`\n  ANATOMÍA DE LA ROTACIÓN · ${fechas.length} meses · ${ANOS.toFixed(1)} años\n`);

// Reconstruye los pesos mes a mes (idéntico a `coste_friccion.mjs`).
const pesos = [];
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
  pesos.push(applyDualMomentum(w, mom).weights);
}

// ── 1. Rotación por activo ──────────────────────────────────────────────────────────────
const porActivo = {}; for (const a of ACTIVOS) porActivo[a] = 0;
const movimientos = [];
let rotTotal = 0;
for (let i = 1; i < pesos.length; i++) {
  for (const a of ACTIVOS) {
    const d = Math.abs((pesos[i][a] ?? 0) - (pesos[i - 1][a] ?? 0));
    if (d > 1e-9) { porActivo[a] += d; rotTotal += d; movimientos.push({ activo: a, delta: d, fecha: fechas[i] }); }
  }
}
console.log(`  ROTACIÓN POR ACTIVO  (total ${rotTotal.toFixed(1)} · ${(rotTotal / ANOS).toFixed(2)}×/año)`);
const orden = Object.entries(porActivo).sort((a, b) => b[1] - a[1]);
for (const [a, v] of orden) if (v > 0.001)
  console.log(`     ${a.padEnd(8)}${v.toFixed(1).padStart(7)}   ${(v / rotTotal * 100).toFixed(1).padStart(5)} %   ${(v / ANOS).toFixed(2)}×/año`);

// ── 2. Distribución por TAMAÑO del movimiento ───────────────────────────────────────────
console.log(`\n  ¿DE QUÉ TAMAÑO SON LOS MOVIMIENTOS?  (${movimientos.length} ajustes individuales)`);
console.log(`     banda        nº      rotación   % del total   coste/año a 10 pb`);
const BANDAS = [0.005, 0.01, 0.02, 0.05, 0.10];
const acumulado = [];
for (const b of BANDAS) {
  const dentro = movimientos.filter((m) => m.delta < b);
  const rot = dentro.reduce((s, m) => s + m.delta, 0);
  acumulado.push({ banda: b, n: dentro.length, rotacion: +rot.toFixed(2), pct: +(rot / rotTotal * 100).toFixed(1), pbAno: +(rot / ANOS * 10).toFixed(1) });
  console.log(`     < ${(b * 100).toFixed(1).padStart(4)} %${String(dentro.length).padStart(7)}${rot.toFixed(2).padStart(13)}${(rot / rotTotal * 100).toFixed(1).padStart(12)} %${(rot / ANOS * 10).toFixed(1).padStart(16)} pb`);
}

// ── 3. Lo que eso significa contra la brecha ────────────────────────────────────────────
const BRECHA_PB_ANO = 11.8;
console.log(`\n  CONTRA LA BRECHA (${BRECHA_PB_ANO} pb/año):`);
for (const a of acumulado) {
  const cubre = a.pbAno / BRECHA_PB_ANO * 100;
  console.log(`     no operar por debajo del ${(a.banda * 100).toFixed(1)} % ahorraría ${a.pbAno} pb/año  →  ${cubre.toFixed(0)} % de la brecha`);
}

// ── 4. Control: ¿la rotación es regime-flip o deriva? ────────────────────────────────────
const grandes = movimientos.filter((m) => m.delta >= 0.10);
console.log(`\n  ⇒ ${grandes.length} movimientos grandes (≥10 %) generan ${(grandes.reduce((s, m) => s + m.delta, 0) / rotTotal * 100).toFixed(1)} % de la rotación`);
console.log(`     esos son los cambios de régimen, y NO se pueden evitar sin cambiar la estrategia.`);
console.log(`     el resto es deriva y micro-ajuste, que es donde una banda de no-operar actúa.`);

writeFileSync(join(AQUI, "out", "rotacion_anatomia.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/rotacion_anatomia.mjs",
  meses: fechas.length, anos: +ANOS.toFixed(2),
  rotacionTotal: +rotTotal.toFixed(2), rotacionAnual: +(rotTotal / ANOS).toFixed(2),
  porActivo: Object.fromEntries(orden.map(([a, v]) => [a, { rotacion: +v.toFixed(2), pct: +(v / rotTotal * 100).toFixed(1) }])),
  ajustes: movimientos.length, porBanda: acumulado,
  movimientosGrandes: grandes.length, pctRotacionDeGrandes: +(grandes.reduce((s, m) => s + m.delta, 0) / rotTotal * 100).toFixed(1),
  brechaPbAno: BRECHA_PB_ANO,
  nota: "Esto MIDE la distribucion de tamaños; no elige una banda ni vuelve a correr la estrategia con ella. Elegir una banda y remedir SI seria un ensayo del presupuesto. Los movimientos grandes son cambios de regimen y no se pueden evitar sin cambiar la estrategia.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/rotacion_anatomia.json\n`);
