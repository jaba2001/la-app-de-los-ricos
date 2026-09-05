// ─────────────────────────────────────────────────────────────────────────────
// REALIZED average pairwise correlation of a universe, as-of a date. PIT-clean.
//
// Why realized (not CBOE ^COR3M): the implied index only goes back a few years on
// free feeds and its construction is forward-looking; realized correlation has a long
// history and uses only prices up to `date`, so the backtest stays point-in-time.
// (The LIVE product can layer ^COR3M/^COR1M on top — same signal, different vintage.)
//
// Estimator (equal-weight, O(N·T) not O(N²)): for a trailing window of daily returns,
//   ρ̄ ≈ (N·Var(r_port) − meanVar) / (meanVar·(N−1))
// where r_port(t) = mean_i r_i(t) is the equal-weight portfolio return and meanVar is
// the average single-name return variance. This is the standard realized-correlation
// identity (portfolio variance vs constituent variance) and matches how CBOE derives
// implied correlation. Returns a value in ~[0,1]; higher = names move together (macro
// tape), lower = idiosyncratic dispersion (a stock-picker's tape).
// ─────────────────────────────────────────────────────────────────────────────
import { returnsSeries } from "./prices.mjs";

const variance = (a) => { if (a.length < 3) return null; const m = a.reduce((s, x) => s + x, 0) / a.length; return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); };

/** Preload return maps for the universe + the SPY trading-day grid. Call once. */
export async function buildCorrEngine(universe) {
  const maps = new Map(); // ticker -> Map(date -> logret)
  for (const t of universe) {
    const rs = await returnsSeries(t);
    if (!rs.length) continue;
    const m = new Map();
    for (const { date, ret } of rs) m.set(date, ret);
    maps.set(t, m);
  }
  const spy = await returnsSeries("SPY");
  const spyDates = spy.map((x) => x.date); // ascending
  return { maps, spyDates };
}

/** Realized avg pairwise correlation over the `win` sessions on-or-before `date`. */
export function corrAsOf(engine, universe, date, win = 63) {
  const { maps, spyDates } = engine;
  // last SPY index on-or-before date
  let hi = -1;
  for (let lo = 0, h = spyDates.length - 1; lo <= h;) { const m = (lo + h) >> 1; if (spyDates[m] <= date) { hi = m; lo = m + 1; } else h = m - 1; }
  if (hi < win) return null;
  const grid = spyDates.slice(hi - win + 1, hi + 1);

  // per-name aligned return vectors (null where the name didn't trade that day)
  const kept = [];
  for (const t of universe) {
    const m = maps.get(t);
    if (!m) continue;
    let cnt = 0;
    const v = grid.map((d) => { const x = m.get(d); if (x != null) { cnt++; return x; } return null; });
    if (cnt >= win * 0.9) kept.push(v); // require ≥90% coverage to count the name
  }
  const N = kept.length;
  if (N < 5) return null;

  // equal-weight portfolio return each day (avg over names present that day)
  const port = [];
  for (let j = 0; j < grid.length; j++) {
    let s = 0, c = 0;
    for (const v of kept) if (v[j] != null) { s += v[j]; c++; }
    if (c > 0) port.push(s / c);
  }
  const varP = variance(port);
  if (varP == null || varP <= 0) return null;

  // mean single-name variance (each over its own available days)
  let sv = 0, nv = 0;
  for (const v of kept) { const vals = v.filter((x) => x != null); const vv = variance(vals); if (vv != null && vv > 0) { sv += vv; nv++; } }
  if (!nv) return null;
  const meanVar = sv / nv;

  const rho = (N * varP - meanVar) / (meanVar * (N - 1));
  // clamp to a sane band — the estimator can nick slightly outside [0,1] with sparse days
  return Math.max(-0.2, Math.min(1, rho));
}
