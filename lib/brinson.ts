// ─────────────────────────────────────────────────────────────────────────────
// ATRIBUCIÓN DE BRINSON — ¿de dónde viene el resultado?
//
// Separa el retorno activo (cartera − referencia) en dos causas:
//
//   ASIGNACIÓN — poner más o menos que la referencia en una categoría que lo hizo mejor o peor
//                que el conjunto. Es la decisión de CUÁNTO.
//   SELECCIÓN  — que lo que se tiene DENTRO de la categoría rinda distinto que la categoría.
//                Es la decisión de CUÁL.
//
// Con la notación del temario (Gestión de Activos y Carteras, «método práctico»):
//
//     Asignación(k) = (w_p,k − w_b,k) × (r_b,k − R_b)
//     Selección(k)  = (r_p,k − r_b,k) × w_p,k
//
// ⚠️ **EL CRITERIO ES EL CUADRE, y es innegociable.** Las dos contribuciones tienen que sumar
// EXACTAMENTE el retorno activo. En el ejemplo resuelto del curso: −4 % + 0,3 % = −3,7 %. Si no
// cuadra, la atribución está mal y no se publica — el mismo listón que el Sankey.
//
// ⚠️ Y ESTA VARIANTE MANDA LA INTERACCIÓN A «SELECCIÓN», porque usa el peso de la CARTERA y no el
// de la referencia en el término de selección. Es el convenio de dos factores del temario. La
// variante de tres factores separa la interacción; las dos son correctas y **no se pueden
// mezclar**: hay que decir cuál se usa, y aquí es ésta.
//
// Pesos en FRACCIÓN (0,60) y retornos en PORCENTAJE (15 = +15 %).
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaBrinson {
  categoria: string;
  pesoCartera: number; pesoReferencia: number;
  retornoCartera: number; retornoReferencia: number;
  asignacion: number; seleccion: number;
}

export interface Atribucion {
  filas: FilaBrinson[];
  retornoCartera: number;
  retornoReferencia: number;
  retornoActivo: number;
  totalAsignacion: number;
  totalSeleccion: number;
  /** `retornoActivo − (asignación + selección)`. Tiene que ser ~0 o la atribución no vale. */
  residuo: number;
  cuadra: boolean;
}

export interface EntradaCategoria {
  categoria: string;
  pesoCartera: number; pesoReferencia: number;
  /** `null` cuando la cartera no tiene nada de la categoría: no hay retorno que atribuir. */
  retornoCartera: number | null;
  retornoReferencia: number;
}

/**
 * Atribución de un periodo.
 *
 * ⚠️ Si la cartera no tiene nada de una categoría, su retorno es `null` y el término de selección
 * es CERO por construcción —no se puede seleccionar dentro de algo que no se tiene—, pero el de
 * asignación NO lo es: **no tener algo que la referencia sí tiene es una apuesta**, y del tamaño
 * del peso de la referencia. Tratarlo como cero sería regalar la mitad de la historia, y es
 * exactamente lo que hace Scora Picks al no llevar las megacapitalizaciones.
 */
export function atribuir(entradas: EntradaCategoria[], tolerancia = 1e-9): Atribucion {
  const Rb = entradas.reduce((s, e) => s + e.pesoReferencia * e.retornoReferencia, 0);
  const Rp = entradas.reduce((s, e) => s + e.pesoCartera * (e.retornoCartera ?? 0), 0);

  const filas: FilaBrinson[] = entradas.map((e) => ({
    categoria: e.categoria,
    pesoCartera: e.pesoCartera, pesoReferencia: e.pesoReferencia,
    retornoCartera: e.retornoCartera ?? 0, retornoReferencia: e.retornoReferencia,
    asignacion: (e.pesoCartera - e.pesoReferencia) * (e.retornoReferencia - Rb),
    seleccion: e.retornoCartera == null ? 0 : (e.retornoCartera - e.retornoReferencia) * e.pesoCartera,
  }));

  const totalAsignacion = filas.reduce((s, f) => s + f.asignacion, 0);
  const totalSeleccion = filas.reduce((s, f) => s + f.seleccion, 0);
  const retornoActivo = Rp - Rb;
  const residuo = retornoActivo - (totalAsignacion + totalSeleccion);
  return {
    filas, retornoCartera: Rp, retornoReferencia: Rb, retornoActivo,
    totalAsignacion, totalSeleccion, residuo, cuadra: Math.abs(residuo) <= tolerancia,
  };
}

