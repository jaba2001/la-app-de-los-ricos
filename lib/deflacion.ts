// ─────────────────────────────────────────────────────────────────────────────
// SHARPE DEFLACTADO — Bailey & López de Prado (2014)
//
// La pregunta que contesta: **si he probado N estrategias, ¿qué probabilidad hay de que el mejor
// Sharpe que he encontrado sea real y no el máximo de N intentos sobre ruido?**
//
// El repo ya venía deflactando a mano, comparando contra `√(2·ln N)`. Esto lo hace bien y añade
// las dos correcciones que faltaban:
//
//   1. **La forma de la distribución.** El Sharpe supone normalidad. Con colas gruesas —la serie
//      del allocator tiene exceso de curtosis +2,52— el error del propio Sharpe es MAYOR de lo
//      que la fórmula normal sugiere, así que exigir menos sería engañarse.
//   2. **El umbral del máximo esperado**, que depende de N y no de una regla del pulgar.
//
//     SR₀ = √Var(SR) · [ (1−γ)·Φ⁻¹(1 − 1/N) + γ·Φ⁻¹(1 − 1/(N·e)) ]        γ = Euler-Mascheroni
//
//     DSR = Φ( (SR − SR₀)·√(T−1) / √(1 − γ₃·SR + (γ₄−1)/4·SR²) )
//
// `DSR` es la probabilidad de que el Sharpe observado supere al que produciría el azar tras N
// intentos. Por convenio se exige **DSR > 0,95**.
//
// ⚠️ Todos los Sharpe de aquí son POR PERIODO (mensuales), no anualizados. Anualizar antes de
// meterlos en estas fórmulas es el mismo error que ya se cometió con Jobson-Korkie: la
// derivación es por observación.
// ─────────────────────────────────────────────────────────────────────────────

const GAMMA = 0.5772156649015329;   // Euler-Mascheroni

/** Φ(x) — normal estándar acumulada, por la aproximación de Abramowitz-Stegun (error < 7,5e-8). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Φ⁻¹(p) — inversa, por el algoritmo de Acklam. */
export function normalInv(p: number): number {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface Deflacion {
  sharpeObservado: number;
  sharpeUmbral: number;
  dsr: number;
  supera: boolean;
  ensayos: number;
  observaciones: number;
}

/**
 * Sharpe deflactado.
 *
 * @param sharpePorPeriodo  Sharpe MENSUAL observado (no anualizado)
 * @param T                 número de observaciones
 * @param ensayos           cuántas estrategias se han probado sobre estos datos
 * @param asimetria         γ₃ de los retornos
 * @param curtosis          γ₄ — curtosis TOTAL, no el exceso (normal = 3)
 * @param varianzaSharpes   varianza de los Sharpe de los ensayos probados. Sin ella se usa
 *                          `1/T`, que es la varianza asintótica de UN Sharpe bajo la nula: es
 *                          conservador y no exige inventarse un dato que no se tiene.
 */
export function sharpeDeflactado(
  sharpePorPeriodo: number, T: number, ensayos: number,
  asimetria = 0, curtosis = 3, varianzaSharpes: number | null = null,
): Deflacion {
  const N = Math.max(2, ensayos);
  const v = varianzaSharpes ?? 1 / T;
  const umbral = Math.sqrt(v) * ((1 - GAMMA) * normalInv(1 - 1 / N) + GAMMA * normalInv(1 - 1 / (N * Math.E)));

  // Denominador: el error del Sharpe corregido por asimetría y curtosis.
  const den = Math.sqrt(Math.max(1e-12, 1 - asimetria * sharpePorPeriodo + ((curtosis - 1) / 4) * sharpePorPeriodo * sharpePorPeriodo));
  const dsr = normalCdf(((sharpePorPeriodo - umbral) * Math.sqrt(Math.max(T - 1, 1))) / den);
  return {
    sharpeObservado: sharpePorPeriodo, sharpeUmbral: umbral,
    dsr, supera: dsr > 0.95, ensayos: N, observaciones: T,
  };
}
