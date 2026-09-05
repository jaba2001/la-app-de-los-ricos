// ─────────────────────────────────────────────────────────────────────────────
// F3 · LÍMITES AL ARBITRAJE — Shleifer & Vishny (1997), "The Limits of Arbitrage".
//
// El paper que faltaba en Scora y que explica su propio hallazgo. El arbitraje real no lo
// hacen millones de inversores marginales: lo hacen POCOS especialistas con dinero AJENO.
// Cuando el diferencial se mueve en contra, el inversor —que solo ve resultados, no la
// tesis— retira capital justo cuando la oportunidad es mejor, y el arbitrajista liquida en
// el peor momento. El capital de arbitraje es PROCÍCLICO: escasea cuando más falta hace.
//
// Corolario devastador para la EMH: un operador perfectamente racional puede racionalmente
// NO corregir un precio mal puesto. Y Pontiff (2006) identificó el mayor coste de mantener
// la posición: la VOLATILIDAD IDIOSINCRÁTICA — justo lo que el CAPM llama "gratis" por
// diversificable. Aquí las dos teorías se tocan, y por eso este módulo consume el residuo
// de lib/factorModel.ts.
//
// Para qué sirve en producto: fricción alta = una señal barata puede seguir barata mucho
// tiempo (y el riesgo de intentarlo es mayor). No es una señal de compra; es el contexto
// que dice cuánto puede tardar —o no llegar— la convergencia.
//
// Puro y headless. Umbrales macro tomados de los YA calibrados en la app
// (components/macro/MacroIndicators.tsx) para no crear una segunda calibración en conflicto.
// ─────────────────────────────────────────────────────────────────────────────

/** Interpolación lineal por tramos. `points` ascendente en x; fuera de rango se aplana. */
function piecewise(x: number, points: [number, number][]): number {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

const num = (x: number | null | undefined): x is number => x != null && isFinite(x);

// ── Iliquidez de Amihud (2002) ───────────────────────────────────────────────
/**
 * ILLIQ = media de |retorno| / volumen en dólares, escalada x1e6 para que sea legible.
 * Mide cuánto mueve el precio un dólar negociado: el coste de entrar y salir.
 *
 * `closes` en orden cronológico (el más antiguo primero) y `dollarVolumes` alineado con
 * ellos (volumen en dólares de cada sesión). Devuelve null si no hay solape suficiente.
 */
export function amihudIlliquidity(closes: number[], dollarVolumes: number[]): number | null {
  const n = Math.min(closes.length, dollarVolumes.length);
  if (n < 3) return null;
  const c = closes.slice(closes.length - n);
  const v = dollarVolumes.slice(dollarVolumes.length - n);
  const vals: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = c[i - 1], cur = c[i], dv = v[i];
    if (!(prev > 0) || !(cur > 0) || !(dv > 0)) continue; // sesión sin datos utilizables
    vals.push(Math.abs(cur / prev - 1) / dv);
  }
  if (vals.length < 2) return null;
  return (vals.reduce((s, x) => s + x, 0) / vals.length) * 1e6;
}

// ── Coste de arbitraje por nombre ────────────────────────────────────────────
export interface FrictionInputs {
  /** Volatilidad idiosincrática ANUALIZADA en % — el residuo de `fitFactorModel`.
   *  Es el coste de mantenimiento dominante según Pontiff (2006). */
  idiosyncraticVolAnnual?: number | null;
  /** Interés corto como % del free float. */
  shortInterestPctFloat?: number | null;
  /** Días para cubrir (short interest / volumen medio diario). */
  daysToCover?: number | null;
  /** Iliquidez de Amihud (x1e6), de `amihudIlliquidity`. */
  amihud?: number | null;
  /** Capitalización en USD. */
  marketCap?: number | null;
}

export interface FrictionComponent {
  key: string;
  label: string;
  raw: number;
  /** 0-100; mayor = más fricción. */
  score: number;
}

export type FrictionBand = "baja" | "media" | "alta" | "extrema";

export interface FrictionResult {
  /** 0-100. Mayor = más caro/arriesgado para un profesional corregir un error de precio aquí. */
  score: number;
  band: FrictionBand;
  components: FrictionComponent[];
  /** Cuántos componentes había realmente (el score se normaliza sobre los presentes). */
  covered: number;
  readings: string[];
}

