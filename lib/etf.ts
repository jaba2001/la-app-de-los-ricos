// ─────────────────────────────────────────────────────────────────────────────
// ETF LAB — expense-ratio comparison, top-holdings overlap, and cheaper same-category
// alternatives. Holdings/expense ratios are a CURATED public snapshot of the most
// widely-held ETFs (top-10 constituents), labeled with an as-of date. Overlap and the
// alternatives finder are pure & unit-tested. A live full-holdings feed is a paid upgrade
// (see the paid-data roadmap) — this covers the popular names for free and honestly.
// ─────────────────────────────────────────────────────────────────────────────

export const ETF_SNAPSHOT_ASOF = "2026-07";

export interface Holding { symbol: string; weight: number; } // weight in %
export interface EtfInfo {
  symbol: string;
  name: string;
  category: string;
  expenseRatio: number;   // % (e.g., 0.03 = 3 bps)
  holdings: Holding[];    // top ~10; empty for bond/commodity funds
}

// Curated snapshot. Expense ratios are public facts; top-10 weights are approximate as-of the
// snapshot month and meant for relative overlap, not exact replication.
export const ETFS: EtfInfo[] = [
  { symbol: "SPY", name: "SPDR S&P 500",            category: "US Large Blend", expenseRatio: 0.0945,
    holdings: [{symbol:"NVDA",weight:7.5},{symbol:"AAPL",weight:7.0},{symbol:"MSFT",weight:6.5},{symbol:"AMZN",weight:3.8},{symbol:"AVGO",weight:2.4},{symbol:"META",weight:2.6},{symbol:"GOOGL",weight:2.0},{symbol:"GOOG",weight:1.7},{symbol:"TSLA",weight:1.8},{symbol:"BRK.B",weight:1.7}] },
  { symbol: "VOO", name: "Vanguard S&P 500",        category: "US Large Blend", expenseRatio: 0.03,
    holdings: [{symbol:"NVDA",weight:7.5},{symbol:"AAPL",weight:7.0},{symbol:"MSFT",weight:6.5},{symbol:"AMZN",weight:3.8},{symbol:"AVGO",weight:2.4},{symbol:"META",weight:2.6},{symbol:"GOOGL",weight:2.0},{symbol:"GOOG",weight:1.7},{symbol:"TSLA",weight:1.8},{symbol:"BRK.B",weight:1.7}] },
  { symbol: "IVV", name: "iShares Core S&P 500",    category: "US Large Blend", expenseRatio: 0.03,
    holdings: [{symbol:"NVDA",weight:7.5},{symbol:"AAPL",weight:7.0},{symbol:"MSFT",weight:6.5},{symbol:"AMZN",weight:3.8},{symbol:"AVGO",weight:2.4},{symbol:"META",weight:2.6},{symbol:"GOOGL",weight:2.0},{symbol:"GOOG",weight:1.7},{symbol:"TSLA",weight:1.8},{symbol:"BRK.B",weight:1.7}] },
  { symbol: "QQQ", name: "Invesco Nasdaq-100",      category: "US Large Growth", expenseRatio: 0.20,
    holdings: [{symbol:"NVDA",weight:9.0},{symbol:"AAPL",weight:8.8},{symbol:"MSFT",weight:8.0},{symbol:"AMZN",weight:5.5},{symbol:"AVGO",weight:5.0},{symbol:"META",weight:3.8},{symbol:"TSLA",weight:3.0},{symbol:"COST",weight:2.7},{symbol:"GOOGL",weight:2.5},{symbol:"GOOG",weight:2.4}] },
  { symbol: "QQQM", name: "Invesco Nasdaq-100 (M)", category: "US Large Growth", expenseRatio: 0.15,
    holdings: [{symbol:"NVDA",weight:9.0},{symbol:"AAPL",weight:8.8},{symbol:"MSFT",weight:8.0},{symbol:"AMZN",weight:5.5},{symbol:"AVGO",weight:5.0},{symbol:"META",weight:3.8},{symbol:"TSLA",weight:3.0},{symbol:"COST",weight:2.7},{symbol:"GOOGL",weight:2.5},{symbol:"GOOG",weight:2.4}] },
  { symbol: "DIA", name: "SPDR Dow Jones",          category: "US Large Blend", expenseRatio: 0.16,
    holdings: [{symbol:"GS",weight:8.5},{symbol:"MSFT",weight:6.5},{symbol:"CAT",weight:6.0},{symbol:"HD",weight:5.5},{symbol:"V",weight:4.5},{symbol:"UNH",weight:4.3},{symbol:"AXP",weight:4.0},{symbol:"AMGN",weight:3.6},{symbol:"CRM",weight:3.4},{symbol:"AAPL",weight:3.2}] },
  { symbol: "IWM", name: "iShares Russell 2000",    category: "US Small Blend", expenseRatio: 0.19, holdings: [] },
  { symbol: "XLK", name: "Technology Select",        category: "Sector · Technology", expenseRatio: 0.09,
    holdings: [{symbol:"NVDA",weight:15.0},{symbol:"AAPL",weight:14.0},{symbol:"MSFT",weight:13.0},{symbol:"AVGO",weight:5.0},{symbol:"ORCL",weight:3.5},{symbol:"CRM",weight:3.0},{symbol:"CSCO",weight:2.6},{symbol:"AMD",weight:2.4},{symbol:"ACN",weight:2.2},{symbol:"ADBE",weight:2.0}] },
  { symbol: "XLF", name: "Financial Select",         category: "Sector · Financials", expenseRatio: 0.09,
    holdings: [{symbol:"BRK.B",weight:13.0},{symbol:"JPM",weight:10.0},{symbol:"V",weight:8.0},{symbol:"MA",weight:7.0},{symbol:"BAC",weight:4.5},{symbol:"WFC",weight:4.0},{symbol:"GS",weight:3.0},{symbol:"AXP",weight:2.8},{symbol:"MS",weight:2.6},{symbol:"SPGI",weight:2.4}] },
  { symbol: "XLE", name: "Energy Select",            category: "Sector · Energy", expenseRatio: 0.09,
    holdings: [{symbol:"XOM",weight:23.0},{symbol:"CVX",weight:17.0},{symbol:"COP",weight:7.5},{symbol:"WMB",weight:5.0},{symbol:"EOG",weight:4.0},{symbol:"KMI",weight:3.8},{symbol:"SLB",weight:3.5},{symbol:"OKE",weight:3.4},{symbol:"PSX",weight:3.0},{symbol:"MPC",weight:2.8}] },
  { symbol: "XLV", name: "Health Care Select",       category: "Sector · Healthcare", expenseRatio: 0.09,
    holdings: [{symbol:"LLY",weight:11.0},{symbol:"UNH",weight:8.0},{symbol:"JNJ",weight:7.0},{symbol:"ABBV",weight:6.0},{symbol:"MRK",weight:4.5},{symbol:"TMO",weight:3.8},{symbol:"ABT",weight:3.6},{symbol:"ISRG",weight:3.4},{symbol:"AMGN",weight:3.2},{symbol:"PFE",weight:3.0}] },
  { symbol: "XLY", name: "Cons. Discretionary Sel.", category: "Sector · Discretionary", expenseRatio: 0.09,
    holdings: [{symbol:"AMZN",weight:23.0},{symbol:"TSLA",weight:15.0},{symbol:"HD",weight:9.0},{symbol:"MCD",weight:4.5},{symbol:"BKNG",weight:4.0},{symbol:"LOW",weight:3.6},{symbol:"TJX",weight:3.4},{symbol:"SBUX",weight:2.6},{symbol:"NKE",weight:2.4},{symbol:"ORLY",weight:2.2}] },
  { symbol: "SMH", name: "VanEck Semiconductor",     category: "Industry · Semiconductors", expenseRatio: 0.35,
    holdings: [{symbol:"NVDA",weight:20.0},{symbol:"TSM",weight:12.0},{symbol:"AVGO",weight:8.0},{symbol:"AMD",weight:5.0},{symbol:"ASML",weight:4.5},{symbol:"QCOM",weight:4.2},{symbol:"TXN",weight:4.0},{symbol:"AMAT",weight:3.8},{symbol:"MU",weight:3.6},{symbol:"LRCX",weight:3.4}] },
  { symbol: "SOXX", name: "iShares Semiconductor",   category: "Industry · Semiconductors", expenseRatio: 0.35,
    holdings: [{symbol:"NVDA",weight:14.0},{symbol:"AVGO",weight:9.0},{symbol:"AMD",weight:7.0},{symbol:"QCOM",weight:6.0},{symbol:"TXN",weight:5.5},{symbol:"MU",weight:5.0},{symbol:"AMAT",weight:4.8},{symbol:"LRCX",weight:4.5},{symbol:"ADI",weight:4.2},{symbol:"KLAC",weight:4.0}] },
  { symbol: "SCHD", name: "Schwab US Dividend",      category: "US Dividend Value", expenseRatio: 0.06,
    holdings: [{symbol:"KO",weight:4.3},{symbol:"VZ",weight:4.2},{symbol:"AMGN",weight:4.1},{symbol:"ABBV",weight:4.0},{symbol:"CVX",weight:3.9},{symbol:"HD",weight:3.8},{symbol:"PEP",weight:3.7},{symbol:"CSCO",weight:3.6},{symbol:"LMT",weight:3.5},{symbol:"TXN",weight:3.4}] },
  { symbol: "VIG", name: "Vanguard Div. Appreciation", category: "US Dividend Growth", expenseRatio: 0.05,
    holdings: [{symbol:"AAPL",weight:4.5},{symbol:"MSFT",weight:4.4},{symbol:"AVGO",weight:4.0},{symbol:"JPM",weight:3.6},{symbol:"V",weight:3.4},{symbol:"XOM",weight:3.0},{symbol:"MA",weight:2.8},{symbol:"COST",weight:2.6},{symbol:"HD",weight:2.4},{symbol:"WMT",weight:2.2}] },
  { symbol: "VEA", name: "Vanguard Dev. Markets",    category: "International Developed", expenseRatio: 0.03, holdings: [] },
  { symbol: "VWO", name: "Vanguard Emerging Mkts",   category: "Emerging Markets", expenseRatio: 0.07, holdings: [] },
  { symbol: "EFA", name: "iShares MSCI EAFE",        category: "International Developed", expenseRatio: 0.32, holdings: [] },
  { symbol: "AGG", name: "iShares Core US Agg Bond", category: "US Aggregate Bond", expenseRatio: 0.03, holdings: [] },
  { symbol: "BND", name: "Vanguard Total Bond",      category: "US Aggregate Bond", expenseRatio: 0.03, holdings: [] },
  { symbol: "TLT", name: "iShares 20+ Yr Treasury",  category: "Long Government Bond", expenseRatio: 0.15, holdings: [] },
  { symbol: "GLD", name: "SPDR Gold Shares",         category: "Commodity · Gold", expenseRatio: 0.40, holdings: [] },
  { symbol: "SLV", name: "iShares Silver Trust",     category: "Commodity · Silver", expenseRatio: 0.50, holdings: [] },
];

