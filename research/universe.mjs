// Backtest universe. For in-session validation we use a fixed, sector-diverse set of
// ~44 large caps that includes both winners (NVDA, AAPL) and laggards (INTC, DIS, T)
// so the score has something to discriminate — this is survivorship-biased (all still
// listed) and labelled as such. The full, survivorship-controlled run uses
// loadSP500Historical() (GitHub point-in-time constituents incl. removed names) + a
// delisted-capable price source (Tiingo/EODHD) and is a multi-day batch.

export const CURATED = [
  // Technology
  "AAPL", "MSFT", "NVDA", "AMD", "INTC", "CSCO", "ORCL", "ADBE", "CRM", "QCOM",
  // Communication Services
  "GOOGL", "META", "NFLX", "T", "VZ", "DIS",
  // Financials
  "JPM", "BAC", "WFC", "GS", "C",
  // Healthcare
  "JNJ", "PFE", "UNH", "MRK", "ABBV",
  // Consumer
  "KO", "PEP", "WMT", "PG", "MCD", "NKE", "SBUX", "HD", "COST",
  // Energy / Industrials / Materials
  "XOM", "CVX", "COP", "BA", "CAT", "GE", "HON", "UPS",
];

/** Full survivorship-controlled S&P 500 membership over time (GitHub, free). Best-effort. */
export async function loadSP500Historical() {
  const url = "https://raw.githubusercontent.com/fja05680/sp500/master/S%26P%20500%20Historical%20Components%20%26%20Changes(current).csv";
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const text = await r.text();
    const lines = text.trim().split("\n").slice(1);
    const byDate = lines.map((ln) => {
      const c = ln.indexOf(",");
      const date = ln.slice(0, c).replace(/"/g, "").trim();
      const tickers = ln.slice(c + 1).replace(/"/g, "").split(",").map((t) => t.trim()).filter(Boolean);
      return { date, tickers };
    }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    return byDate.sort((a, b) => a.date.localeCompare(b.date));
  } catch { return null; }
}

/** Members as of a date from the historical membership table. */
export function membersAsOf(table, date) {
  if (!table) return null;
  const on = table.filter((r) => r.date <= date);
  return on.length ? on[on.length - 1].tickers : table[0].tickers;
}