// Anclas documentadas. Son REGLAS DE OFICIO calibradas a ojo sobre renta variable
// estadounidense, no constantes medidas: pendientes de validar contra el harness antes de
// que esto influya en ninguna decisión. Se publican los valores crudos junto al score
// precisamente para que el lector no tenga que fiarse de la curva.
const ANCHORS: Record<string, [number, number][]> = {
  idioVol:  [[10, 5], [20, 30], [35, 60], [55, 85], [80, 100]],   // % anual
  shortInt: [[1, 5], [3, 25], [7, 55], [15, 85], [30, 100]],      // % del float
  daysCover:[[0.5, 5], [2, 30], [4, 55], [8, 85], [15, 100]],     // días
  amihud:   [[0.005, 5], [0.05, 30], [0.5, 60], [5, 90], [50, 100]],
  size:     [[50e6, 100], [300e6, 82], [2e9, 55], [10e9, 30], [200e9, 5]], // desc. en score
};

const LABELS: Record<string, string> = {
  idioVol: "Volatilidad idiosincrática",
  shortInt: "Interés corto (% float)",
  daysCover: "Días para cubrir",
  amihud: "Iliquidez (Amihud)",
  size: "Tamaño (capitalización)",
};

/**
 * Compone el coste de arbitraje 0-100 sobre los componentes DISPONIBLES (se normaliza por
 * los presentes, así que un nombre con 2 de 5 señales sigue recibiendo un score justo).
 * Devuelve null si no hay ninguna entrada utilizable.
 */
export function arbitrageCost(inp: FrictionInputs): FrictionResult | null {
  const raw: [string, number | null | undefined][] = [
    ["idioVol", inp.idiosyncraticVolAnnual],
    ["shortInt", inp.shortInterestPctFloat],
    ["daysCover", inp.daysToCover],
    ["amihud", inp.amihud],
    ["size", inp.marketCap],
  ];

  const components: FrictionComponent[] = [];
  for (const [key, v] of raw) {
    if (!num(v) || v < 0) continue;
    components.push({ key, label: LABELS[key], raw: v, score: piecewise(v, ANCHORS[key]) });
  }
  if (!components.length) return null;

  const score = components.reduce((s, c) => s + c.score, 0) / components.length;
  const band: FrictionBand = score >= 75 ? "extrema" : score >= 50 ? "alta" : score >= 28 ? "media" : "baja";

  const readings: string[] = [];
  const top = [...components].sort((a, b) => b.score - a.score)[0];
  readings.push(
    band === "baja"
      ? "Fricción baja: un profesional puede corregir un error de precio aquí con facilidad, así que es poco probable que uno grande persista."
      : band === "media"
      ? "Fricción media: la convergencia es posible pero no inmediata."
      : "Fricción alta: caro y arriesgado de arbitrar. Un descuento puede persistir mucho tiempo — o no cerrarse nunca."
  );
  readings.push(`Componente dominante: ${top.label.toLowerCase()}.`);
  if (components.length < 5) {
    readings.push(`Calculado sobre ${components.length} de 5 componentes — los ausentes no penalizan ni premian.`);
  }
  const idio = components.find((c) => c.key === "idioVol");
  if (idio && idio.score >= 60) {
    readings.push("La vol idiosincrática alta es el coste de mantenimiento que Pontiff (2006) identifica como el mayor freno al arbitraje: el CAPM la llama diversificable y gratis, pero para quien mantiene la posición no lo es.");
  }
  return { score, band, components, covered: components.length, readings };
}

// ── Estrés del capital de arbitraje (macro) ──────────────────────────────────
export interface CapitalStressInputs {
  /** Spread OAS de high yield en PUNTOS BÁSICOS. */
  hyOasBps?: number | null;
  /** Chicago NFCI (unidades estándar, 0 = media histórica). */
  nfci?: number | null;
  /** St. Louis STLFSI4 (unidades estándar, 0 = media histórica). */
  stlfsi4?: number | null;
  /** Índice MOVE (volatilidad implícita de bonos). */
  moveIndex?: number | null;
  /** VIX. */
  vix?: number | null;
}

export interface CapitalStressResult {
  /** 0-100. Alto = el capital de arbitraje está bajo presión. */
  score: number;
  band: "calmado" | "normal" | "tenso" | "crisis";
  drivers: FrictionComponent[];
  covered: number;
  reading: string;
}

// Anclas alineadas con los umbrales YA calibrados en components/macro/MacroIndicators.tsx
// (HY OAS warn 400 / bad 600 · NFCI warn 0 / bad 0.5 · STLFSI4 warn 0.5 / bad 1.5 ·
// MOVE warn 100 / bad 140) y el disparador VIX>35 de MacroMonitors.
const STRESS_ANCHORS: Record<string, [number, number][]> = {
  hyOasBps: [[250, 5], [400, 40], [600, 75], [1000, 100]],
  nfci:     [[-0.8, 5], [0, 40], [0.5, 75], [1.5, 100]],
  stlfsi4:  [[-1, 5], [0.5, 45], [1.5, 80], [3, 100]],
  moveIndex:[[60, 5], [100, 40], [140, 75], [200, 100]],
  vix:      [[12, 5], [20, 35], [35, 80], [60, 100]],
};
const STRESS_LABELS: Record<string, string> = {
  hyOasBps: "Spread HY (OAS)", nfci: "NFCI (Chicago)", stlfsi4: "STLFSI4 (St. Louis)",
  moveIndex: "MOVE (vol de bonos)", vix: "VIX",
};

