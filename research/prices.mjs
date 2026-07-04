// Historical EOD prices for the backtest. FMP's stable/historical-price-eod returns
// dated ranges on the free tier (survivorship caveat: delisted names aren't covered
// — swap in Tiingo/EODHD for a bias-free universe later). Cached per (ticker,range).
const FMP = process.env.FMP_KEY || "wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2";
const cache = new Map();

export async function eod(ticker, from, to) {
  const key = `${ticker}/${from}/${to}`;
  if (cache.has(key)) return cache.get(key);
  let rows = [];
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${ticker}&from=${from}&to=${to}&apikey=${FMP}`);
    const j = r.ok ? await r.json() : [];
    rows = Array.isArray(j) ? j.filter((x) => x && x.date && x.close != null).sort((a, b) => a.date.localeCompare(b.date)) : [];
  } catch { rows = []; }
  cache.set(key, rows);
  return rows;
}

const daysBefore = (date, n) => new Date(new Date(date).getTime() - n * 86400000).toISOString().slice(0, 10);

/** Last close on-or-before `date`. */
export async function priceAsOf(ticker, date) {
  const rows = await eod(ticker, daysBefore(date, 12), date);
  const on = rows.filter((r) => r.date <= date);
  return on.length ? on[on.length - 1].close : null;
}

/** Trailing momentum (% change) at `date` over ~1M/3M/6M, from a single ~200d window. */
export async function momentum(ticker, date) {
  const rows = await eod(ticker, daysBefore(date, 250), date);
  const on = rows.filter((r) => r.date <= date).map((r) => r.close);
  if (on.length < 130) return { m1: null, m3: null, m6: null };
  const last = on[on.length - 1];
  const pct = (n) => (on.length > n ? ((last - on[on.length - 1 - n]) / on[on.length - 1 - n]) * 100 : null);
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}
