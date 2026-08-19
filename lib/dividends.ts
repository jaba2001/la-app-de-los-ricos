// ─────────────────────────────────────────────────────────────────────────────
// DIVIDEND GRADES (F5 · P1-5) — la parte de Seeking Alpha que sí merece copiarse tal cual,
// porque no es una apuesta de rentabilidad: es medir si un dividendo se puede pagar.
//
// Cuatro notas, como ellos: SEGURIDAD · CRECIMIENTO · RENTABILIDAD · CONSISTENCIA. La
// diferencia está en la seguridad, que es la única que de verdad importa: SA la vende con
// un "98,77% de los recortes evitados desde 2010" que es una cifra retrospectiva sobre su
// propio sistema. Aquí no se promete nada de eso — se enseñan los ratios que hacen que un
// dividendo sea insostenible y se dice cuáles fallan.
//
// Por qué esto SÍ y el score sector-relativo NO: un payout del 95% o una cobertura de
// intereses de 1,5 son hechos sobre la capacidad de pagar, no predicciones de mercado.
// La distinción es la misma que atravesó toda la investigación — medir lo que ES frente a
// adivinar lo que VA A PASAR — y explica por qué esta pieza puede entrar sin backtest.
//
// Módulo PURO para que corra headless en los tests.
// ─────────────────────────────────────────────────────────────────────────────

export interface DividendInputs {
  dividendYield?: number | null;        // % anual
  payoutRatio?: number | null;          // fracción del beneficio (0-1+)
  fcfPayoutRatio?: number | null;       // fracción del flujo de caja libre
  interestCoverage?: number | null;     // veces
  netDebtEbitda?: number | null;        // veces
  /** Dividendos por acción anuales, del más reciente al más antiguo. */
  dpsHistory?: number[] | null;
  epsGrowth?: number | null;            // % — un beneficio que cae acaba con el dividendo
}

export interface DividendGrade {
  key: "safety" | "growth" | "yield" | "consistency";
  label: string;
  score: number;       // 0-100
  grade: string;       // A+ … F
  reasons: string[];   // por qué, en palabras — la nota sola no vale de nada
}

export interface DividendGrades {
  paysDividend: boolean;
  grades: DividendGrade[];
  warnings: string[];  // lo que de verdad hay que leer antes de comprar por el dividendo
}

const CUTS: [number, string][] = [[95, "A+"], [88, "A"], [80, "A-"], [72, "B+"], [64, "B"], [56, "B-"], [48, "C+"], [40, "C"], [32, "C-"], [24, "D+"], [16, "D"], [8, "D-"]];
export function dividendGradeFrom(score: number): string {
  for (const [min, g] of CUTS) if (score >= min) return g;
  return "F";
}

