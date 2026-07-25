// ─────────────────────────────────────────────────────────────────────────────
// SCORA PORTFOLIO BACKTEST (Fase 8, Steps 3-5) — build a fixed-N, sector-capped, macro-tilted
// portfolio each month, rebalance monthly (10bps/side), benchmark vs SPY, and report the full
// risk-adjusted suite (reusing lib/riskMetrics), up/down capture, a Treynor-Mazuy timing test,
// and a block-bootstrap CI on the Sharpe. Sweeps N ∈ {20,30,40}. Point-in-time, free data.
// Run: node --experimental-strip-types --no-warnings research/portfolio_backtest.mjs [--full N] [--macro]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, fwdReturn, momentum, hasPriceAt } from "./prices.mjs";
import { regimeAsOf, preloadRegimeSeries } from "./regimeReal.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { sharpe, sortino, maxDrawdown, calmar, valueAtRisk, conditionalVaR, beta as betaOf, informationRatio, jensenAlpha, annualVol } from "../lib/riskMetrics.ts";

const START = "2020-01-01";
const COST_BPS = 10;
const N_LIST = [20, 30, 40];
const SECTOR_CAP = 0.30;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

const FULL = process.argv.includes("--full");
const USE_MACRO = process.argv.includes("--macro");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 150);
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -1));

let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
    console.log(`  full S&P 500 mode · ${UNIVERSE.length} names (cap ${CAP})`);
  } else console.log("  --full: constituents load failed → CURATED");
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);

console.log(`\n  SCORA portfolio backtest · ${UNIVERSE.length} names · ${dates.length} rebalances ${dates[0]}→${dates.at(-1)}${USE_MACRO ? " · MACRO" : ""}\n  loading data…`);
await preloadRegimeSeries();
const meta = {};
for (const t of UNIVERSE) { const cik = await tickerToCik(t); meta[t] = { cik, sector: cik ? await sicSector(cik) : "" }; }
const spyCache = new Map();
async function spy1(date) { if (!spyCache.has(date)) spyCache.set(date, await fwdReturn("SPY", date, addMonths(date, 1))); return spyCache.get(date); }

// Panel: per month, [{ t, ic, sector, fwd1 }]
const panel = new Map();
for (const date of dates) {
  const macro = await regimeAsOf(date);
  const picks = [];
  for (const t of UNIVERSE) {
    if (!isMember(t, date)) continue;
    const { cik, sector } = meta[t];
    if (!cik || !(await hasPriceAt(t, date))) continue;
    const f = await fundamentalsAsOf(cik, date);
    const raw = await rawPriceAsOf(t, date);
    if (!f || f.revTTM == null || raw == null) continue;
    const mom = await momentum(t, date);
    const { ic } = scoreStock(f, raw, mom, sector, USE_MACRO ? macro : null);
    const fwd1 = await fwdReturn(t, date, addMonths(date, 1));
    if (fwd1 == null) continue;
    picks.push({ t, ic, sector: sector || "?", fwd1 });
  }
  panel.set(date, picks);
}
console.log(`  panel built (${[...panel.values()].reduce((s, p) => s + p.length, 0)} name-months)\n`);

// Build the top-N sector-capped equal-weight portfolio monthly return series (decimals).
async function buildSeries(N) {
  const capCount = Math.max(1, Math.floor(SECTOR_CAP * N));
  const port = [], spy = []; let prev = new Set();
  for (const date of dates) {
    const s1 = await spy1(date);
    if (s1 == null) continue;
    const ranked = [...(panel.get(date) ?? [])].sort((a, b) => b.ic - a.ic);
    const chosen = []; const secCount = {};
    for (const r of ranked) {
      if (chosen.length >= N) break;
      const c = secCount[r.sector] ?? 0;
      if (c >= capCount) continue;             // sector cap
      chosen.push(r); secCount[r.sector] = c + 1;
    }
    if (!chosen.length) { spy.push(s1); port.push(s1); continue; } // no picks → track index
    const gross = mean(chosen.map((r) => r.fwd1));
    const set = new Set(chosen.map((r) => r.t));
    let turn = 0; for (const x of set) if (!prev.has(x)) turn++;
    const turnover = set.size ? turn / set.size : 0;
    const net = gross - (turnover * COST_BPS * 2) / 100;
    port.push(net); spy.push(s1); prev = set;
  }
  return { port: port.map((r) => r / 100), spy: spy.map((r) => r / 100) }; // → decimals for riskMetrics
}

