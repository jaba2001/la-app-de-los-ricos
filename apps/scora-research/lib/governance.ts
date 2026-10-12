// ─────────────────────────────────────────────────────────────────────────────
// F4 · COSTES DE AGENCIA — Jensen & Meckling (1976), "Theory of the Firm".
//
// Cuando quien decide no es quien pone el dinero aparecen COSTES DE AGENCIA: monitorización
// + fianza (bonding) + pérdida residual. No es un fallo moral, es la consecuencia
// estructural de separar propiedad y control. La continuación es Jensen (1986), la
// hipótesis del FLUJO DE CAJA LIBRE: el directivo con caja abundante y sin proyectos buenos
// construye imperio en vez de repartir — y por eso la deuda DISCIPLINA (compromete la caja
// futura y le quita discrecionalidad).
//
// La pregunta que resume el paper y que este módulo intenta contestar con datos gratis:
// ¿de quién es el dinero que se está gastando, y en beneficio de quién?
//
// Señales elegidas por estar DOCUMENTADAS en la literatura y salir de estados financieros
// que Scora ya descarga:
//   • Emisión neta de acciones — Pontiff & Woodgate (2008), Daniel & Titman (2006)
//   • Crecimiento de activos   — Cooper, Gulen & Schill (2008)
//   • Carga de SBC             — transferencia directa del accionista al gestor
//   • Test del FCF de Jensen   — caja alta + retorno bajo + inversión alta = imperio
//   • Alineación de insiders   — con punto dulce: poca = desalineación, mucha = atrincheramiento
//   • Accruals (Sloan 1996)    — se PASA como entrada desde lib/quality.ts, no se recalcula
//
// ⚠️ NADA de esto entra en `score.total` sin pasar el gate OOS + PSR de research/backtest.mjs.
// La emisión neta y el crecimiento de activos tienen IC documentada en la literatura, así que
// MERECEN medirse — pero medirse, no suponerse. Ver PLAN_TEORIA_FINANCIERA_SCORA.md §3.4.
//
// Puro y headless.
// ─────────────────────────────────────────────────────────────────────────────

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

export interface GovernanceInputs {
  /** Variación % interanual de acciones en circulación. POSITIVA = dilución. */
  netIssuancePct?: number | null;
  /** Compensación en acciones / ingresos, en %. */
  sbcToRevenuePct?: number | null;
  /** Compensación en acciones / flujo de caja libre, en %. */
  sbcToFcfPct?: number | null;
  /** Crecimiento % interanual del activo total. */
  assetGrowthPct?: number | null;
  /** Participación de insiders como FRACCIÓN (0-1), igual que en lib/esg.ts. */
  insiderOwn?: number | null;
  /** Ratio de accruals de lib/quality.ts (`accrualsRatio().ratio`). Alto = beneficio de peor calidad. */
  accrualsRatio?: number | null;
}

export interface GovernanceComponent {
  key: string;
  label: string;
  raw: number;
  /** 0-100; MAYOR = MÁS coste de agencia (peor). */
  score: number;
  note: string;
}

export type AgencyBand = "baja" | "moderada" | "alta" | "severa";

export interface GovernanceResult {
  /** 0-100. ATENCIÓN AL SENTIDO: mayor = MÁS coste de agencia = PEOR para el accionista.
   *  Es lo contrario del Scora Score, y por eso se llama "coste" y no "puntuación". */
  agencyCost: number;
  band: AgencyBand;
  components: GovernanceComponent[];
  covered: number;
  readings: string[];
}

// Anclas: reglas de oficio documentadas, NO constantes medidas. Se publican los valores
// crudos junto al score para que el lector no dependa de la curva.
const ANCHORS: Record<string, [number, number][]> = {
  // Emisión neta: recomprar acciones puntúa bajo; diluir agresivamente, alto.
  netIssuance: [[-8, 3], [-3, 12], [0, 30], [2, 55], [6, 82], [15, 100]],
  sbcToRevenue: [[0, 3], [2, 25], [6, 55], [12, 82], [25, 100]],
  sbcToFcf: [[0, 3], [8, 28], [25, 60], [55, 88], [100, 100]],
  // Cooper-Gulen-Schill: crecer activos deprisa predice retornos futuros bajos.
  assetGrowth: [[-10, 12], [0, 25], [10, 42], [25, 72], [50, 95], [80, 100]],
  accruals: [[-0.1, 10], [0, 25], [0.1, 55], [0.25, 85], [0.5, 100]],
};

