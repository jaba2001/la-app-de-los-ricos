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
import { normCdf } from "../lib/quality.ts";
import { readLedgerTotal, readLedgerDispersion } from "./trialsLedger.mjs";

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

// ── Significance helpers (Probabilistic / Deflated Sharpe — Bailey & López de Prado) ──
function moments(r) {
  const n = r.length, m = mean(r);
  const sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  const sk = sd > 0 ? (r.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n) : 0;
  const ku = sd > 0 ? (r.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n) : 3;
  return { n, m, sd, srP: sd > 0 ? m / sd : 0, skew: sk, kurt: ku };
}
// Inverse standard-normal CDF (Acklam's rational approximation).
function invNorm(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
/** Probabilistic Sharpe Ratio: P(true SR > srBench) given non-normality. srP/srBench per-period. */
function psr(srP, T, skew, kurt, srBench = 0) {
  const den = Math.sqrt(Math.max(1e-9, 1 - skew * srP + ((kurt - 1) / 4) * srP * srP));
  return normCdf(((srP - srBench) * Math.sqrt(T - 1)) / den);
}

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
const perConfig = [];
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
  perConfig.push({ N, port, spy, mo: moments(port) });
  console.log(`  ${String(N).padEnd(3)} ${pct(tot).padStart(7)} ${pct(spyTot).padStart(6)}  ${row.sharpe.toFixed(2).padStart(5)}  ${row.sortino.toFixed(2).padStart(6)}  ${row.calmar.toFixed(2).padStart(6)}  ${row.maxDrawdown.toFixed(1).padStart(6)}  ${pct(row.jensenAlpha).padStart(7)}  ${row.beta.toFixed(2)}  ${row.informationRatio.toFixed(2).padStart(5)}  ${(row.upCapture ?? 0).toFixed(2)}/${(row.downCapture ?? 0).toFixed(2)}  ${row.var95.toFixed(1).padStart(6)}  ${row.cvar95.toFixed(1).padStart(6)}   ${boot ? `[${boot.lo.toFixed(2)},${boot.hi.toFixed(2)}]` : "—"}`);
}

