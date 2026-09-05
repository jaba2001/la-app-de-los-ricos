// ─────────────────────────────────────────────────────────────────────────────
// LOS TESTS DE TEMPORIZACIÓN — Merton-Henriksson y Treynor-Mazuy
//
// ⚠️ Lo que fija este fichero no es que las regresiones «funcionen», sino que **no den un falso
// positivo**. La sonda exploratoria del 2026-09-03 dio γ con t = 2,58 usando errores OLS
// clásicos, y parecía evidencia de habilidad de temporización. Con errores robustos cae a 1,42.
// Lo que destruyó la significación fue la HETEROCEDASTICIDAD —los retornos agrupan volatilidad y
// el error clásico supone varianza constante—, no la autocorrelación, que añadió apenas 0,03.
//
//   node --experimental-strip-types --no-warnings scripts/temporizacion.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { ols, rezagosNW, mertonHenriksson, treynorMazuy } from "../lib/temporizacion.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m} — esperado ≈${b}, salió ${a}`);

// Generador reproducible: los tests no pueden depender de la suerte de una semilla.
const gen = (semilla) => { let s = semilla; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; };

// ── La regresión, contra una respuesta conocida ──────────────────────────────────────────
// y = 3 + 2x, exacto: los coeficientes tienen que salir clavados y el error ~0.
{
  const y = [], X = [];
  for (let i = 0; i < 50; i++) { const x = i / 10; y.push(3 + 2 * x); X.push([1, x]); }
  const r = ols(y, X, 0);
  cerca(r.coef[0], 3, 1e-6, "intercepto de una recta exacta");
  cerca(r.coef[1], 2, 1e-6, "pendiente de una recta exacta");
}

// Una matriz singular (columna duplicada) devuelve null, no NaN ni basura.
{
  const y = [1, 2, 3, 4], X = [[1, 1, 1], [1, 2, 2], [1, 3, 3], [1, 4, 4]];
  ok(ols(y, X, 0) === null, "una matriz singular devuelve null");
  ok(ols([1, 2], [[1, 0, 0], [1, 1, 1]], 0) === null, "con menos observaciones que parámetros, null");
}

// ── Newey-West ───────────────────────────────────────────────────────────────────────────
{
  cerca(rezagosNW(236), 4, 0, "la regla de Newey-West(1994) da 4 rezagos para 236 meses");
  ok(rezagosNW(50) >= 1, "nunca menos de 1 rezago");
  ok(rezagosNW(1000) > rezagosNW(100), "más observaciones → más rezagos");

  // ⚠️ NW cambia los ERRORES, jamás los coeficientes. Si un día cambiaran, la implementación
  // estaría tocando la estimación en vez de su incertidumbre.
  const r = gen(11);
  const y = [], X = [];
  for (let i = 0; i < 300; i++) { const x = r() * 10; y.push(0.5 * x + r() * 3); X.push([1, x]); }
  const a = ols(y, X, 0), b = ols(y, X, 6);
  cerca(a.coef[1], b.coef[1], 1e-12, "el coeficiente no depende del tipo de error");
  ok(a.errorTipico[1] !== b.errorTipico[1], "pero el error típico sí");
}

// ── LO QUE MÁS IMPORTA: que no invente temporización donde no la hay ─────────────────────
{
  const r = gen(7);
  const indice = Array.from({ length: 400 }, () => r() * 12);
  // Beta CONSTANTE de 0,6: por construcción no hay habilidad de temporización ninguna.
  const cartera = indice.map((x) => 0.6 * x + r() * 2);
  const mh = mertonHenriksson(cartera, indice), tm = treynorMazuy(cartera, indice);
  ok(!mh.significativo, `sin temporización, MH no la encuentra (γ t=${mh.gammaT})`);
  ok(!tm.significativo, `sin temporización, TM tampoco (γ t=${tm.gammaT})`);
  cerca(mh.betaBajista, 0.6, 0.15, "y recupera la beta verdadera en tramos bajistas");
  cerca(mh.betaAlcista, 0.6, 0.15, "y la misma en alcistas, que es lo que se construyó");
}

// ── Y que SÍ la encuentre cuando existe de verdad ────────────────────────────────────────
{
  const r = gen(23);
  const indice = Array.from({ length: 400 }, () => r() * 12);
  // Beta 0,2 cuando el mercado cae y 1,2 cuando sube: temporización perfecta, ruido pequeño.
  const cartera = indice.map((x) => (x > 0 ? 1.2 : 0.2) * x + r() * 1.5);
  const mh = mertonHenriksson(cartera, indice), tm = treynorMazuy(cartera, indice);
  ok(mh.significativo, `con temporización real, MH la detecta (γ t=${mh.gammaT})`);
  ok(tm.significativo, `y TM también (γ t=${tm.gammaT})`);
  cerca(mh.betaBajista, 0.2, 0.15, "MH recupera la beta bajista");
  cerca(mh.betaAlcista, 1.2, 0.15, "y la alcista");
  ok(mh.gamma > 0, "γ positivo = la beta sube en mercados alcistas");
}

// Temporización INVERTIDA: γ tiene que salir negativo, no simplemente «no significativo».
{
  const r = gen(31);
  const indice = Array.from({ length: 400 }, () => r() * 12);
  const cartera = indice.map((x) => (x > 0 ? 0.3 : 1.1) * x + r() * 1.5);
  const mh = mertonHenriksson(cartera, indice);
  ok(mh.gamma < 0, `temporización invertida da γ negativo (${mh.gamma})`);
  ok(!mh.significativo, "y `significativo` sólo se pone con γ POSITIVO, no con |t|>2");
}

// ── La tasa libre de riesgo, constante o serie ───────────────────────────────────────────
{
  const r = gen(5);
  const indice = Array.from({ length: 200 }, () => r() * 10);
  const cartera = indice.map((x) => 0.7 * x + r() * 2);
  const a = mertonHenriksson(cartera, indice, 0);
  const b = mertonHenriksson(cartera, indice, Array(200).fill(0));
  cerca(a.gamma, b.gamma, 1e-9, "rf=0 constante y una serie de ceros dan lo mismo");
  const c = mertonHenriksson(cartera, indice, 3);
  ok(Number.isFinite(c.gamma), "con rf constante distinta de cero sigue calculando");
}

console.log(pass && !fail ? `\n✓ temporización: ${pass} passed, 0 failed\n` : `\n✖ temporización: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
