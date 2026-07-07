// ─────────────────────────────────────────────────────────────────────────────
// Secular Clock (Layer 1, Phase 5) — where are we in the long (15-20yr) valuation
// cycle, and what baseline equity exposure does that imply? The secular baseline is the
// ceiling that Layer 2 (tactical multi-asset allocation) then tilts around.
//
// Primary gauge: the Buffett Indicator (total market cap / GDP), robust and live from
// FRED. CAPE (Shiller) is a complementary reference. Both are the best long-horizon
// return predictors (CAPE explains ~2/3 of 10y-forward real return variance). High
// valuations don't time the market — they compress FORWARD returns — so a stretched
// secular reading argues for a lower baseline equity weight and more reliance on the
// tactical/allocation and momentum layers, not an all-out exit.
// ─────────────────────────────────────────────────────────────────────────────

export interface SecularRegime {
  phase: "Cheap" | "Fair" | "Elevated" | "Expensive" | "Extreme" | "Unknown";
  baselineEquity: number; // 0-100 suggested secular baseline equity weight
  percentile: number;     // rough valuation percentile (higher = more expensive)
  gauge: string;          // which gauge drove it
  detail: string;
  color: string;
}

/**
 * Classify the secular valuation regime. Buffett Indicator (market-cap/GDP, %) is the
 * primary input; CAPE and the 10y expected return add context. Thresholds are historical
 * priors: ~<90 cheap, 90-120 fair, 120-150 elevated, 150-190 expensive, >190 extreme.
 */
export function secularRegime(buffett: number | null, cape: number | null, expectedReturn10y: number | null): SecularRegime {
  const bands: { max: number; phase: SecularRegime["phase"]; base: number; pct: number; color: string }[] = [
    { max: 90,  phase: "Cheap",     base: 80, pct: 18, color: "var(--sr-pos)" },
    { max: 120, phase: "Fair",      base: 65, pct: 42, color: "var(--sr-pos)" },
    { max: 150, phase: "Elevated",  base: 55, pct: 64, color: "var(--sr-warn)" },
    { max: 190, phase: "Expensive", base: 45, pct: 82, color: "var(--sr-warn)" },
    { max: Infinity, phase: "Extreme", base: 35, pct: 95, color: "var(--sr-neg)" },
  ];

  if (buffett == null && cape == null) {
    return { phase: "Unknown", baselineEquity: 55, percentile: 50, gauge: "—", detail: "No secular valuation reading available.", color: "var(--sr-text-2)" };
  }

  // Prefer Buffett; if absent, map CAPE onto comparable bands (CAPE ~16 median, >30 rich).
  let band;
  let gauge: string;
  if (buffett != null) {
    band = bands.find((b) => buffett < b.max)!;
    gauge = `Buffett ${buffett.toFixed(0)}%`;
  } else {
    // CAPE bands: <16 cheap, 16-22 fair, 22-28 elevated, 28-34 expensive, >34 extreme
    const c = cape as number;
    const idx = c < 16 ? 0 : c < 22 ? 1 : c < 28 ? 2 : c < 34 ? 3 : 4;
    band = bands[idx];
    gauge = `CAPE ${c.toFixed(1)}`;
  }

  const capeStr = cape != null ? ` · CAPE ${cape.toFixed(1)}` : "";
  const erStr = expectedReturn10y != null ? ` Forward 10y return priced near ${expectedReturn10y.toFixed(1)}%.` : "";
  const detail = band.phase === "Extreme" || band.phase === "Expensive"
    ? `Valuations are stretched (${gauge}${capeStr}).${erStr} High valuations compress forward returns — keep the secular equity baseline defensive and lean on tactical allocation + momentum.`
    : band.phase === "Cheap" || band.phase === "Fair"
    ? `Valuations are reasonable (${gauge}${capeStr}).${erStr} A higher secular equity baseline is warranted.`
    : `Valuations are above average (${gauge}${capeStr}).${erStr} A moderate secular baseline.`;

  return { phase: band.phase, baselineEquity: band.base, percentile: band.pct, gauge, detail, color: band.color };
}
