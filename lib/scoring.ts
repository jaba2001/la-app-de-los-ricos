import type { ScoreInputs, Scores, MacroState } from "./types";
// `percentile.ts` es un módulo PURO sin dependencias, así que importarlo no rompe la regla
// de "cargable en node por el golden test" que gobierna este fichero.
// Con extensión .ts a propósito: `node --experimental-strip-types` (el que corre los golden)
// no resuelve extensiones, y a diferencia de un `import type` —que desaparece al compilar—
// éste es un import de VALOR y tiene que existir en runtime.
import { pctlPoints, gradePillar, type FactorDistTable } from "./percentile.ts";

/** Versión de la fórmula del score. Va sellada en cada cohorte de `sl_cohort`: cambiar el
 *  criterio sin versionarlo haría incomparables las cohortes nuevas con las viejas y
 *  rompería el track record por dentro, sin que nada fallara. */
export const SCORE_VERSION_ABSOLUTE_BANDS = 1;   // bandas absolutas (histórico)
export const SCORE_VERSION_SECTOR_PCTL = 2;      // percentiles sector-relativos (F2)

// Regime→factor rotation, MEASURED (research/regime_sector_lab.mjs) and VALIDATED (a regime
// growth/value rotation earned Sharpe 1.24 vs SPY 0.74 over 2000-2026, regime_factor_validate).
// +1 favored / −1 disfavored per style, by regime. Kept inline (this module is node-loaded by
// the golden test → no runtime value imports); lib/regimeSectors.ts is the canonical copy for
// the UI, and golden behavioral tests pin both to the same sign structure. Single meaning, two
// small copies — the same parity discipline as the allocator's TS/MJS twins.
type MacroStyle = "value" | "growth" | "momentum" | "quality" | "size";
const REGIME_FACTOR_SIGNS: Record<string, Record<MacroStyle, number>> = {
  expansion:   { growth: +1, value: -1, momentum:  0, quality:  0, size: -1 },
  reflation:   { growth: +1, value: -1, momentum: +1, quality:  0, size:  0 },
  stagflation: { growth: +1, value: -1, momentum:  0, quality: +1, size: -1 },
  contraction: { growth: -1, value: +1, momentum:  0, quality: +1, size:  0 },
  neutral:     { growth: -1, value: +1, momentum:  0, quality: -1, size:  0 },
};
const FAVORED_STYLE_LABEL: Record<string, string> = { expansion: "Growth", reflation: "Growth", stagflation: "Growth", contraction: "Value", neutral: "Value" };

// FMP-stable profiles say "Financial Services" / "Basic Materials"; older sources and the
// GICS convention say "Financials" / "Materials". Every sector map carries BOTH spellings so
// no name silently falls out of sector-relative valuation, its sector ETF, or the macro tilt.
export const SECTOR_PE_BM: Record<string, number> = {
  Technology: 28, Healthcare: 22, Financials: 14, "Financial Services": 14,
  "Consumer Cyclical": 20, "Consumer Defensive": 18, Industrials: 18, Energy: 12,
  Materials: 14, "Basic Materials": 14,
  Utilities: 16, "Real Estate": 22, "Communication Services": 22,
};

export const SECTOR_EV_BM: Record<string, number> = {
  Technology: 22, Healthcare: 18, Financials: 12, "Financial Services": 12,
  "Consumer Cyclical": 14, "Consumer Defensive": 14, Industrials: 14, Energy: 7,
  Materials: 10, "Basic Materials": 10,
  Utilities: 12, "Real Estate": 20, "Communication Services": 16,
};

export const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK", Healthcare: "XLV", Financials: "XLF", "Financial Services": "XLF",
  "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP",
  Industrials: "XLI", Energy: "XLE", Materials: "XLB", "Basic Materials": "XLB",
  Utilities: "XLU", "Real Estate": "XLRE", "Communication Services": "XLC",
};

