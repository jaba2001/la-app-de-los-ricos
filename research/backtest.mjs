// ─────────────────────────────────────────────────────────────────────────────
// SCORA HISTORICAL BACKTEST — point-in-time, monthly rebalance, free data.
// Scores a universe as of each month-start using only data filed by then, measures
// forward returns vs SPY, and reports the metrics an investor asks for: hit-rate &
// alpha by horizon, Information Coefficient, decile monotonicity, top-minus-bottom
// spread, Sharpe & max drawdown of the score≥60 portfolio, and a by-regime breakdown.
// Run: node --experimental-strip-types --no-warnings research/backtest.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, fwdReturn, momentum, hasPriceAt } from "./prices.mjs";
import { regimeAsOf, preloadRegimeSeries } from "./regimeReal.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";

const HORIZONS = [1, 3, 6, 12];
const COST_BPS = 10;           // per side
const BUY_THRESH = 60;
const START = "2020-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };

// ── stats helpers ─────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j; } return r; }
function spearman(x, y) { if (x.length < 5) return null; const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : null; }

// ── collect the panel ─────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1)); // need ≥1M forward for the equity curve

// Universe: CURATED by default; `--full [N]` = S&P 500 with point-in-time membership
// (union of members over the window, capped at N by presence). `--macro` feeds the
// as-of regime into the score to measure the overlay's lift vs pure-micro.
const FULL = process.argv.includes("--full");
const USE_MACRO = process.argv.includes("--macro");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 120);
let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
    console.log(`  full S&P 500 mode · ${UNIVERSE.length} names (cap ${CAP}) · point-in-time membership`);
  } else console.log("  --full: constituents load failed → CURATED");
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);

console.log(`\n  SCORA backtest · ${UNIVERSE.length} names · ${dates.length} monthly rebalances ${dates[0]}→${dates.at(-1)}${USE_MACRO ? " · MACRO overlay" : ""}\n  loading data…`);

const rows = [];
const spyCache = new Map();
async function spyFwd(date, m) { const k = `${date}/${m}`; if (!spyCache.has(k)) spyCache.set(k, await fwdReturn("SPY", date, addMonths(date, m))); return spyCache.get(k); }

await preloadRegimeSeries(); // fetch all FRED regime series once (real production engine)
const meta = {};
for (const t of UNIVERSE) { const cik = await tickerToCik(t); meta[t] = { cik, sector: cik ? await sicSector(cik) : "" }; }

for (const date of dates) {
  const macro = await regimeAsOf(date);
  for (const t of UNIVERSE) {
    if (!isMember(t, date)) continue;
    const { cik, sector } = meta[t];
    if (!cik || !(await hasPriceAt(t, date))) continue;
    const f = await fundamentalsAsOf(cik, date);
    const raw = await rawPriceAsOf(t, date);
    if (!f || f.revTTM == null || raw == null) continue;
    const mom = await momentum(t, date);
    // Score the PURE MICRO signal (neutral regime) — the simplified as-of regime is
    // used only to *label* the by-regime breakdown, never fed into the score, so the
    // headline isn't confounded by a coarse macro classifier. The production macro
    // overlay is validated separately once macro.js runs historically.
    const { ic } = scoreStock(f, raw, mom, sector, USE_MACRO ? macro : null);
    const fwd = {}, alpha = {};
    for (const m of HORIZONS) { const r = await fwdReturn(t, date, addMonths(date, m)); const s = await spyFwd(date, m); fwd[m] = r; alpha[m] = r != null && s != null ? r - s : null; }
    rows.push({ date, t, ic, sector, regime: macro.regime_id, fwd, alpha });
  }
}
console.log(`  scored ${rows.length} name-months\n`);

// ── metrics ─────────────────────────────────────────────────────────────────
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
const report = { generatedAt: new Date().toISOString(), universe: UNIVERSE.length, mode: FULL ? "full-sp500-pit" : "curated", macroOverlay: USE_MACRO, rebalances: dates.length, nameMonths: rows.length, buyThreshold: BUY_THRESH, horizons: {}, regimes: {}, caveats: [FULL ? "point-in-time S&P 500 membership (incl. removed names)" : "survivorship (curated current members)", "fully-delisted names omitted (Yahoo) — add Tiingo for a bias-free universe", USE_MACRO ? "macro overlay fed into score" : "pure-micro score (regime is descriptive only)", "sector benchmarks held constant"] };

console.log("  ── Hit-rate & alpha vs SPY, by horizon (score ≥60 vs rest) ──");
console.log("  Horizon   BUY n   BUY hit   BUY α    | rest n   rest hit  rest α");
for (const m of HORIZONS) {
  const buy = rows.filter((r) => r.ic >= BUY_THRESH && r.alpha[m] != null);
  const rest = rows.filter((r) => r.ic < BUY_THRESH && r.alpha[m] != null);
  const hit = (a) => (a.length ? a.filter((r) => r.alpha[m] > 0).length / a.length : null);
  const av = (a) => mean(a.map((r) => r.alpha[m]));
  report.horizons[m] = { buyN: buy.length, buyHit: hit(buy), buyAlpha: av(buy), restN: rest.length, restHit: hit(rest), restAlpha: av(rest) };
  console.log(`  ${(m + "M").padEnd(9)}${String(buy.length).padStart(5)}  ${(hit(buy) != null ? (hit(buy) * 100).toFixed(0) + "%" : "—").padStart(7)}  ${pct(av(buy)).padStart(7)}%  | ${String(rest.length).padStart(5)}  ${(hit(rest) != null ? (hit(rest) * 100).toFixed(0) + "%" : "—").padStart(7)}  ${pct(av(rest)).padStart(6)}%`);
}

