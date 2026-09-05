// Mean-variance portfolio optimization (P2-13). Pure linear algebra — closed-form min-variance
// and max-Sharpe (tangency) weights from expected returns μ and covariance Σ, plus a long-only
// projection. From the "Gestión de activos y carteras" material (Markowitz). This is a TOOL that
// sits ALONGSIDE Scora's validated regime allocator, never replacing it. Verified in p2.test.mjs.

type Matrix = number[][];

/** Gauss-Jordan inverse; returns null if singular. */
export function invert(m: Matrix): Matrix | null {
  const n = m.length;
  const A: Matrix = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j];
    }
  }
  return A.map((row) => row.slice(n));
}

function matVec(m: Matrix, v: number[]): number[] {
  return m.map((row) => row.reduce((s, x, j) => s + x * v[j], 0));
}
function normalizeSum1(w: number[]): number[] {
  const s = w.reduce((a, b) => a + b, 0);
  return s !== 0 ? w.map((x) => x / s) : w;
}

/** Global minimum-variance weights: w ∝ Σ⁻¹·1, normalized to sum 1. */
export function minVariance(cov: Matrix): number[] | null {
  const inv = invert(cov);
  if (!inv) return null;
  return normalizeSum1(matVec(inv, cov.map(() => 1)));
}

/** Tangency (max-Sharpe) weights: w ∝ Σ⁻¹·(μ − rf), normalized to sum 1. */
export function maxSharpe(mu: number[], cov: Matrix, rf = 0): number[] | null {
  const inv = invert(cov);
  if (!inv) return null;
  return normalizeSum1(matVec(inv, mu.map((m) => m - rf)));
}

/** Clamp negatives to 0 and renormalize — a simple long-only projection (no shorting). */
export function longOnly(w: number[]): number[] {
  return normalizeSum1(w.map((x) => Math.max(0, x)));
}

export interface PortfolioStats { ret: number; vol: number; sharpe: number }