export function calcScores(inp: ScoreInputs, dist?: FactorDistTable | null, lambda: number = 1): Scores {
  // PERCENTILES SECTORIALES (F2). `dist` es OPCIONAL y ese detalle es la clave: sin tabla,
  // cada métrica cae exactamente en la banda absoluta de siempre y el score no se mueve ni
  // un punto — por eso los 862 golden siguen verdes sin tocarlos. Con tabla, cada métrica
  // se juzga contra la distribución REAL de su sector. Donde más cambia no es en el P/E
  // (que ya tenía SECTOR_PE_BM) sino en las métricas que nunca tuvieron ajuste: una utility
  // deja de ser penalizada por una deuda que es la normal en su sector, y una tecnológica
  // barata para su sector deja de puntuar como cara sólo por compararla con un banco.
  //   `P(metrica, valor, max)` → puntos por percentil, o null si no hay con qué compararlo.
  //   `lambda` gradúa cuánto pesa el sector frente al mercado entero (1 = sólo sector,
  //   0 = sólo mercado). Se mide en research/score_v2_sweep.mjs antes de fijarlo.
  const P = (metric: string, v: number | null | undefined, max: number): number | null =>
    dist ? pctlPoints(metric, v, inp.sector, dist, max, lambda) : null;

  let value = 0;
  // Sector-relative valuation: a P/E of 12 is cheap for a bank but expensive for a
  // utility. When we know the sector, score P/E and EV/EBITDA against that sector's
  // benchmark (bands of 0.7×/1.0×/1.3×). Falls back to absolute bands when the sector
  // is unknown, so callers that don't pass one behave exactly as before.
  const sectorPeBm = inp.sector ? SECTOR_PE_BM[inp.sector] : undefined;
  const sectorEvBm = inp.sector ? SECTOR_EV_BM[inp.sector] : undefined;
  if (inp.pe != null) {
    const p = P("pe", inp.pe, 7);
    if (p != null) value += p;
    else if (sectorPeBm && inp.pe > 0) {
      const r = inp.pe / sectorPeBm;
      value += r < 0.7 ? 7 : r < 1.0 ? 5 : r < 1.3 ? 3 : 0;
    } else {
      value += inp.pe < 15 ? 7 : inp.pe < 25 ? 5 : inp.pe < 35 ? 3 : 0;
    }
  }
  if (inp.pb != null) value += P("pb", inp.pb, 6) ?? (inp.pb < 1.5 ? 6 : inp.pb < 3 ? 4 : inp.pb < 5 ? 2 : 0);
  if (inp.evEbitda != null) {
    const p = P("evEbitda", inp.evEbitda, 6);
    if (p != null) value += p;
    else if (sectorEvBm && inp.evEbitda > 0) {
      const r = inp.evEbitda / sectorEvBm;
      value += r < 0.7 ? 6 : r < 1.0 ? 4 : r < 1.3 ? 2 : 0;
    } else {
      value += inp.evEbitda < 8 ? 6 : inp.evEbitda < 15 ? 4 : inp.evEbitda < 25 ? 2 : 0;
    }
  }
  if (inp.pfcf != null) value += P("pfcf", inp.pfcf, 6) ?? (inp.pfcf < 15 ? 6 : inp.pfcf < 25 ? 4 : inp.pfcf < 40 ? 2 : 0);
  // Reverse DCF signal — market expectations premium/discount vs conservative growth
  if (inp.impliedGrowthCagr != null) {
    value += inp.impliedGrowthCagr > 30 ? -4
           : inp.impliedGrowthCagr > 20 ? -2
           : inp.impliedGrowthCagr <  5 ?  3   // price implies below-consensus growth → potential
           : 0;
  }
  // Speculative value: >70% of value from terminal → unreliable
  if (inp.tvShare != null && inp.tvShare > 0.7) value -= 2;

  // Banks/insurers carry deposits & leverage by design, so industrial balance-sheet
  // ratios (D/E, current ratio, interest coverage, net debt/EBITDA) score them ~0
  // even when they're perfectly healthy. For financials, gauge health on the metrics
  // that actually apply — ROE, ROA, net margin, operating efficiency — all free-tier.
  const isFinancial = inp.sector === "Financial Services" || inp.sector === "Financials";
  let health = 0;
  if (isFinancial) {
    if (inp.roe != null)             health += P("roe", inp.roe, 12) ?? (inp.roe > 18 ? 12 : inp.roe > 13 ? 9 : inp.roe > 9 ? 6 : inp.roe > 5 ? 3 : 0);
    if (inp.roa != null)             health += P("roa", inp.roa, 8) ?? (inp.roa > 1.4 ? 8 : inp.roa > 1.1 ? 6 : inp.roa > 0.8 ? 4 : inp.roa > 0.4 ? 2 : 0);
    if (inp.netMargin != null)       health += P("netMargin", inp.netMargin, 6) ?? (inp.netMargin > 28 ? 6 : inp.netMargin > 20 ? 4 : inp.netMargin > 12 ? 2 : 0);
    if (inp.operatingMargin != null) { const om = inp.operatingMargin * 100; health += P("operatingMargin", inp.operatingMargin, 4) ?? (om > 35 ? 4 : om > 20 ? 3 : om > 0 ? 1 : 0); }
  } else {
    if (inp.debtEquity != null) health += P("debtEquity", inp.debtEquity, 10) ?? (inp.debtEquity < 0.3 ? 10 : inp.debtEquity < 0.7 ? 7 : inp.debtEquity < 1.5 ? 4 : 0);
    if (inp.currentRatio != null) health += P("currentRatio", inp.currentRatio, 10) ?? (inp.currentRatio > 2 ? 10 : inp.currentRatio > 1.5 ? 7 : inp.currentRatio > 1 ? 4 : 0);
    if (inp.interestCoverage != null) health += P("interestCoverage", inp.interestCoverage, 10) ?? (inp.interestCoverage > 10 ? 10 : inp.interestCoverage > 5 ? 6 : inp.interestCoverage > 2 ? 3 : 0);
    if (inp.netDebtEbitda != null) health += P("netDebtEbitda", inp.netDebtEbitda, 5) ?? (inp.netDebtEbitda < 1 ? 5 : inp.netDebtEbitda < 3 ? 3 : 0);
    if (inp.roic != null) health += P("roic", inp.roic, 5) ?? (inp.roic > 20 ? 5 : inp.roic > 12 ? 3 : 0);
    // Novy-Marx gross profitability (gross profit / total assets) — the most regime-ROBUST
    // quality signal (measured: best/near-best Sharpe in every backtest window, qgv_lab.mjs).
    // Rewards asset-light, high-moat models the way net margin can't. Always-on quality.
    if (inp.grossProfitability != null) health += P("grossProfitability", inp.grossProfitability, 4) ?? (inp.grossProfitability > 40 ? 4 : inp.grossProfitability > 25 ? 2 : inp.grossProfitability > 12 ? 1 : 0);
  }

  let momentum = 0;
  if (inp.priceChange1M != null) momentum += P("priceChange1M", inp.priceChange1M, 9) ?? (inp.priceChange1M > 5 ? 9 : inp.priceChange1M > 0 ? 6 : inp.priceChange1M > -5 ? 3 : 0);
  if (inp.priceChange3M != null) momentum += P("priceChange3M", inp.priceChange3M, 8) ?? (inp.priceChange3M > 10 ? 8 : inp.priceChange3M > 0 ? 5 : inp.priceChange3M > -10 ? 2 : 0);
  if (inp.priceChange6M != null) momentum += P("priceChange6M", inp.priceChange6M, 8) ?? (inp.priceChange6M > 15 ? 8 : inp.priceChange6M > 0 ? 5 : inp.priceChange6M > -15 ? 2 : 0);

  let growth = 0;
  if (inp.revenueGrowth != null) growth += P("revenueGrowth", inp.revenueGrowth, 11) ?? (inp.revenueGrowth > 20 ? 11 : inp.revenueGrowth > 10 ? 8 : inp.revenueGrowth > 0 ? 5 : 0);
  if (inp.epsGrowth != null) growth += P("epsGrowth", inp.epsGrowth, 9) ?? (inp.epsGrowth > 20 ? 9 : inp.epsGrowth > 10 ? 6 : inp.epsGrowth > 0 ? 3 : 0);

  // ── FCF quality signals (Features 1 & 6 from videos) ──────────────────────

  // Feature 1: CapEx/Revenue — asset-light model quality (lower = better: Uber/Airbnb style)
  if (!isFinancial && inp.capexToRevenue != null && inp.capexToRevenue >= 0) {
    const cr = inp.capexToRevenue;
    health += cr < 0.05 ? 4 : cr < 0.10 ? 3 : cr < 0.20 ? 1 : cr > 0.40 ? -2 : 0;
  }

  // Feature 6: FCF vs Earnings divergence — accounting quality signal
  // FCF growing faster than earnings → real cash generation; slower → earnings may be inflated
  if (!isFinancial && inp.fcfGrowthYoy != null && inp.epsGrowth != null) {
    const div = inp.fcfGrowthYoy - inp.epsGrowth;
    if (div > 15)        { health += 3; growth += 1; }  // FCF well ahead of earnings → quality
    else if (div > 5)    { health += 1; }
    else if (div < -20)  { health -= 3; }                // Earnings far ahead of FCF → concern
    else if (div < -10)  { health -= 1; }
  }

  // ── Finviz signals (all optional — gracefully degrade to no-op when null) ──

  // Forward P/E adds value signal (cap remains 25)
  if (inp.forwardPe != null && inp.forwardPe > 0) {
    value += inp.forwardPe < 12 ? 4 : inp.forwardPe < 20 ? 3 : inp.forwardPe < 30 ? 1 : 0;
  }

  // Operating margin adds profitability to health (cap remains 30). Financials already
  // fold operating efficiency into their own health formula above — don't double-count.
  if (!isFinancial && inp.operatingMargin != null) {
    const om = inp.operatingMargin * 100;
    health += om > 25 ? 3 : om > 12 ? 2 : om > 0 ? 1 : 0;
  }

  // Institutional flow adds confidence to health
  if (inp.instTrans != null) {
    const it = inp.instTrans * 100;
    health += it > 3 ? 3 : it > 1 ? 2 : it < -3 ? -3 : it < -1 ? -2 : 0;
  }

  // Short float as momentum/sentiment signal
  if (inp.shortFloat != null) {
    const sf = inp.shortFloat * 100;
    momentum += sf < 2 ? 2 : sf > 25 ? -5 : sf > 15 ? -3 : sf > 8 ? -1 : 0;
  }

  // Relative volume — unusual activity
  if (inp.relVolume != null) {
    momentum += inp.relVolume > 3 ? 2 : inp.relVolume > 1.5 ? 1 : inp.relVolume < 0.2 ? -1 : 0;
  }

  // EPS Q/Q acceleration adds to growth
  if (inp.epsQoQ != null) {
    const eq = inp.epsQoQ * 100;
    growth += eq > 30 ? 3 : eq > 10 ? 2 : eq > 0 ? 1 : 0;
  }

  // Sales Q/Q adds to growth
  if (inp.salesQoQ != null) {
    const sq = inp.salesQoQ * 100;
    growth += sq > 20 ? 2 : sq > 5 ? 1 : 0;
  }

  // B1 — Regime-weighted scoring
  const regime = inp.regime ?? "neutral";
  let vW = 1, hW = 1, mW = 1, gW = 1;
  if (regime === "expansion")        { mW = 1.15; gW = 1.1; }
  else if (regime === "reflation")   { vW = 1.1;  gW = 1.05; }
  else if (regime === "stagflation") { hW = 1.2;  mW = 0.75; gW = 0.75; }
  else if (regime === "contraction") { hW = 1.25; mW = 0.6;  gW = 0.7;  vW = 1.05; }

  // Clamp to the published pillar bounds [0..cap]. Penalties (short float, negative FCF
  // divergence, inst. selling…) offset points WITHIN a pillar but can't take it below 0 —
  // otherwise a name with only penalty signals renders a negative gauge.
  value    = Math.max(0, Math.min(25, Math.round(value    * vW)));
  health   = Math.max(0, Math.min(30, Math.round(health   * hW)));
  momentum = Math.max(0, Math.min(25, Math.round(momentum * mW)));
  growth   = Math.max(0, Math.min(20, Math.round(growth   * gW)));

  // B2 — Rate sensitivity penalty (high leverage in hostile macro)
  if (inp.debtEquity != null && inp.debtEquity > 1.5 &&
      (regime === "stagflation" || regime === "contraction")) {
    const penalty = Math.min(5, Math.round((inp.debtEquity - 1.5) * 3));
    health = Math.max(0, health - penalty);
  }

  const total = value + health + momentum + growth;
  return { value, health, momentum, growth, total };
}

