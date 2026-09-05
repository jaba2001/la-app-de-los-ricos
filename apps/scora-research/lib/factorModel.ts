// ─────────────────────────────────────────────────────────────────────────────
// MULTI-FACTOR RISK MODEL (F1) — la piedra angular de PLAN_TEORIA_FINANCIERA_SCORA.md.
// Une CAPM (Sharpe 1964: solo el riesgo sistemático se paga) y APT (Ross 1976: los retornos
// los genera un modelo de k factores, por no-arbitraje y sin cartera de mercado).
//
// Una sola regresión MCO produce las CUATRO salidas que el resto del plan necesita:
//   • betas por factor        → motor de escenarios y mapa de exposición de cartera
//   • varianza idiosincrática → coste de arbitraje (Pontiff 2006) y el panel
//                               "riesgo por el que nadie te paga" (CAPM)
//   • t-stats + R²            → el grado de señal del Libro de Evidencia
//   • cuotas de varianza      → qué mueve de verdad a esta acción / cartera
//
// PUNTO METODOLÓGICO CRÍTICO (Chen-Roll-Ross 1986): se regresa sobre INNOVACIONES
// (sorpresas: diferencias o residuos AR(1)), nunca sobre niveles. Un nivel no es un shock.
// Ver `innovations()`.
//
// Puro y headless: reutiliza `invert` de ./optimize.ts y `fitAR` de ./arima.ts (ambos
// módulos sin imports y ya cubiertos por p2.test.mjs) — un solo camino de código.
// ─────────────────────────────────────────────────────────────────────────────
import { invert } from "./optimize.ts";
import { fitAR } from "./arima.ts";

/** Observaciones mínimas por parámetro estimado para considerar el ajuste fiable.
 *  Regla de oficio: ~10 por parámetro. Con 7 factores + intercepto son 80 meses. */
export const MIN_OBS_PER_PARAM = 10;

/** Umbral |t| convencional en finanzas para "distinguible de cero". No es un p-valor:
 *  con n pequeño la t de Student tiene colas más gordas que la normal, así que es una
 *  regla de oficio deliberadamente cruda — y se reporta el t crudo para que el lector juzgue. */
export const T_SIGNIFICANT = 2;

// ── Innovaciones ─────────────────────────────────────────────────────────────
export type InnovationMethod = "level" | "diff" | "pct" | "ar1";

/**
 * Convierte una serie de NIVELES en la serie de SORPRESAS que exige la APT.
 * - `level`: sin transformar (úsalo solo si la serie YA es un retorno/cambio).
 * - `diff` : primera diferencia, el shock absoluto (p.ej. delta del spread en pb).
 * - `pct`  : cambio porcentual, para series de precio (petróleo, dólar).
 * - `ar1`  : residuo de un AR(1), la parte NO anticipada (lo más fiel a Chen-Roll-Ross).
 *
 * `diff`, `pct` y `ar1` devuelven n−1 observaciones. Alinea siempre por la COLA
 * (ver `fitFactorModel`): todas las series terminan en la misma fecha.
 */
export function innovations(series: number[], method: InnovationMethod = "diff"): number[] {
  const s = series.filter((x) => x != null && isFinite(x));
  if (method === "level") return [...s];
  if (s.length < 2) return [];
  if (method === "diff") {
    const out: number[] = [];
    for (let i = 1; i < s.length; i++) out.push(s[i] - s[i - 1]);
    return out;
  }
  if (method === "pct") {
    const out: number[] = [];
    // Un denominador 0 haría infinito el cambio: se emite 0 (sin sorpresa medible)
    // en vez de contaminar toda la regresión con un Infinity/NaN.
    for (let i = 1; i < s.length; i++) out.push(s[i - 1] !== 0 ? (s[i] / s[i - 1] - 1) * 100 : 0);
    return out;
  }
  // ar1: residuos del AR(1). Si no converge se degrada a primera diferencia, en vez de
  // devolver vacío y perder el factor entero.
  const fit = fitAR(s, 1);
  if (fit && fit.resid.length) return [...fit.resid];
  const out: number[] = [];
  for (let i = 1; i < s.length; i++) out.push(s[i] - s[i - 1]);
  return out;
}

// ── Resultado ────────────────────────────────────────────────────────────────
export interface FactorLoading {
  factor: string;
  beta: number;
  stdError: number;
  tStat: number;
  significant: boolean;
  /** Cuota CON SIGNO de la varianza TOTAL de y explicada por este factor.
   *  La suma de todas es exactamente rSquared (descomposición por covarianzas: con
   *  factores correlacionados una cuota individual PUEDE ser negativa — es honesto). */
  varianceShare: number;
}

