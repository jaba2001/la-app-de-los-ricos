// ─────────────────────────────────────────────────────────────────────────────
// GROWTH METRICS (2026-07-11) — measures the EXACT production Growth path (the real
// allocate.mjs growthWeights + applyDualMomentum + 5% BTC sleeve) over the full record
// and computes the full institutional risk report (lib/riskMetrics.ts) vs the S&P 500 —
// the evidence for Plan A's risk-adjusted claim. One code path: no re-implementation.
// BTC contributes 0 before it exists (~2018) and up to 5% (trend-gated) after. Run:
//   node --experimental-strip-types --no-warnings research/growth_metrics.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, blendWeights, applyDualMomentum, riskParity } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const COST_BPS = 10;
const START = process.env.BT_START || "2007-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const today = new Date().toISOString().slice(0, 10);
const END = process.env.BT_END || addMonths(today, -1);
const dates = monthStarts(START, END);
console.log(`\n  GROWTH METRICS · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)} · production path (with 5% BTC sleeve)`);
await preloadStationary();

/**
 * DESDE CUÁNDO SE PUEDE TENER CADA ACTIVO — una decisión declarada, no un accidente del caché.
 *
 * ⚠️ **ESTO ESTABA IMPLÍCITO Y CASI PUBLICA UN NÚMERO INFLADO.** La cabecera decía «BTC contributes
 * 0 before it exists (~2018)», pero nada lo imponía: la fecha real de arranque de BTC era **la que
 * el fichero de caché resultara tener**. Al restaurar la historia de precios el 2026-09-03, BTCUSD
 * pasó de empezar en 2018-06 a **2014-09**, y como en ese tramo bitcoin hizo ~35×, el mismo código
 * pasó de **+637 % a +740 %** sin que se tocara una sola regla. La ganancia venía de un periodo en
 * el que un particular no podía tener bitcoin en su bróker.
 *
 * Se fija en 2018-06 porque es cuando el sleeve se declara invertible; cambiarla es una decisión
 * de producto que hay que tomar a la vista, no un efecto secundario de refrescar precios.
 */
const DISPONIBLE_DESDE = { BTCUSD: "2018-06-01" };

const fCache = new Map();
async function fwd1(a, d) {
  if (DISPONIBLE_DESDE[a] && d < DISPONIBLE_DESDE[a]) return null;
  const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k);
}
async function mom(a, d) {
  // El momento a 12 meses necesita que el activo ya fuera invertible al PRINCIPIO de la ventana.
  if (DISPONIBLE_DESDE[a] && addMonths(d, -12) < DISPONIBLE_DESDE[a]) return null;
  return fwdReturn(a, addMonths(d, -12), addMonths(d, -1));
}

/**
 * Run one strategy step(date, macro) → weights.
 *
 * Returns `{ rets, pesos, rotacion }`:
 *   · `rets`     the monthly NET-of-cost return series (percent), which is what every metric uses
 *   · `pesos`    the weight vector actually held each month — needed for Brinson attribution
 *   · `rotacion` one-way turnover each month
 *
 * ⚠️ ANTES SÓLO DEVOLVÍA `rets`, Y LA SERIE NO SE GUARDABA EN NINGUNA PARTE. El artefacto eran
 * 1 KB de agregados: las cifras canónicas (Sharpe 1,00, maxDD −16,2) existían, pero la serie que
 * las produjo no. Sin ella no hay M², ni Sortino recalculable, ni correlación, ni regresión de
 * temporización, ni atribución — o sea, ninguna de las comprobaciones que el claim necesita.
 *
 * ⚠️ Y EL COSTE SE APLICA AQUÍ DENTRO. Lo que se persiste tiene que ser el retorno NETO; guardar
 * el bruto inflaría todas las métricas de golpe y en silencio.
 */
async function run(step, etiqueta = "?") {
  const rets = [], pesos = [], rotacion = []; let prev = {};
  // ⚠️ UN PRECIO QUE FALTA NO ES UN MES PLANO. `if (r == null) continue` deja el activo fuera del
  // retorno de ese mes sin decir nada, así que una serie truncada produce meses a 0 % en vez de
  // un error. Se cuenta y se comprueba abajo — ver la nota de `faltantes`.
  const faltan = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  const conPeso = Object.fromEntries(ASSETS.map((a) => [a, 0]));
  for (const date of dates) {
    const macro = await regimeStationaryAsOf(date);
    const w = await step(date, macro);
    let gross = 0;
    for (const a of ASSETS) {
      const wa = w[a] || 0; if (!wa) continue;
      conPeso[a]++;
      const r = await fwd1(a, date);
      if (r == null) { faltan[a]++; continue; }
      gross += wa * r;
    }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100);
    pesos.push(Object.fromEntries(ASSETS.map((a) => [a, +(w[a] || 0).toFixed(6)])));
    rotacion.push(+(turn / 2).toFixed(6));
    prev = w;
  }
  return { rets, pesos, rotacion, faltan, conPeso, etiqueta };
}