const LABELS: Record<string, string> = {
  netIssuance: "Net share issuance",
  sbcToRevenue: "SBC / revenue",
  sbcToFcf: "SBC / free cash flow",
  assetGrowth: "Asset growth",
  insiderAlignment: "Insider alignment",
  accruals: "Accruals (earnings quality)",
};

/**
 * Alineación de insiders con PUNTO DULCE (misma forma que lib/esg.ts): con participación
 * casi nula el gestor no arriesga su patrimonio; con participación dominante se atrinchera
 * y deja de rendir cuentas al resto del accionariado. El óptimo está en medio (~5-25%).
 * Devuelve coste de agencia 0-100.
 */
function insiderAlignmentCost(frac: number): number {
  const pct = frac * 100;
  if (pct <= 25) return piecewise(pct, [[0, 78], [2, 55], [6, 25], [15, 18], [25, 30]]);
  return piecewise(pct, [[25, 30], [40, 55], [60, 80], [80, 95]]);
}

/**
 * Compone el coste de agencia sobre los componentes DISPONIBLES (normalizado por los
 * presentes). Devuelve null si no hay ninguna entrada utilizable.
 */
export function computeGovernance(inp: GovernanceInputs): GovernanceResult | null {
  const components: GovernanceComponent[] = [];
  const add = (key: string, v: number | null | undefined, note: string) => {
    if (!num(v)) return;
    components.push({ key, label: LABELS[key], raw: v, score: piecewise(v, ANCHORS[key]), note });
  };

  add("netIssuance", inp.netIssuancePct,
    num(inp.netIssuancePct) && inp.netIssuancePct < 0
      ? "Net buyback: shareholders who stay own more of the company."
      : "Dilution: each existing share is a smaller slice of the same company.");
  add("sbcToRevenue", inp.sbcToRevenuePct, "Share of revenue paid to staff in shareholders' stock.");
  add("sbcToFcf", inp.sbcToFcfPct, "How much of free cash flow is consumed by stock-based compensation.");
  add("assetGrowth", inp.assetGrowthPct, "Cooper-Gulen-Schill (2008): fast asset growth predicts low future returns.");
  add("accruals", inp.accrualsRatio, "Sloan (1996): earnings well above cash are lower-quality earnings.");

  if (num(inp.insiderOwn) && inp.insiderOwn >= 0 && inp.insiderOwn <= 1) {
    components.push({
      key: "insiderAlignment",
      label: LABELS.insiderAlignment,
      raw: inp.insiderOwn,
      score: insiderAlignmentCost(inp.insiderOwn),
      note: "Sweet spot: too little ownership is misalignment; too much, entrenchment.",
    });
  }

  if (!components.length) return null;

  const agencyCost = components.reduce((s, c) => s + c.score, 0) / components.length;
  const band: AgencyBand = agencyCost >= 75 ? "severa" : agencyCost >= 52 ? "alta" : agencyCost >= 30 ? "moderada" : "baja";

  const readings: string[] = [];
  const top = [...components].sort((a, b) => b.score - a.score)[0];
  readings.push(
    band === "baja"
      ? "Incentives look aligned with shareholders: capital is managed as if it were their own."
      : band === "moderada"
      ? "Normal agency frictions. Nothing alarming, but worth knowing where the money goes."
      : band === "alta"
      ? "High agency cost: a meaningful part of the value created doesn't reach shareholders."
      : "Severe agency cost: management is systematically transferring value away from shareholders."
  );
  readings.push(`Main source: ${top.label.toLowerCase()} (${top.raw.toFixed(2)}).`);
  if (components.length < 6) readings.push(`Computed on ${components.length} of 6 available signals.`);
  return { agencyCost, band, components, covered: components.length, readings };
}

