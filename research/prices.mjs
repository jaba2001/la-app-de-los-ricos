// Historical EOD prices for the backtest — two full series per ticker, fetched once
// over a wide window and disk-cached, so a whole backtest is ~2 FMP calls per name
// (not per date). FMP free tier:
//   • RAW (non-split-adjusted) → market cap / P/E / P/B (matches as-reported shares)
//   • ADJUSTED (split-adjusted close) → returns & momentum (correct through splits)
// Survivorship caveat: FMP free omits delisted names — swap Tiingo/EODHD later.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const FMP = process.env.FMP_KEY || "wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "px");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const FROM = "2018-06-01";
const TODAY = new Date().toISOString().slice(0, 10);
const mem = new Map();

/** Full price series for a ticker (cached once). raw=true → unadjusted for market cap. */
async function series(ticker, raw) {
  const key = `${ticker}_${raw ? "raw" : "adj"}`;
  if (mem.has(key)) return mem.get(key);
  const path = join(DIR, key.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
  let rows = null;
  if (existsSync(path)) { try { rows = JSON.parse(readFileSync(path, "utf8")); } catch { rows = null; } }
  if (!rows) {
    const ep = raw ? "historical-price-eod/non-split-adjusted" : "historical-price-eod/full";
    const field = raw ? "adjClose" : "close";
    try {
      const r = await fetch(`https://financialmodelingprep.com/stable/${ep}?symbol=${ticker}&from=${FROM}&to=${TODAY}&apikey=${FMP}`);
      const j = r.ok ? await r.json() : [];
      rows = Array.isArray(j)
        ? j.filter((x) => x && x.date && x[field] != null).map((x) => ({ date: x.date, close: x[field] })).sort((a, b) => a.date.localeCompare(b.date))
        : [];
    } catch { rows = []; }
    writeFileSync(path, JSON.stringify(rows));
  }
  mem.set(key, rows);
  return rows;
}

const lastOnOrBefore = (rows, date) => {
  // binary search the sorted series for the last close on-or-before date
  let lo = 0, hi = rows.length - 1, ans = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = rows[m].close; lo = m + 1; } else hi = m - 1; }
  return ans;
};
const idxOnOrBefore = (rows, date) => {
  let lo = 0, hi = rows.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
};

export async function rawPriceAsOf(ticker, date) { return lastOnOrBefore(await series(ticker, true), date); }
export async function priceAsOf(ticker, date) { return lastOnOrBefore(await series(ticker, false), date); }

export async function fwdReturn(ticker, from, to) {
  const rows = await series(ticker, false);
  const a = lastOnOrBefore(rows, from), b = lastOnOrBefore(rows, to);
  return a && b && a > 0 ? (b / a - 1) * 100 : null;
}

export async function momentum(ticker, date) {
  const rows = await series(ticker, false);
  const i = idxOnOrBefore(rows, date);
  if (i < 130) return { m1: null, m3: null, m6: null };
  const at = (n) => (i - n >= 0 ? rows[i - n].close : null);
  const cur = rows[i].close;
  const pct = (n) => { const p = at(n); return p && p > 0 ? ((cur - p) / p) * 100 : null; };
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}

/** Has enough price history to be tradable at `date` (liquidity/coverage gate). */
export async function hasPriceAt(ticker, date) {
  const rows = await series(ticker, false);
  return idxOnOrBefore(rows, date) >= 0;
}
