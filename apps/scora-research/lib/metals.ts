// ─────────────────────────────────────────────────────────────────────────────
// PRECIOUS & INDUSTRIAL METALS — gold, silver, platinum, copper. Prices come from the
// liquid ETF proxies (free FMP quote); positioning comes from the CFTC Commitments of
// Traders report (free, weekly) via /api/cot — managed-money net is the honest read of
// "institutional buying". Pure math here (net positioning, WoW change, gold/silver ratio,
// a positioning read) is unit-tested; the component fetches and renders.
// ─────────────────────────────────────────────────────────────────────────────

export interface Metal { key: string; name: string; etf: string; cotCode: string; unit: string; }

// CFTC contract-market codes (Disaggregated Futures-and-Options Combined, dataset kh3c-gbw2).
export const METALS: Metal[] = [
  { key: "gold",     name: "Gold",     etf: "GLD",  cotCode: "088691", unit: "100 oz" },
  { key: "silver",   name: "Silver",   etf: "SLV",  cotCode: "084691", unit: "5,000 oz" },
  { key: "platinum", name: "Platinum", etf: "PPLT", cotCode: "076651", unit: "50 oz" },
  { key: "copper",   name: "Copper",   etf: "CPER", cotCode: "085692", unit: "25,000 lb" },
];

// One weekly COT observation (as normalized by /api/cot).
export interface CotRow {
  date: string;
  managedLong: number;
  managedShort: number;
  openInterest: number;
}

/** Managed-money net = long − short (contracts). Positive = net long ("institutional buying"). */
export function netManagedMoney(row: Pick<CotRow, "managedLong" | "managedShort">): number {
  return row.managedLong - row.managedShort;
}

/** Week-over-week change in managed-money net. rows newest-first or oldest-first; we sort. */
export function wowChange(rows: CotRow[]): number | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  return netManagedMoney(sorted[n - 1]) - netManagedMoney(sorted[n - 2]);
}

/** Net long as a share of open interest (−1..1) — normalizes across contract sizes. */
export function netAsPctOfOI(row: CotRow): number | null {
  if (!(row.openInterest > 0)) return null;
  return netManagedMoney(row) / row.openInterest;
}

/** Gold / silver ratio from the two ETF prices, adjusted for the ~10:1 GLD:SLV notional
 *  (GLD ≈ 1/10 oz gold, SLV ≈ 1 oz silver), giving the classic oz-for-oz ratio. */
export function goldSilverRatio(gldPrice: number | null, slvPrice: number | null): number | null {
  if (gldPrice == null || slvPrice == null || slvPrice <= 0) return null;
  return (gldPrice * 10) / slvPrice;
}

export interface PositioningRead { label: string; tone: "pos" | "neg" | "neutral"; }

/** A plain read of managed-money net vs open interest + its weekly direction. */
export function positioningRead(row: CotRow | null, wow: number | null): PositioningRead {
  if (!row) return { label: "No positioning data", tone: "neutral" };
  const pct = netAsPctOfOI(row);
  const dir = wow == null ? "" : wow > 0 ? " · rising" : wow < 0 ? " · falling" : " · flat";
  if (pct == null) return { label: "Net positioning n/a", tone: "neutral" };
  if (pct > 0.20)  return { label: `Crowded net long (${(pct * 100).toFixed(0)}% of OI)${dir}`, tone: "pos" };
  if (pct > 0.05)  return { label: `Net long (${(pct * 100).toFixed(0)}% of OI)${dir}`, tone: "pos" };
  if (pct < -0.05) return { label: `Net short (${(pct * 100).toFixed(0)}% of OI)${dir}`, tone: "neg" };
  return { label: `Balanced positioning${dir}`, tone: "neutral" };
}
