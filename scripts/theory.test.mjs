// ─────────────────────────────────────────────────────────────────────────────
// Tests de los módulos teóricos (PLAN_TEORIA_FINANCIERA_SCORA.md).
//   F1 lib/factorModel.ts  — CAPM + APT (regresión multifactor)
//   F2 lib/optimize.ts     — Ledoit-Wolf, Black-Litterman, remuestreo de Michaud
//   F3 lib/frictions.ts    — límites al arbitraje (Shleifer-Vishny, Pontiff, Amihud)
//   F4 lib/governance.ts   — costes de agencia (Jensen & Meckling)
//   F5 lib/greeks.ts       — medición: IV, N(d2), vol realizada, VRP
//
// Run: node --experimental-strip-types --no-warnings scripts/theory.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { fitFactorModel, innovations, scenarioImpact, portfolioReturns, explainLoadings } from "../lib/factorModel.ts";
import {
  ledoitWolf, blackLitterman, impliedEquilibriumReturns, resampleWeights, equalWeights,
  covariance, invert, minVariance, longOnly,
} from "../lib/optimize.ts";
import {
  blackScholes, impliedVol, impliedProbability, realizedVol, realizedVolFromCloses,
  varianceRiskPremium, noArbitrageBounds, MIN_VEGA_FOR_IV, MAX_VOL_UNCERTAINTY,
} from "../lib/greeks.ts";
import { amihudIlliquidity, arbitrageCost, arbitrageCapitalStress, STRUCTURAL_EDGES } from "../lib/frictions.ts";
import { computeGovernance, jensenFcfTest, shareholderYield } from "../lib/governance.ts";
import { gradeSignal, GRADE_COLOR, GRADE_LABEL } from "../lib/signalGrade.ts";

let pass = 0, fail = 0;
function approx(name, got, want, tol = 1e-3) {
  if (Math.abs(got - want) <= tol) pass++;
  else { fail++; console.error(`✗ ${name}: got ${got}, want ${want} (tol ${tol})`); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error(`✗ ${name}`); } }

// Generadores deterministas (sin Math.random: los tests deben ser reproducibles).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
function constCorrSeries(p, n, seed) {
  const r = rng(seed); const out = Array.from({ length: p }, () => []);
  for (let t = 0; t < n; t++) { const c = gauss(r); for (let i = 0; i < p; i++) out[i].push(0.3 * c + Math.sqrt(0.91) * gauss(r)); }
  return out;
}
function heteroSeries(p, n, seed) {
  const r = rng(seed);
  const load = Array.from({ length: p }, (_, i) => 0.15 + (0.8 * i) / Math.max(1, p - 1));
  const scale = Array.from({ length: p }, (_, i) => 1 + i);
  const out = Array.from({ length: p }, () => []);
  for (let t = 0; t < n; t++) {
    const c = gauss(r);
    for (let i = 0; i < p; i++) out[i].push(scale[i] * (load[i] * c + Math.sqrt(1 - load[i] ** 2) * gauss(r)));
  }
  return out;
}