export interface FactorModel {
  /** Intercepto por periodo: el alfa no explicado por los factores. */
  alpha: number;
  alphaStdError: number;
  alphaTStat: number;
  loadings: FactorLoading[];
  n: number;
  k: number;
  rSquared: number;
  adjRSquared: number;
  /** Desviación típica por periodo de los residuos = riesgo idiosincrático. */
  residualVol: number;
  systematicShare: number;
  idiosyncraticShare: number;
  reliable: boolean;
  warnings: string[];
}

const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Covarianza muestral (denominador n−1) de dos series ya alineadas. */
function cov(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (a[i] - ma) * (b[i] - mb);
  return acc / (n - 1);
}

/**
 * Ajusta y = alfa + suma(beta_j · f_j) + e por MCO.
 *
 * `y` y cada serie de `factors` deben ser INNOVACIONES ya transformadas y expresadas en
 * la MISMA unidad temporal (p.ej. mensual). Las series se alinean por la COLA a la
 * longitud mínima común: todas acaban en la misma fecha, se descarta lo más antiguo.
 *
 * Devuelve null si no hay datos suficientes o si X'X es singular (factores colineales).
 */
export function fitFactorModel(
  y: number[],
  factors: Record<string, number[]>,
  opts?: { minObsPerParam?: number }
): FactorModel | null {
  const names = Object.keys(factors);
  const warnings: string[] = [];
  if (!y.length || names.length === 0) return null;

  // Alineación por la cola.
  const n = Math.min(y.length, ...names.map((f) => factors[f].length));
  const k = names.length + 1; // + intercepto
  if (n < k + 2) return null; // sin grados de libertad para estimar s²
  const tail = (a: number[]): number[] => a.slice(a.length - n);
  const Y = tail(y);
  const F = names.map((f) => tail(factors[f]));

  // Un factor constante no tiene varianza: es colineal con el intercepto y haría
  // singular a X'X. Se detecta antes para poder devolver un motivo, no solo null.
  for (let j = 0; j < names.length; j++) {
    if (cov(F[j], F[j]) === 0) return null;
  }

  // X = [1, f1, ..., fk]  (n × k)
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < names.length; j++) row.push(F[j][i]);
    X.push(row);
  }

  // X'X (k×k) y X'y (k)
  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty: number[] = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * Y[i];
      for (let b = a; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];

  const inv = invert(XtX);
  if (!inv) return null; // colinealidad perfecta

  const coef: number[] = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));

  // Ajustados, residuos, sumas de cuadrados.
  const fitted: number[] = [];
  const resid: number[] = [];
  for (let i = 0; i < n; i++) {
    const yh = X[i].reduce((s, x, j) => s + x * coef[j], 0);
    fitted.push(yh);
    resid.push(Y[i] - yh);
  }
  const rss = resid.reduce((s, e) => s + e * e, 0);
  const my = mean(Y);
  const tss = Y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - k;
  const s2 = df > 0 ? rss / df : 0;

  const rSquared = tss > 0 ? 1 - rss / tss : 0;
  const adjRSquared = tss > 0 && df > 0 ? 1 - (1 - rSquared) * ((n - 1) / df) : 0;

  const se = (j: number): number => {
    const v = s2 * inv[j][j];
    return v > 0 ? Math.sqrt(v) : 0;
  };

  const varY = tss / (n - 1);
  const loadings: FactorLoading[] = names.map((name, j) => {
    const b = coef[j + 1];
    const e = se(j + 1);
    // Descomposición exacta: contribucion_j = beta_j·cov(f_j, ajustados) / var(y).
    // La suma sobre j da R² (ver test en p2.test.mjs).
    const share = varY > 0 ? (b * cov(F[j], fitted)) / varY : 0;
    return {
      factor: name,
      beta: b,
      stdError: e,
      tStat: e > 0 ? b / e : 0,
      significant: e > 0 && Math.abs(b / e) >= T_SIGNIFICANT,
      varianceShare: share,
    };
  });

  const minPer = opts?.minObsPerParam ?? MIN_OBS_PER_PARAM;
  const reliable = n >= minPer * k;
  if (!reliable) {
    warnings.push(
      `Solo ${n} observaciones para ${k} parámetros (${(n / k).toFixed(1)} por parámetro; ` +
      `la regla de oficio pide ${minPer}). Betas y t-stats son indicativos, no concluyentes.`
    );
  }
  if (rSquared < 0.1) {
    warnings.push(`R² de ${(rSquared * 100).toFixed(0)}%: los factores explican muy poco. Trata las betas con escepticismo.`);
  }

  const aSe = se(0);
  return {
    alpha: coef[0],
    alphaStdError: aSe,
    alphaTStat: aSe > 0 ? coef[0] / aSe : 0,
    loadings,
    n,
    k,
    rSquared,
    adjRSquared,
    residualVol: Math.sqrt(Math.max(0, s2)),
    systematicShare: rSquared,
    idiosyncraticShare: 1 - rSquared,
    reliable,
    warnings,
  };
}