/** Expected return, volatility and Sharpe of a weight vector given μ and Σ (rf optional). */
export function portfolioStats(w: number[], mu: number[], cov: Matrix, rf = 0): PortfolioStats {
  const ret = w.reduce((s, wi, i) => s + wi * mu[i], 0);
  let variance = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) variance += w[i] * w[j] * cov[i][j];
  const vol = Math.sqrt(Math.max(0, variance));
  return { ret, vol, sharpe: vol > 0 ? (ret - rf) / vol : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 · Markowitz que SÍ se puede usar — PLAN_TEORIA_FINANCIERA_SCORA.md §2.1.
//
// La teoría de 1952 es correcta; la implementación ingenua no. Michaud (1989) llamó al
// optimizador media-varianza "una máquina de maximizar error de estimación", y Chopra &
// Ziemba (1993) midieron que un error en las MEDIAS cuesta ~11x el mismo error en las
// varianzas — siendo la media justo lo peor estimado. DeMiguel, Garlappi & Uppal (2009)
// remataron: 1/N gana a la optimización muestral fuera de muestra en casi todos los casos.
//
// De ahí las tres piezas siguientes:
//   • ledoitWolf      — encoge la covarianza, que es lo estimable
//   • blackLitterman  — evita estimar μ: parte del equilibrio y solo lo mueve lo que la
//                       evidencia MEDIDA justifique
//   • resampleWeights — muestra la incertidumbre de los pesos en vez de esconderla
// ─────────────────────────────────────────────────────────────────────────────

/** Pesos iguales (1/N) — el control de DeMiguel et al. Muéstralo SIEMPRE al lado de
 *  cualquier cartera optimizada: fuera de muestra suele ganar. */
export function equalWeights(n: number): number[] {
  return n > 0 ? Array(n).fill(1 / n) : [];
}

export interface ShrinkageResult {
  /** Covarianza encogida: delta·objetivo + (1−delta)·muestral. */
  cov: Matrix;
  /** Intensidad óptima de encogimiento en [0,1]. Alta = pocos datos para tantos activos. */
  delta: number;
  sample: Matrix;
  target: Matrix;
  /** Correlación media usada para construir el objetivo de correlación constante. */
  avgCorrelation: number;
}

/**
 * Encogimiento de Ledoit-Wolf (2004, "Honey, I Shrunk the Sample Covariance Matrix")
 * hacia el objetivo de CORRELACIÓN CONSTANTE.
 *
 * Por qué importa: con p activos hay p(p+1)/2 parámetros que estimar y rara vez hay datos
 * suficientes. La covarianza muestral es ruidosa y, si n < p, directamente SINGULAR — el
 * optimizador la invierte y escupe pesos disparatados. El encogimiento la mezcla con una
 * matriz estructurada y siempre invertible, con la intensidad que los propios datos piden.
 *
 * Nota de convención: internamente usa el estimador de máxima verosimilitud (divisor n),
 * que es para el que Ledoit-Wolf deriva delta. Para n >= 30 la diferencia con el divisor
 * n−1 de `covariance()` es despreciable.
 *
 * `series[i]` es la serie de retornos del activo i. Devuelve null con menos de 2 activos
 * o menos de 3 observaciones.
 */
export function ledoitWolf(series: number[][]): ShrinkageResult | null {
  const p = series.length;
  if (p < 2) return null;
  const n = Math.min(...series.map((s) => s.length));
  if (!isFinite(n) || n < 3) return null;

  const X = series.map((s) => s.slice(s.length - n)); // alineado por la cola
  const means = X.map((s) => s.reduce((a, b) => a + b, 0) / n);
  const D = X.map((s, i) => s.map((v) => v - means[i])); // desviaciones

  // Covarianza muestral con divisor n (convención de Ledoit-Wolf).
  const S: Matrix = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += D[i][t] * D[j][t];
      S[i][j] = S[j][i] = acc / n;
    }
  }

  const sd = S.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  // Correlación media entre pares distintos.
  let rSum = 0, rCount = 0;
  for (let i = 0; i < p; i++) {
    for (let j = i + 1; j < p; j++) {
      if (sd[i] > 0 && sd[j] > 0) { rSum += S[i][j] / (sd[i] * sd[j]); rCount++; }
    }
  }
  const rBar = rCount > 0 ? rSum / rCount : 0;

  // Objetivo F: misma diagonal, correlación constante fuera de ella.
  const F: Matrix = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    F[i][i] = S[i][i];
    for (let j = i + 1; j < p; j++) F[i][j] = F[j][i] = rBar * sd[i] * sd[j];
  }

  // pi = suma de varianzas asintóticas de los elementos de S.
  const piMat: Matrix = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += (D[i][t] * D[j][t] - S[i][j]) ** 2;
      piMat[i][j] = acc / n;
    }
  }
  let piHat = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) piHat += piMat[i][j];

  // rho = covarianza asintótica entre S y el objetivo F.
  const theta = (i: number, j: number): number => {
    // theta_ii,ij = (1/n) sum_t [(d_it)^2 − s_ii]·[d_it·d_jt − s_ij]
    let acc = 0;
    for (let t = 0; t < n; t++) acc += (D[i][t] * D[i][t] - S[i][i]) * (D[i][t] * D[j][t] - S[i][j]);
    return acc / n;
  };
  let rhoHat = 0;
  for (let i = 0; i < p; i++) rhoHat += piMat[i][i];
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      if (i === j) continue;
      if (sd[i] > 0 && sd[j] > 0) {
        rhoHat += (rBar / 2) * ((sd[j] / sd[i]) * theta(i, j) + (sd[i] / sd[j]) * theta(j, i));
      }
    }
  }

  // gamma = distancia (Frobenius) entre objetivo y muestral.
  let gammaHat = 0;
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) gammaHat += (F[i][j] - S[i][j]) ** 2;

  const delta = gammaHat > 0 ? Math.max(0, Math.min(1, (piHat - rhoHat) / gammaHat / n)) : 1;

  const cov: Matrix = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) cov[i][j] = delta * F[i][j] + (1 - delta) * S[i][j];
  }
  return { cov, delta, sample: S, target: F, avgCorrelation: rBar };
}

// ── Black-Litterman (1992) ───────────────────────────────────────────────────
// La pieza que convierte la honestidad de Scora en ARITMÉTICA (plan §3.2). En vez de
// inventar retornos esperados, parte del equilibrio implícito en los pesos de mercado y
// solo lo desplaza en la medida en que una vista tenga confianza MEDIDA (el IC del
// backtest). Con IC ≈ 0 la vista se ignora sola y la cartera vuelve al equilibrio: el
// sistema demuestra que no sabe elegir acciones en vez de prometer que sí.