// ── F1 · modelo multifactor ──────────────────────────────────────────────────
{
  const n = 60, f1 = [], f2 = [], y = [];
  const r = rng(11);
  for (let i = 0; i < n; i++) {
    const a = gauss(r), b = gauss(r);
    f1.push(a); f2.push(b); y.push(0.5 + 2 * a - 1 * b);
  }
  const m = fitFactorModel(y, { f1, f2 });
  ok("FM ajusta", m !== null);
  approx("FM alpha exacto", m.alpha, 0.5, 1e-9);
  approx("FM beta f1 exacto", m.loadings[0].beta, 2, 1e-9);
  approx("FM beta f2 exacto", m.loadings[1].beta, -1, 1e-9);
  approx("FM R2 = 1 sin ruido", m.rSquared, 1, 1e-9);
  approx("FM vol residual = 0", m.residualVol, 0, 1e-9);
  // INVARIANTE CLAVE: la descomposición de varianza suma exactamente R².
  approx("FM suma de cuotas = R2", m.loadings.reduce((s, l) => s + l.varianceShare, 0), m.rSquared, 1e-9);
  approx("FM sistemático + idiosincrático = 1", m.systematicShare + m.idiosyncraticShare, 1, 1e-12);

  // Con ruido: betas cercanas, t-stats altos, invariante se mantiene.
  const y2 = [], r2 = rng(23);
  for (let i = 0; i < n; i++) y2.push(0.5 + 2 * f1[i] - 1 * f2[i] + gauss(r2) * 0.15);
  const m2 = fitFactorModel(y2, { f1, f2 });
  approx("FM ruido beta f1", m2.loadings[0].beta, 2, 0.1);
  approx("FM ruido beta f2", m2.loadings[1].beta, -1, 0.1);
  approx("FM ruido suma cuotas = R2", m2.loadings.reduce((s, l) => s + l.varianceShare, 0), m2.rSquared, 1e-9);
  ok("FM factores reales significativos", m2.loadings[0].significant && m2.loadings[1].significant);

  // Un factor irrelevante NO debe salir significativo.
  const f3 = [], r3 = rng(37);
  for (let i = 0; i < n; i++) f3.push(gauss(r3));
  const m3 = fitFactorModel(y2, { f1, f2, f3 });
  ok("FM factor irrelevante no significativo", !m3.loadings[2].significant);

  // Guardas.
  ok("FM colineal -> null", fitFactorModel(y, { f1, dupe: f1.map((v) => v * 2) }) === null);
  ok("FM factor constante -> null", fitFactorModel(y, { f1, flat: new Array(n).fill(3) }) === null);
  ok("FM muestra insuficiente -> null", fitFactorModel([1, 2, 3], { f1: [1, 2, 3] }) === null);
  ok("FM sin factores -> null", fitFactorModel(y, {}) === null);
  ok("FM avisa con pocas observaciones", fitFactorModel(y.slice(0, 12), { f1: f1.slice(0, 12), f2: f2.slice(0, 12) }).warnings.length > 0);

  // Alineación por la cola.
  const mA = fitFactorModel(y, { f1: f1.slice(10), f2: f2.slice(10) });
  ok("FM alinea por la cola", mA.n === 50);
  approx("FM alineado conserva beta", mA.loadings[0].beta, 2, 1e-9);

  // innovations.
  const lvl = [100, 102, 101, 105];
  ok("innov diff longitud", innovations(lvl, "diff").length === 3);
  approx("innov diff valor", innovations(lvl, "diff")[0], 2, 1e-12);
  approx("innov pct valor", innovations(lvl, "pct")[0], 2, 1e-12);
  ok("innov level intacto", innovations(lvl, "level").length === 4);
  ok("innov pct con denominador 0 es finito", isFinite(innovations([0, 5, 10], "pct")[0]));
  const ar = [0]; for (let i = 1; i < 40; i++) ar.push(0.6 * ar[i - 1] + 5);
  ok("innov ar1 anula un AR(1) puro", Math.max(...innovations(ar, "ar1").map(Math.abs)) < 1e-6);
  ok("innov serie corta -> []", innovations([1], "diff").length === 0);

  // Escenarios.
  const sc = scenarioImpact(m, { f1: 0.1, f2: -0.2, desconocido: 1 });
  approx("escenario total", sc.total, 0.4, 1e-9);
  ok("escenario detecta factor desconocido", sc.ignored.length === 1 && sc.ignored[0] === "desconocido");
  ok("escenario detecta factor sin shock", scenarioImpact(m, { f1: 0.1 }).unshocked[0] === "f2");

  // Cartera.
  approx("portfolioReturns 50/50", portfolioReturns([0.5, 0.5], [[1, 2, 3], [3, 2, 1]])[0], 2, 1e-12);
  ok("portfolioReturns alinea por la cola", portfolioReturns([0.5, 0.5], [[9, 9, 1, 2, 3], [3, 2, 1]]).length === 3);
  ok("portfolioReturns pesos desalineados -> []", portfolioReturns([1], [[1], [2]]).length === 0);

  // Lectura en lenguaje llano.
  ok("explainLoadings solo describe significativas", explainLoadings(m3).length === 2);
  ok("explainLoadings usa etiquetas", explainLoadings(m2, { f1: "petróleo" })[0].includes("petróleo"));
}