// Up/down capture + Treynor-Mazuy timing regression.
function capture(port, spy) {
  const up = spy.map((s, i) => [s, port[i]]).filter(([s]) => s > 0);
  const dn = spy.map((s, i) => [s, port[i]]).filter(([s]) => s < 0);
  const uc = up.length ? mean(up.map((x) => x[1])) / mean(up.map((x) => x[0])) : null;
  const dc = dn.length ? mean(dn.map((x) => x[1])) / mean(dn.map((x) => x[0])) : null;
  return { up: uc, down: dc };
}
function treynorMazuy(port, spy, rf = 0) {
  // (port-rf) = a + b(spy-rf) + c(spy-rf)^2 ; c>0 = timing skill. OLS via normal equations.
  const y = port.map((p) => p - rf), x1 = spy.map((s) => s - rf), x2 = x1.map((v) => v * v);
  const n = y.length; if (n < 6) return null;
  const S = (a, b) => a.reduce((s, _, i) => s + a[i] * b[i], 0);
  const ones = new Array(n).fill(1);
  const A = [[S(ones, ones), S(ones, x1), S(ones, x2)], [S(x1, ones), S(x1, x1), S(x1, x2)], [S(x2, ones), S(x2, x1), S(x2, x2)]];
  const bvec = [S(ones, y), S(x1, y), S(x2, y)];
  // solve 3x3
  const M = A.map((row, i) => [...row, bvec[i]]);
  for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = 0; r < 3; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= 3; k++) M[r][k] -= f * M[c][k]; } }
  const sol = M.map((row, i) => row[3] / row[i]);
  return { alpha: sol[0], beta: sol[1], timing: sol[2] };
}
// Block bootstrap CI for the annualized Sharpe.
function bootstrapSharpe(port, block = 6, iters = 2000) {
  const n = port.length; if (n < block * 2) return null;
  const sh = [];
  for (let it = 0; it < iters; it++) {
    const s = [];
    while (s.length < n) { const start = Math.floor(Math.random() * (n - block)); for (let k = 0; k < block && s.length < n; k++) s.push(port[start + k]); }
    sh.push(sharpe(s));
  }
  sh.sort((a, b) => a - b);
  return { lo: sh[Math.floor(iters * 0.05)], hi: sh[Math.floor(iters * 0.95)] };
}

const report = { generatedAt: new Date().toISOString(), mode: FULL ? "full-sp500-pit" : "curated", macro: USE_MACRO, universe: UNIVERSE.length, months: 0, sectorCap: SECTOR_CAP, byN: {} };
console.log("  ── Top-N portfolio vs SPY (monthly, sector-capped, net of 10bps/side) ──");
console.log("  N   Total%   SPY%   Sharpe  Sortino  Calmar   maxDD%   Jensenα%  β    IR    up/down cap    VaR95%  CVaR95%  Sharpe95%CI");
for (const N of N_LIST) {
  const { port, spy } = await buildSeries(N);
  report.months = port.length;
  const tot = (port.reduce((a, r) => a * (1 + r), 1) - 1) * 100;
  const spyTot = (spy.reduce((a, r) => a * (1 + r), 1) - 1) * 100;
  const cap = capture(port, spy);
  const tm = treynorMazuy(port, spy);
  const boot = bootstrapSharpe(port);
  const row = {
    total: tot, spyTotal: spyTot, sharpe: sharpe(port), sortino: sortino(port), calmar: calmar(port),
    maxDrawdown: maxDrawdown(port) * 100, jensenAlpha: jensenAlpha(port, spy) * 100, beta: betaOf(port, spy),
    informationRatio: informationRatio(port, spy), upCapture: cap.up, downCapture: cap.down,
    var95: valueAtRisk(port) * 100, cvar95: conditionalVaR(port) * 100, annVol: annualVol(port) * 100,
    timing: tm?.timing ?? null, sharpeCI: boot,
  };
  report.byN[N] = row;
  console.log(`  ${String(N).padEnd(3)} ${pct(tot).padStart(7)} ${pct(spyTot).padStart(6)}  ${row.sharpe.toFixed(2).padStart(5)}  ${row.sortino.toFixed(2).padStart(6)}  ${row.calmar.toFixed(2).padStart(6)}  ${row.maxDrawdown.toFixed(1).padStart(6)}  ${pct(row.jensenAlpha).padStart(7)}  ${row.beta.toFixed(2)}  ${row.informationRatio.toFixed(2).padStart(5)}  ${(row.upCapture ?? 0).toFixed(2)}/${(row.downCapture ?? 0).toFixed(2)}  ${row.var95.toFixed(1).padStart(6)}  ${row.cvar95.toFixed(1).padStart(6)}   ${boot ? `[${boot.lo.toFixed(2)},${boot.hi.toFixed(2)}]` : "—"}`);
}

writeFileSync(join(OUT, "portfolio_backtest.json"), JSON.stringify(report, null, 2));
console.log(`\n  → wrote research/out/portfolio_backtest.json`);
console.log(`  Notes: Jensen α & timing vs SPY; up/down-capture = mean port return ÷ mean SPY return in up/down months; Sharpe 90% CI via block bootstrap. Curated = survivorship-aware (add --full + TIINGO_TOKEN for a bias-free universe).\n`);
