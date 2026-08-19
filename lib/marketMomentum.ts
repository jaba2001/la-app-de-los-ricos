// ─────────────────────────────────────────────────────────────────────────────
// MARKET MOMENTUM MONITOR (F4) — el estado del mercado en un número, agregando señales
// que Scora YA recoge a diario. No hay tabla nueva ni cron nuevo: `macro_breadth.mjs`
// escribe la amplitud cada día laborable y el resto vive en `macro_state`. Agregar lo que
// ya existe es menos superficie que mantener que duplicarlo.
//
// ⚠️ QUÉ ES Y QUÉ NO ES. Esto es CONTEXTO, no una señal de compra ni de venta, y esa
// distinción no es un descargo de responsabilidad: es el resultado de haberlo medido.
// En esta misma investigación se probaron tres formas de convertir señales de mercado en
// rentabilidad (compuesto de momentum, gate binario, percentiles sectoriales) y las tres
// se cayeron. Lo único que replicó fuera de muestra fue el gate, y mejorando el SHARPE, no
// el retorno. Así que este panel responde "¿cómo está el mercado?" — que es una pregunta
// legítima y útil — y no "¿qué compro?", que es la que no sabemos contestar.
//
// Módulo PURO (sin imports de runtime) para que corra headless en los tests.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarketMomentumInput {
  breadth200?: number | null;   // % del universo sobre su media de 200 sesiones
  breadth50?: number | null;    // % sobre la de 50
  breadthMom?: number | null;   // % con momentum 12-1m positivo
  breadth1m?: number | null;    // % en positivo el último mes
  riskOn?: number | null;       // 0-100, apetito de riesgo (ya compuesto)
  impliedCorr?: number | null;  // correlación implícita (~10-90): ALTA = malo para dispersión
  hyOas?: number | null;        // diferencial high yield en pb: ALTO = estrés de crédito
  spyVs200?: number | null;     // % de distancia del índice a su media de 200 sesiones
}

export interface MarketMomentumSignal {
  key: string;
  label: string;
  raw: number;        // el valor crudo, que SIEMPRE se enseña junto al normalizado
  score: number;      // 0-100 ya orientado (100 = mejor entorno)
  hint: string;
}

export type MarketState = "THRUST" | "TRENDING" | "NEUTRAL" | "DETERIORATING" | "STRESSED";

export interface MarketMomentum {
  score: number;                   // 0-100
  state: MarketState;
  label: string;
  color: string;
  detail: string;
  signals: MarketMomentumSignal[]; // el desglose: sin esto el número sería magia
  coverage: number;                // cuántas señales había (de 8)
  divergence: boolean;             // índice arriba con amplitud floja
}

/** Mapea un valor a 0-100 entre dos extremos, recortando fuera de rango. */
function band(v: number, lo: number, hi: number): number {
  if (hi === lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/**
 * Agrega el estado del mercado. Cada señal se normaliza a 0-100 con bandas FIJAS y
 * declaradas — no con percentiles de la propia muestra. Esa elección es deliberada y viene
 * de lo aprendido: cada vez que en esta investigación se usó un umbral estimado de los
 * propios datos, la conclusión se evaporó al recalcularla con sólo el pasado. Bandas fijas
 * significan que el número de hoy y el de hace tres años son comparables.
 */
export function marketMomentum(inp: MarketMomentumInput): MarketMomentum | null {
  const signals: MarketMomentumSignal[] = [];
  const add = (key: string, label: string, raw: number | null | undefined, score: number | null, hint: string) => {
    if (raw == null || !isFinite(raw) || score == null) return;
    signals.push({ key, label, raw, score: Math.round(score), hint });
  };

  add("breadth200", "Above 200-day", inp.breadth200, inp.breadth200 != null ? band(inp.breadth200, 20, 80) : null,
      "Share of the universe in a long-term uptrend");
  add("breadth50", "Above 50-day", inp.breadth50, inp.breadth50 != null ? band(inp.breadth50, 20, 80) : null,
      "Short-term participation");
  add("breadthMom", "Positive 12-1m", inp.breadthMom, inp.breadthMom != null ? band(inp.breadthMom, 30, 75) : null,
      "How broad the momentum is");
  add("breadth1m", "Up last month", inp.breadth1m, inp.breadth1m != null ? band(inp.breadth1m, 25, 75) : null,
      "Near-term thrust");
  add("riskOn", "Risk appetite", inp.riskOn, inp.riskOn != null ? band(inp.riskOn, 20, 80) : null,
      "Liquidity-led backdrop gauge");
  // Correlación y crédito van INVERTIDOS: más alto = peor entorno.
  add("impliedCorr", "Dispersion", inp.impliedCorr, inp.impliedCorr != null ? 100 - band(inp.impliedCorr, 15, 50) : null,
      "Low correlation means names move on their own merits");
  add("hyOas", "Credit", inp.hyOas, inp.hyOas != null ? 100 - band(inp.hyOas, 280, 700) : null,
      "High-yield spread — the market's own risk thermometer");
  add("spyVs200", "Index trend", inp.spyVs200, inp.spyVs200 != null ? band(inp.spyVs200, -12, 12) : null,
      "Where the index sits versus its 200-day average");

  if (signals.length < 3) return null;   // con menos de tres señales el agregado no dice nada

  const score = Math.round(signals.reduce((s, x) => s + x.score, 0) / signals.length);

  // DIVERGENCIA: el índice arriba mientras la participación se estrecha. Es el aviso
  // clásico y el que Scora ya detectaba en `regime_confirmation`; aquí se hace explícito.
  const divergence = (inp.spyVs200 ?? 0) > 0 && (inp.breadth200 ?? 100) < 45;

  let state: MarketState, label: string, color: string, detail: string;
  if (divergence) {
    state = "DETERIORATING"; label = "Narrowing";
    color = "var(--sr-warn)";
    detail = "The index is holding up while participation thins out — fewer names are doing the work. Historically an early warning, not a sell signal.";
  } else if (score >= 80) {
    state = "THRUST"; label = "Broad strength"; color = "var(--sr-pos)";
    detail = "Participation, credit and risk appetite are all constructive at once. Rare, and it does not tell you what happens next.";
  } else if (score >= 60) {
    state = "TRENDING"; label = "Constructive"; color = "var(--sr-pos)";
    detail = "Most of the market is in an uptrend with credit behaving.";
  } else if (score >= 40) {
    state = "NEUTRAL"; label = "Mixed"; color = "var(--sr-text-2)";
    detail = "No clear read: some parts of the market are working and others are not.";
  } else {
    state = "STRESSED"; label = "Stressed"; color = "var(--sr-neg)";
    detail = "Weak participation with credit and risk appetite deteriorating. This is where selection historically pays least.";
  }

  return { score, state, label, color, detail, signals, coverage: signals.length, divergence };
}

/** Lectura del panel en una frase, para cabeceras y alertas. */
export function marketMomentumLine(m: MarketMomentum | null): string {
  if (!m) return "Not enough market data to read the backdrop.";
  return `${m.label} — market breadth score ${m.score}/100 across ${m.coverage} signals.`;
}