// ── Significance / blindaje (PSR + Deflated Sharpe + OOS split) ──────────────────
if (perConfig.length) {
  const T = perConfig[0].mo.n;
  const spyMo = moments(perConfig[0].spy);
  // Deflation threshold SR0 from the N-sweep trials (Bailey-López de Prado).
  const srps = perConfig.map((c) => c.mo.srP);
  const varSR = srps.length > 1 ? srps.reduce((s, x) => s + (x - mean(srps)) ** 2, 0) / (srps.length - 1) : 0;
  const M = srps.length, GAMMA = 0.5772156649;
  const SR0 = M > 1 ? Math.sqrt(varSR) * ((1 - GAMMA) * invNorm(1 - 1 / M) + GAMMA * invNorm(1 - 1 / (M * Math.E))) : 0;
  const best = perConfig.slice().sort((a, b) => b.mo.srP - a.mo.srP)[0];
  const psrVsSpy = psr(best.mo.srP, T, best.mo.skew, best.mo.kurt, spyMo.srP);
  const dsr = psr(best.mo.srP, T, best.mo.skew, best.mo.kurt, SR0);

  // ── M ACUMULADO (2026-08-18) ────────────────────────────────────────────────
  // `M` de arriba son los ensayos DE ESTA EJECUCIÓN (el barrido de N). Pero el M que exige
  // la deflación es todo lo que se ha evaluado sobre LOS MISMOS DATOS, y research/ lleva
  // una docena de laboratorios barriendo la misma historia. research/out/trials_ledger.json
  // los cuenta (cota inferior). Se reporta el DSR con AMBOS: el de siempre para
  // continuidad, y el honesto — que es el que hay que creerse.
  // Dos cotas, no una. SR0 = sqrt(var(SR)) x f(M), y AMBOS factores estan mal medidos si
  // solo miras este script:
  //   - f(M): M=3 aqui, pero se han evaluado 200+ variantes sobre los mismos datos.
  //   - var(SR): las 3 configs del barrido de N dan Sharpe casi identico, asi que la
  //     varianza sale ~0 y la deflacion no muerde. La dispersion real entre todo lo
  //     probado va de -0.02 (long/short) a 1.02 (asignador).
  // Cota OPTIMISTA = lo de siempre (M y var de este script).
  // Cota CONSERVADORA = M acumulado del libro de ensayos + dispersion agrupada.
  // Agrupar familias de estrategia distintas infla var(SR) por encima de lo que supone el
  // marco de Bailey-Lopez de Prado (que asume M intentos sobre EL MISMO problema), asi que
  // la verdad esta ENTRE las dos. Publicarlas ambas es mas honesto que elegir una.
  const disp = readLedgerDispersion();
  const M_CUM = disp ? Math.max(M, disp.trials) : null;
  const SD_CUM = disp ? Math.max(Math.sqrt(varSR), disp.sdMonthly) : null;
  const SR0_CUM = M_CUM && M_CUM > 1 && SD_CUM != null
    ? SD_CUM * ((1 - GAMMA) * invNorm(1 - 1 / M_CUM) + GAMMA * invNorm(1 - 1 / (M_CUM * Math.E)))
    : null;
  const dsrCum = SR0_CUM != null ? psr(best.mo.srP, T, best.mo.skew, best.mo.kurt, SR0_CUM) : null;
  // OOS split (train first 60% / test last 40%) for the best config.
  const cut = Math.floor(best.port.length * 0.6);
  const trainR = best.port.slice(0, cut), testR = best.port.slice(cut);
  const trTot = (r) => (r.reduce((a, x) => a * (1 + x), 1) - 1) * 100;
  report.significance = {
    trials: M, srBenchMonthly: +spyMo.srP.toFixed(4), deflationThresholdSR0: +SR0.toFixed(4),
    bestN: best.N, bestSharpeMonthly: +best.mo.srP.toFixed(4), skew: +best.mo.skew.toFixed(2), kurt: +best.mo.kurt.toFixed(2),
    PSR_vs_SPY: +psrVsSpy.toFixed(3), DSR: +dsr.toFixed(3),
    cumulativeTrials: M_CUM, deflationThresholdSR0_cumulative: SR0_CUM != null ? +SR0_CUM.toFixed(4) : null,
    DSR_cumulative: dsrCum != null ? +dsrCum.toFixed(3) : null,
    cumulativeSharpeSdMonthly: SD_CUM != null ? +SD_CUM.toFixed(5) : null,
    cumulativeNote: "DSR es la cota OPTIMISTA (M y var(SR) de este script). DSR_cumulative es la CONSERVADORA (M del libro de ensayos + dispersion agrupada entre laboratorios). La verdad esta entre ambas: agrupar familias distintas infla var(SR) sobre lo que supone Bailey-Lopez de Prado. Ninguna de las dos rescata el veredicto, que ya cae por PSR vs SPY.",
    oos: { split: cut, trainSharpe: sharpe(trainR), testSharpe: sharpe(testR), trainTotal: +trTot(trainR).toFixed(1), testTotal: +trTot(testR).toFixed(1), spyTrainTotal: +trTot(best.spy.slice(0, cut)).toFixed(1), spyTestTotal: +trTot(best.spy.slice(cut)).toFixed(1) },
  };
  console.log(`\n  ── Significance / blindaje (best config N=${best.N}) ──`);
  console.log(`  PSR vs SPY: ${(psrVsSpy * 100).toFixed(1)}%  (prob. the portfolio's true Sharpe beats SPY's — want >95%)`);
  console.log(`  Deflated Sharpe (vs ${M}-trial threshold SR0=${SR0.toFixed(3)}/mo): ${(dsr * 100).toFixed(1)}%  (want >95% to call the Sharpe real)`);
  if (dsrCum != null) {
    console.log(`  Deflated Sharpe CONSERVADOR — M acumulado ${M_CUM} ensayos, sd ${SD_CUM.toFixed(4)}/mo (SR0=${SR0_CUM.toFixed(3)}/mo): ${(dsrCum * 100).toFixed(1)}%`);
    console.log(`    (la cota de arriba usa M=${M} y la varianza de este script; la verdad esta entre ambas — ver cumulativeNote)`);
  } else {
    console.log(`  (sin research/out/trials_ledger.json: ejecuta research/trialsLedger.mjs para el M acumulado)`);
  }
  console.log(`  OOS split @ ${cut}mo — train Sharpe ${sharpe(trainR).toFixed(2)} (port ${pct(trTot(trainR))}% vs SPY ${pct(trTot(best.spy.slice(0, cut)))}%) · test Sharpe ${sharpe(testR).toFixed(2)} (port ${pct(trTot(testR))}% vs SPY ${pct(trTot(best.spy.slice(cut)))}%)`);
  const dsrEffective = dsrCum != null ? dsrCum : dsr;
  report.verdict = (psrVsSpy > 0.95 && dsrEffective > 0.95)
    ? "ROBUST — selection portfolio's Sharpe beats SPY and survives the multi-trial deflation."
    : "NOT ROBUST — the selection portfolio does NOT significantly beat SPY after PSR/deflation; the measured edge is in the regime allocator (C3), not stock selection.";
  console.log(`  VERDICT: ${report.verdict}`);
}

writeFileSync(join(OUT, "portfolio_backtest.json"), JSON.stringify(report, null, 2));
console.log(`\n  → wrote research/out/portfolio_backtest.json`);
console.log(`  Notes: Jensen α & timing vs SPY; up/down-capture = mean port return ÷ mean SPY return in up/down months; Sharpe 90% CI via block bootstrap. Curated = survivorship-aware (add --full + TIINGO_TOKEN for a bias-free universe).\n`);
