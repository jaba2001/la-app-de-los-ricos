// ─────────────────────────────────────────────────────────────────────────────
// F0c · GRADO DE SEÑAL — el problema de la hipótesis conjunta de Fama, hecho mecánica
// de producto. PLAN_TEORIA_FINANCIERA_SCORA.md §2.3.
//
// Fama (1970, y explícito en 1991): la eficiencia NO se puede testear sola. Siempre
// testeas eficiencia Y un modelo de retornos esperados a la vez, así que cualquier
// "anomalía" puede ser un modelo malo en lugar de una ineficiencia. No existe un test
// limpio. La consecuencia práctica no es el nihilismo: es que ningún número debería
// aparecer en pantalla sin decir cuánto vale.
//
// Este módulo convierte cuatro hechos verificables —IC medida, veredicto fuera de muestra,
// tamaño muestral e integridad point-in-time— en una letra que puede ir pegada a cada
// tarjeta de la UI. Deliberadamente severo: la nota por defecto es mala y hay que
// ganársela con evidencia, no al revés.
//
// Puro y headless.
// ─────────────────────────────────────────────────────────────────────────────

export type Grade = "A" | "B" | "C" | "D";

export type OosStatus =
  | "passed"        // superó el gate fuera de muestra
  | "failed"        // se midió fuera de muestra y NO lo superó
  | "not-tested";   // nunca se sometió a un gate OOS

export interface SignalEvidence {
  /** Coeficiente de información medido (Spearman score↔retorno futuro). null = sin medir. */
  ic?: number | null;
  /** Resultado del gate fuera de muestra. */
  oos?: OosStatus;
  /** Observaciones sobre las que se midió (nombre-mes, meses, o lo que aplique). */
  sampleSize?: number | null;
  /** ¿El universo era point-in-time (sin sesgo de supervivencia)? */
  pointInTime?: boolean | null;
  /** Nº de ensayos evaluados sobre los mismos datos (del libro de ensayos). */
  trials?: number | null;
}

export interface GradedSignal {
  grade: Grade;
  /** Puntos 0-100 sobre los que se decide la letra (transparencia, no misticismo). */
  points: number;
  /** Qué suma y qué resta, en lenguaje llano. */
  reasons: string[];
  /** La frase que debe acompañar al número en la UI. */
  caveat: string;
}

/**
 * EFECTO MÍNIMO DETECTABLE del IC en el universo de Scora.
 *
 * No es una banda elegida a ojo: `research/momentum_audit.mjs` (A8, 2026-08-17) midió que la
 * desviación típica del IC transversal mensual es ~0.22, lo que con 192 meses deja el MDE al
 * 80% de potencia en **0.044**. Detectar un IC de 0.03 exigiría 411 meses (34 años); uno de
 * 0.02, setenta y siete años.
 *
 * Consecuencia dura: por debajo de esto un IC NO es "débil", es **indetectable**. Puntuarlo
 * como si fuera evidencia parcial sería falso rigor — el mismo pecado que este módulo existe
 * para evitar. Por eso la banda inferior vale CERO puntos y lo dice con todas las letras.
 */
export const MDE_IC = 0.044;

/** Señal fuerte: el doble del efecto mínimo detectable. */
const IC_STRONG = 2 * MDE_IC;
/** Umbral de detectabilidad. Debajo, la muestra no puede distinguirlo del ruido. */
const IC_USEFUL = MDE_IC;

/**
 * Nota una señal a partir de su evidencia. Cuatro ejes, ninguno opcional en espíritu:
 * si falta un dato, NO se asume favorable — se penaliza por desconocido.
 */
export function gradeSignal(ev: SignalEvidence): GradedSignal {
  const reasons: string[] = [];
  let points = 0;

  // ── 1. IC medida (0-40) ────────────────────────────────────────────────────
  const ic = ev.ic;
  if (ic == null || !isFinite(ic)) {
    reasons.push("No measured IC: we don't know whether it predicts anything.");
  } else {
    const a = Math.abs(ic);
    if (a >= IC_STRONG) { points += 40; reasons.push(`IC ${ic.toFixed(3)}: more than twice the minimum detectable effect (${MDE_IC}).`); }
    else if (a >= IC_USEFUL) { points += 26; reasons.push(`IC ${ic.toFixed(3)}: above the minimum detectable effect (${MDE_IC}).`); }
    else { reasons.push(`IC ${ic.toFixed(3)}: BELOW the minimum detectable effect (${MDE_IC}). It is not a weak signal — with this sample it is undetectable, and an IC like this only gets "confirmed" by chance.`); }
    if (ic < 0) reasons.push("Careful: the sign is NEGATIVE — it predicts the opposite of how it is used.");
  }

  // ── 2. Fuera de muestra (0-30) — el eje que más pesa por unidad ────────────
  switch (ev.oos) {
    case "passed":
      points += 30; reasons.push("Passed an out-of-sample gate.");
      break;
    case "failed":
      reasons.push("Measured out of sample and did NOT pass: in-sample doesn't count.");
      break;
    default:
      points += 6; reasons.push("Never put through an out-of-sample gate.");
  }

  // ── 3. Tamaño muestral (0-15) ──────────────────────────────────────────────
  const n = ev.sampleSize;
  if (n == null) reasons.push("Unknown sample size.");
  else if (n >= 5000) { points += 15; reasons.push(`${n.toLocaleString("en-US")} observations.`); }
  else if (n >= 1000) { points += 11; reasons.push(`${n.toLocaleString("en-US")} observations.`); }
  else if (n >= 200) { points += 6; reasons.push(`${n.toLocaleString("en-US")} observations: borderline.`); }
  else { points += 2; reasons.push(`Only ${n.toLocaleString("en-US")} observations.`); }

  // ── 4. Integridad point-in-time (0-15) ─────────────────────────────────────
  if (ev.pointInTime === true) { points += 15; reasons.push("Point-in-time universe: no survivorship bias."); }
  else if (ev.pointInTime === false) { reasons.push("Universe with survivorship bias: the result is inflated by construction."); }
  else reasons.push("Universe integrity not verified.");

  // ── Penalización por multiplicidad ─────────────────────────────────────────
  // Cuantas más variantes se probaron sobre los mismos datos, más probable es que la
  // mejor lo sea por azar. Es el mismo argumento del Sharpe deflactado, aplicado a la nota.
  const trials = ev.trials;
  if (trials != null && trials > 0) {
    const penalty = Math.min(15, Math.round(Math.log10(Math.max(1, trials)) * 7));
    if (penalty > 0) {
      points -= penalty;
      reasons.push(`−${penalty} for multiplicity: ${trials} trials on the same data raise the bar.`);
    }
  }

  points = Math.max(0, Math.min(100, points));
  const grade: Grade = points >= 78 ? "A" : points >= 55 ? "B" : points >= 32 ? "C" : "D";

  const caveat =
    grade === "A" ? "Measured, validated out of sample, on a clean universe. Even so: past evidence, not a promise."
    : grade === "B" ? "Reasonable evidence with a weak leg. Use it as context, not as a trigger."
    : grade === "C" ? "Weak evidence. Informative at most; it shouldn't move a decision on its own."
    : "Not enough evidence. It is here for transparency, not because it works.";

  return { grade, points, reasons, caveat };
}

export const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--sr-pos)",
  B: "var(--sr-text-2)",
  C: "var(--sr-warn)",
  D: "var(--sr-neg)",
};

export const GRADE_LABEL: Record<Grade, string> = {
  A: "Strong evidence",
  B: "Reasonable evidence",
  C: "Weak evidence",
  D: "No evidence",
};