/**
 * Comprueba que los precios cubren la ventana pedida.
 *
 * ⚠️ **ESTO EXISTE POR UN INCIDENTE REAL, y de los caros.** El 2026-09-01 el caché de `SPY` se
 * sobrescribió con una serie que empezaba en **2018-06** en vez de 2006 —`PX_FROM` vale
 * `"2018-06-01"` por defecto en `prices.mjs`, así que cualquier script que refresque un símbolo
 * sin fijarla le recorta la historia—. Como `run()` se saltaba los meses sin precio, **los 36
 * meses de la crisis de 2008 se convirtieron en meses planos** y el backtest publicó:
 *
 *     SPY +218 % con maxDD −23,9 %   (lo real: +652 % con −50,7 %)
 *     Growth +222 % Sharpe 0,75      (lo canónico: +637 % Sharpe 1,00)
 *
 * Ningún test falló. Los agregados eran internamente consistentes y la serie reproducía sus
 * propias métricas: la comprobación de la fase 0 pasaba en verde con datos falsos. Sólo se vio
 * porque un drawdown de −23,9 % para el S&P 500 en una ventana que incluye 2008 **es imposible**,
 * y eso hay que saberlo de antes.
 *
 * La lección: comprobar la COBERTURA en el punto de uso, donde se conoce la ventana que hace
 * falta. El guardián de `prices.mjs` protege de acortar una caché válida, pero no puede saber que
 * este backtest necesita empezar en 2007.
 */
/**
 * Huecos ACEPTADOS, con su motivo escrito y su impacto medido.
 *
 * «El activo aún no existía» y «el dato se ha perdido» producen el mismo `null` y son cosas
 * distintas: lo primero es un hecho del mundo, lo segundo un fallo. Sin esta lista habría que
 * elegir entre fallar por algo irreparable o callar los dos casos — y callar es lo que produjo el
 * incidente de SPY. Sin motivo escrito no entra nada aquí.
 */
const HUECOS_ACEPTADOS = new Map([
  ["defensive/BIL",
   "BIL empezó a cotizar el 2007-05-30: los 5 primeros meses de la ventana el ETF NO EXISTÍA. " +
   "Pesa ~8-9 % en este perfil y 0 % en `growth`, que es la ruta de producción, así que el claim " +
   "principal no está afectado. Esos meses la posición se comporta como caja al 0 %; las letras " +
   "rendían ~5 % en 2007, de modo que el perfil defensivo queda ~0,2 pp SUBESTIMADO en toda la " +
   "ventana — el sesgo es conservador, que es el lado correcto en el que equivocarse."],
]);

function comprobarCobertura(corridas) {
  const malas = [], aceptados = [];
  for (const c of corridas) {
    for (const a of ASSETS) {
      if (!c.conPeso[a]) continue;                       // nunca se tuvo: no aplica
      const pct = 100 * c.faltan[a] / c.conPeso[a];
      if (pct <= 2) continue;
      const clave = `${c.etiqueta}/${a}`;
      const linea = `${clave}: sin precio en ${c.faltan[a]} de ${c.conPeso[a]} meses con peso (${pct.toFixed(0)} %)`;
      if (HUECOS_ACEPTADOS.has(clave)) aceptados.push([linea, HUECOS_ACEPTADOS.get(clave)]);
      else malas.push(linea);
    }
  }
  for (const [linea, motivo] of aceptados) {
    console.log(`  ⓘ hueco aceptado · ${linea}`);
    console.log(`     ${motivo.replace(/(.{96})\s/g, "$1\n     ")}`);
  }
  if (malas.length) {
    console.error(`\n  ⛔ LOS PRECIOS NO CUBREN LA VENTANA ${dates[0]} → ${dates.at(-1)}:`);
    for (const m of malas) console.error(`     · ${m}`);
    console.error(`\n     Un mes sin precio NO es un mes plano: el resultado saldría creíble y falso.`);
    console.error(`     Restaura la historia con:  PX_FROM=2006-01-01 PX_REFRESH=1 node ... research/growth_metrics.mjs\n`);
    process.exit(1);
  }
}

