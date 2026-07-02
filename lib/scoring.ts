import type { ScoreInputs, Scores, MacroState } from "./types";

export const SECTOR_PE_BM: Record<string, number> = {
  Technology: 28, Healthcare: 22, Financials: 14, "Consumer Cyclical": 20,
  "Consumer Defensive": 18, Industrials: 18, Energy: 12, Materials: 14,
  Utilities: 16, "Real Estate": 22, "Communication Services": 22,
};

export const SECTOR_EV_BM: Record<string, number> = {
  Technology: 22, Healthcare: 18, Financials: 12, "Consumer Cyclical": 14,
  "Consumer Defensive": 14, Industrials: 14, Energy: 7, Materials: 10,
  Utilities: 12, "Real Estate": 20, "Communication Services": 16,
};

export const SECTOR_ETF: Record<string, string> = {
  Technology: "XLK", Healthcare: "XLV", Financials: "XLF",
  "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP",
  Industrials: "XLI", Energy: "XLE", Materials: "XLB",
  Utilities: "XLU", "Real Estate": "XLRE", "Communication Services": "XLC",
};

export function calcScores(inp: ScoreInputs): Scores {
  let value = 0;
  if (inp.pe != null) value += inp.pe < 15 ? 7 : inp.pe < 25 ? 5 : inp.pe < 35 ? 3 : 0;
  if (inp.pb != null) value += inp.pb < 1.5 ? 6 : inp.pb < 3 ? 4 : inp.pb < 5 ? 2 : 0;
  if (inp.evEbitda != null) value += inp.evEbitda < 8 ? 6 : inp.evEbitda < 15 ? 4 : inp.evEbitda < 25 ? 2 : 0;
  if (inp.pfcf != null) value += inp.pfcf < 15 ? 6 : inp.pfcf < 25 ? 4 : inp.pfcf < 40 ? 2 : 0;
  // Reverse DCF signal — market expectations premium/discount vs conservative growth
  if (inp.impliedGrowthCagr != null) {
    value += inp.impliedGrowthCagr > 30 ? -4
           : inp.impliedGrowthCagr > 20 ? -2
           : inp.impliedGrowthCagr <  5 ?  3   // price implies below-consensus growth → potential
           : 0;
  }
  // Speculative value: >70% of value from terminal → unreliable
  if (inp.tvShare != null && inp.tvShare > 0.7) value -= 2;

  let health = 0;
  if (inp.debtEquity != null) health += inp.debtEquity < 0.3 ? 10 : inp.debtEquity < 0.7 ? 7 : inp.debtEquity < 1.5 ? 4 : 0;
  if (inp.currentRatio != null) health += inp.currentRatio > 2 ? 10 : inp.currentRatio > 1.5 ? 7 : inp.currentRatio > 1 ? 4 : 0;
  if (inp.interestCoverage != null) health += inp.interestCoverage > 10 ? 10 : inp.interestCoverage > 5 ? 6 : inp.interestCoverage > 2 ? 3 : 0;
  if (inp.netDebtEbitda != null) health += inp.netDebtEbitda < 1 ? 5 : inp.netDebtEbitda < 3 ? 3 : 0;
  if (inp.roic != null) health += inp.roic > 20 ? 5 : inp.roic > 12 ? 3 : 0;

  let momentum = 0;
  if (inp.priceChange1M != null) momentum += inp.priceChange1M > 5 ? 9 : inp.priceChange1M > 0 ? 6 : inp.priceChange1M > -5 ? 3 : 0;
  if (inp.priceChange3M != null) momentum += inp.priceChange3M > 10 ? 8 : inp.priceChange3M > 0 ? 5 : inp.priceChange3M > -10 ? 2 : 0;
  if (inp.priceChange6M != null) momentum += inp.priceChange6M > 15 ? 8 : inp.priceChange6M > 0 ? 5 : inp.priceChange6M > -15 ? 2 : 0;

  let growth = 0;
  if (inp.revenueGrowth != null) growth += inp.revenueGrowth > 20 ? 11 : inp.revenueGrowth > 10 ? 8 : inp.revenueGrowth > 0 ? 5 : 0;
  if (inp.epsGrowth != null) growth += inp.epsGrowth > 20 ? 9 : inp.epsGrowth > 10 ? 6 : inp.epsGrowth > 0 ? 3 : 0;

  // ── FCF quality signals (Features 1 & 6 from videos) ──────────────────────

  // Feature 1: CapEx/Revenue — asset-light model quality (lower = better: Uber/Airbnb style)
  if (inp.capexToRevenue != null && inp.capexToRevenue >= 0) {
    const cr = inp.capexToRevenue;
    health += cr < 0.05 ? 4 : cr < 0.10 ? 3 : cr < 0.20 ? 1 : cr > 0.40 ? -2 : 0;
  }

  // Feature 6: FCF vs Earnings divergence — accounting quality signal
  // FCF growing faster than earnings → real cash generation; slower → earnings may be inflated
  if (inp.fcfGrowthYoy != null && inp.epsGrowth != null) {
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

  // Operating margin adds profitability to health (cap remains 30)
  if (inp.operatingMargin != null) {
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

  value    = Math.min(25, Math.round(value    * vW));
  health   = Math.min(30, Math.round(health   * hW));
  momentum = Math.min(25, Math.round(momentum * mW));
  growth   = Math.min(20, Math.round(growth   * gW));

  // B2 — Rate sensitivity penalty (high leverage in hostile macro)
  if (inp.debtEquity != null && inp.debtEquity > 1.5 &&
      (regime === "stagflation" || regime === "contraction")) {
    const penalty = Math.min(5, Math.round((inp.debtEquity - 1.5) * 3));
    health = Math.max(0, health - penalty);
  }

  const total = value + health + momentum + growth;
  return { value, health, momentum, growth, total };
}

export function getRating(total: number): { label: string; color: string } {
  if (total >= 80) return { label: "STRONG BUY", color: "var(--sr-pos)" };
  if (total >= 50) return { label: "BUY",         color: "var(--sr-pos)" };
  if (total >= 35) return { label: "CAUTION",     color: "var(--sr-neg)" };
  return               { label: "AVOID",          color: "var(--sr-neg)" };
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

export function getMacroTilt(
  macroState: { regime_id?: string | null; recession_prob?: number | null; credit_stress?: number | null; ic_score?: number | null; cartera_quadrant?: string | null; fear_greed?: number | null; ted_spread?: number | null; hy_oas?: number | null },
  sector: string
): { tilt: number; label: string; color: string; reasons: string[] } {
  let tilt = 0;
  const reasons: string[] = [];
  const regime = macroState.regime_id ?? "neutral";
  const rpc = macroState.recession_prob != null ? Number(macroState.recession_prob) : 50;
  const csc = macroState.credit_stress  != null ? Number(macroState.credit_stress)  : 50;
  const ic  = macroState.ic_score       != null ? Number(macroState.ic_score)        : null;
  const fg  = macroState.fear_greed     != null ? Number(macroState.fear_greed)      : null;
  const ted = macroState.ted_spread     != null ? Number(macroState.ted_spread)      : null;

  const growthSectors    = ["Technology", "Consumer Cyclical", "Communication Services", "Real Estate"];
  const defensiveSectors = ["Utilities", "Consumer Defensive", "Healthcare"];
  const cyclicalSectors  = ["Energy", "Materials", "Industrials", "Financials"];

  if (regime === "expansion") {
    tilt += 8;
    reasons.push("Expansion regime favors equities");
    if (growthSectors.includes(sector))   { tilt += 4; reasons.push(`Growth tilt benefits ${sector}`); }
  } else if (regime === "reflation") {
    tilt += 3;
    if (cyclicalSectors.includes(sector)) { tilt += 5; reasons.push(`Reflation favors ${sector}`); }
  } else if (regime === "stagflation") {
    tilt -= 8;
    reasons.push("Stagflation — unfavorable macro backdrop");
    if (growthSectors.includes(sector))    { tilt -= 5; reasons.push(`Growth tech underperforms in stagflation`); }
    if (defensiveSectors.includes(sector)) { tilt += 3; reasons.push(`${sector} defensive tilt partially offsets`); }
  } else if (regime === "contraction") {
    tilt -= 12;
    reasons.push("Contraction regime — risk-off");
    if (defensiveSectors.includes(sector)) { tilt += 4; reasons.push(`${sector} is defensive`); }
  }

  if (rpc > 60) { tilt -= 5; reasons.push(`High recession probability (${rpc.toFixed(0)})`); }
  else if (rpc > 40) { tilt -= 2; reasons.push(`Elevated recession probability`); }
  if (csc > 60) { tilt -= 4; reasons.push(`Credit stress elevated`); }

  // IC score adds direct macro health signal (independent of regime category)
  if (ic != null) {
    if (ic < 25)       { tilt -= 4; reasons.push(`Macro health very weak (IC ${ic.toFixed(0)})`); }
    else if (ic < 40)  { tilt -= 2; reasons.push(`Macro health below average (IC ${ic.toFixed(0)})`); }
    else if (ic > 72)  { tilt += 3; reasons.push(`Strong macro health (IC ${ic.toFixed(0)})`); }
  }

  // TED spread — interbank stress (above 50 bps is elevated; above 100 bps is crisis territory)
  if (ted != null && ted > 100) { tilt -= 3; reasons.push(`TED spread elevated (${ted.toFixed(0)} bps)`); }
  else if (ted != null && ted > 50) { tilt -= 1; reasons.push(`TED spread slightly elevated`); }

  // Extreme fear creates buying opportunity; extreme greed signals risk
  if (fg != null && fg < 20)  { tilt += 2; reasons.push(`Extreme fear — contrarian positive`); }
  if (fg != null && fg > 80)  { tilt -= 2; reasons.push(`Extreme greed — elevated risk`); }

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
  if (inp.roic != null)             quality += inp.roic > 25 ? 6 : inp.roic > 15 ? 4 : inp.roic > 8 ? 2 : 0;
  if (inp.roe != null)              quality += inp.roe > 20 ? 5 : inp.roe > 12 ? 3 : inp.roe > 5 ? 1 : 0;
  if (inp.grossMargin != null)      quality += inp.grossMargin > 60 ? 5 : inp.grossMargin > 40 ? 3 : inp.grossMargin > 25 ? 1 : 0;
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
