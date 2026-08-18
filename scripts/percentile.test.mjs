// Tests de lib/percentile.ts (F2 · percentiles sector-relativos).
// Fichero propio, en la línea de golden.test.mjs / p2.test.mjs / theory.test.mjs.
//   node --experimental-strip-types --no-warnings scripts/percentile.test.mjs
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  pctlOf, goodnessPctl, gradeFromPctl, gradeColor, lookupDist,
  gradeMetric, gradePillar, explainGrade, DIST_LEVELS, HIGHER_IS_BETTER,
} from "../lib/percentile.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error(`  ✖ ${msg}`); } };
const near = (a, b, tol, msg) => ok(a != null && Math.abs(a - b) <= tol, `${msg} (obtenido ${a}, esperado ≈${b})`);

// Distribución de juguete: los cuantiles [1,5,10,25,50,75,90,95,99] valen 10,20,…,90.
const D = { q: [10, 20, 30, 40, 50, 60, 70, 80, 90], n: 100 };

// ── pctlOf ───────────────────────────────────────────────────────────────────
near(pctlOf(50, D), 50, 1e-9, "pctlOf: el valor de la mediana devuelve el percentil 50");
near(pctlOf(10, D), 1, 1e-9, "pctlOf: el corte inferior devuelve 1");
near(pctlOf(90, D), 99, 1e-9, "pctlOf: el corte superior devuelve 99");
near(pctlOf(5, D), 1, 1e-9, "pctlOf: por debajo del mínimo se recorta a 1");
near(pctlOf(1000, D), 99, 1e-9, "pctlOf: por encima del máximo se recorta a 99");
// Interpolación: 55 está a mitad entre q[4]=50 (p50) y q[5]=60 (p75) → 62.5
near(pctlOf(55, D), 62.5, 1e-9, "pctlOf: interpola linealmente entre cortes");
ok(pctlOf(null, D) === null, "pctlOf: valor nulo → null");
ok(pctlOf(50, null) === null, "pctlOf: distribución ausente → null");
ok(pctlOf(NaN, D) === null, "pctlOf: NaN → null");
ok(pctlOf(50, { q: [1, 2, 3], n: 10 }) === null, "pctlOf: distribución con longitud incorrecta → null");
ok(DIST_LEVELS.length === D.q.length, "DIST_LEVELS y los cuantiles tienen la misma longitud");

// Tramo plano: si dos cortes coinciden, dentro no hay información → punto medio del tramo.
const PLANO = { q: [0, 0, 0, 0, 0, 5, 10, 15, 20], n: 50 };
near(pctlOf(0, PLANO), 1, 1e-9, "pctlOf: en un tramo plano en el mínimo devuelve el suelo");

// ── goodnessPctl ─────────────────────────────────────────────────────────────
near(goodnessPctl(60, D, true), 75, 1e-9, "goodnessPctl: 'más es mejor' conserva el percentil");
near(goodnessPctl(60, D, false), 25, 1e-9, "goodnessPctl: 'menos es mejor' lo invierte");
ok(HIGHER_IS_BETTER.pe === false, "dirección: en el PER, más bajo es mejor");
ok(HIGHER_IS_BETTER.roe === true, "dirección: en el ROE, más alto es mejor");
ok(HIGHER_IS_BETTER.debtEquity === false, "dirección: en deuda/equity, más bajo es mejor");

// ── gradeFromPctl ────────────────────────────────────────────────────────────
ok(gradeFromPctl(99) === "A+", "grado: percentil 99 → A+");
ok(gradeFromPctl(97) === "A+", "grado: el corte de A+ es 97");
ok(gradeFromPctl(96.9) === "A", "grado: justo por debajo de 97 → A");
ok(gradeFromPctl(50) === "C", "grado: la mediana es una C");
ok(gradeFromPctl(1) === "F", "grado: percentil 1 → F");
ok(gradeFromPctl(null) === null, "grado: null → null");
ok(gradeColor("A+").includes("pos"), "color: la A usa el token positivo");
ok(gradeColor("F").includes("neg"), "color: la F usa el token negativo");
ok(gradeColor(null).includes("text-3"), "color: sin grado, color apagado");

// ── lookupDist ───────────────────────────────────────────────────────────────
const TABLA = { ALL: { pe: D }, Technology: { pe: { q: [20, 25, 30, 40, 55, 70, 90, 110, 200], n: 60 } } };
ok(lookupDist(TABLA, "Technology", "pe").n === 60, "lookupDist: usa el sector cuando existe");
ok(lookupDist(TABLA, "Utilities", "pe").n === 100, "lookupDist: cae a ALL si el sector no está");
ok(lookupDist(TABLA, "Technology", "roe") === null, "lookupDist: métrica inexistente → null");
ok(lookupDist(null, "Technology", "pe") === null, "lookupDist: sin tabla → null (no lanza)");

