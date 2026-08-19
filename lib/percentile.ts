// ─────────────────────────────────────────────────────────────────────────────
// PERCENTILES SECTOR-RELATIVOS (F2 · P0-1 de PLAN_SEEKINGALPHA_MARKET_MOMENTUM.md)
//
// El problema que resuelve: la mayoría de métricas del score se juzgan con bandas
// ABSOLUTAS iguales para todos los sectores. El PER y el EV/EBITDA ya tenían un ajuste
// (SECTOR_PE_BM / SECTOR_EV_BM, benchmarks fijos a ojo), pero el resto no, y ahí el sesgo
// es grave. Medido sobre 488 nombres del S&P 500:
//   · `debtEquity < 1.5 → 4 de 10`, pero la mediana de Utilities es 1,44 → la utility
//     mediana de su sector cobraba 4/10 y la del percentil 75 cobraba CERO, no por estar
//     mal gestionada sino por ser una utility (negocio regulado e intensivo en capital).
//   · `pb < 1.5 → 6 de 6`, pero la mediana de Financials es 2,12 y la de Technology 7,22
//     → un banco del montón se llevaba el máximo y una tecnológica en el percentil 25 de
//     su sector (P/B 4,5, o sea barata) se llevaba 2 de 6.
// Seeking Alpha lleva desde el principio comparando por PERCENTIL DENTRO DEL SECTOR, y es
// —de todo lo que hacen— lo único que de verdad hay que copiarles: no es una apuesta de
// alfa, es calidad de medición.
//
// Este módulo es PURO (sin imports de runtime) para que el test golden lo ejecute headless,
// igual que scoring.ts / rating.ts / timeframes.ts.
//
// Las distribuciones las calcula `research/factor_dist.mjs` y se guardan por sector.
// Cuando no hay distribución para un sector, se cae a la distribución "ALL"; cuando tampoco
// la hay, el llamador se queda con su comportamiento actual. Degradar bien es obligatorio:
// nada de esto puede romper una pantalla porque falte un dato.
// ─────────────────────────────────────────────────────────────────────────────

/** Cortes de una distribución: los percentiles 1, 5, 10, 25, 50, 75, 90, 95 y 99.
 *  Se guardan cuantiles y no media/desviación a propósito: los ratios financieros tienen
 *  colas brutales (un PER de 900 tras un año malo) y la media no sobrevive a eso. */
export interface MetricDist {
  q: number[];   // 9 valores ascendentes
  n: number;     // tamaño de la muestra que los generó
}

/** sector → métrica → distribución. La clave "ALL" es el agregado de todo el universo. */
export type FactorDistTable = Record<string, Record<string, MetricDist>>;

/** Niveles de percentil que representa cada posición de `q`. */
export const DIST_LEVELS = [1, 5, 10, 25, 50, 75, 90, 95, 99] as const;

/** Para cada métrica, si un valor MÁS ALTO es mejor para el inversor. */
export const HIGHER_IS_BETTER: Record<string, boolean> = {
  // Valoración — más barato es mejor
  pe: false, forwardPe: false, pb: false, evEbitda: false, pfcf: false,
  // Rentabilidad y calidad — más es mejor
  roe: true, roa: true, roic: true, grossMargin: true, netMargin: true,
  operatingMargin: true, grossProfitability: true, fcfYield: true,
  // Solidez — según el signo natural de cada una
  debtEquity: false, netDebtEbitda: false, currentRatio: true, interestCoverage: true,
  capexToRevenue: false,
  // Crecimiento — más es mejor
  revenueGrowth: true, epsGrowth: true, fcfGrowthYoy: true,
  // Momentum — más es mejor (con la salvedad medida en §7.10: no genera alfa por sí solo)
  priceChange1M: true, priceChange3M: true, priceChange6M: true,
};

/** Percentil CRUDO (1..99) de un valor dentro de una distribución, interpolando entre cortes.
 *  No sabe nada de si "alto" es bueno: eso lo decide `goodnessPctl`. */
