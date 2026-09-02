// ─────────────────────────────────────────────────────────────────────────────
// LAS MÉTRICAS DE LA FASE 1 — M², captura, forma de la distribución y significación
//
// Lo que sostiene el claim «iguala al índice con un tercio del drawdown» no es el Sharpe a
// secas: es M² (la ventaja de Sharpe en puntos de retorno), la captura alcista/bajista, y la
// FORMA de la distribución —porque el Sharpe supone normalidad y una promesa de caídas obliga
// a enseñar asimetría y curtosis—.
//
//   node --experimental-strip-types --no-warnings scripts/riesgo.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { m2, m2Alpha, captura, asimetria, curtosisExceso, correlacion, diferenciaSharpe,
         sharpe, annualVol } from "../lib/riskMetrics.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m} — esperado ≈${b}, salió ${a}`);

// ── M² ───────────────────────────────────────────────────────────────────────────────────
// El ejemplo del CFA L1: cartera con 10 % y σ 20 %, Rf 5 %, mercado 11 % con σ 30 %.
// Sharpe = (10−5)/20 = 0,25 → M² = 0,25×30 + 5 = 12,5 % → M²-alfa = 12,5 − 11 = 1,5 pp.
// Se reproduce con series mensuales construidas para tener esos momentos exactos.
{
  const serie = (mediaAnual, volAnual, n = 240) => {
    // Alterna dos valores para fijar media y desviación exactas.
    const m = mediaAnual / 12, s = volAnual / Math.sqrt(12);
    const out = [];
    for (let i = 0; i < n; i++) out.push(i % 2 === 0 ? m + s : m - s);
    return out;
  };
  const p = serie(10, 20), b = serie(11, 30);
  cerca(sharpe(p, 5), 0.25, 0.02, "Sharpe del ejemplo del CFA");
  cerca(annualVol(b), 30, 0.5, "volatilidad anual del mercado");
  cerca(m2(p, b, 5), 12.5, 0.4, "M² = Sharpe × σ_mercado + Rf");
  cerca(m2Alpha(p, b, 5), 1.5, 0.4, "M²-alfa = M² − retorno del mercado");
}

// M² tiene que ordenar IGUAL que el Sharpe: es la misma información en otras unidades.
{
  const a = [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1];
  const peor = [4, -2, 4, -2, 4, -2, 4, -2, 4, -2, 4, -2];
  const bench = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  ok(sharpe(a) > sharpe(peor), "la serie estable tiene mejor Sharpe");
  ok(m2(a, bench) > m2(peor, bench), "y también mejor M² — el orden se conserva");
}

// ── Captura alcista / bajista ────────────────────────────────────────────────────────────
{
  const bench = [10, -10, 10, -10, 10, -10];
  const mitad = [5, -5, 5, -5, 5, -5];
  cerca(captura(mitad, bench, true), 50, 1, "capturar la mitad de las subidas → 50 %");
  cerca(captura(mitad, bench, false), 50, 1, "y la mitad de las bajadas → 50 %");

  const asimetrico = [10, -5, 10, -5, 10, -5];
  cerca(captura(asimetrico, bench, true), 100, 1, "toda la subida → 100 %");
  cerca(captura(asimetrico, bench, false), 50, 1, "media bajada → 50 %: el perfil que vende Scora");

  // ⚠️ Sin meses de ese signo NO hay ratio. Devolver 0 diría «no captura nada», que es lo
  // contrario de «no se sabe».
  ok(captura([1, 2, 3], [1, 2, 3], false) === null, "sin meses bajistas devuelve null, no 0");
  ok(captura([1, 2, 3], [-1, -2, -3], true) === null, "sin meses alcistas, igual");
}

// ── Forma de la distribución ─────────────────────────────────────────────────────────────
{
  const sim = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2];
  cerca(asimetria(sim), 0, 0.01, "una serie simétrica tiene asimetría 0");

  const colaIzq = [1, 1, 1, 1, 1, 1, 1, 1, 1, -20];
  ok(asimetria(colaIzq) < -1, `una cola izquierda larga da asimetría negativa (${asimetria(colaIzq).toFixed(2)})`);
  ok(curtosisExceso(colaIzq) > 1, `y curtosis en exceso positiva (${curtosisExceso(colaIzq).toFixed(2)})`);

  // Con menos de 4 datos no hay curtosis que calcular: se devuelve 0, no NaN.
  ok(Number.isFinite(curtosisExceso([1, 2])), "con pocos datos no devuelve NaN");
  ok(Number.isFinite(asimetria([1, 2])), "la asimetría tampoco");
}

// ── Correlación ──────────────────────────────────────────────────────────────────────────
{
  const a = [1, 2, 3, 4, 5];
  cerca(correlacion(a, a), 1, 1e-9, "una serie consigo misma correla 1");
  cerca(correlacion(a, a.map((x) => -x)), -1, 1e-9, "y con su opuesta, −1");
  cerca(correlacion(a, [3, 3, 3, 3, 3]), 0, 1e-9, "con una constante, 0 (y no NaN)");
}

// ── La significación de una diferencia de Sharpe ─────────────────────────────────────────
// ⚠️ EL PUNTO CRÍTICO: se usan los Sharpe POR PERIODO y T = número de observaciones, NO los
// anualizados con T en años. No son equivalentes —el término 2(1−ρ) no escala con √12— y
// hacerlo mal daba t = 1,62 donde el cálculo correcto da 1,92: la diferencia entre «no
// concluyente» y «casi». El plan v2 llevaba la tabla mal por esto.
{
  const d = diferenciaSharpe([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  ok(d.diferencia === 0, "dos series idénticas no se diferencian");
  ok(!d.significativo, "y no es significativo");

  // Más meses, misma diferencia → más significación. Es la propiedad que hace útil el test.
  const ruido = (n, semilla) => { let s = semilla; return Array.from({ length: n }, () => { s = (s * 9301 + 49297) % 233280; return (s / 233280 - 0.5) * 6; }); };
  const corto = ruido(60, 7), largo = [...corto, ...ruido(180, 13)];
  const bCorto = corto.map((x) => x - 0.5), bLargo = largo.map((x) => x - 0.5);
  const dc = diferenciaSharpe(corto, bCorto), dl = diferenciaSharpe(largo, bLargo);
  ok(Math.abs(dl.t) > Math.abs(dc.t), `más meses → más t (${dc.meses}m: t=${dc.t} · ${dl.meses}m: t=${dl.t})`);
  ok(dl.rho > 0.9, `series casi paralelas correlan alto (ρ=${dl.rho})`);
  ok(dl.errorTipico > 0, "el error típico se reporta para poder rehacer la cuenta");
}

console.log(pass && !fail ? `\n✓ riesgo: ${pass} passed, 0 failed\n` : `\n✖ riesgo: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