// ── F2 · Ledoit-Wolf ─────────────────────────────────────────────────────────
{
  const s = constCorrSeries(5, 200, 1);
  const lw = ledoitWolf(s);
  ok("LW delta en [0,1]", lw.delta >= 0 && lw.delta <= 1);
  let sym = true;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (Math.abs(lw.cov[i][j] - lw.cov[j][i]) > 1e-12) sym = false;
  ok("LW matriz simétrica", sym);
  ok("LW invertible", invert(lw.cov) !== null);
  ok("LW delta -> 1 con objetivo exacto", ledoitWolf(constCorrSeries(5, 2000, 3)).delta > 0.9);

  // EL beneficio: con p > n la muestral es singular y la encogida no.
  const big = constCorrSeries(12, 8, 7);
  ok("LW muestral singular con p>n", invert(covariance(big)) === null);
  ok("LW encogida invertible con p>n", invert(ledoitWolf(big).cov) !== null);

  // Con objetivo mal especificado, delta decae con n (converge como 1/n).
  const dS = ledoitWolf(heteroSeries(6, 25, 3)).delta;
  const dM = ledoitWolf(heteroSeries(6, 250, 3)).delta;
  const dL = ledoitWolf(heteroSeries(6, 4000, 3)).delta;
  ok("LW delta decae con n", dL < dM && dM < dS);

  // La afirmación del paper: en muestra pequeña, la encogida está más cerca de la verdadera.
  const P = 8, N = 20, TRIALS = 40;
  const load = Array.from({ length: P }, (_, i) => 0.15 + (0.8 * i) / (P - 1));
  const scale = Array.from({ length: P }, (_, i) => 1 + i);
  const trueCov = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (_, j) =>
    i === j ? scale[i] ** 2 : scale[i] * scale[j] * load[i] * load[j]));
  const frob = (A, B) => { let t = 0; for (let i = 0; i < P; i++) for (let j = 0; j < P; j++) t += (A[i][j] - B[i][j]) ** 2; return Math.sqrt(t); };
  let eSample = 0, eShrunk = 0;
  for (let k = 0; k < TRIALS; k++) {
    const d = heteroSeries(P, N, 1000 + k);
    eSample += frob(covariance(d), trueCov);
    eShrunk += frob(ledoitWolf(d).cov, trueCov);
  }
  ok("LW encogida más cerca de la verdadera (Monte Carlo)", eShrunk < eSample);
  ok("LW guardas", ledoitWolf([[1, 2, 3]]) === null && ledoitWolf([[1, 2], [1, 2]]) === null);
}

// ── F2 · Black-Litterman ─────────────────────────────────────────────────────
{
  const cov = [[0.04, 0.006, 0.008], [0.006, 0.09, 0.012], [0.008, 0.012, 0.16]];
  const wMkt = [0.6, 0.3, 0.1];
  const pi = impliedEquilibriumReturns(cov, wMkt, 2.5);
  ok("BL equilibrio tiene 3 componentes", pi.length === 3);

  // EL TEST DECISIVO — la honestidad hecha aritmética: sin confianza medida, la vista no
  // mueve nada y la cartera se queda en el equilibrio de mercado.
  const bl0 = blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, -1, 0], q: 0.05, confidence: 0 }] });
  approx("BL confianza 0 -> shift nulo", bl0.totalShift, 0, 1e-12);
  for (let i = 0; i < 3; i++) approx(`BL confianza 0 -> peso mercado [${i}]`, bl0.weights[i], wMkt[i], 1e-10);
  const blNone = blackLitterman({ cov, marketWeights: wMkt, views: [] });
  for (let i = 0; i < 3; i++) approx(`BL sin vistas -> peso mercado [${i}]`, blNone.weights[i], wMkt[i], 1e-10);

  // Monotonía en la confianza.
  const shifts = [0.05, 0.2, 0.5, 0.9].map((c) =>
    blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, -1, 0], q: 0.05, confidence: c }] }).totalShift);
  ok("BL shift crece con la confianza", shifts.every((v, i) => i === 0 || v > shifts[i - 1]));

  // Dirección correcta.
  ok("BL vista alcista sube el peso",
    blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, 0, 0], q: pi[0] + 0.1, confidence: 0.8 }] }).weights[0] > wMkt[0]);
  ok("BL vista bajista baja el peso",
    blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, 0, 0], q: pi[0] - 0.1, confidence: 0.8 }] }).weights[0] < wMkt[0]);

  // La tesis de Scora: con el IC medido de la selección (~0.02) la vista se apaga sola.
  const blIC = blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, -1, 0], q: 0.08, confidence: 0.02 }] });
  ok("BL con IC~0 deja los pesos casi en mercado", blIC.weights.every((w, i) => Math.abs(w - wMkt[i]) < 0.05));

  // Guardas.
  ok("BL dimensiones malas -> null", blackLitterman({ cov, marketWeights: [1, 2], views: [] }) === null);
  ok("BL pick de tamaño malo -> null", blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1], q: 0.1, confidence: 0.5 }] }) === null);
  ok("BL confianza 1 no explota", blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [1, 0, 0], q: 0.2, confidence: 1 }] }) !== null);
  ok("BL pick nulo se ignora", blackLitterman({ cov, marketWeights: wMkt, views: [{ pick: [0, 0, 0], q: 0.2, confidence: 0.5 }] }).totalShift < 1e-9);
}