/** Aversión al riesgo de mercado. 2.5 es el valor convencional (Black-Litterman original). */
export const DEFAULT_RISK_AVERSION = 2.5;
/** Escala de incertidumbre del equilibrio. 0.05 es la elección habitual. */
export const DEFAULT_TAU = 0.05;

/** Retornos de equilibrio implícitos por ingeniería inversa de los pesos de mercado:
 *  Pi = lambda · Sigma · w_mkt. Es "qué retornos tendría que esperar el mercado para
 *  que estos pesos fueran óptimos". */
export function impliedEquilibriumReturns(cov: Matrix, marketWeights: number[], riskAversion = DEFAULT_RISK_AVERSION): number[] {
  return cov.map((row) => riskAversion * row.reduce((s, v, j) => s + v * marketWeights[j], 0));
}

export interface BlView {
  /** Vector de selección sobre los activos. [0,1,-1] = "el activo 1 bate al 2". */
  pick: number[];
  /** Retorno esperado de la vista (misma unidad que los retornos usados en la covarianza). */
  q: number;
  /** Confianza en [0,1). 0 = ninguna (la vista se ignora); ->1 = certeza.
   *  AQUÍ es donde entra el IC medido: confianza = |IC| normalizado, nunca a ojo. */
  confidence: number;
}

export interface BlackLittermanResult {
  /** Retornos de equilibrio (prior). */
  prior: number[];
  /** Retornos posteriores tras incorporar las vistas. */
  posterior: number[];
  /** Pesos óptimos con los retornos posteriores: w = (lambda·Sigma)^-1 · mu. */
  weights: number[];
  /** Pesos de equilibrio de referencia (los de mercado), para comparar. */
  priorWeights: number[];
  /** Desplazamiento total |posterior − prior| sumado: cuánto movieron las vistas. */
  totalShift: number;
}

/** Confianza máxima admitida: 1 exacto haría Omega = 0 y la matriz singular. */
const MAX_CONFIDENCE = 0.999;

/**
 * Black-Litterman con Omega derivada de la confianza (estilo Idzorek):
 *   Omega_kk = (P_k · tau·Sigma · P_k') · (1/conf − 1)
 * de modo que conf -> 0 hace Omega -> infinito (vista ignorada) y conf -> 1 la impone.
 *
 * Devuelve null si las dimensiones no cuadran o si alguna matriz resulta singular.
 */
export function blackLitterman(opts: {
  cov: Matrix;
  marketWeights: number[];
  views: BlView[];
  riskAversion?: number;
  tau?: number;
}): BlackLittermanResult | null {
  const { cov, marketWeights, views } = opts;
  const lambda = opts.riskAversion ?? DEFAULT_RISK_AVERSION;
  const tau = opts.tau ?? DEFAULT_TAU;
  const p = cov.length;
  if (p === 0 || marketWeights.length !== p) return null;
  if (views.some((v) => v.pick.length !== p)) return null;

  const prior = impliedEquilibriumReturns(cov, marketWeights, lambda);
  const tauSigma: Matrix = cov.map((row) => row.map((v) => tau * v));
  const invTauSigma = invert(tauSigma);
  if (!invTauSigma) return null;

  // Sin vistas (o todas con confianza nula) el posterior ES el equilibrio.
  const usable = views.filter((v) => v.confidence > 0);
  const finish = (posterior: number[]): BlackLittermanResult | null => {
    const lambdaSigma: Matrix = cov.map((row) => row.map((v) => lambda * v));
    const invLS = invert(lambdaSigma);
    if (!invLS) return null;
    const weights = invLS.map((row) => row.reduce((s, v, j) => s + v * posterior[j], 0));
    return {
      prior,
      posterior,
      weights,
      priorWeights: [...marketWeights],
      totalShift: posterior.reduce((s, v, i) => s + Math.abs(v - prior[i]), 0),
    };
  };
  if (usable.length === 0) return finish([...prior]);

  // A = (tau·Sigma)^-1 + P'·Omega^-1·P   y   b = (tau·Sigma)^-1·Pi + P'·Omega^-1·Q
  const A: Matrix = invTauSigma.map((row) => [...row]);
  const b: number[] = invTauSigma.map((row) => row.reduce((s, v, j) => s + v * prior[j], 0));

  for (const v of usable) {
    const conf = Math.min(MAX_CONFIDENCE, v.confidence);
    // P_k · tau·Sigma · P_k'
    const tsP = tauSigma.map((row) => row.reduce((s, x, j) => s + x * v.pick[j], 0));
    const variance = v.pick.reduce((s, x, i) => s + x * tsP[i], 0);
    if (!(variance > 0)) continue; // vista degenerada (pick nulo): se ignora
    const omega = variance * (1 / conf - 1);
    if (!(omega > 0) || !isFinite(omega)) continue;
    const invOmega = 1 / omega;
    for (let i = 0; i < p; i++) {
      b[i] += invOmega * v.pick[i] * v.q;
      for (let j = 0; j < p; j++) A[i][j] += invOmega * v.pick[i] * v.pick[j];
    }
  }

  const invA = invert(A);
  if (!invA) return null;
  const posterior = invA.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  return finish(posterior);
}