// Production GROWTH: growthWeights(riskOn, btcMom) → applyDualMomentum (the exact live path).
const stepGrowth = async (date, macro) => {
  const btcM = await mom("BTCUSD", date);
  const base = growthWeights(macro.risk_on, btcM);
  const m = {}; for (const a of ASSETS) m[a] = await mom(a, date);
  return applyDualMomentum(base, m).weights;
};
// Growth WITHOUT the BTC sleeve — to isolate the sleeve's contribution honestly.
const stepGrowthNoBtc = async (date, macro) => {
  const base = growthWeights(macro.risk_on, null);
  const m = {}; for (const a of ASSETS) m[a] = await mom(a, date);
  return applyDualMomentum(base, m).weights;
};
// DEFENSIVE profile: blend + dual-mom + risk-parity (the low-drawdown mandate).
const stepDefensive = async (date, macro) => {
  const base = blendWeights(macro.risk_on);
  const m = {}, v = {};
  for (const a of ASSETS) { m[a] = await mom(a, date); }
  const gated = applyDualMomentum(base, m).weights;
  return riskParity(gated, v); // no vols in this quick pass → weights unchanged (mean-inv guard)
};
const stepSPY = async () => ({ SPY: 1 });
const step6040 = async () => ({ SPY: 0.6, IEF: 0.4 });

const spyRun = await run(stepSPY, "spy");
const growthRun = await run(stepGrowth, "growth");
const growthNoBtcRun = await run(stepGrowthNoBtc, "growthNoBtc");
const defRun = await run(stepDefensive, "defensive");
const b6040Run = await run(step6040, "bench6040");

// Antes de calcular una sola métrica: ¿hay precios para toda la ventana?
comprobarCobertura([spyRun, growthRun, growthNoBtcRun, defRun, b6040Run]);

const spyR = spyRun.rets, growthR = growthRun.rets, growthNoBtcR = growthNoBtcRun.rets;
const defR = defRun.rets, b6040R = b6040Run.rets;

const rep = {
  growth: riskReport(growthR, spyR),
  growthNoBtc: riskReport(growthNoBtcR, spyR),
  defensive: riskReport(defR, spyR),
  bench6040: riskReport(b6040R, spyR),
  spy: riskReport(spyR),
};
const tot = (r) => { let e = 1; for (const x of r) e *= 1 + x / 100; return (e - 1) * 100; };

console.log(`\n  ${"strategy".padEnd(22)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"Sortino".padStart(9)}${"Calmar".padStart(8)}${"maxDD".padStart(8)}${"VaR95".padStart(8)}${"CVaR95".padStart(8)}${"α".padStart(7)}${"IR".padStart(6)}`);
const line = (name, r, total) => console.log(`  ${name.padEnd(22)}${("+" + total.toFixed(0) + "%").padStart(9)}${(r.cagr + "%").padStart(7)}${String(r.sharpe).padStart(8)}${String(r.sortino).padStart(9)}${String(r.calmar).padStart(8)}${(r.maxDrawdown + "%").padStart(8)}${(r.var95 + "%").padStart(8)}${(r.cvar95 + "%").padStart(8)}${String(r.alpha ?? "—").padStart(7)}${String(r.informationRatio ?? "—").padStart(6)}`);
line("Growth (+BTC)", rep.growth, tot(growthR));
line("Growth (no BTC)", rep.growthNoBtc, tot(growthNoBtcR));
line("Defensive", rep.defensive, tot(defR));
line("Static 60/40", rep.bench6040, tot(b6040R));
line("SPY buy & hold", rep.spy, tot(spyR));

const out = { generatedAt: new Date().toISOString(), months: dates.length, window: { start: START },
  totals: { growth: +tot(growthR).toFixed(1), growthNoBtc: +tot(growthNoBtcR).toFixed(1), defensive: +tot(defR).toFixed(1), bench6040: +tot(b6040R).toFixed(1), spy: +tot(spyR).toFixed(1) },
  report: rep };
const fname = process.env.BT_START ? `growth_metrics_${START}.json` : "growth_metrics.json";
writeFileSync(join(OUT, fname), JSON.stringify(out, null, 2));

