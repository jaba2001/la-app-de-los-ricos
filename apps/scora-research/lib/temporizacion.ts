// ─────────────────────────────────────────────────────────────────────────────
// ¿HAY HABILIDAD DE TEMPORIZACIÓN? — los dos tests formales
//
// El edge que Scora declara es la ASIGNACIÓN POR RÉGIMEN: saber cuándo estar dentro y cuándo
// fuera. Eso es *market timing*, y tiene dos contrastes publicados que lo atacan en su propio
// terreno. Los dos son regresiones sobre el exceso de retorno.
//
//   **Merton-Henriksson (1981)** — beta dual:
//       Rp − Rf = α + β⁻(Rm − Rf) + γ·(Rm − Rf)·D        D = 1 si Rm > Rf
//     `β⁻` es la beta en mercados bajistas y `β⁻ + γ` la alcista. **γ > 0 = la beta SUBE cuando
//     el mercado sube**, que es exactamente lo que el allocator afirma hacer.
//
//   **Treynor-Mazuy (1966)** — convexidad:
//       Rp − Rf = α + β(Rm − Rf) + γ(Rm − Rf)² + u
//     Mide lo mismo por la curvatura. Que los dos coincidan es la comprobación cruzada.
//
// ⚠️ **NEWEY-WEST NO ES OPCIONAL.** Los retornos mensuales de una estrategia con reequilibrio
// mensual están autocorrelacionados, y con errores estándar OLS simples el estadístico sale
// INFLADO. En la sonda exploratoria del 2026-09-03, con OLS crudo, el γ de Merton-Henriksson
// contra el 60/40 daba t = 2,13; ese número no se puede publicar sin corregir, porque parte de
// él es la autocorrelación haciéndose pasar por evidencia.
//
// ⚠️ Y LA REFERENCIA TIENE QUE SER LA DEL MANDATO. Contra el S&P 500, una estrategia que lleva
// renta fija parecerá tener timing sólo por no ser 100 % bolsa: la beta baja en las caídas
// porque los bonos suben, no porque nadie haya acertado el momento. Por eso se corre contra el
// 60/40 además de contra el índice, y se publican los dos.
// ─────────────────────────────────────────────────────────────────────────────

export interface Regresion {
  coef: number[];
  errorTipico: number[];
  t: number[];
  n: number;
  k: number;
  /** Rezagos usados en Newey-West. 0 = errores OLS simples. */
  rezagos: number;
}

/** Invierte una matriz cuadrada por Gauss-Jordan. `null` si es singular. */
function invertir(A: number[][]): number[][] | null {
  const k = A.length;
  const M = A.map((fila, i) => [...fila, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * k; j++) M[c][j] /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r) => r.slice(k));
}

/**
 * Rezagos de Newey-West por la regla de Newey-West (1994): `floor(4·(T/100)^(2/9))`.
 *
 * Se usa una regla y no un número a ojo porque elegir el rezago mirando el resultado es
 * exactamente la clase de decisión que convierte un contraste en una búsqueda.
 */
export function rezagosNW(T: number): number {
  return Math.max(1, Math.floor(4 * Math.pow(T / 100, 2 / 9)));
}

/**
 * Mínimos cuadrados con errores estándar de Newey-West (HAC).
 *
 * `rezagos = 0` da los errores OLS clásicos, que sirven para ver cuánto infla la
 * autocorrelación — no para publicar.
 */