// ── F2 · remuestreo ──────────────────────────────────────────────────────────
{
  const s = constCorrSeries(4, 120, 11);
  const opt = (cv) => longOnly(minVariance(cv) ?? []);
  const a = resampleWeights(s, opt, { draws: 80, seed: 5 });
  const b = resampleWeights(s, opt, { draws: 80, seed: 5 });
  const c = resampleWeights(s, opt, { draws: 80, seed: 99 });
  ok("resample reproducible con misma semilla", a.mean.every((v, i) => Math.abs(v - b.mean[i]) < 1e-15));
  ok("resample cambia con otra semilla", a.mean.some((v, i) => Math.abs(v - c.mean[i]) > 1e-9));
  approx("resample pesos suman 1", a.mean.reduce((x, y) => x + y, 0), 1, 1e-9);
  ok("resample expone dispersión real", a.stdDev.every((v) => v > 0));
  ok("resample p05 <= media <= p95", a.mean.every((v, i) => a.p05[i] <= v + 1e-9 && v <= a.p95[i] + 1e-9));
  ok("resample series cortas -> null", resampleWeights([[1, 2], [1, 2]], opt) === null);
  approx("equalWeights suma 1", equalWeights(4).reduce((x, y) => x + y, 0), 1, 1e-12);
  ok("equalWeights(0) vacío", equalWeights(0).length === 0);
}

