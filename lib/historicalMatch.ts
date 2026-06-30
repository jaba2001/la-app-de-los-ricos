import type { MacroState } from "./types";
import { HISTORICAL_ANALOGS, type HistoricalAnalog } from "./historicalAnalogs";

export interface AnalogMatch {
  analog: HistoricalAnalog;
  similarity: number; // 0-100, higher = closer match
  distance: number;   // raw weighted distance (sort key)
}

// Same weights as computeICHealthScore (lib/scoring.ts) / icScoreVal (ic-proxy/lib/macro.js)
// — reused verbatim for consistency across the app's independent implementations of this
// Druckenmiller-hierarchy weighting (Liquidity > Credit > Recession > Geopolitical = Housing).
const WEIGHTS = {
  liquidity_cycle: 0.35,
  credit_stress: 0.25,
  recession_prob: 0.20,
  geopolitical_risk: 0.10,
  housing_stress: 0.10,
} as const;

type CompositeKey = keyof typeof WEIGHTS;

/**
 * Ranks curated historical episodes by similarity to today's macro composites.
 * Pure/synchronous — takes the already-loaded macro state, no fetching.
 */
export function matchHistoricalAnalogs(
  macro: Pick<MacroState, "liquidity_cycle" | "credit_stress" | "recession_prob" | "geopolitical_risk" | "housing_stress" | "regime_id">,
  topN = 3
): AnalogMatch[] {
  const current: Record<CompositeKey, number> = {
    liquidity_cycle: Number(macro.liquidity_cycle ?? 50),
    credit_stress: Number(macro.credit_stress ?? 50),
    recession_prob: Number(macro.recession_prob ?? 50),
    geopolitical_risk: Number(macro.geopolitical_risk ?? 50),
    housing_stress: Number(macro.housing_stress ?? 50),
  };

  const results: AnalogMatch[] = HISTORICAL_ANALOGS.map((analog) => {
    // Weighted Euclidean distance across the 5 composites, each diff normalized to 0-1
    // of the 0-100 scale before weighting, so weights sum to 1 and distance stays
    // interpretable in [0, ~1].
    const sqDiffSum = (Object.keys(WEIGHTS) as CompositeKey[]).reduce((sum, key) => {
      const diff = (current[key] - analog.composites[key]) / 100;
      return sum + WEIGHTS[key] * diff * diff;
    }, 0);
    const distance = Math.sqrt(sqDiffSum);

    // Same-regime bonus: two episodes can sit at similar numeric distance but represent a
    // meaningfully different qualitative regime — reward exact classifyRegime() agreement
    // so a same-regime episode isn't outranked by a numerically-closer-but-wrong-regime one.
    const regimeBonus = macro.regime_id && analog.regimeId === macro.regime_id ? 0.08 : 0;
    const adjustedDistance = Math.max(0, distance - regimeBonus);

    const similarity = Math.round(Math.max(0, 1 - adjustedDistance) * 100);
    return { analog, similarity, distance: adjustedDistance };
  });

  return results.sort((a, b) => a.distance - b.distance).slice(0, topN);
}

export interface SectorExposure {
  sector: string;
  tickerCount: number;
  historicalRole: "outperformer" | "underperformer" | "neutral";
}

/**
 * Cross-references a holdings list (caller-supplied, e.g. from sl_watchlist -> sl_analyses)
 * against the top analog match's sector winners/losers. Purely descriptive — never
 * prescriptive ("buy/sell") output.
 */
export function crossReferenceSectors(
  topMatch: AnalogMatch,
  holdings: { sector: string | null }[]
): SectorExposure[] {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    if (!h.sector) continue;
    bySector.set(h.sector, (bySector.get(h.sector) ?? 0) + 1);
  }
  return Array.from(bySector.entries())
    .map(([sector, tickerCount]) => {
      const role: SectorExposure["historicalRole"] = topMatch.analog.sectorImpact.outperformers.includes(sector)
        ? "outperformer"
        : topMatch.analog.sectorImpact.underperformers.includes(sector)
        ? "underperformer"
        : "neutral";
      return { sector, tickerCount, historicalRole: role };
    })
    .sort((a, b) => b.tickerCount - a.tickerCount);
}
