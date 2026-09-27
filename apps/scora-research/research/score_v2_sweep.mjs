// ─────────────────────────────────────────────────────────────────────────────
// BARRIDO DE NEUTRALIZACIÓN SECTORIAL — la prueba que faltaba.
//
// La primera validación comparó dos extremos: bandas absolutas (nada de sector) contra
// percentiles puramente sectoriales (sólo sector). Ganó el primero, y la explicación fue
// que neutralizar del todo borra el alfa sectorial. Pero de ahí NO se sigue que el sector
// no aporte nada: entre 0 y 1 hay un continuo que nadie había mirado.
//
// λ mezcla el percentil dentro del sector con el percentil contra todo el mercado:
//    λ=0 → sólo mercado (pero ya en escala de percentiles, no de bandas)
//    λ=1 → sólo sector (lo que se probó y falló)
//
// Comparación PAREADA por trimestre contra el score v1 de producción, que es el listón.
// Y con la advertencia de A10 puesta desde el principio: barrer 6 valores de λ son 6
// contrastes, así que el mejor de la tabla está sesgado al alza por selección. Por eso se
// reporta también el λ óptimo en la PRIMERA MITAD de la muestra y qué hace en la SEGUNDA:
// si el ganador in-sample no aguanta fuera, es ruido con buena pinta.
//
//   node --experimental-strip-types --no-warnings research/score_v2_sweep.mjs [--cap 400]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";
import { fwdReturn } from "./prices.mjs";
import { calcScores } from "../lib/scoring.ts";
import { addMonths, monthStarts, mean, std, fx, spearman } from "./momentumSignals.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const CAP = Number(arg("--cap", "400"));
const COST_BPS = 10;
const LAMBDAS = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1];

const histFile = join(OUT, "factor_dist_history.json");
if (!existsSync(histFile)) { console.error("  ✖ falta factor_dist_history.json"); process.exit(1); }
const HIST = JSON.parse(readFileSync(histFile, "utf8")).history;
const HIST_DATES = Object.keys(HIST).sort();
const distAsOf = (fecha) => { let e = null; for (const d of HIST_DATES) { if (d <= fecha) e = d; else break; } return e ? HIST[e] : null; };

const today = new Date().toISOString().slice(0, 10);
const fechas = monthStarts(arg("--from", "2019-01-01"), addMonths(today, -2)).filter((_, i) => i % 3 === 0);
const table = await loadSP500Historical();
console.log(`\n  BARRIDO DE NEUTRALIZACIÓN · λ ∈ {${LAMBDAS.join(", ")}} · ${fechas.length} trimestres\n`);

const sectorCache = new Map();
const porFecha = new Map();
for (const fecha of fechas) {
  const dist = distAsOf(fecha);
  if (!dist) continue;
  const miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
  // ⚠️ NO truncar: `membersAsOf` devuelve los tickers EN ORDEN ALFABÉTICO, así que un
  // slice(0, N) borraba sistemáticamente de la S a la Z — 99 nombres en 2020, entre ellos
  // UnitedHealth, Visa, Walmart, Exxon, Verizon y Wells Fargo. Un universo truncado por la
  // inicial no es "el S&P 500". Si hace falta limitar por coste, se limita por FRECUENCIA
  // de pertenencia (como los labs de momentum), nunca por orden alfabético.
  if (CAP > 0 && miembros.length > CAP) {
    console.log(`  ⚠ CAP=${CAP} ignorado: truncar por orden alfabético sesgaría el universo. Usando los ${miembros.length} miembros.`);
  }
  const filas = await collectRows(miembros, fecha, sectorCache);
  const bucket = [];
  for (const f of filas) {
    const inputs = { ...f.m, sector: f.sector };
    const fwd3 = await fwdReturn(f.ticker, fecha, addMonths(fecha, 3));
    if (fwd3 == null) continue;
    const row = { t: f.ticker, fwd3, v1: calcScores(inputs).total };
    for (const L of LAMBDAS) row[`L${L}`] = calcScores(inputs, dist, L).total;
    bucket.push(row);
  }
  if (bucket.length >= 30) porFecha.set(fecha, bucket);
}
const fechasOk = [...porFecha.keys()];
console.log(`  ${fechasOk.length} trimestres con datos\n`);

const tOf = (a) => { const s = std(a); return s ? mean(a) / (s / Math.sqrt(a.length)) : null; };
function icDe(key, subset = fechasOk) {
  const out = [];
  for (const f of subset) {
    const b = porFecha.get(f);
    const s = spearman(b.map((r) => r[key]), b.map((r) => r.fwd3));
    if (s != null) out.push(s);
  }
  return out;
}
function curva(key, subset = fechasOk) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const f of subset) {
    const b = porFecha.get(f);
    const n = Math.max(1, Math.floor(b.length / 10));
    const held = [...b].sort((x, y) => y[key] - x[key]).slice(0, n);
    const r = mean(held.map((x) => x.fwd3));
    const set = new Set(held.map((x) => x.t));
    let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    const net = r - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = set;
  }
  const años = (subset.length * 3) / 12;
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 1 / años) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(4) : 0 };
}