export function pctlOf(value: number | null | undefined, dist: MetricDist | null | undefined): number | null {
  if (value == null || !isFinite(value) || !dist || !Array.isArray(dist.q) || dist.q.length !== DIST_LEVELS.length) return null;
  const q = dist.q;
  if (value <= q[0]) return DIST_LEVELS[0];
  if (value >= q[q.length - 1]) return DIST_LEVELS[DIST_LEVELS.length - 1];
  for (let i = 0; i < q.length - 1; i++) {
    if (value <= q[i + 1]) {
      const span = q[i + 1] - q[i];
      // Tramo plano (muchos valores repetidos, típico en métricas con ceros): el punto medio
      // es la respuesta honesta — dentro del tramo no hay información para ordenar.
      const frac = span > 0 ? (value - q[i]) / span : 0.5;
      return DIST_LEVELS[i] + frac * (DIST_LEVELS[i + 1] - DIST_LEVELS[i]);
    }
  }
  return DIST_LEVELS[DIST_LEVELS.length - 1];
}

/** Percentil de BONDAD (1..99, donde 99 = de lo mejor del sector), ya orientado. */
export function goodnessPctl(value: number | null | undefined, dist: MetricDist | null | undefined, higherIsBetter: boolean): number | null {
  const p = pctlOf(value, dist);
  if (p == null) return null;
  return higherIsBetter ? p : 100 - p;
}

/** Cortes de letra. Coinciden con los publicados en el plan (§6 P0-1). */
export const GRADE_CUTS: { min: number; grade: string }[] = [
  { min: 97, grade: "A+" }, { min: 90, grade: "A" }, { min: 83, grade: "A-" },
  { min: 76, grade: "B+" }, { min: 69, grade: "B" }, { min: 62, grade: "B-" },
  { min: 55, grade: "C+" }, { min: 45, grade: "C" }, { min: 38, grade: "C-" },
  { min: 30, grade: "D+" }, { min: 22, grade: "D" }, { min: 12, grade: "D-" },
  { min: -Infinity, grade: "F" },
];

export function gradeFromPctl(p: number | null | undefined): string | null {
  if (p == null || !isFinite(p)) return null;
  for (const c of GRADE_CUTS) if (p >= c.min) return c.grade;
  return "F";
}

/** Color de la letra, en los tokens del sistema de diseño (no colores sueltos). */
export function gradeColor(grade: string | null | undefined): string {
  if (!grade) return "var(--sr-text-3)";
  if (grade.startsWith("A")) return "var(--sr-pos)";
  if (grade.startsWith("B")) return "#34D399";
  if (grade.startsWith("C")) return "var(--sr-warn)";
  return "var(--sr-neg)";
}

/** Busca la distribución de una métrica para un sector, cayendo a "ALL" y luego a nada. */
export function lookupDist(table: FactorDistTable | null | undefined, sector: string | null | undefined, metric: string): MetricDist | null {
  if (!table) return null;
  const bySector = sector ? table[sector] : null;
  return bySector?.[metric] ?? table["ALL"]?.[metric] ?? null;
}

export interface MetricGrade {
  metric: string;
  value: number;
  pctl: number;      // percentil de bondad, 1..99
  grade: string;
  sector: string;    // el sector contra el que se comparó ("ALL" si hubo que agregar)
}

/** Nota sector-relativa de UNA métrica. `null` si falta el dato o la distribución. */
export function gradeMetric(
  metric: string,
  value: number | null | undefined,
  table: FactorDistTable | null | undefined,
  sector: string | null | undefined
): MetricGrade | null {
  const dist = lookupDist(table, sector, metric);
  if (dist == null || value == null || !isFinite(value)) return null;
  const higher = HIGHER_IS_BETTER[metric];
  if (higher === undefined) return null;           // métrica sin dirección declarada → no se gradúa
  const pctl = goodnessPctl(value, dist, higher);
  if (pctl == null) return null;
  const grade = gradeFromPctl(pctl);
  if (grade == null) return null;
  const usedSector = sector && table?.[sector]?.[metric] ? sector : "ALL";
  return { metric, value, pctl: Math.round(pctl * 10) / 10, grade, sector: usedSector };
}

/** Qué métricas componen cada pilar, en el mismo reparto que ya usa `calcScores()`. */
export const PILLAR_METRICS: Record<string, string[]> = {
  value: ["pe", "pb", "evEbitda", "pfcf", "forwardPe"],
  health: ["debtEquity", "currentRatio", "interestCoverage", "netDebtEbitda", "roic", "grossProfitability", "operatingMargin"],
  momentum: ["priceChange1M", "priceChange3M", "priceChange6M"],
  growth: ["revenueGrowth", "epsGrowth"],
};

export interface PillarGrade {
  pillar: string;
  pctl: number;              // media de los percentiles de bondad presentes
  grade: string;
  metrics: MetricGrade[];    // el desglose, que es lo que hace la nota discutible en vez de mágica
  coverage: number;          // cuántas de las métricas del pilar tenían dato y distribución
}