// ─────────────────────────────────────────────────────────────────────────────
// UMBRALES DESCALIFICADORES (P0-3) — copiados de Seeking Alpha porque la idea es buena y
// es gratis: un solo pilar podrido debe TOPAR la nota, por bien que vaya el resto.
//
// El fallo que corrige: los cuatro pilares se suman, así que una empresa con una salud
// financiera en el decil inferior de su sector puede sacar BUY a base de momentum y
// crecimiento. La suma dice "está bien"; el balance dice "esto puede quebrar". Topar es
// más honesto que promediar, y —a diferencia de SA— aquí el motivo se dice en pantalla.
//
// Sólo funciona con distribuciones (hace falta saber qué es "el decil inferior DE SU
// SECTOR"). Sin ellas devuelve lista vacía y el rating es el de siempre.
// ─────────────────────────────────────────────────────────────────────────────
export const DISQUALIFY_BELOW_PCTL = 10;

export interface Disqualifier { pillar: string; pctl: number; reason: string }

export function findDisqualifiers(inp: ScoreInputs, dist?: FactorDistTable | null): Disqualifier[] {
  if (!dist) return [];
  const etiquetas: Record<string, string> = { value: "Valuation", health: "Financial health", momentum: "Momentum", growth: "Growth" };
  const out: Disqualifier[] = [];
  for (const pilar of ["value", "health", "momentum", "growth"]) {
    const g = gradePillar(pilar, inp as unknown as Record<string, number | null | undefined>, dist, inp.sector);
    if (g && g.pctl < DISQUALIFY_BELOW_PCTL) {
      out.push({
        pillar: pilar,
        pctl: g.pctl,
        reason: `${etiquetas[pilar]} sits in the bottom ${DISQUALIFY_BELOW_PCTL}% of ${g.metrics[0]?.sector ?? "its sector"} (percentile ${Math.round(g.pctl)}) — the rating is capped regardless of the other pillars.`,
      });
    }
  }
  return out;
}