// ── Escenarios (la salida natural de la APT) ─────────────────────────────────
export interface ScenarioLeg { factor: string; beta: number; shock: number; impact: number }
export interface ScenarioResult {
  /** Impacto total esperado sobre y, en las MISMAS unidades que y (p.ej. % mensual). */
  total: number;
  legs: ScenarioLeg[];
  /** Factores del shock que el modelo no conoce (se ignoran, pero se avisa). */
  ignored: string[];
  /** Factores del modelo sin shock definido (se asumen quietos). */
  unshocked: string[];
}

/**
 * Valora un shock de factores con las betas ajustadas: delta_y ≈ suma(beta_j · shock_j).
 * Los shocks deben ir en las MISMAS unidades que las innovaciones usadas al ajustar
 * (si el factor se ajustó con `diff` sobre un spread en pb, el shock va en pb).
 * Es una aproximación lineal: no captura convexidad ni cambios de régimen en las betas.
 */
export function scenarioImpact(model: FactorModel, shocks: Record<string, number>): ScenarioResult {
  const known = new Set(model.loadings.map((l) => l.factor));
  const legs: ScenarioLeg[] = [];
  const unshocked: string[] = [];
  for (const l of model.loadings) {
    const sh = shocks[l.factor];
    if (sh == null || !isFinite(sh)) { unshocked.push(l.factor); continue; }
    legs.push({ factor: l.factor, beta: l.beta, shock: sh, impact: l.beta * sh });
  }
  legs.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return {
    total: legs.reduce((s, l) => s + l.impact, 0),
    legs,
    ignored: Object.keys(shocks).filter((f) => !known.has(f)),
    unshocked,
  };
}

// ── Cartera ──────────────────────────────────────────────────────────────────
/**
 * Serie de retornos de una cartera de pesos FIJOS a partir de los retornos por activo.
 * `assetReturns[i]` es la serie del activo i; se alinean por la cola. Pesos y series
 * deben venir en el mismo orden. Devuelve [] si no hay solape suficiente.
 */
export function portfolioReturns(weights: number[], assetReturns: number[][]): number[] {
  if (!weights.length || weights.length !== assetReturns.length) return [];
  const n = Math.min(...assetReturns.map((r) => r.length));
  if (!isFinite(n) || n < 1) return [];
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
      const s = assetReturns[i];
      acc += weights[i] * s[s.length - n + t];
    }
    out.push(acc);
  }
  return out;
}

// ── Lectura en lenguaje llano ────────────────────────────────────────────────
/**
 * Traduce las cargas a frases legibles, de mayor a menor peso en varianza.
 * `labels` mapea el nombre técnico del factor a uno humano ("hy_oas" → "spread de crédito").
 * Por defecto solo describe las significativas: decir "corto dólar" con t=0.3 sería ruido.
 */
export function explainLoadings(
  model: FactorModel,
  labels: Record<string, string> = {},
  opts?: { includeInsignificant?: boolean }
): string[] {
  const wanted = opts?.includeInsignificant ? model.loadings : model.loadings.filter((l) => l.significant);
  return [...wanted]
    .sort((a, b) => Math.abs(b.varianceShare) - Math.abs(a.varianceShare))
    .map((l) => {
      const name = labels[l.factor] ?? l.factor;
      const dir = l.beta >= 0 ? "largo" : "corto";
      const flag = l.significant ? "" : " · no significativa";
      return `${dir} ${name} (beta ${l.beta >= 0 ? "+" : ""}${l.beta.toFixed(2)}, t ${l.tStat.toFixed(1)}, ${(l.varianceShare * 100).toFixed(0)}% de la varianza${flag})`;
    });
}
