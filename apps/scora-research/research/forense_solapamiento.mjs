// ─────────────────────────────────────────────────────────────────────────────
// ¿DICE LA CONTABILIDAD FORENSE ALGO NUEVO? (requisito previo de la Fase F3)
//
// Antes de medir si una señal PREDICE, hay que medir si APORTA. Una señal muy correlacionada
// con la que ya usas no añade nada aunque funcione: estarías comprando lo mismo dos veces.
//
// Éste fue el número que justificó abrir la fase entera —**rho de Spearman −0,197** entre los
// devengos de Sloan y la señal de calidad de Picks—, y hasta el 24-08-2026 vivía sólo en un
// script de sesión. Un plan que se apoya en una cifra irreproducible no se apoya en nada.
//
// El resultado NO cambió con el veredicto de la Fase F3. Los devengos siguen trayendo
// información distinta; lo que se midió después es que esa información distinta **no predice**
// (ver `forense_veredicto.json`). Son dos preguntas separadas y conviene no confundirlas.
//
//   node --experimental-strip-types --no-warnings research/forense_solapamiento.mjs [--asof …]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";
import { metricasDe, percentilesDe } from "./picksSignal.mjs";
import { tickerToCik, fundamentalsAsOf } from "./edgar.mjs";
import { devengos, beneish, piotroski } from "./forenseSignal.mjs";
import { altmanZ } from "../lib/quality.ts";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/**
 * Correlación de rangos de Spearman con empates promediados.
 *
 * De rangos y no de Pearson porque las métricas forenses tienen colas larguísimas —un
 * Beneish M puede irse a −8 y un ratio de devengos a 0,5— y una correlación lineal la
 * decidirían cuatro nombres extremos.
 */
export function spearman(a, b) {
  const ks = Object.keys(a).filter((k) => a[k] != null && b[k] != null && isFinite(a[k]) && isFinite(b[k]));
  if (ks.length < 20) return { rho: null, n: ks.length };
  const rangos = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const medio = (i + j) / 2 + 1;                       // empates: rango medio
      for (let k = i; k <= j; k++) r[idx[k][1]] = medio;
      i = j + 1;
    }
    return r;
  };
  const ra = rangos(ks.map((k) => a[k])), rb = rangos(ks.map((k) => b[k]));
  const n = ks.length, m = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  if (da === 0 || db === 0) return { rho: null, n };
  return { rho: +(num / Math.sqrt(da * db)).toFixed(3), n };
}

const table = await loadSP500Historical();
if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
const miembros = [...new Set(membersAsOf(table, ASOF) || [])];
console.log(`\n  SOLAPAMIENTO FORENSE ↔ SEÑAL DE CALIDAD · ${ASOF} · ${miembros.length} miembros\n`);

const filas = await collectRows(miembros, ASOF, new Map(), false, null);
const senal = percentilesDe(filas.map(metricasDe));
console.log(`  ${filas.length} con fundamentales · ${Object.keys(senal).length} con señal de calidad`);

const acc = {}, bene = {}, pio = {}, alt = {};
for (const t of Object.keys(senal)) {
  try {
    const cik = await tickerToCik(t); if (!cik) continue;
    const f = await fundamentalsAsOf(cik, ASOF); if (!f) continue;
    // Los devengos van NEGADOS para que "mayor = mejor" en todas, igual que en picksSignal.
    const d = devengos(f); if (d != null) acc[t] = -d;
    const m = beneish(f); if (m != null) bene[t] = -m;         // menos M = menos sospecha
    const p = piotroski(f); if (p && p.max === 9) pio[t] = p.score;
    const totLiab = f.assets != null && f.equity != null ? f.assets - f.equity : null;
    const z = altmanZ({ workingCapital: f.curA != null && f.curL != null ? f.curA - f.curL : null,
      retainedEarnings: f.retainedEarnings, ebit: f.oiTTM, marketCap: null, bookEquity: f.equity,
      totalLiabilities: totLiab, sales: f.revTTM, totalAssets: f.assets, serviceOrFinancial: true });
    if (z) alt[t] = z.z;
  } catch { /* saltar */ }
}

const CANDIDATOS = [
  ["devengos (Sloan, negados)", acc],
  ["Beneish M (negado)", bene],
  ["Piotroski F", pio],
  ["Altman Z''", alt],
];
console.log(`\n  correlación de rangos con la señal de calidad de Picks:\n`);
console.log("  señal                          rho       n     lectura");
const resultados = {};
for (const [nombre, mapa] of CANDIDATOS) {
  const { rho, n } = spearman(senal, mapa);
  const lectura = rho == null ? "muestra corta"
    : Math.abs(rho) > 0.7 ? "REDUNDANTE — es la misma información"
    : Math.abs(rho) > 0.4 ? "solapa bastante"
    : "información DISTINTA";
  console.log(`  ${nombre.padEnd(28)} ${String(rho).padStart(6)}  ${String(n).padStart(4)}     ${lectura}`);
  resultados[nombre] = { rho, n, lectura };
}

// Entre ellas: si dos forenses dicen lo mismo, sobra una.
console.log(`\n  y entre ellas:`);
for (let i = 0; i < CANDIDATOS.length; i++) {
  for (let j = i + 1; j < CANDIDATOS.length; j++) {
    const { rho, n } = spearman(CANDIDATOS[i][1], CANDIDATOS[j][1]);
    if (rho == null) continue;
    console.log(`    ${CANDIDATOS[i][0].padEnd(28)} ↔ ${CANDIDATOS[j][0].padEnd(28)} rho ${String(rho).padStart(6)}  n ${n}`);
    resultados[`${CANDIDATOS[i][0]} ↔ ${CANDIDATOS[j][0]}`] = { rho, n };
  }
}

console.log(`\n  ⚠ Aportar y predecir son cosas distintas. Este script mide lo PRIMERO. Lo segundo`);
console.log(`    está medido en forense_veredicto.json, y la respuesta fue que NO: HF1 cambia de`);
console.log(`    signo entre ventanas. Una señal puede ser perfectamente ortogonal e inútil.`);

const ruta = join(OUT, "forense_solapamiento.json");
writeFileSync(ruta, JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: ASOF,
  universo: miembros.length, conFundamentales: filas.length, conSenal: Object.keys(senal).length,
  correlaciones: resultados,
  nota: "Mide si la señal forense APORTA información distinta, no si PREDICE. Lo segundo está en forense_veredicto.json y salió que no.",
}, null, 1));
console.log(`\n  → ${ruta}\n`);