// ── Frontera remuestreada (Michaud) ──────────────────────────────────────────

/** PRNG determinista (mulberry32): el remuestreo debe ser REPRODUCIBLE — un intervalo de
 *  confianza que cambia en cada recarga no es un intervalo de confianza. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ResampledWeights {
  mean: number[];
  /** Desviación típica de cada peso entre remuestreos: la banda de incertidumbre. */
  stdDev: number[];
  /** Percentiles 5 y 95 por activo. */
  p05: number[];
  p95: number[];
  draws: number;
}

/**
 * Remuestreo de Michaud: bootstrap de las observaciones, se reoptimiza en cada réplica y
 * se reporta la DISPERSIÓN de los pesos. Mata la falsa precisión — "AAPL 12%" se convierte
 * en "AAPL 12% ± 9%", que es la verdad.
 *
 * `optimizer` recibe la matriz de covarianzas remuestreada y los retornos medios, y
 * devuelve los pesos (o null si esa réplica no se puede resolver).
 */
export function resampleWeights(
  series: number[][],
  optimizer: (cov: Matrix, mu: number[]) => number[] | null,
  opts?: { draws?: number; seed?: number }
): ResampledWeights | null {
  const p = series.length;
  if (p < 2) return null;
  const n = Math.min(...series.map((s) => s.length));
  if (!isFinite(n) || n < 5) return null;
  const draws = opts?.draws ?? 200;
  const rand = mulberry32(opts?.seed ?? 42);
  const X = series.map((s) => s.slice(s.length - n));

  const collected: number[][] = [];
  for (let d = 0; d < draws; d++) {
    // Bootstrap por FECHA (se remuestrean columnas enteras) para preservar la
    // correlación entre activos — remuestrear cada activo por su cuenta la destruiría.
    const idx: number[] = [];
    for (let t = 0; t < n; t++) idx.push(Math.floor(rand() * n));
    const rs = X.map((s) => idx.map((i) => s[i]));
    const cv = covariance(rs);
    const mu = rs.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
    const w = optimizer(cv, mu);
    if (w && w.length === p && w.every((x) => isFinite(x))) collected.push(w);
  }
  if (collected.length < 2) return null;

  const q = (sorted: number[], frac: number): number =>
    sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(frac * (sorted.length - 1))))];

  const mean: number[] = [], stdDev: number[] = [], p05: number[] = [], p95: number[] = [];
  for (let i = 0; i < p; i++) {
    const col = collected.map((w) => w[i]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((s, x) => s + (x - m) ** 2, 0) / (col.length - 1));
    const sorted = [...col].sort((a, b) => a - b);
    mean.push(m); stdDev.push(sd); p05.push(q(sorted, 0.05)); p95.push(q(sorted, 0.95));
  }
  return { mean, stdDev, p05, p95, draws: collected.length };
}

/** Sample covariance matrix from aligned return series (columns = assets). */
export function covariance(series: number[][]): Matrix {
  const k = series.length;
  const n = Math.min(...series.map((s) => s.length));
  const means = series.map((s) => s.slice(0, n).reduce((a, b) => a + b, 0) / n);
  const cov: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += (series[i][t] - means[i]) * (series[j][t] - means[j]);
      const c = n > 1 ? acc / (n - 1) : 0;
      cov[i][j] = cov[j][i] = c;
    }
  }
  return cov;
}