const BY_SYMBOL = new Map(ETFS.map(e => [e.symbol, e]));
export function getEtf(symbol: string): EtfInfo | null { return BY_SYMBOL.get(symbol.toUpperCase()) ?? null; }
export function etfSymbols(): string[] { return ETFS.map(e => e.symbol); }

export interface OverlapResult {
  overlapPct: number;                 // Σ min(weightA, weightB) over shared holdings (%)
  shared: { symbol: string; weightA: number; weightB: number }[];
  measurable: boolean;                // false when either side has no holdings snapshot
}

/** Top-holdings overlap between two ETFs = Σ min(weightA, weightB) over names in both.
 *  Measured on the curated top-10 snapshot; bond/commodity funds (no holdings) → not measurable. */
export function overlap(a: EtfInfo, b: EtfInfo): OverlapResult {
  if (!a.holdings.length || !b.holdings.length) return { overlapPct: 0, shared: [], measurable: false };
  const bMap = new Map(b.holdings.map(h => [h.symbol, h.weight]));
  const shared: { symbol: string; weightA: number; weightB: number }[] = [];
  let sum = 0;
  for (const h of a.holdings) {
    const wb = bMap.get(h.symbol);
    if (wb != null) { sum += Math.min(h.weight, wb); shared.push({ symbol: h.symbol, weightA: h.weight, weightB: wb }); }
  }
  shared.sort((x, y) => Math.min(y.weightA, y.weightB) - Math.min(x.weightA, x.weightB));
  return { overlapPct: Math.round(sum * 10) / 10, shared, measurable: true };
}

/** Same-category ETFs with a lower expense ratio than `symbol`, cheapest first. */
export function cheaperAlternatives(symbol: string): EtfInfo[] {
  const me = getEtf(symbol);
  if (!me) return [];
  return ETFS
    .filter(e => e.symbol !== me.symbol && e.category === me.category && e.expenseRatio < me.expenseRatio)
    .sort((a, b) => a.expenseRatio - b.expenseRatio);
}