// ── F5 · medición con Black-Scholes ──────────────────────────────────────────
{
  // Round-trip: si devuelve una IV, debe respetar la incertidumbre que ella misma declara;
  // si devuelve null, la vega verdadera debe ser demasiado pequeña para identificarla.
  let checked = 0, resolved = 0, contractOk = true, nullOk = true;
  for (const S of [50, 100, 250]) {
    for (const K of [S * 0.7, S * 0.9, S, S * 1.1, S * 1.4]) {
      for (const T of [7 / 365, 0.25, 1, 2]) {
        for (const v of [0.08, 0.2, 0.45, 1.2]) {
          for (const type of ["call", "put"]) {
            const g = blackScholes(S, K, T, v, 0.045, 0, type);
            if (g.price < 1e-8) continue;
            checked++;
            const iv = impliedVol(g.price, S, K, T, 0.045, 0, type);
            if (!iv) { if (g.vega > MIN_VEGA_FOR_IV) nullOk = false; continue; }
            resolved++;
            if (Math.abs(iv.vol - v) > iv.volUncertainty * 2 + 1e-9) contractOk = false;
          }
        }
      }
    }
  }
  ok("IV round-trip respeta la incertidumbre declarada", contractOk);
  ok("IV solo devuelve null cuando vega es diminuta", nullOk);
  ok("IV resuelve la mayoría de casos", resolved > checked * 0.6);

  // Paridad: misma IV para call y put del mismo strike.
  const cPx = blackScholes(100, 105, 0.5, 0.32, 0.04, 0.01, "call").price;
  const pPx = blackScholes(100, 105, 0.5, 0.32, 0.04, 0.01, "put").price;
  approx("IV call == IV put", impliedVol(cPx, 100, 105, 0.5, 0.04, 0.01, "call").vol - impliedVol(pPx, 100, 105, 0.5, 0.04, 0.01, "put").vol, 0, 1e-7);
  ok("IV declara incertidumbre por debajo del umbral", impliedVol(cPx, 100, 105, 0.5, 0.04, 0.01, "call").volUncertainty <= MAX_VOL_UNCERTAINTY);

  // Cotas y guardas.
  const bnd = noArbitrageBounds(100, 100, 1, 0.05, 0, "call");
  ok("cotas de no-arbitraje ordenadas", bnd.lo < bnd.hi);
  ok("IV por encima de la cota -> null", impliedVol(bnd.hi * 1.5, 100, 100, 1, 0.05, 0, "call") === null);
  ok("IV precio negativo -> null", impliedVol(-5, 100, 100, 1, 0.05, 0, "call") === null);
  ok("IV T=0 -> null", impliedVol(10, 100, 100, 0, 0.05, 0, "call") === null);
  ok("IV NaN -> null", impliedVol(NaN, 100, 100, 1, 0.05, 0, "call") === null);
  // Muy dentro de dinero: vega colapsa, NO se debe publicar un número inventado.
  ok("IV deep ITM no identificable -> null", impliedVol(blackScholes(100, 20, 1, 0.2, 0.04, 0, "call").price, 100, 20, 1, 0.04, 0, "call") === null);

  // N(d2).
  const ip = impliedProbability(100, 100, 1, 0.2, 0.05, 0);
  approx("N(d2) above+below = 1", ip.above + ip.below, 1, 1e-12);
  approx("movimiento esperado = vol*sqrt(T)", ip.expectedMovePct, 20, 1e-9);
  ok("N(d2) strike alto -> prob baja", impliedProbability(100, 200, 1, 0.2, 0.05).above < 0.05);
  ok("N(d2) strike bajo -> prob alta", impliedProbability(100, 50, 1, 0.2, 0.05).above > 0.95);
  ok("N(d2) monótona en el strike", impliedProbability(100, 90, 1, 0.2, 0.05).above > impliedProbability(100, 110, 1, 0.2, 0.05).above);
  ok("N(d2) vol 0 -> null", impliedProbability(100, 100, 1, 0, 0.05) === null);

  // Vol realizada y VRP.
  const alt = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
  ok("vol realizada en rango", realizedVol(alt, 252) > 0.15 && realizedVol(alt, 252) < 0.17);
  ok("vol realizada serie corta -> null", realizedVol([0.01], 252) === null);
  const closes = [100]; for (let i = 1; i < 60; i++) closes.push(closes[i - 1] * (1 + (i % 2 === 0 ? 0.01 : -0.01)));
  ok("vol realizada desde cierres", realizedVolFromCloses(closes, 252) > 0.1);
  ok("vol realizada cierres cortos -> null", realizedVolFromCloses([100, 101]) === null);
  const vrp = varianceRiskPremium(0.2, 0.15);
  approx("VRP en puntos de vol", vrp.volPoints, 5, 1e-9);
  approx("VRP en puntos de varianza", vrp.variancePoints, 175, 1e-6);
  ok("VRP cara", vrp.richness === "cara");
  ok("VRP barata", varianceRiskPremium(0.15, 0.25).richness === "barata");
  ok("VRP neutral", varianceRiskPremium(0.201, 0.2).richness === "neutral");
  ok("VRP vol 0 -> null", varianceRiskPremium(0, 0.2) === null);
}