export function ols(y: number[], X: number[][], rezagos: number | null = null): Regresion | null {
  const n = y.length, k = X[0].length;
  if (n <= k) return null;
  const L = rezagos == null ? rezagosNW(n) : rezagos;

  const XtX: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty: number[] = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const inv = invertir(XtX);
  if (!inv) return null;
  const coef = inv.map((fila) => fila.reduce((s, v, j) => s + v * Xty[j], 0));

  const u: number[] = [];
  for (let i = 0; i < n; i++) {
    let yh = 0;
    for (let a = 0; a < k; a++) yh += X[i][a] * coef[a];
    u.push(y[i] - yh);
  }

  // Matriz "meat" de Newey-West: S = Γ₀ + Σ_{l=1..L} w_l (Γ_l + Γ_lᵀ), con pesos de Bartlett.
  const S: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  const acumular = (l: number, peso: number) => {
    for (let i = l; i < n; i++) {
      for (let a = 0; a < k; a++) {
        for (let b = 0; b < k; b++) {
          const g = X[i][a] * u[i] * X[i - l][b] * u[i - l];
          S[a][b] += peso * (l === 0 ? g : g + X[i - l][a] * u[i - l] * X[i][b] * u[i]);
        }
      }
    }
  };
  acumular(0, 1);
  for (let l = 1; l <= L; l++) acumular(l, 1 - l / (L + 1));

  // Var(β) = (XtX)⁻¹ S (XtX)⁻¹, con el ajuste de grados de libertad n/(n−k).
  const ajuste = n / (n - k);
  const V: number[][] = Array.from({ length: k }, () => Array(k).fill(0));
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      let acc = 0;
      for (let p = 0; p < k; p++) for (let q = 0; q < k; q++) acc += inv[a][p] * S[p][q] * inv[q][b];
      V[a][b] = acc * ajuste;
    }
  }
  const errorTipico = V.map((fila, i) => Math.sqrt(Math.max(fila[i], 0)));
  return { coef, errorTipico, t: coef.map((c, i) => (errorTipico[i] === 0 ? 0 : c / errorTipico[i])), n, k, rezagos: L };
}

export interface Temporizacion {
  alfa: number; alfaT: number;
  betaBajista: number; betaAlcista: number;
  gamma: number; gammaT: number;
  significativo: boolean;
  n: number; rezagos: number;
}

/** Merton-Henriksson: `γ > 0` significativo = la beta sube en mercados alcistas. */
export function mertonHenriksson(cartera: number[], indice: number[], rf: number[] | number = 0): Temporizacion | null {
  const n = Math.min(cartera.length, indice.length);
  const rfa = (i: number) => (typeof rf === "number" ? rf / 12 : (rf[i] ?? 0));
  const y: number[] = [], X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = indice[i] - rfa(i);
    y.push(cartera[i] - rfa(i));
    X.push([1, x, x > 0 ? x : 0]);
  }
  const r = ols(y, X);
  if (!r) return null;
  return {
    alfa: +r.coef[0].toFixed(4), alfaT: +r.t[0].toFixed(2),
    betaBajista: +r.coef[1].toFixed(3), betaAlcista: +(r.coef[1] + r.coef[2]).toFixed(3),
    gamma: +r.coef[2].toFixed(4), gammaT: +r.t[2].toFixed(2),
    significativo: r.t[2] >= 2, n: r.n, rezagos: r.rezagos,
  };
}

/** Treynor-Mazuy: `γ > 0` significativo = la relación con el mercado es convexa. */
export function treynorMazuy(cartera: number[], indice: number[], rf: number[] | number = 0): Temporizacion | null {
  const n = Math.min(cartera.length, indice.length);
  const rfa = (i: number) => (typeof rf === "number" ? rf / 12 : (rf[i] ?? 0));
  const y: number[] = [], X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = indice[i] - rfa(i);
    y.push(cartera[i] - rfa(i));
    X.push([1, x, x * x]);
  }
  const r = ols(y, X);
  if (!r) return null;
  return {
    alfa: +r.coef[0].toFixed(4), alfaT: +r.t[0].toFixed(2),
    betaBajista: +r.coef[1].toFixed(3), betaAlcista: +r.coef[1].toFixed(3),   // TM tiene UNA beta
    gamma: +r.coef[2].toFixed(5), gammaT: +r.t[2].toFixed(2),
    significativo: r.t[2] >= 2, n: r.n, rezagos: r.rezagos,
  };
}