/** Mapea un valor a 0-100 entre dos extremos (invertido si lo > hi). */
function band(v: number, lo: number, hi: number): number {
  if (lo === hi) return 50;
  const t = (v - lo) / (hi - lo);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * SEGURIDAD — ¿puede la empresa seguir pagando esto?
 * Se mira contra el BENEFICIO y contra el FLUJO DE CAJA (que es el que paga de verdad), más
 * el balance. Un payout por encima del 100% del FCF no es un dividendo: es una devolución
 * de capital financiada, y hay que decirlo con esas palabras.
 */
function safety(inp: DividendInputs): DividendGrade {
  const parts: number[] = [];
  const reasons: string[] = [];

  if (inp.payoutRatio != null) {
    const s = 100 - band(inp.payoutRatio, 0.3, 1.1);
    parts.push(s);
    if (inp.payoutRatio > 1) reasons.push(`Pays out ${(inp.payoutRatio * 100).toFixed(0)}% of earnings — more than it earns.`);
    else if (inp.payoutRatio > 0.8) reasons.push(`Earnings payout is high (${(inp.payoutRatio * 100).toFixed(0)}%), leaving little cushion.`);
  }
  if (inp.fcfPayoutRatio != null) {
    const s = 100 - band(inp.fcfPayoutRatio, 0.3, 1.1);
    parts.push(s, s);   // pesa doble: el dividendo se paga con caja, no con beneficio contable
    if (inp.fcfPayoutRatio > 1) reasons.push(`The dividend exceeds free cash flow (${(inp.fcfPayoutRatio * 100).toFixed(0)}%) — it is being funded, not earned.`);
  }
  if (inp.interestCoverage != null) {
    parts.push(band(inp.interestCoverage, 1.5, 12));
    if (inp.interestCoverage < 3) reasons.push(`Interest coverage of ${inp.interestCoverage.toFixed(1)}× — creditors get paid before shareholders.`);
  }
  if (inp.netDebtEbitda != null) {
    parts.push(100 - band(inp.netDebtEbitda, 0.5, 5));
    if (inp.netDebtEbitda > 4) reasons.push(`Net debt at ${inp.netDebtEbitda.toFixed(1)}× EBITDA constrains what can be paid out.`);
  }
  if (inp.epsGrowth != null && inp.epsGrowth < -20) {
    parts.push(20);
    reasons.push(`Earnings are falling ${Math.abs(inp.epsGrowth).toFixed(0)}% — the usual prelude to a cut.`);
  }

  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 50;
  if (!reasons.length) reasons.push("Payout and balance sheet leave room to keep paying.");
  return { key: "safety", label: "Safety", score, grade: dividendGradeFrom(score), reasons };
}

/** CRECIMIENTO — ¿lo ha subido, y cuánto? Se mide sobre el historial real de DPS. */
function growth(inp: DividendInputs): DividendGrade {
  const h = inp.dpsHistory?.filter((x) => x != null && isFinite(x) && x > 0) ?? [];
  if (h.length < 2) return { key: "growth", label: "Growth", score: 50, grade: dividendGradeFrom(50), reasons: ["Not enough dividend history to judge growth."] };
  const años = Math.min(h.length - 1, 5);
  const cagr = (Math.pow(h[0] / h[años], 1 / años) - 1) * 100;
  const score = Math.round(band(cagr, -5, 15));
  const reasons = [cagr > 0
    ? `Raised at ${cagr.toFixed(1)}% a year over the last ${años} years.`
    : `The dividend has shrunk ${Math.abs(cagr).toFixed(1)}% a year over the last ${años} years.`];
  return { key: "growth", label: "Growth", score, grade: dividendGradeFrom(score), reasons };
}

/**
 * RENTABILIDAD — cuánto paga. Ojo con la trampa clásica: una rentabilidad altísima suele
 * ser el mercado avisando de un recorte, no un regalo. Por eso la nota SUBE hasta ~6% y
 * vuelve a BAJAR por encima del 9%: no es un error, es lo que dice la experiencia.
 */
function yieldGrade(inp: DividendInputs): DividendGrade {
  const y = inp.dividendYield;
  if (y == null) return { key: "yield", label: "Yield", score: 0, grade: "F", reasons: ["No dividend."] };
  let score: number;
  const reasons: string[] = [];
  if (y <= 6) score = Math.round(band(y, 0, 6) * 0.95 + 5);
  else {
    score = Math.round(Math.max(35, 100 - (y - 6) * 12));
    reasons.push(`A ${y.toFixed(1)}% yield is usually the market pricing in a cut, not a bargain.`);
  }
  if (!reasons.length) reasons.push(`Pays ${y.toFixed(2)}%.`);
  return { key: "yield", label: "Yield", score, grade: dividendGradeFrom(score), reasons };
}

/** CONSISTENCIA — ¿lo ha pagado sin fallar, y sin recortes? Un recorte pesa mucho. */
function consistency(inp: DividendInputs): DividendGrade {
  const h = inp.dpsHistory?.filter((x) => x != null && isFinite(x)) ?? [];
  if (h.length < 3) return { key: "consistency", label: "Consistency", score: 50, grade: dividendGradeFrom(50), reasons: ["Too short a record to judge consistency."] };
  let recortes = 0, subidas = 0;
  for (let i = 0; i < h.length - 1; i++) {
    if (h[i] < h[i + 1] * 0.98) recortes++;
    else if (h[i] > h[i + 1] * 1.02) subidas++;
  }
  const años = h.length;
  const base = band(años, 3, 15) * 0.4 + (subidas / (años - 1)) * 100 * 0.6;
  const score = Math.round(Math.max(0, base - recortes * 25));   // un recorte cuesta caro
  const reasons = [`${años} years of payments, ${subidas} increases${recortes ? `, ${recortes} cut${recortes > 1 ? "s" : ""}` : ", no cuts"}.`];
  if (recortes) reasons.push("A past cut is the single strongest predictor of another one.");
  return { key: "consistency", label: "Consistency", score, grade: dividendGradeFrom(score), reasons };
}

export function dividendGrades(inp: DividendInputs): DividendGrades {
  const paga = (inp.dividendYield ?? 0) > 0 || (inp.dpsHistory?.some((x) => x > 0) ?? false);
  if (!paga) return { paysDividend: false, grades: [], warnings: [] };

  const grades = [safety(inp), growth(inp), yieldGrade(inp), consistency(inp)];
  const warnings: string[] = [];
  const s = grades[0];
  if (s.score < 40) warnings.push("Dividend safety is weak — treat the payout as uncertain.");
  if ((inp.fcfPayoutRatio ?? 0) > 1) warnings.push("The dividend is not covered by free cash flow.");
  if ((inp.dividendYield ?? 0) > 9) warnings.push("A yield this high usually signals distress rather than value.");
  return { paysDividend: true, grades, warnings };
}