// ── gradeMetric ──────────────────────────────────────────────────────────────
const g = gradeMetric("pe", 55, TABLA, "Technology");
ok(g && g.sector === "Technology", "gradeMetric: informa del sector con el que comparó");
ok(g && g.grade === gradeFromPctl(g.pctl), "gradeMetric: la letra concuerda con el percentil");
ok(gradeMetric("pe", 55, TABLA, "Utilities").sector === "ALL", "gradeMetric: marca ALL cuando tuvo que agregar");
ok(gradeMetric("noExiste", 5, TABLA, "Technology") === null, "gradeMetric: métrica sin dirección declarada → null");
ok(gradeMetric("pe", null, TABLA, "Technology") === null, "gradeMetric: sin valor → null");
ok(gradeMetric("pe", 55, null, "Technology") === null, "gradeMetric: sin tabla → null");

// El caso que justifica TODA la F2: el mismo PER, juzgado en dos sectores, no vale lo mismo.
// (Se usa 55 —la mediana de la distribución tech de juguete— y NO 30, que cae en el mismo
// nivel de cuantil en ambas y por tanto no distingue nada: el valor de prueba tiene que
// caer en tramos distintos de las dos distribuciones o el test no prueba lo que dice.)
const peAgregado = gradeMetric("pe", 55, TABLA, "Utilities");   // cae a ALL: 55 está entre p50 y p75
const peTech = gradeMetric("pe", 55, TABLA, "Technology");      // en tech, 55 es justo la mediana
ok(peTech.pctl > peAgregado.pctl, `sector-relativo: un PER de 55 es MEJOR nota en Technology (${peTech?.pctl}) que en el agregado (${peAgregado?.pctl})`);

// ── gradePillar ──────────────────────────────────────────────────────────────
const TABLA2 = { ALL: { pe: D, pb: D, evEbitda: D, roe: D, revenueGrowth: D, epsGrowth: D } };
const pv = gradePillar("value", { pe: 20, pb: 20, evEbitda: 20 }, TABLA2, null);
ok(pv && pv.coverage === 3, "gradePillar: cuenta cuántas métricas pudo graduar");
near(pv.pctl, 95, 1e-9, "gradePillar: tres métricas baratas (p5) dan percentil de bondad 95");
ok(pv.metrics.length === 3, "gradePillar: devuelve el desglose, no sólo la letra");
const pg = gradePillar("growth", { revenueGrowth: 80, epsGrowth: 80 }, TABLA2, null);
near(pg.pctl, 95, 1e-9, "gradePillar: crecimiento alto → percentil alto");
ok(gradePillar("value", {}, TABLA2, null) === null, "gradePillar: sin ninguna métrica → null");
ok(gradePillar("inexistente", { pe: 20 }, TABLA2, null) === null, "gradePillar: pilar desconocido → null");
ok(gradePillar("value", { pe: 20 }, null, null) === null, "gradePillar: sin tabla → null (degrada, no rompe)");

// ── explainGrade ─────────────────────────────────────────────────────────────
ok(explainGrade(peTech).includes("Technology"), "explainGrade: nombra el sector de comparación");
ok(explainGrade(peTech).includes("Percentil"), "explainGrade: enseña el percentil, no sólo la letra");
ok(explainGrade(null) === null, "explainGrade: null → null");

// ── contra la distribución REAL, si está generada ────────────────────────────
const distPath = join(dirname(fileURLToPath(import.meta.url)), "..", "research", "out", "factor_dist.json");
if (existsSync(distPath)) {
  const real = JSON.parse(readFileSync(distPath, "utf8")).dist;
  ok(real.ALL?.pe != null, "real: existe la distribución agregada del PER");
  const tech = real.Technology?.pe, fin = real["Financial Services"]?.pe;
  if (tech && fin) {
    ok(tech.q[4] > fin.q[4], `real: la mediana de PER de Technology (${tech.q[4]}) supera a la de Financials (${fin.q[4]})`);
    // La demostración de que la banda absoluta estaba mal: un PER de 15 es del montón en un
    // banco y una ganga en una tecnológica; hoy `calcScores` les da a los dos la nota máxima.
    const enBanco = gradeMetric("pe", 15, real, "Financial Services");
    const enTech = gradeMetric("pe", 15, real, "Technology");
    ok(enTech.pctl > enBanco.pctl, `real: un PER de 15 puntúa mejor en Technology (${enTech.grade}) que en un banco (${enBanco.grade})`);
    ok(enBanco.pctl < 75, `real: un PER de 15 en un banco NO es sobresaliente (${enBanco.grade}, percentil ${enBanco.pctl}) — hoy el score le da el máximo`);
  }
  const ener = real.Energy?.pe;
  if (ener && tech) ok(ener.q[4] < tech.q[4], "real: Energy cotiza a múltiplos más bajos que Technology");
} else {
  console.log("  (research/out/factor_dist.json no generado — se omiten las comprobaciones sobre datos reales)");
}

console.log(`\n${fail === 0 ? "✓" : "✗"} percentile: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
