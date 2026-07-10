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
import { buildCorrEngine, corrAsOf } from "./correlation.mjs";

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
    const { ic, scores } = scoreStock(f, raw, mom, sector, USE_MACRO ? macro : null);
    // Phase 4 — momentum/trajectory score to test 0A's hypothesis that the value/quality
    // score reads dispersion backwards. `mom121` = 12-1m price momentum (Jegadeesh-Titman,
    // PIT: window ends 1M before `date`). `traj` = momentum-dominant blend + earnings/rev
    // growth (from the production sub-scores). Both are pure rankers for the IC test.
    const mom121 = await fwdReturn(t, addMonths(date, -12), addMonths(date, -1));
    const traj = (mom121 ?? 0) + 0.4 * (mom.m6 ?? 0) + 1.2 * (scores.growth ?? 0);
    const fwd = {}, alpha = {};
    for (const m of HORIZONS) { const r = await fwdReturn(t, date, addMonths(date, m)); const s = await spyFwd(date, m); fwd[m] = r; alpha[m] = r != null && s != null ? r - s : null; }
    // A0 — store the individual sub-scores so we can measure each factor's IC by regime
    // (the input to the A5 IC-weighted ensemble). value/health/momentum/growth are the
    // production factors; mom121 is the pure price-momentum ranker.
    rows.push({ date, t, ic, mom: mom121, traj, sector, regime: macro.regime_id, fwd, alpha,
      f_value: scores.value ?? null, f_health: scores.health ?? null, f_momentum: scores.momentum ?? null, f_growth: scores.growth ?? null });
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

// ── 0A · correlation-conditioned scores · value/quality vs momentum (Phase 4) ─
// 0A showed the value/quality score reads dispersion backwards (2020-24 was mega-cap
// MOMENTUM, so a value tilt ranks the winners LOW). Phase 4 tests the fix: does a
// momentum/trajectory score earn POSITIVE IC in low correlation where value/quality
// fails? Bucket months into terciles by realized correlation and compare IC + decile
// spread for three rankers: value/quality (baseline), 12-1m momentum, momentum+growth.
console.log("\n  ── 0A · scores conditioned on market correlation regime (Phase 4) ──");
const corrEngine = await buildCorrEngine(UNIVERSE);
const corrByDate = new Map();
for (const d of dates) { const c = corrAsOf(corrEngine, UNIVERSE, d, 63); if (c != null) corrByDate.set(d, c); }
const corrDates = [...corrByDate.keys()].sort((a, b) => corrByDate.get(a) - corrByDate.get(b));
report.correlation = { months: corrDates.length, scores: {} };