export function getRating(total: number, disqualifiers?: Disqualifier[] | null): { label: string; color: string; capped?: boolean; reason?: string } {
  const base =
    total >= 80 ? { label: "STRONG BUY", color: "var(--sr-pos)" }
    : total >= 50 ? { label: "BUY",       color: "var(--sr-pos)" }
    : total >= 35 ? { label: "CAUTION",   color: "var(--sr-neg)" }
    :               { label: "AVOID",     color: "var(--sr-neg)" };
  if (!disqualifiers?.length) return base;
  // Topado a CAUTION: nunca puede salir una recomendación de compra con un pilar hundido.
  if (base.label === "STRONG BUY" || base.label === "BUY") {
    return { label: "CAUTION", color: "var(--sr-neg)", capped: true, reason: disqualifiers[0].reason };
  }
  return { ...base, capped: true, reason: disqualifiers[0].reason };
}

// Weighted composite health score, 0-100 (higher = healthier backdrop). Druckenmiller-style
// hierarchy: Liquidity > Credit > Recession > Geopolitical = Housing. Same weights used by
// the matching engine in lib/historicalMatch.ts for consistency across the app.
export function computeICHealthScore(macro: Pick<MacroState, "liquidity_cycle" | "credit_stress" | "recession_prob" | "geopolitical_risk" | "housing_stress"> | null | undefined): number | null {
  const lcc = macro?.liquidity_cycle, csc = macro?.credit_stress;
  const rpc = macro?.recession_prob,  grc = macro?.geopolitical_risk;
  const hsc = macro?.housing_stress;
  if (lcc == null || csc == null || rpc == null || grc == null || hsc == null) return null;
  return Math.max(0, Math.min(100, 100 - (Number(csc) * 0.25 + (100 - Number(lcc)) * 0.35 + Number(rpc) * 0.20 + Number(grc) * 0.10 + Number(hsc) * 0.10)));
}