// ── F3 · límites al arbitraje ────────────────────────────────────────────────
{
  // Amihud: a igual movimiento de precio, MENOS volumen = MÁS iliquidez.
  const px = [100, 101, 100, 102, 101];
  const liquid = amihudIlliquidity(px, [1e9, 1e9, 1e9, 1e9, 1e9]);
  const thin = amihudIlliquidity(px, [1e6, 1e6, 1e6, 1e6, 1e6]);
  ok("Amihud: menos volumen = más iliquidez", thin > liquid);
  ok("Amihud positivo", liquid > 0);
  ok("Amihud serie corta -> null", amihudIlliquidity([100], [1e6]) === null);
  ok("Amihud volumen 0 se ignora", amihudIlliquidity(px, [0, 0, 0, 0, 0]) === null);

  // Coste de arbitraje.
  const facil = arbitrageCost({ idiosyncraticVolAnnual: 12, shortInterestPctFloat: 1, daysToCover: 0.5, amihud: 0.005, marketCap: 500e9 });
  const dificil = arbitrageCost({ idiosyncraticVolAnnual: 70, shortInterestPctFloat: 25, daysToCover: 12, amihud: 20, marketCap: 80e6 });
  ok("fricción: fácil < difícil", facil.score < dificil.score);
  ok("fricción banda baja", facil.band === "baja");
  ok("fricción banda extrema", dificil.band === "extrema");
  ok("fricción score en [0,100]", facil.score >= 0 && dificil.score <= 100);
  ok("fricción cuenta componentes", facil.covered === 5);
  ok("fricción parcial se normaliza", arbitrageCost({ idiosyncraticVolAnnual: 70 }).covered === 1);
  ok("fricción sin datos -> null", arbitrageCost({}) === null);
  ok("fricción ignora negativos", arbitrageCost({ idiosyncraticVolAnnual: -5, marketCap: 500e9 }).covered === 1);
  ok("fricción monótona en vol idiosincrática",
    arbitrageCost({ idiosyncraticVolAnnual: 70 }).score > arbitrageCost({ idiosyncraticVolAnnual: 12 }).score);

  // Estrés del capital de arbitraje.
  const calma = arbitrageCapitalStress({ hyOasBps: 260, nfci: -0.7, stlfsi4: -0.9, moveIndex: 65, vix: 13 });
  const crisis = arbitrageCapitalStress({ hyOasBps: 1000, nfci: 1.5, stlfsi4: 3, moveIndex: 200, vix: 60 });
  ok("estrés: calma < crisis", calma.score < crisis.score);
  ok("estrés banda calmado", calma.band === "calmado");
  ok("estrés banda crisis", crisis.band === "crisis");
  ok("estrés parcial funciona", arbitrageCapitalStress({ vix: 60 }).covered === 1);
  ok("estrés sin datos -> null", arbitrageCapitalStress({}) === null);
  ok("estrés menciona el driver dominante", crisis.reading.length > 20);
  ok("ventaja estructural documentada", STRUCTURAL_EDGES.length >= 4 && STRUCTURAL_EDGES.every((e) => e.title && e.detail));
}

// ── F4 · costes de agencia ───────────────────────────────────────────────────
{
  const bueno = computeGovernance({ netIssuancePct: -4, sbcToRevenuePct: 1, sbcToFcfPct: 5, assetGrowthPct: 3, insiderOwn: 0.12, accrualsRatio: -0.02 });
  const malo = computeGovernance({ netIssuancePct: 12, sbcToRevenuePct: 22, sbcToFcfPct: 90, assetGrowthPct: 60, insiderOwn: 0.75, accrualsRatio: 0.4 });
  ok("agencia: bueno < malo", bueno.agencyCost < malo.agencyCost);
  ok("agencia banda baja", bueno.band === "baja");
  ok("agencia banda severa", malo.band === "severa");
  ok("agencia cuenta 6 componentes", bueno.covered === 6);
  ok("agencia parcial se normaliza", computeGovernance({ netIssuancePct: 12 }).covered === 1);
  ok("agencia sin datos -> null", computeGovernance({}) === null);
  ok("agencia score en [0,100]", bueno.agencyCost >= 0 && malo.agencyCost <= 100);
  // Punto dulce de insiders: 12% mejor que 0.5% y que 75%.
  const sweet = computeGovernance({ insiderOwn: 0.12 }).agencyCost;
  ok("insiders punto dulce mejor que casi nada", sweet < computeGovernance({ insiderOwn: 0.005 }).agencyCost);
  ok("insiders punto dulce mejor que atrincheramiento", sweet < computeGovernance({ insiderOwn: 0.75 }).agencyCost);
  ok("agencia dilución peor que recompra",
    computeGovernance({ netIssuancePct: 10 }).agencyCost > computeGovernance({ netIssuancePct: -5 }).agencyCost);
  ok("agencia fracción de insiders fuera de rango se ignora", computeGovernance({ insiderOwn: 5, netIssuancePct: 0 }).covered === 1);

  // Test del FCF de Jensen.
  const imperio = jensenFcfTest({ fcfMarginPct: 15, roicPct: 4, waccPct: 9, capexToRevenuePct: 14, dividendYieldPct: 0, buybackYieldPct: 0 });
  ok("Jensen detecta construcción de imperio", imperio.empireBuilding === true);
  approx("Jensen diferencial", imperio.spread, -5, 1e-9);
  const sano = jensenFcfTest({ fcfMarginPct: 20, roicPct: 25, waccPct: 8, capexToRevenuePct: 4, dividendYieldPct: 2, buybackYieldPct: 3 });
  ok("Jensen no marca a un buen asignador", sano.empireBuilding === false);
  ok("Jensen calcula rentabilidad al accionista", Math.abs(sano.shareholderYield - 5) < 1e-9);
  ok("Jensen sin entradas -> null", jensenFcfTest({ fcfMarginPct: 10 }) === null);
  ok("Jensen explica el diferencial positivo", sano.reading.includes("CREA valor"));

  // Rentabilidad total al accionista.
  approx("shareholderYield resta la emisión", shareholderYield(2, 3, 1), 4, 1e-9);
  ok("shareholderYield sin datos -> null", shareholderYield(null, null, null) === null);
  approx("shareholderYield parcial", shareholderYield(2, null, null), 2, 1e-9);
}