/** Nota sector-relativa de un PILAR: media de los percentiles de las métricas disponibles.
 *  Promediar percentiles (y no valores) es lo que permite mezclar un PER con un margen sin
 *  que la escala de uno se coma al otro. `null` si no se pudo graduar ni una métrica. */
export function gradePillar(
  pillar: string,
  inputs: Record<string, number | null | undefined>,
  table: FactorDistTable | null | undefined,
  sector: string | null | undefined
): PillarGrade | null {
  const metrics = PILLAR_METRICS[pillar];
  if (!metrics) return null;
  const graded: MetricGrade[] = [];
  for (const m of metrics) {
    const g = gradeMetric(m, inputs[m], table, sector);
    if (g) graded.push(g);
  }
  if (graded.length === 0) return null;
  const pctl = graded.reduce((s, g) => s + g.pctl, 0) / graded.length;
  const grade = gradeFromPctl(pctl);
  if (grade == null) return null;
  return { pillar, pctl: Math.round(pctl * 10) / 10, grade, metrics: graded, coverage: graded.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSIÓN A PUNTOS DEL SCORE
//
// Aquí está la calibración, y es la parte que más fácil se hace mal: si la curva reparte
// menos puntos que las bandas absolutas que sustituye, el score de TODO el universo baja y
// parece que el método es más severo cuando en realidad sólo está mal escalado. Medido
// (research/score_pctl_impact.mjs): con "pe < 25 → 5 de 7 puntos", más de medio universo
// cobra el 71% de la nota, así que la curva tiene que dar ~0,68 de media para que el
// cambio sea NEUTRO EN NIVEL y sólo redistribuya.
//
// De ahí la recta: sube desde el percentil 0 (que aún cobra algo, porque ser el peor de un
// sector bueno no es lo mismo que no valer nada) hasta el 75, donde ya se lleva todo.
// PCTL_FULL_POINTS es el único parámetro y está calibrado contra el universo real.
// ─────────────────────────────────────────────────────────────────────────────
export const PCTL_ZERO_BELOW = 15;     // por debajo de este percentil, la métrica no puntúa
export const PCTL_FULL_POINTS = 75;    // a partir de aquí se cobra el 100%

/** Fracción de los puntos de una métrica que corresponde a un percentil de bondad (0..1).
 *  Recta entre los dos umbrales. Con 15/75 la fracción media del universo es 0,55, que es
 *  la que iguala el reparto de las bandas absolutas: medido sobre los 488 nombres del
 *  S&P 500, el score medio se mueve ~0 puntos. Si se cambian estas constantes hay que
 *  volver a correr `research/score_pctl_impact.mjs` y comprobar que sigue siendo neutro,
 *  o el cambio dejará de redistribuir y pasará a subir o bajar la nota de todo el mundo. */
export function pctlFraction(pctl: number | null | undefined): number | null {
  if (pctl == null || !isFinite(pctl)) return null;
  return Math.max(0, Math.min(1, (pctl - PCTL_ZERO_BELOW) / (PCTL_FULL_POINTS - PCTL_ZERO_BELOW)));
}

/** Puntos que una métrica aporta al score, juzgada contra su sector.
 *  `null` cuando falta el valor, la distribución o la dirección → el llamador cae a su banda. */
export function pctlPoints(
  metric: string,
  value: number | null | undefined,
  sector: string | null | undefined,
  table: FactorDistTable | null | undefined,
  max: number
): number | null {
  const higher = HIGHER_IS_BETTER[metric];
  if (higher === undefined || value == null || !isFinite(value) || !table) return null;
  const dist = lookupDist(table, sector, metric);
  if (!dist) return null;
  const pctl = goodnessPctl(value, dist, higher);
  const frac = pctlFraction(pctl);
  return frac == null ? null : max * frac;
}

/** Frase lista para pantalla. La letra sola es lo que critican de Seeking Alpha: el número
 *  crudo y el sector de comparación tienen que ir SIEMPRE al lado. */
export function explainGrade(g: MetricGrade | PillarGrade | null): string | null {
  if (!g) return null;
  const dentro = "sector" in g ? ` de ${g.sector === "ALL" ? "todo el universo" : g.sector}` : "";
  return `Percentil ${Math.round(g.pctl)}${dentro} (${g.grade})`;
}
