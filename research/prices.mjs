// Historical EOD prices for the backtest — Yahoo v8 chart (free, no token, UNIVERSAL
// symbol coverage; FMP free 402s on most tickers). One call per name over a wide
// window, disk-cached. From each call we keep:
//   • adjClose (split+dividend adjusted) → total-return returns & momentum
//   • close (split-adjusted) + split events → RAW price for market cap / P/E / P/B,
//     reconstructed as close × (product of split ratios AFTER the date).
// Survivorship: Yahoo also omits fully-delisted names → add Tiingo (free token) for
// a bias-free universe; still-listed removed members are covered.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "ypx");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
const P1 = Math.floor(new Date("2018-06-01").getTime() / 1000);
const P2 = Math.floor(Date.now() / 1000);
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchYahoo(ticker) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${P1}&period2=${P2}&interval=1d&events=split`, { headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const ts = res.timestamp, q = res.indicators.quote[0], adj = res.indicators.adjclose?.[0]?.adjclose;
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: q.close[i], adj: adj?.[i] ?? q.close[i] });
      }
      rows.sort((x, y) => x.date.localeCompare(y.date));
      const splits = Object.values(res.events?.splits ?? {}).map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), factor: s.numerator / s.denominator })).sort((x, y) => x.date.localeCompare(y.date));
      return { rows, splits };
    } catch { await sleep(700 * (a + 1)); }
  }
  return null;
}

async function series(ticker) {
  if (mem.has(ticker)) return mem.get(ticker);
  const path = join(DIR, ticker.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
  let data = null;
  if (existsSync(path)) { try { const c = JSON.parse(readFileSync(path, "utf8")); if (c?.rows?.length) data = c; } catch { data = null; } }
  if (!data) { await sleep(180); data = await fetchYahoo(ticker); if (data?.rows?.length) writeFileSync(path, JSON.stringify(data)); }
  data = data ?? { rows: [], splits: [] };
  mem.set(ticker, data);
  return data;
}

const idxOnOrBefore = (rows, date) => { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };
// Cumulative split factor for splits strictly AFTER `date` (to undo Yahoo's adjustment).
const fwdSplit = (splits, date) => splits.reduce((f, s) => (s.date > date ? f * s.factor : f), 1);

/** RAW (unadjusted) price on-or-before date — for market cap / P/E / P/B. */
export async function rawPriceAsOf(ticker, date) {
  const { rows, splits } = await series(ticker);
  const i = idxOnOrBefore(rows, date);
  return i < 0 ? null : rows[i].close * fwdSplit(splits, rows[i].date);
}
/** Total-return (adj) price on-or-before date — for returns. */
export async function priceAsOf(ticker, date) {
  const { rows } = await series(ticker);
  const i = idxOnOrBefore(rows, date);
  return i < 0 ? null : rows[i].adj;
}
export async function fwdReturn(ticker, from, to) {
  const { rows } = await series(ticker);
  const a = idxOnOrBefore(rows, from), b = idxOnOrBefore(rows, to);
  return a >= 0 && b >= 0 && rows[a].adj > 0 ? (rows[b].adj / rows[a].adj - 1) * 100 : null;
}
export async function momentum(ticker, date) {
  const { rows } = await series(ticker);
  const i = idxOnOrBefore(rows, date);
  if (i < 130) return { m1: null, m3: null, m6: null };
  const cur = rows[i].adj;
  const pct = (n) => { const p = i - n >= 0 ? rows[i - n].adj : null; return p && p > 0 ? ((cur - p) / p) * 100 : null; };
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}
export async function hasPriceAt(ticker, date) {
  const { rows } = await series(ticker);
  return idxOnOrBefore(rows, date) >= 0;
}
