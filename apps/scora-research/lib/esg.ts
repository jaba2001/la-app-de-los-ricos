// ─────────────────────────────────────────────────────────────────────────────
// ESG-LITE (Fase 6) — a FREE, transparent proxy, not a rating. Environmental from a curated
// sector carbon-intensity map; Governance from ownership/dilution signals Scora already has;
// Social from a coarse sector controversy map. Explicitly experimental — structured ESG
// (MSCI/Sustainalytics) is a paid-data upgrade (see the roadmap's paid tier). Pure & headless.
// ─────────────────────────────────────────────────────────────────────────────

// Relative carbon/environmental intensity by sector, 0 (low) – 100 (high). Higher = worse E.
export const SECTOR_CARBON: Record<string, number> = {
  Energy: 95, "Basic Materials": 85, Materials: 85, Utilities: 80, Industrials: 60,
  "Consumer Cyclical": 45, "Consumer Defensive": 40, "Real Estate": 40,
  "Communication Services": 25, Healthcare: 25, Technology: 20,
  Financials: 15, "Financial Services": 15,
};
// Coarse social-controversy proxy by sector, 0 (low) – 100 (high). Higher = worse S.
const SECTOR_SOCIAL: Record<string, number> = {
  Energy: 60, "Basic Materials": 55, Materials: 55, Industrials: 45, Healthcare: 45,
  "Consumer Defensive": 50, "Consumer Cyclical": 40, Utilities: 35, Technology: 40,
  "Communication Services": 45, Financials: 40, "Financial Services": 40, "Real Estate": 30,
};

const clamp = (x: number) => Math.max(0, Math.min(100, x));

export interface EsgLite { e: number; s: number; g: number; overall: number; note: string; }
export interface EsgInputs { sector: string | null; insiderOwn?: number | null; instOwn?: number | null; shortFloat?: number | null; }

/** Free ESG-lite 0-100 (higher = better). E from sector carbon, S from sector controversy,
 *  G from ownership/dilution/short signals. Returns null when the sector is unknown. */
export function esgLite(inp: EsgInputs): EsgLite | null {
  const sector = inp.sector ?? "";
  const carbon = SECTOR_CARBON[sector];
  const social = SECTOR_SOCIAL[sector];
  if (carbon == null && social == null) return null;
  const e = clamp(100 - (carbon ?? 50));
  const s = clamp(100 - (social ?? 50));

  // Governance: insider ownership sweet-spot (5-25% aligns incentives; >50% = concentration
  // risk), healthy institutional ownership, low short interest. Inputs are fractions (0-1).
  let g = 55; // neutral base
  const io = inp.insiderOwn != null ? inp.insiderOwn * 100 : null;
  if (io != null) g += io >= 5 && io <= 25 ? 15 : io > 50 ? -15 : io > 25 ? -5 : 0;
  const inst = inp.instOwn != null ? inp.instOwn * 100 : null;
  if (inst != null) g += inst >= 40 && inst <= 90 ? 10 : inst > 95 ? -5 : 0;
  const sf = inp.shortFloat != null ? inp.shortFloat * 100 : null;
  if (sf != null) g += sf > 20 ? -15 : sf > 10 ? -8 : 0;
  g = clamp(g);

  const overall = Math.round((e * 0.4 + s * 0.3 + g * 0.3));
  return { e: Math.round(e), s: Math.round(s), g: Math.round(g), overall, note: "Free proxy — not a rating; structured ESG is a paid upgrade." };
}