// A1 — UNIFIED MACRO VOICE. The stock score's macro tilt now derives from the SAME
// stationary risk-on gauge the validated allocator uses (macro_state.risk_on), not from
// the legacy ic_score/ted_spread/fear_greed grab-bag. When risk_on is absent it falls back
// to a regime + recession/credit estimate, so the score and the allocator can never speak
// with contradictory numbers. Correlation (selection regime) is surfaced separately via
// stockPickingRegime, so it's intentionally NOT folded into this backdrop tilt.
export function getMacroTilt(
  macroState: { regime_id?: string | null; recession_prob?: number | null; credit_stress?: number | null; risk_on?: number | null; hy_oas?: number | null; implied_corr?: number | null; ic_score?: number | null },
  sector: string,
  factorTilts?: { value: number; growth: number; momentum: number; quality: number; size: number } | null
): { tilt: number; label: string; color: string; reasons: string[] } {
  const reasons: string[] = [];
  const regime = macroState.regime_id ?? "neutral";
  const rpc = macroState.recession_prob != null ? Number(macroState.recession_prob) : 50;
  const csc = macroState.credit_stress  != null ? Number(macroState.credit_stress)  : 50;
  const hy  = macroState.hy_oas != null ? Number(macroState.hy_oas) : null;

  const REGIME_BASE: Record<string, number> = { expansion: 70, reflation: 58, neutral: 50, stagflation: 32, contraction: 22 };
  const ro = macroState.risk_on != null
    ? Math.max(0, Math.min(100, Number(macroState.risk_on)))
    : Math.max(0, Math.min(100, (REGIME_BASE[regime] ?? 50) - (rpc - 50) * 0.3 - (csc - 50) * 0.2));

  let tilt = Math.round(((ro - 50) / 50) * 10); // liquidity-led backdrop, ±10
  reasons.push(`Risk-on gauge ${ro.toFixed(0)}/100 → ${ro >= 60 ? "risk-on" : ro >= 40 ? "neutral" : "risk-off"} backdrop`);

  const growthSectors    = ["Technology", "Consumer Cyclical", "Communication Services", "Real Estate"];
  const defensiveSectors = ["Utilities", "Consumer Defensive", "Healthcare"];
  const cyclicalSectors  = ["Energy", "Materials", "Basic Materials", "Industrials", "Financials", "Financial Services"];
  if (ro >= 60) {
    if (growthSectors.includes(sector))        { tilt += 3; reasons.push(`Risk-on favors ${sector} (growth)`); }
    else if (cyclicalSectors.includes(sector)) { tilt += 2; reasons.push(`Risk-on lifts ${sector} (cyclical)`); }
    else if (defensiveSectors.includes(sector)) { tilt -= 1; reasons.push(`${sector} lags in a risk-on tape`); }
  } else if (ro < 40) {
    if (defensiveSectors.includes(sector))     { tilt += 3; reasons.push(`${sector} is defensive in risk-off`); }
    else if (growthSectors.includes(sector))   { tilt -= 3; reasons.push(`${sector} (growth) hurt in risk-off`); }
    else if (cyclicalSectors.includes(sector)) { tilt -= 2; reasons.push(`${sector} (cyclical) soft in risk-off`); }
  }

  // Regime→FACTOR rotation (measured & validated: Sharpe 1.24 vs SPY 0.74, 2000-2026). Tilt a
  // name UP when its dominant style is what the regime rewards (growth in expansion/reflation,
  // value in contraction/neutral). Small ±4 — validated at the basket level, a directional
  // nudge at single-name. `factorTilts` optional → callers without a style profile are unchanged.
  const fsign = REGIME_FACTOR_SIGNS[regime];
  if (factorTilts && fsign) {
    const styles: [MacroStyle, number][] = [["growth", factorTilts.growth], ["value", factorTilts.value], ["momentum", factorTilts.momentum], ["quality", factorTilts.quality], ["size", factorTilts.size]];
    const [domStyle, domVal] = styles.slice().sort((a, b) => b[1] - a[1])[0];
    const total = styles.reduce((s, [, v]) => s + Math.max(0, v), 0);
    const strength = total > 0 ? Math.min(1, (domVal / total) * 2) : 0; // how dominant the top style is
    const ft = Math.round((fsign[domStyle] ?? 0) * 4 * strength); // ±4 pts max
    if (ft !== 0) {
      tilt += ft;
      reasons.push(`${domStyle[0].toUpperCase() + domStyle.slice(1)}-leaning name ${ft > 0 ? "has a macro tailwind" : "faces a macro headwind"} in ${regime} (favors ${FAVORED_STYLE_LABEL[regime] ?? "—"}) — measured factor rotation`);
    }
  }

  // Secondary confirmations — kept small; the risk-on gauge already folds most of this in.
  if (rpc > 60) { tilt -= 4; reasons.push(`High recession probability (${rpc.toFixed(0)})`); }
  else if (rpc > 40) { tilt -= 2; reasons.push(`Elevated recession probability`); }
  if (csc > 60 || (hy != null && hy > 500)) { tilt -= 3; reasons.push(`Credit stress elevated`); }

  tilt = Math.max(-20, Math.min(20, tilt));
  const label = tilt >= 6 ? "Favorable" : tilt >= -2 ? "Neutral" : tilt >= -8 ? "Caution" : "Unfavorable";
  const color = tilt >= 6 ? "var(--sr-pos)" : tilt >= -2 ? "var(--sr-text-2)" : tilt >= -8 ? "var(--sr-warn)" : "var(--sr-neg)";
  return { tilt, label, color, reasons };
}