// ── LA SERIE MENSUAL ─────────────────────────────────────────────────────────────────────
// Es la fase 0 del plan de gestión activa: sin serie no hay M², ni correlación, ni regresión de
// temporización, ni atribución. Se guarda aparte de los agregados porque pesa ~40× más y no todo
// el mundo la necesita.
const sname = process.env.BT_START ? `growth_series_${START}.json` : "growth_series.json";
const serie = {
  generatedAt: out.generatedAt,
  window: out.window, months: dates.length,
  unidades: "retornos MENSUALES en PORCENTAJE y NETOS de coste (COST_BPS=10 por lado, aplicado sobre la rotación de ida)",
  activos: ASSETS,
  fechas: dates,
  estrategias: {
    growth:      { rets: growthRun.rets,      pesos: growthRun.pesos,      rotacion: growthRun.rotacion },
    growthNoBtc: { rets: growthNoBtcRun.rets, pesos: growthNoBtcRun.pesos, rotacion: growthNoBtcRun.rotacion },
    defensive:   { rets: defRun.rets,         pesos: defRun.pesos,         rotacion: defRun.rotacion },
    bench6040:   { rets: b6040Run.rets,       pesos: b6040Run.pesos,       rotacion: b6040Run.rotacion },
    spy:         { rets: spyRun.rets,         pesos: spyRun.pesos,         rotacion: spyRun.rotacion },
  },
};
writeFileSync(join(OUT, sname), JSON.stringify(serie, null, 2));

// ⚠️ SE LEE DE VUELTA DEL DISCO Y SE RECALCULA. Comparar contra los arrays en memoria no probaría
// nada —son los mismos objetos—; lo que puede fallar es la SERIALIZACIÓN: pérdida de precisión,
// un `null` que se cuela, un orden alterado. Si la serie guardada no reproduce los agregados
// publicados, no es la serie que los produjo y todo lo que se construya encima será falso.
{
  const leida = JSON.parse(readFileSync(join(OUT, sname), "utf8"));
  const fallos = [];
  for (const [k, r] of Object.entries(leida.estrategias)) {
    if (r.rets.length !== dates.length) fallos.push(`${k}: ${r.rets.length} retornos para ${dates.length} meses`);
    if (r.pesos.length !== dates.length) fallos.push(`${k}: ${r.pesos.length} vectores de peso para ${dates.length} meses`);
    if (r.rets.some((x) => !Number.isFinite(x))) fallos.push(`${k}: hay retornos no finitos`);
    const rep2 = riskReport(r.rets, leida.estrategias.spy.rets);
    const esperado = rep[k];
    for (const campo of ["cagr", "sharpe", "sortino", "calmar", "maxDrawdown"]) {
      if (rep2[campo] !== esperado[campo]) fallos.push(`${k}.${campo}: releído ${rep2[campo]} ≠ publicado ${esperado[campo]}`);
    }
    const t2 = +tot(r.rets).toFixed(1);
    if (t2 !== out.totals[k]) fallos.push(`${k}.total: releído ${t2} ≠ publicado ${out.totals[k]}`);
    // Los pesos de una cartera larga sin apalancamiento suman ≤ 1 (el resto es implícitamente caja).
    const maxSuma = Math.max(...r.pesos.map((p) => Object.values(p).reduce((s, x) => s + x, 0)));
    if (maxSuma > 1.0001) fallos.push(`${k}: pesos que suman ${maxSuma.toFixed(4)} > 1`);
  }
  if (fallos.length) {
    console.error(`\n  ⛔ LA SERIE GUARDADA NO REPRODUCE LOS AGREGADOS PUBLICADOS:`);
    for (const f of fallos) console.error(`     · ${f}`);
    console.error(`     No se puede construir nada encima de ella.\n`);
    process.exit(1);
  }
  console.log(`  ✓ serie releída del disco: reproduce CAGR, Sharpe, Sortino, Calmar, maxDD y total de las 5 estrategias`);
}
console.log(`  → wrote research/out/${sname}  (${dates.length} meses × 5 estrategias × ${ASSETS.length} activos)`);
console.log(`\n  Risk-adjusted vs S&P 500: Growth Sharpe ${rep.growth.sharpe} / Sortino ${rep.growth.sortino} vs SPY ${rep.spy.sharpe} / ${rep.spy.sortino}; maxDD ${rep.growth.maxDrawdown}% vs ${rep.spy.maxDrawdown}%; Jensen α ${rep.growth.alpha}%/yr; IR ${rep.growth.informationRatio}.`);
console.log(`  → wrote research/out/${fname}\n`);
