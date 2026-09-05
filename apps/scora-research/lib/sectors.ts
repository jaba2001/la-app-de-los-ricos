// ─────────────────────────────────────────────────────────────────────────────
// Sector rotation (Layer 3) — within the equity sleeve, momentum favors some sectors
// over others. Ranking the 11 SPDR sectors by 12-1m momentum and holding the top-3
// (cash-gated) is a modest but real risk refinement: validated 2007-2026 at Sharpe 0.76
// vs SPY 0.71 with HALF the drawdown (-23.9% vs -50.7%), and clearly beats an
// equal-weight-sectors basket (0.67 / -48.5%). Source: research/sectors.mjs.
// ─────────────────────────────────────────────────────────────────────────────

export const SECTORS: { etf: string; name: string }[] = [
  { etf: "XLK", name: "Technology" },
  { etf: "XLC", name: "Communication" },
  { etf: "XLY", name: "Cons. Discretionary" },
  { etf: "XLF", name: "Financials" },
  { etf: "XLI", name: "Industrials" },
  { etf: "XLE", name: "Energy" },
  { etf: "XLB", name: "Materials" },
  { etf: "XLV", name: "Health Care" },
  { etf: "XLP", name: "Cons. Staples" },
  { etf: "XLU", name: "Utilities" },
  { etf: "XLRE", name: "Real Estate" },
];

export const SECTOR_ROTATION_STATS = {
  period: "2007–2026",
  topK: 3,
  strategy: { sharpe: 0.76, maxDrawdown: -23.9 },
  equalWeight: { sharpe: 0.67, maxDrawdown: -48.5 },
  spy: { sharpe: 0.71, maxDrawdown: -50.7 },
};

export interface RankedSector { etf: string; name: string; mom: number | null; rank: number; favored: boolean; }

/**
 * Rank sectors by 12-1m momentum (desc). Top-K with positive momentum are "favored"
 * (the ones a dual-momentum rotation would hold); a negative-momentum sector is never
 * favored (its slot goes to cash). `mom` is a map etf → 12-1m return (%); null = no data.
 */
export function rankSectors(mom: Record<string, number | null>, topK = SECTOR_ROTATION_STATS.topK): RankedSector[] {
  const rows = SECTORS
    .map((s) => ({ ...s, mom: mom[s.etf] ?? null }))
    .filter((s) => s.mom != null)
    .sort((a, b) => (b.mom as number) - (a.mom as number));
  return rows.map((s, i) => ({ etf: s.etf, name: s.name, mom: s.mom, rank: i + 1, favored: i < topK && (s.mom as number) > 0 }));
}