/**
 * Compuesto de presión sobre el capital de arbitraje. La predicción de Shleifer & Vishny es
 * concreta y comprobable: cuando esto está alto, los diferenciales SE ENSANCHAN y las
 * estrategias de reversión fallan — justo cuando parecen más atractivas.
 *
 * Uso previsto: puerta de régimen sobre cualquier señal de reversión a la media. Es una
 * puerta MOTIVADA POR TEORÍA y declarada de antemano, no encontrada barriendo variantes —
 * distinción que importa de verdad para el Sharpe deflactado (plan §3.3): suma 1 ensayo, no 40.
 */
export function arbitrageCapitalStress(inp: CapitalStressInputs): CapitalStressResult | null {
  const raw: [string, number | null | undefined][] = [
    ["hyOasBps", inp.hyOasBps], ["nfci", inp.nfci], ["stlfsi4", inp.stlfsi4],
    ["moveIndex", inp.moveIndex], ["vix", inp.vix],
  ];
  const drivers: FrictionComponent[] = [];
  for (const [key, v] of raw) {
    if (!num(v)) continue;
    drivers.push({ key, label: STRESS_LABELS[key], raw: v, score: piecewise(v, STRESS_ANCHORS[key]) });
  }
  if (!drivers.length) return null;

  const score = drivers.reduce((s, d) => s + d.score, 0) / drivers.length;
  const band: CapitalStressResult["band"] = score >= 75 ? "crisis" : score >= 50 ? "tenso" : score >= 28 ? "normal" : "calmado";
  const top = [...drivers].sort((a, b) => b.score - a.score)[0];
  const reading =
    band === "crisis"
      ? `Capital de arbitraje bajo fuerte presión (lidera: ${top.label}). Shleifer & Vishny: aquí los diferenciales se ensanchan antes de cerrarse, y quien gestiona dinero ajeno se ve forzado a liquidar. Desconfía de las señales de reversión.`
      : band === "tenso"
      ? `Capital de arbitraje tensionado (lidera: ${top.label}). Las correcciones de precio tardan más de lo normal.`
      : band === "normal"
      ? "Capital de arbitraje en condiciones normales."
      : "Capital de arbitraje abundante: los errores de precio tienden a corregirse rápido.";
  return { score, band, drivers, covered: drivers.length, reading };
}

// ── La ventaja estructural del minorista ─────────────────────────────────────
export interface StructuralEdge { title: string; detail: string }

/**
 * Shleifer & Vishny DEL REVÉS. El paper describe las restricciones que atan al
 * profesional; la observación honesta es que un particular no tiene ninguna de ellas.
 * Esa es la única ventaja real y defendible de un inversor minorista — y es estructural,
 * no informativa: no consiste en saber más, sino en no tener que rendir cuentas antes de
 * que la tesis madure.
 *
 * Es texto fijo a propósito: es una tesis, no un dato calculado, y no debe simular serlo.
 */
export const STRUCTURAL_EDGES: StructuralEdge[] = [
  {
    title: "No tienes reembolsos",
    detail: "El arbitrajista de Shleifer & Vishny liquida porque sus inversores retiran capital cuando la posición va en contra. A ti nadie te lo retira: puedes aguantar el ensanchamiento que a él le expulsa.",
  },
  {
    title: "No tienes riesgo de carrera",
    detail: "Un gestor que se desvía del índice y pierde durante 18 meses se queda sin trabajo, aunque acabe teniendo razón. Tú no puedes ser despedido de tu propia cartera.",
  },
  {
    title: "No tienes mandato de tracking error",
    detail: "Los fondos institucionales tienen límites de desviación frente a su índice. Tú puedes tener 0% de un sector entero durante años sin que nadie te obligue a comprarlo.",
  },
  {
    title: "Tu horizonte no tiene trimestres",
    detail: "No reportas resultados a nadie en marzo. Las primas que exigen paciencia (iliquidez, valor, convergencias lentas) son precisamente las que el capital profesional no puede cosechar.",
  },
  {
    title: "Lo que NO te da ventaja",
    detail: "Nada de lo anterior es información. No sabes más que el mercado sobre una empresa, y esa es exactamente la parte que Scora mide y encuentra en ~0. Tu ventaja es estructural, no informativa — confundirlas es el error caro.",
  },
];