// Information Coefficient (Spearman ic↔fwd3m), averaged across rebalances
const ics = [];
for (const date of dates) { const g = rows.filter((r) => r.date === date && r.fwd[3] != null); if (g.length >= 8) { const s = spearman(g.map((r) => r.ic), g.map((r) => r.fwd[3])); if (s != null) ics.push(s); } }
report.informationCoefficient = mean(ics);
console.log(`\n  Information Coefficient (Spearman, ic↔3M fwd): ${report.informationCoefficient != null ? report.informationCoefficient.toFixed(3) : "—"}  (n=${ics.length} months)`);

// Decile monotonicity on 3M alpha
const pool = rows.filter((r) => r.alpha[3] != null).sort((a, b) => a.ic - b.ic);
const decAlpha = [];
if (pool.length >= 30) { const sz = Math.floor(pool.length / 10); for (let i = 0; i < 10; i++) { const seg = pool.slice(i * sz, i === 9 ? pool.length : (i + 1) * sz); decAlpha.push(mean(seg.map((r) => r.alpha[3]))); } }
report.deciles = decAlpha;
report.topMinusBottom = decAlpha.length ? decAlpha[9] - decAlpha[0] : null;
if (decAlpha.length) { console.log("  Decile 3M alpha (D1 low score → D10 high):"); console.log("   " + decAlpha.map((v) => pct(v, 0).padStart(5)).join(" ")); console.log(`  Top-minus-bottom decile spread: ${pct(report.topMinusBottom)}%`); }

// Equity curve — monthly, 1M hold, equal-weight BUY bucket, minus turnover cost
let equity = 1, spyEq = 1, peak = 1, maxDD = 0; const monthly = [], spyMonthly = []; let prevSet = new Set();
for (const date of dates) {
  const buy = rows.filter((r) => r.date === date && r.ic >= BUY_THRESH && r.fwd[1] != null);
  const spy1 = await spyFwd(date, 1);
  if (spy1 == null) continue;
  spyEq *= 1 + spy1 / 100; spyMonthly.push(spy1);
  if (!buy.length) { monthly.push(0); continue; }
  const set = new Set(buy.map((r) => r.t));
  let turn = 0; for (const x of set) if (!prevSet.has(x)) turn++; const turnover = set.size ? turn / set.size : 0;
  const gross = mean(buy.map((r) => r.fwd[1]));
  const netRet = gross - (turnover * COST_BPS * 2) / 100; // cost% = turnover × 20bps = turnover×0.20%
  equity *= 1 + netRet / 100; monthly.push(netRet); prevSet = set;
  peak = Math.max(peak, equity); maxDD = Math.min(maxDD, equity / peak - 1);
}
const excess = monthly.map((r, i) => r - (spyMonthly[i] ?? 0));
report.equity = { buyTotalReturn: (equity - 1) * 100, spyTotalReturn: (spyEq - 1) * 100, sharpe: std(monthly) ? mean(monthly) / std(monthly) * Math.sqrt(12) : null, maxDrawdown: maxDD * 100, months: monthly.length, avgMonthlyExcess: mean(excess) };
console.log(`\n  ── score≥60 equal-weight monthly portfolio (net of ${COST_BPS}bps/side) ──`);
console.log(`  Total return: ${pct(report.equity.buyTotalReturn)}%  vs SPY ${pct(report.equity.spyTotalReturn)}%   over ${monthly.length} months`);
console.log(`  Sharpe (ann.): ${report.equity.sharpe != null ? report.equity.sharpe.toFixed(2) : "—"}   Max drawdown: ${pct(report.equity.maxDrawdown)}%`);

// By regime (3M alpha of BUY) — with the regime-month distribution for context
console.log("\n  ── score≥60 3M alpha by macro regime ──");
const regMonths = {}; for (const d of dates) { const rg = (rows.find((r) => r.date === d) || {}).regime; if (rg) regMonths[rg] = (regMonths[rg] ?? 0) + 1; }
for (const rg of ["expansion", "reflation", "stagflation", "contraction"]) {
  const g = rows.filter((r) => r.regime === rg && r.ic >= BUY_THRESH && r.alpha[3] != null);
  report.regimes[rg] = { months: regMonths[rg] ?? 0, n: g.length, alpha: mean(g.map((r) => r.alpha[3])) };
  console.log(`  ${rg.padEnd(12)} ${String(regMonths[rg] ?? 0).padStart(2)} mo · BUY n=${String(g.length).padStart(4)}  avg 3M alpha ${g.length ? pct(report.regimes[rg].alpha) + "%" : "—"}`);
}

writeFileSync(join(OUT, "backtest_summary.json"), JSON.stringify(report, null, 2));
console.log(`\n  → wrote research/out/backtest_summary.json`);
console.log(`  Caveats: ${report.caveats.join(" · ")}\n`);