/**
 * Encadena la atribución de varios periodos.
 *
 * ⚠️ **SUMAR LAS ATRIBUCIONES MENSUALES NO DA LA ATRIBUCIÓN DEL PERIODO**, porque los retornos
 * componen y las contribuciones no. La suma aritmética es la aproximación estándar de primer
 * orden y es la que se usa aquí; el residuo de composición **se reporta aparte** en vez de
 * repartirlo en silencio, que es lo que hacen los sistemas comerciales con sus métodos de
 * *smoothing* — y repartir un residuo sin decirlo es inventar atribución.
 */
export function encadenar(periodos: Atribucion[]): {
  asignacion: number; seleccion: number; retornoActivoSumado: number;
  retornoActivoCompuesto: number; residuoComposicion: number; periodos: number; todosCuadran: boolean;
} {
  const asignacion = periodos.reduce((s, p) => s + p.totalAsignacion, 0);
  const seleccion = periodos.reduce((s, p) => s + p.totalSeleccion, 0);
  const retornoActivoSumado = periodos.reduce((s, p) => s + p.retornoActivo, 0);
  let ep = 1, eb = 1;
  for (const p of periodos) { ep *= 1 + p.retornoCartera / 100; eb *= 1 + p.retornoReferencia / 100; }
  const retornoActivoCompuesto = (ep - eb) * 100;
  return {
    asignacion, seleccion, retornoActivoSumado, retornoActivoCompuesto,
    residuoComposicion: retornoActivoCompuesto - retornoActivoSumado,
    periodos: periodos.length, todosCuadran: periodos.every((p) => p.cuadra),
  };
}

/**
 * Encadenado de Carino (1999) — el que hace que las contribuciones sumen el retorno COMPUESTO.
 *
 * ⚠️ **EXISTE PORQUE `encadenar()` NO BASTA, y el número lo dejaba claro.** Sumar las
 * atribuciones mensuales del allocator daba 55,6 pp, mientras que el retorno activo compuesto de
 * los mismos 236 meses es **332,7 pp**: un residuo de 277 pp, cinco veces mayor que aquello que
 * decía descomponer. Con esa diferencia, decir «la asignación aporta 53,4 pp» es incorrecto en
 * magnitud aunque el reparto relativo sea informativo.
 *
 * Carino resuelve la incoherencia con un factor de escala por periodo:
 *
 *     k_t = [ln(1+Rp_t) − ln(1+Rb_t)] / (Rp_t − Rb_t)          (→ 1/(1+Rp_t) si Rp_t = Rb_t)
 *     K   = [ln(1+Rp)   − ln(1+Rb)]   / (Rp − Rb)              sobre el periodo entero
 *     contribución ajustada = contribución × k_t / K
 *
 * Así la suma de las contribuciones ajustadas es EXACTAMENTE el retorno activo compuesto. No es
 * un apaño: es el método estándar de la industria, y la alternativa —repartir el residuo a
 * prorrata sin decirlo— es inventar atribución.
 *
 * Retornos de entrada en PORCENTAJE, como en el resto del módulo.
 */
export function encadenarCarino(periodos: Atribucion[]): {
  asignacion: number; seleccion: number; retornoActivoCompuesto: number;
  residuo: number; cuadra: boolean; periodos: number;
} {
  if (!periodos.length) {
    return { asignacion: 0, seleccion: 0, retornoActivoCompuesto: 0, residuo: 0, cuadra: true, periodos: 0 };
  }
  let ep = 1, eb = 1;
  for (const p of periodos) { ep *= 1 + p.retornoCartera / 100; eb *= 1 + p.retornoReferencia / 100; }
  const Rp = ep - 1, Rb = eb - 1;
  const activoCompuesto = (Rp - Rb) * 100;

  // K del periodo completo, con su límite cuando cartera y referencia empatan.
  const K = Math.abs(Rp - Rb) < 1e-12
    ? 1 / (1 + Rp)
    : (Math.log(1 + Rp) - Math.log(1 + Rb)) / (Rp - Rb);

  let asignacion = 0, seleccion = 0;
  for (const p of periodos) {
    const rp = p.retornoCartera / 100, rb = p.retornoReferencia / 100;
    const kt = Math.abs(rp - rb) < 1e-12
      ? 1 / (1 + rp)
      : (Math.log(1 + rp) - Math.log(1 + rb)) / (rp - rb);
    const escala = kt / K;
    asignacion += p.totalAsignacion * escala;
    seleccion += p.totalSeleccion * escala;
  }
  const residuo = activoCompuesto - (asignacion + seleccion);
  return {
    asignacion, seleccion, retornoActivoCompuesto: activoCompuesto,
    residuo, cuadra: Math.abs(residuo) <= Math.max(0.01, Math.abs(activoCompuesto) * 1e-6),
    periodos: periodos.length,
  };
}