// -- F0c . grado de senal (problema de la hipotesis conjunta de Fama) ---------
{
  const best = gradeSignal({ ic: 0.14, oos: "passed", sampleSize: 9000, pointInTime: true });
  ok("grado A con evidencia completa", best.grade === "A");
  const worst = gradeSignal({});
  ok("grado D sin evidencia", worst.grade === "D");
  ok("D avisa de que no hay evidencia", worst.caveat.toLowerCase().includes("sin evidencia"));

  const icLow = gradeSignal({ ic: 0.01, oos: "passed", sampleSize: 9000, pointInTime: true }).points;
  const icMid = gradeSignal({ ic: 0.06, oos: "passed", sampleSize: 9000, pointInTime: true }).points;
  const icHigh = gradeSignal({ ic: 0.14, oos: "passed", sampleSize: 9000, pointInTime: true }).points;
  ok("puntos crecen con el IC", icLow < icMid && icMid < icHigh);

  const failedG = gradeSignal({ ic: 0.08, oos: "failed", sampleSize: 9000, pointInTime: true }).points;
  const untested = gradeSignal({ ic: 0.08, oos: "not-tested", sampleSize: 9000, pointInTime: true }).points;
  const passedG = gradeSignal({ ic: 0.08, oos: "passed", sampleSize: 9000, pointInTime: true }).points;
  ok("OOS: fallado < sin probar < superado", failedG < untested && untested < passedG);

  ok("point-in-time puntua mas que universo sesgado",
    gradeSignal({ ic: 0.08, oos: "passed", sampleSize: 9000, pointInTime: true }).points >
    gradeSignal({ ic: 0.08, oos: "passed", sampleSize: 9000, pointInTime: false }).points);

  const fewTrials = gradeSignal({ ic: 0.08, oos: "passed", sampleSize: 9000, pointInTime: true, trials: 3 }).points;
  const manyTrials = gradeSignal({ ic: 0.08, oos: "passed", sampleSize: 9000, pointInTime: true, trials: 500 }).points;
  ok("mas ensayos penalizan la nota", manyTrials < fewTrials);

  ok("IC negativo se avisa", gradeSignal({ ic: -0.09, oos: "passed", sampleSize: 9000, pointInTime: true }).reasons.some((r) => r.includes("NEGATIVO")));

  ok("puntos en [0,100]", [best, worst, gradeSignal({ ic: 0.5, trials: 1e6 })].every((g) => g.points >= 0 && g.points <= 100));
  ok("toda nota tiene color y etiqueta", ["A", "B", "C", "D"].every((g) => GRADE_COLOR[g] && GRADE_LABEL[g]));
  ok("toda nota trae caveat y razones", [best, worst].every((g) => g.caveat.length > 10 && g.reasons.length > 0));

  // El caso REAL de Scora: IC ~0.01, sin gate OOS, 201 ensayos. No puede salir bien parado.
  const real = gradeSignal({ ic: 0.0103, oos: "not-tested", sampleSize: 9257, pointInTime: true, trials: 201 });
  ok("el caso real de seleccion sale C o D", real.grade === "C" || real.grade === "D");
}

console.log(`\n${fail === 0 ? "✓" : "✗"} teoría: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