// ── Test del flujo de caja libre (Jensen 1986) ───────────────────────────────
export interface JensenFcfInputs {
  /** Flujo de caja libre / ingresos, en %. */
  fcfMarginPct?: number | null;
  /** Retorno sobre capital invertido, en %. */
  roicPct?: number | null;
  /** Coste medio ponderado del capital, en % (de lib/valuation.waccBridge). */
  waccPct?: number | null;
  /** CapEx / ingresos, en %. */
  capexToRevenuePct?: number | null;
  /** Rentabilidad por dividendo, en %. */
  dividendYieldPct?: number | null;
  /** Rentabilidad por recompra neta, en %. */
  buybackYieldPct?: number | null;
}

export interface JensenFcfResult {
  /** true = el patrón de construcción de imperio está presente. */
  empireBuilding: boolean;
  /** Diferencial ROIC − WACC en puntos porcentuales; negativo = destruye valor al invertir. */
  spread: number | null;
  /** Dividendos + recompras netas, en %. */
  shareholderYield: number | null;
  reading: string;
}

/**
 * El test de Jensen (1986): caja libre abundante + retorno del capital POR DEBAJO de su
 * coste + inversión alta + poco reparto = el directivo está construyendo un imperio con
 * dinero que rendiría más en el bolsillo del accionista.
 *
 * Requiere margen de FCF, ROIC y WACC; el resto refina la lectura. Devuelve null sin ellos.
 */
export function jensenFcfTest(inp: JensenFcfInputs): JensenFcfResult | null {
  if (!num(inp.fcfMarginPct) || !num(inp.roicPct) || !num(inp.waccPct)) return null;
  const spread = inp.roicPct - inp.waccPct;
  const yieldSum = (num(inp.dividendYieldPct) ? inp.dividendYieldPct : 0) + (num(inp.buybackYieldPct) ? inp.buybackYieldPct : 0);
  const shareholderYield = num(inp.dividendYieldPct) || num(inp.buybackYieldPct) ? yieldSum : null;

  const cashRich = inp.fcfMarginPct >= 8;
  const destroysValue = spread < 0;
  const investsHeavily = num(inp.capexToRevenuePct) ? inp.capexToRevenuePct >= 8 : false;
  const returnsLittle = shareholderYield == null ? false : shareholderYield < 1.5;

  const empireBuilding = cashRich && destroysValue && (investsHeavily || returnsLittle);

  const reading = empireBuilding
    ? `Empire-building pattern: it generates cash (FCF ${inp.fcfMarginPct.toFixed(1)}% of revenue) but reinvests at a return BELOW its cost of capital (ROIC ${inp.roicPct.toFixed(1)}% vs WACC ${inp.waccPct.toFixed(1)}%). Jensen (1986): that money would earn more paid out than reinvested.`
    : destroysValue
    ? `ROIC (${inp.roicPct.toFixed(1)}%) is below the cost of capital (${inp.waccPct.toFixed(1)}%): growing destroys value, though not every condition of the empire pattern is met.`
    : `Capital is reinvested above its cost (ROIC ${inp.roicPct.toFixed(1)}% vs WACC ${inp.waccPct.toFixed(1)}%, spread +${spread.toFixed(1)} pp): growth here CREATES value.`;

  return { empireBuilding, spread, shareholderYield, reading };
}

/** Rentabilidad total al accionista = dividendos + recompras netas − emisión.
 *  Todo en %. Devuelve null si no hay ningún componente. */
export function shareholderYield(
  dividendYieldPct?: number | null, buybackYieldPct?: number | null, issuancePct?: number | null
): number | null {
  const parts = [dividendYieldPct, buybackYieldPct, issuancePct != null ? -issuancePct : null].filter(num);
  if (!parts.length) return null;
  return parts.reduce((s, x) => s + x, 0);
}