// Universo equiponderado: el listón honesto (mismo universo, mismo sesgo, sin seleccionar).
const ew = (() => {
  let eq = 1; const rets = [];
  for (const f of fechasOk) { const r = mean(porFecha.get(f).map((x) => x.fwd3)); rets.push(r); eq *= 1 + r / 100; }
  return { total: (eq - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(4) : 0 };
})();

const icV1 = icDe("v1"), cV1 = curva("v1");
console.log(`  ${"".padEnd(22)}${"IC".padStart(9)}${"t vs v1".padStart(9)}${"decil top".padStart(11)}${"vs EW".padStart(9)}${"Sharpe".padStart(8)}`);
console.log(`  ${"universo EW".padEnd(22)}${"—".padStart(9)}${"—".padStart(9)}${("+" + ew.total.toFixed(0) + "%").padStart(11)}${"—".padStart(9)}${ew.sharpe.toFixed(2).padStart(8)}`);
console.log(`  ${"v1 bandas (producción)".padEnd(22)}${(mean(icV1) >= 0 ? "+" : "") + mean(icV1).toFixed(4)}${"—".padStart(9)}${("+" + cV1.total.toFixed(0) + "%").padStart(11)}${(((cV1.total - ew.total) >= 0 ? "+" : "") + (cV1.total - ew.total).toFixed(0) + "pp").padStart(9)}${cV1.sharpe.toFixed(2).padStart(8)}`);

const filas = [];
for (const L of LAMBDAS) {
  const key = `L${L}`;
  const ic = icDe(key), c = curva(key);
  const dif = ic.map((x, i) => x - icV1[i]);
  const t = tOf(dif);
  filas.push({ lambda: L, ic: mean(ic), tVsV1: t, total: c.total, sharpe: c.sharpe, vsEW: c.total - ew.total });
  console.log(`  ${("λ=" + L + (L === 1 ? " (sólo sector)" : L === 0 ? " (sólo mercado)" : "")).padEnd(22)}${(mean(ic) >= 0 ? "+" : "") + mean(ic).toFixed(4)}${(t ?? 0).toFixed(2).padStart(9)}${("+" + c.total.toFixed(0) + "%").padStart(11)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}`);
}

// ── ¿el mejor λ aguanta fuera de muestra? ────────────────────────────────────────
const mitad = Math.floor(fechasOk.length / 2);
const h1 = fechasOk.slice(0, mitad), h2 = fechasOk.slice(mitad);
let mejorH1 = null, mejorIcH1 = -Infinity;
for (const L of LAMBDAS) { const m = mean(icDe(`L${L}`, h1)); if (m > mejorIcH1) { mejorIcH1 = m; mejorH1 = L; } }
const icH2Mejor = mean(icDe(`L${mejorH1}`, h2));
const icH2V1 = mean(icDe("v1", h2));
console.log(`\n  ── ¿aguanta fuera de muestra? ──`);
console.log(`  mejor λ en la 1ª mitad: ${mejorH1} (IC ${mejorIcH1.toFixed(4)})`);
console.log(`  ese mismo λ en la 2ª mitad: IC ${icH2Mejor.toFixed(4)}   ·   v1 en la 2ª mitad: ${icH2V1.toFixed(4)}`);
const aguanta = icH2Mejor > icH2V1;
console.log(`  → ${aguanta ? "SÍ: el λ elegido en la primera mitad sigue batiendo a v1 en la segunda." : "NO: el λ ganador in-sample no sobrevive fuera de muestra — era selección, no señal."}`);

const mejor = filas.slice().sort((a, b) => b.ic - a.ic)[0];
const alguno = filas.some((f) => Math.abs(f.tVsV1 ?? 0) > 1.96 && f.ic > mean(icV1));
console.log(`\n  ${LAMBDAS.length} valores de λ probados → con ${LAMBDAS.length} contrastes, P(alguno p<0,05 por azar) ≈ ${((1 - Math.pow(0.95, LAMBDAS.length)) * 100).toFixed(0)}%`);
const veredicto = alguno && aguanta
  ? `USAR λ=${mejorH1}: bate a v1 con significancia y aguanta fuera de muestra.`
  : aguanta
    ? `λ=${mejorH1} apunta en la dirección buena y aguanta fuera de muestra, pero sin significancia. Candidato, no conclusión.`
    : "NINGÚN λ mejora a v1 de forma sostenible. La neutralización sectorial —total o parcial— no aporta al score en esta ventana.";
console.log(`\n  VEREDICTO: ${veredicto}\n`);

writeFileSync(join(OUT, "score_v2_sweep.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), quarters: fechasOk.length, lambdas: LAMBDAS,
  universeEW: { total: fx(ew.total, 1), sharpe: fx(ew.sharpe, 2) },
  v1: { ic: fx(mean(icV1)), total: fx(cV1.total, 1), sharpe: fx(cV1.sharpe, 2), vsEW: fx(cV1.total - ew.total, 1) },
  sweep: filas.map((f) => ({ lambda: f.lambda, ic: fx(f.ic), tVsV1: fx(f.tVsV1, 2), total: fx(f.total, 1), sharpe: fx(f.sharpe, 2), vsEW: fx(f.vsEW, 1) })),
  outOfSample: { bestLambdaFirstHalf: mejorH1, icFirstHalf: fx(mejorIcH1), icSecondHalf: fx(icH2Mejor), v1SecondHalf: fx(icH2V1), holds: aguanta },
  multipleComparisons: { contrasts: LAMBDAS.length, familywise: fx(1 - Math.pow(0.95, LAMBDAS.length), 3) },
  verdict: veredicto,
}, null, 2));
console.log(`  → escrito research/out/score_v2_sweep.json\n`);
