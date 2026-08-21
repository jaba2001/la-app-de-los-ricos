// Historical EOD prices for the backtest. Each series normalizes to rows of
// { date, raw, adj }:  raw = unadjusted price (market cap / P/E / P/B), adj =
// total-return (split+dividend) adjusted (returns & momentum).
//   • PRIMARY: Yahoo v8 chart — free, no token, universal for LISTED symbols.
//     raw is reconstructed from split events (close × Π split ratios after the date).
//   • FALLBACK: Tiingo (free token via TIINGO_TOKEN) — covers DELISTED names too,
//     and returns raw `close` + `adjClose` directly (no split math). This is what
//     kills survivorship: set TIINGO_TOKEN and the backtest/cron include dead names.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "px");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";
// Fetch window start. Default 2018-06 for the equity backtest; override with PX_FROM to
// pull a longer history (e.g. the multi-asset 0B robustness run back to the GFC).
const FROM = process.env.PX_FROM || "2018-06-01";
const P1 = Math.floor(new Date(FROM).getTime() / 1000);
const P2 = Math.floor(Date.now() / 1000);
const TODAY = new Date().toISOString().slice(0, 10);
const TIINGO = process.env.TIINGO_TOKEN || "";
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yahoo → normalized rows, raw reconstructed from splits (product of ratios AFTER date).
async function fromYahoo(ticker) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${P1}&period2=${P2}&interval=1d&events=split`, { headers: { "User-Agent": UA } });
      if (r.status === 429) { await sleep(1500 * (a + 1)); continue; }
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp) return [];
      const ts = res.timestamp, q = res.indicators.quote[0], adjc = res.indicators.adjclose?.[0]?.adjclose;
      const splits = Object.values(res.events?.splits ?? {}).map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), f: s.numerator / s.denominator }));
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        const fwd = splits.reduce((f, s) => (s.date > date ? f * s.f : f), 1);
        rows.push({ date, raw: q.close[i] * fwd, adj: adjc?.[i] ?? q.close[i] });
      }
      return rows.sort((x, y) => x.date.localeCompare(y.date));
    } catch { await sleep(700 * (a + 1)); }
  }
  return [];
}

// Tiingo → normalized rows (covers delisted). close = raw, adjClose = total-return.
async function fromTiingo(ticker) {
  if (!TIINGO) return [];
  try {
    const r = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(ticker)}/prices?startDate=${FROM}&endDate=${TODAY}&format=json&token=${TIINGO}`, { headers: { "Content-Type": "application/json" } });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j)
      ? j.filter((x) => x?.date && x.close != null).map((x) => ({ date: x.date.slice(0, 10), raw: x.close, adj: x.adjClose ?? x.close })).sort((a, b) => a.date.localeCompare(b.date))
      : [];
  } catch { return []; }
}

// Canonical symbol → Yahoo symbol. We use FMP's crypto format (BTCUSD) as the ONE
// canonical ticker across the app, backtest and paper fund; Yahoo needs the hyphen form.
const YAHOO_ALIAS = { BTCUSD: "BTC-USD", ETHUSD: "ETH-USD" };

async function series(ticker) {
  if (mem.has(ticker)) return mem.get(ticker);
  const yTicker = YAHOO_ALIAS[ticker] ?? ticker;
  const path = join(DIR, ticker.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
  let rows = null;
  // ⚠️ Esta caché NO CADUCA: una vez escrito el fichero, se reutiliza para siempre. Es lo
  // correcto para un backtest (que quiere datos estables y reproducibles) y VENENO para un
  // proceso en vivo, que se quedaría clavado en la última fecha descargada sin fallar ni
  // avisar. `PX_REFRESH=1` fuerza la recarga; lo usa `cron-picks.mjs`, que necesita el
  // precio de hoy y el calendario de mercado real.
  const refrescar = process.env.PX_REFRESH === "1";
  if (!refrescar && existsSync(path)) { try { const c = JSON.parse(readFileSync(path, "utf8")); if (Array.isArray(c) && c.length && c[0].raw != null) rows = c; } catch { rows = null; } }
  if (!rows) {
    await sleep(160);
    rows = await fromYahoo(yTicker);
    if (!rows.length) rows = await fromTiingo(yTicker); // delisted / Yahoo-miss
    if (rows.length) writeFileSync(path, JSON.stringify(rows));
  }
  rows = rows ?? [];
  mem.set(ticker, rows);
  return rows;
}

const idxOnOrBefore = (rows, date) => { let lo = 0, hi = rows.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].date <= date) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; };

export async function rawPriceAsOf(ticker, date) { const r = await series(ticker); const i = idxOnOrBefore(r, date); return i < 0 ? null : r[i].raw; }
export async function priceAsOf(ticker, date) { const r = await series(ticker); const i = idxOnOrBefore(r, date); return i < 0 ? null : r[i].adj; }
export async function fwdReturn(ticker, from, to) {
  const r = await series(ticker); const a = idxOnOrBefore(r, from), b = idxOnOrBefore(r, to);
  return a >= 0 && b >= 0 && r[a].adj > 0 ? (r[b].adj / r[a].adj - 1) * 100 : null;
}
export async function momentum(ticker, date) {
  const r = await series(ticker); const i = idxOnOrBefore(r, date);
  if (i < 130) return { m1: null, m3: null, m6: null };
  const cur = r[i].adj;
  const pct = (n) => { const p = i - n >= 0 ? r[i - n].adj : null; return p && p > 0 ? ((cur - p) / p) * 100 : null; };
  return { m1: pct(21), m3: pct(63), m6: pct(126) };
}
export async function hasPriceAt(ticker, date) { return idxOnOrBefore(await series(ticker), date) >= 0; }

// Is the (adjusted) price on `date` above its trailing n-day simple moving average?
// Returns null when there isn't enough history. Used by the breadth aggregator.
export async function aboveSMA(ticker, n, date) {
  const r = await series(ticker); const i = idxOnOrBefore(r, date);
  if (i < 0 || i < n - 1) return null;
  let sum = 0; for (let k = i - n + 1; k <= i; k++) sum += r[k].adj;
  const sma = sum / n, px = r[i].adj;
  return px > 0 && sma > 0 ? px > sma : null;
}

// Full history of daily log total-returns (adj-based), memoized via the same cache.
// Used by correlation.mjs to build the realized-correlation engine. PIT-safe: callers
// slice a trailing window ending on-or-before their as-of date.
export async function returnsSeries(ticker) {
  const r = await series(ticker);
  const out = [];
  for (let k = 1; k < r.length; k++) {
    const p0 = r[k - 1].adj, p1 = r[k].adj;
    if (p0 > 0 && p1 > 0) out.push({ date: r[k].date, ret: Math.log(p1 / p0) });
  }
  return out;
}