export interface FactorTilts {
  value: number;
  growth: number;
  momentum: number;
  quality: number;
  size: number;
}

export function calcFactorTilts(inp: ScoreInputs): FactorTilts {
  let value = 0;
  if (inp.pe != null)       value += inp.pe < 10 ? 7 : inp.pe < 18 ? 5 : inp.pe < 28 ? 3 : 0;
  if (inp.pfcf != null)     value += inp.pfcf < 12 ? 5 : inp.pfcf < 20 ? 3 : inp.pfcf < 30 ? 1 : 0;
  if (inp.evEbitda != null) value += inp.evEbitda < 7 ? 5 : inp.evEbitda < 12 ? 3 : inp.evEbitda < 20 ? 1 : 0;
  if (inp.pe != null && inp.epsGrowth != null && inp.epsGrowth > 0) {
    const peg = inp.pe / inp.epsGrowth;
    value += peg < 1 ? 3 : peg < 2 ? 1 : 0;
  }
  value = Math.min(20, value);

  let growth = 0;
  if (inp.revenueGrowth != null) growth += inp.revenueGrowth > 30 ? 10 : inp.revenueGrowth > 20 ? 8 : inp.revenueGrowth > 10 ? 5 : inp.revenueGrowth > 0 ? 2 : 0;
  if (inp.epsGrowth != null)     growth += inp.epsGrowth > 25 ? 10 : inp.epsGrowth > 15 ? 7 : inp.epsGrowth > 5 ? 4 : inp.epsGrowth > 0 ? 1 : 0;
  growth = Math.min(20, growth);

  let momentum = 0;
  if (inp.priceChange1M != null) momentum += inp.priceChange1M > 10 ? 7 : inp.priceChange1M > 3 ? 5 : inp.priceChange1M > 0 ? 3 : inp.priceChange1M > -5 ? 1 : 0;
  if (inp.priceChange3M != null) momentum += inp.priceChange3M > 15 ? 7 : inp.priceChange3M > 5 ? 5 : inp.priceChange3M > 0 ? 3 : 0;
  if (inp.priceChange6M != null) momentum += inp.priceChange6M > 20 ? 6 : inp.priceChange6M > 8 ? 4 : inp.priceChange6M > 0 ? 2 : 0;
  momentum = Math.min(20, momentum);

  let quality = 0;
  // Novy-Marx gross profitability (GP/assets) leads the quality factor — measured as the most
  // regime-robust of the QGV pillars (qgv_lab.mjs). This is the factor that getMacroTilt rotates
  // by regime (quality favored in stagflation/contraction), so a cleaner quality signal sharpens
  // the measured, VALIDATED regime→factor tilt (Sharpe 1.24 vs SPY 0.74).
  if (inp.grossProfitability != null) quality += inp.grossProfitability > 40 ? 5 : inp.grossProfitability > 25 ? 3 : inp.grossProfitability > 12 ? 1 : 0;
  if (inp.roic != null)             quality += inp.roic > 25 ? 6 : inp.roic > 15 ? 4 : inp.roic > 8 ? 2 : 0;
  if (inp.roe != null)              quality += inp.roe > 20 ? 4 : inp.roe > 12 ? 3 : inp.roe > 5 ? 1 : 0;
  if (inp.grossMargin != null)      quality += inp.grossMargin > 60 ? 4 : inp.grossMargin > 40 ? 2 : inp.grossMargin > 25 ? 1 : 0;
  if (inp.interestCoverage != null) quality += inp.interestCoverage > 12 ? 4 : inp.interestCoverage > 5 ? 2 : inp.interestCoverage > 2 ? 1 : 0;
  quality = Math.min(20, quality);

  let size = 10;
  const mc = inp.marketCap;
  if (mc != null) {
    if (mc < 300e6)  size = 20;
    else if (mc < 2e9)   size = 17;
    else if (mc < 10e9)  size = 13;
    else if (mc < 100e9) size = 8;
    else size = 3;
  }

  return { value, growth, momentum, quality, size };
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMED SUB-SCORES (0-10) — Moat & Cash-Flow Quality. These do NOT change the Scora
// Score: they repackage signals calcScores already folds into `health` into two
// plain, self-standing 0-10 gauges the UI can surface. Each is normalized over the
// signals actually present, so a name with only 2 of 4 inputs still gets a fair 0-10.
// Pure & type-only → runs headless in the golden/p2 tests.
// ─────────────────────────────────────────────────────────────────────────────
export interface SubScoreFactor { label: string; strength: number; } // strength 0..1 (null inputs omitted)
export interface SubScore { score: number; factors: SubScoreFactor[]; }
export interface SubScores { moat: SubScore | null; cashFlow: SubScore | null; }

/** Grade a value into 0..1 against ascending or descending thresholds. */
function grade(v: number, thresholds: number[], descending = false): number {
  // thresholds ascending → higher v = better (returns i/(n) as it clears each band).
  // descending → lower v = better.
  const n = thresholds.length;
  if (descending) {
    for (let i = 0; i < n; i++) if (v < thresholds[i]) return (n - i) / n;
    return 0;
  }
  for (let i = n - 1; i >= 0; i--) if (v > thresholds[i]) return (i + 1) / n;
  return 0;
}

function normalize(parts: { label: string; weight: number; strength: number | null }[]): SubScore | null {
  const present = parts.filter(p => p.strength != null) as { label: string; weight: number; strength: number }[];
  if (present.length === 0) return null;
  const got = present.reduce((s, p) => s + p.weight * p.strength, 0);
  const max = present.reduce((s, p) => s + p.weight, 0);
  return {
    score: Math.round((got / max) * 10 * 10) / 10, // one decimal, 0-10
    factors: present.map(p => ({ label: p.label, strength: Math.round(p.strength * 100) / 100 })),
  };
}

export function calcSubScores(inp: ScoreInputs): SubScores {
  // MOAT — durable, hard-to-replicate economics: gross profitability (Novy-Marx), returns on
  // capital, pricing power (gross margin), and capital-light operations.
  const moat = normalize([
    { label: "Gross profitability", weight: 4, strength: inp.grossProfitability != null ? grade(inp.grossProfitability, [8, 15, 25, 40]) : null },
    { label: "Return on capital",   weight: 3, strength: inp.roic != null ? grade(inp.roic, [8, 12, 20]) : null },
    { label: "Pricing power",       weight: 2, strength: inp.grossMargin != null ? grade(inp.grossMargin, [25, 40, 60]) : null },
    { label: "Capital-light",       weight: 1, strength: inp.capexToRevenue != null && inp.capexToRevenue >= 0 ? grade(inp.capexToRevenue, [0.05, 0.10, 0.20], true) : null },
  ]);

  // CASH-FLOW QUALITY — real cash generation, not accounting earnings: FCF yield, FCF growing
  // ahead of earnings (a clean-accounting tell), reasonable price-to-FCF, low capital intensity.
  const divergence = inp.fcfGrowthYoy != null && inp.epsGrowth != null ? inp.fcfGrowthYoy - inp.epsGrowth : null;
  const cashFlow = normalize([
    { label: "FCF yield",           weight: 3, strength: inp.fcfYield != null ? grade(inp.fcfYield * 100, [0, 3, 5, 8]) : null },
    { label: "FCF vs earnings",     weight: 3, strength: divergence != null ? grade(divergence, [-5, 5, 15]) : null },
    { label: "Price to FCF",        weight: 2, strength: inp.pfcf != null && inp.pfcf > 0 ? grade(inp.pfcf, [15, 25, 40], true) : null },
    { label: "Low capital intensity", weight: 2, strength: inp.capexToRevenue != null && inp.capexToRevenue >= 0 ? grade(inp.capexToRevenue, [0.10, 0.20], true) : null },
  ]);

  return { moat, cashFlow };
}