function corrBuckets() {
  const t = Math.floor(corrDates.length / 3);
  return [
    { label: "LOW  corr (stock-pickers)", ds: new Set(corrDates.slice(0, t)) },
    { label: "MID  corr",                 ds: new Set(corrDates.slice(t, corrDates.length - t)) },
    { label: "HIGH corr (macro tape)",    ds: new Set(corrDates.slice(corrDates.length - t)) },
  ];
}
// IC (avg monthly Spearman of score↔3M fwd) + decile spread by score, per corr bucket.
function bucketReport(scoreOf, label) {
  console.log(`\n  ${label}`);
  console.log("  bucket                       months  avgCorr     IC      D10-D1(3M α)");
  const out = [];
  for (const g of corrBuckets()) {
    const gd = [...g.ds];
    const avgCorr = mean(gd.map((d) => corrByDate.get(d)));
    const ics = [];
    for (const d of gd) { const gg = rows.filter((r) => r.date === d && r.fwd[3] != null && scoreOf(r) != null); if (gg.length >= 8) { const s = spearman(gg.map(scoreOf), gg.map((r) => r.fwd[3])); if (s != null) ics.push(s); } }
    const ic = mean(ics);
    const pool = rows.filter((r) => g.ds.has(r.date) && r.alpha[3] != null && scoreOf(r) != null).sort((a, b) => scoreOf(a) - scoreOf(b));
    let spread = null;
    if (pool.length >= 30) { const sz = Math.floor(pool.length / 10); spread = mean(pool.slice(9 * sz).map((r) => r.alpha[3])) - mean(pool.slice(0, sz).map((r) => r.alpha[3])); }
    out.push({ label: g.label, months: gd.length, avgCorr, ic, decileSpread: spread });
    console.log(`  ${g.label.padEnd(27)}${String(gd.length).padStart(5)}   ${avgCorr != null ? avgCorr.toFixed(3) : "  —  "}    ${ic != null ? (ic >= 0 ? "+" : "") + ic.toFixed(3) : "  —  "}     ${spread != null ? pct(spread) + "%" : "—"}`);
  }
  return out;
}
if (corrDates.length >= 9) {
  report.correlation.scores.valueQuality = bucketReport((r) => r.ic,   "value/quality  (baseline — the score today)");
  report.correlation.scores.momentum     = bucketReport((r) => r.mom,  "12-1m momentum (Phase 4 candidate)");
  report.correlation.scores.trajectory   = bucketReport((r) => r.traj, "trajectory     (momentum + earnings/rev growth)");
  const loIC = (s) => s?.[0]?.ic ?? null;
  const vqLo = loIC(report.correlation.scores.valueQuality);
  const momLo = loIC(report.correlation.scores.momentum);
  const trLo = loIC(report.correlation.scores.trajectory);
  const best = Math.max(momLo ?? -9, trLo ?? -9);
  const verdict = best >= 0.03
    ? `PASS — a momentum/trajectory score earns positive low-corr IC (mom ${momLo?.toFixed(3)}, traj ${trLo?.toFixed(3)}) where value/quality fails (${vqLo?.toFixed(3)}). Build the micro 2.0 around momentum/trajectory, gated by correlation.`
    : `WEAK — neither momentum (${momLo?.toFixed(3)}) nor trajectory (${trLo?.toFixed(3)}) is decisively positive in low correlation. Even the right factor mix struggles on this universe → the durable edge stays in allocation.`;
  report.correlation.gate0A_phase4 = verdict;
  console.log(`\n  Gate 0A (Phase 4): ${verdict}`);

  // ── A0 · per-factor IC by correlation regime → the weights for the A5 ensemble ──
  // Measure each production factor's IC in each regime. RenTech discipline: a factor is
  // only trusted (and weighted) where its measured IC is positive. The ensemble weights
  // are derived from THIS evidence, not hand-set.
  console.log("\n  ── A0 · per-factor IC by correlation regime (feeds the A5 ensemble) ──");
  const factorDefs = [
    ["value",    (r) => r.f_value],
    ["health",   (r) => r.f_health],
    ["momentum", (r) => r.f_momentum],
    ["growth",   (r) => r.f_growth],
    ["mom12_1",  (r) => r.mom],
  ];
  const factorIC = {}; // { factor: [icLow, icMid, icHigh] }
  const bucketList = corrBuckets();
  for (const [name, sel] of factorDefs) {
    const perBucket = bucketList.map((g) => {
      const ics = [];
      for (const d of g.ds) { const gg = rows.filter((r) => r.date === d && r.fwd[3] != null && sel(r) != null); if (gg.length >= 8) { const s = spearman(gg.map(sel), gg.map((r) => r.fwd[3])); if (s != null) ics.push(s); } }
      return mean(ics);
    });
    factorIC[name] = perBucket;
    console.log(`  ${name.padEnd(9)} IC  low ${fmtIC(perBucket[0])}   mid ${fmtIC(perBucket[1])}   high ${fmtIC(perBucket[2])}`);
  }
  report.correlation.factorIC = factorIC;
  // Derive ensemble weights: keep only factors with positive IC in that regime, weight ∝ IC.
  const regimeKeys = ["low", "mid", "high"];
  const ensembleWeights = {};
  regimeKeys.forEach((rk, i) => {
    const w = {};
    let sum = 0;
    for (const [name] of factorDefs) { const ic = factorIC[name]?.[i]; if (ic != null && ic > 0) { w[name] = ic; sum += ic; } }
    for (const k in w) w[k] = +(w[k] / sum).toFixed(3);
    ensembleWeights[rk] = w;
  });
  report.correlation.ensembleWeights = ensembleWeights;
  console.log("\n  A5 ensemble weights (∝ positive IC, per regime):");
  for (const rk of regimeKeys) console.log(`  ${rk.padEnd(5)} ${Object.entries(ensembleWeights[rk]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join("  ") || "(no factor with +IC)"}`);
  writeFileSync(join(OUT, "signals_ic.json"), JSON.stringify({ generatedAt: new Date().toISOString(), universe: UNIVERSE.length, factorIC, ensembleWeights }, null, 2));
  console.log(`  → wrote research/out/signals_ic.json`);

  // ── F4.2 · OOS gate for the A5 ensemble ────────────────────────────────────
  // The in-sample weights above describe the whole window — circular if they were ever
  // allowed to DRIVE the score. This gate is the honest test: derive the weights on the
  // EARLY 60% of months (corr-regime cutoffs from the train window too), then measure
  // the frozen ensemble's IC on the LATE 40%, against the monolithic score on the SAME
  // dates. Only a PASS here would justify promoting the ensemble beyond informational.
  const SPLIT = dates[Math.floor(dates.length * 0.6)];
  const trainCorrVals = [...corrByDate.entries()].filter(([d]) => d < SPLIT).map(([, c]) => c).sort((a, b) => a - b);
  if (trainCorrVals.length >= 6) {
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const qv = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const loCut = qv(trainCorrVals, 1 / 3), hiCut = qv(trainCorrVals, 2 / 3);
    const regimeOfDate = (d) => { const c = corrByDate.get(d); return c == null ? null : c <= loCut ? "low" : c >= hiCut ? "high" : "mid"; };

    // Train weights: per-factor IC on train dates only, per regime, ∝ positive IC.
    const trainW = {};
    for (const rk of regimeKeys) {
      let sum = 0; const w = {};
      for (const [name, sel] of factorDefs) {
        const ics = [];
        for (const d of dates.filter((dd) => dd < SPLIT && regimeOfDate(dd) === rk)) {
          const gg = rows.filter((r) => r.date === d && r.fwd[3] != null && sel(r) != null);
          if (gg.length >= 8) { const s = spearman(gg.map(sel), gg.map((r) => r.fwd[3])); if (s != null) ics.push(s); }
        }
        const ic = mean(ics);
        if (ic != null && ic > 0) { w[name] = ic; sum += ic; }
      }
      for (const k in w) w[k] = w[k] / sum;
      trainW[rk] = w;
    }

    // Frozen ensemble composite (same normalization as lib/ensemble.ts) on TEST dates.
    const NORM_F = { value: (v) => clamp01(v / 25), health: (v) => clamp01(v / 30), momentum: (v) => clamp01(v / 25), growth: (v) => clamp01(v / 20), mom12_1: (v) => clamp01((v + 30) / 60) };
    const selOf = Object.fromEntries(factorDefs);
    const composite = (r, rk) => {
      let acc = 0, ws = 0;
      for (const [f, w] of Object.entries(trainW[rk] || {})) { const raw = selOf[f](r); if (raw == null || isNaN(raw)) continue; acc += w * NORM_F[f](raw); ws += w; }
      return ws > 0 ? acc / ws : null;
    };
    const testDates = dates.filter((d) => d >= SPLIT && regimeOfDate(d) != null);
    const icOnTest = (scoreFn) => {
      const ics = [];
      for (const d of testDates) {
        const rk = regimeOfDate(d);
        const gg = rows.filter((r) => r.date === d && r.fwd[3] != null && scoreFn(r, rk) != null);
        if (gg.length >= 8) { const s = spearman(gg.map((r) => scoreFn(r, rk)), gg.map((r) => r.fwd[3])); if (s != null) ics.push(s); }
      }
      return { ic: mean(ics), months: ics.length };
    };
    const ens = icOnTest((r, rk) => composite(r, rk));
    const mono = icOnTest((r) => r.ic);
    const oosPass = ens.ic != null && mono.ic != null && ens.ic > 0 && ens.ic > mono.ic;
    const oosVerdict = oosPass
      ? `PASS — frozen train-window ensemble earns OOS IC ${fmtIC(ens.ic)} vs the monolithic score's ${fmtIC(mono.ic)} over ${ens.months} test months. Promoting it beyond informational is now defensible.`
      : `KEEP INFORMATIONAL — frozen ensemble OOS IC ${fmtIC(ens.ic)} vs score ${fmtIC(mono.ic)} over ${ens.months} test months does not clear the bar (must be >0 AND beat the score). The card stays a transparent read, not a score input.`;
    report.correlation.ensembleOOS = { split: SPLIT, loCut, hiCut, trainWeights: trainW, testMonths: testDates.length, ensembleIC: ens.ic, scoreIC: mono.ic, pass: oosPass, verdict: oosVerdict };
    console.log(`\n  ── F4.2 · ensemble OOS gate (train < ${SPLIT} · test ≥ ${SPLIT}) ──`);
    for (const rk of regimeKeys) console.log(`  train weights ${rk.padEnd(5)} ${Object.entries(trainW[rk]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join("  ") || "(none positive)"}`);
    console.log(`  OOS IC — ensemble ${fmtIC(ens.ic)} (${ens.months} mo) · monolithic score ${fmtIC(mono.ic)} (${mono.months} mo)`);
    console.log(`  Gate F4.2: ${oosVerdict}`);
  }
}
function fmtIC(v) { return v == null ? "  —  " : (v >= 0 ? "+" : "") + v.toFixed(3); }

writeFileSync(join(OUT, "backtest_summary.json"), JSON.stringify(report, null, 2));
console.log(`\n  → wrote research/out/backtest_summary.json`);
console.log(`  Caveats: ${report.caveats.join(" · ")}\n`);
