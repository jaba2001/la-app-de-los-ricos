// ─────────────────────────────────────────────────────────────────────────────
// SECTOR-TILT VALIDATION (Phase 1, 2026-07-11) — the honest gate before productizing the
// regime→sector tilt as a STRATEGY. The earlier +1501%/Sharpe-0.85 used leave-one-out (it
// trained "which sectors lead this regime" on ALL other months incl. the future → leakage).
// This re-tests with a strict EXPANDING WINDOW: at each month, rank sectors using ONLY the
// realized past. Tests concentration (top-2/3/4), the Tech artifact (with/without XLK), and
// — decisively — the tilt AS THE EQUITY SLEEVE inside the validated Growth allocator vs the
// current plain-SPY sleeve. Measure-don't-assert: only worth building if it clears OOS AND
// improves the full strategy's risk-adjusted metrics. Run:
//   node --experimental-strip-types --no-warnings research/sector_tilt_validate.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";
import { ASSETS, growthWeights, applyDualMomentum } from "./allocate.mjs";
import { riskReport } from "../lib/riskMetrics.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const COST_BPS = 10;
const SECTORS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLP", "XLY", "XLB", "XLU"];
const MIN_TRAIN = 6; // months of a regime's history before we trust its sector ranking
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const stats = (rets) => { let e = 1, pk = 1, mdd = 0; for (const x of rets) { e *= 1 + x / 100; pk = Math.max(pk, e); mdd = Math.min(mdd, e / pk - 1); } const yrs = rets.length / 12; return { total: (e - 1) * 100, cagr: (Math.pow(e, 1 / yrs) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 }; };

const START = process.env.BT_START || "2000-06-01";
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -2));
console.log(`\n  SECTOR-TILT VALIDATION · ${dates.length} months ${dates[0]}→${dates.at(-1)} · EXPANDING-WINDOW OOS`);
await preloadStationary();
const fc = new Map();
async function fwd1(a, d) { const k = a + d; if (!fc.has(k)) fc.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fc.get(k); }
async function mom(a, d) { return fwdReturn(a, addMonths(d, -12), addMonths(d, -1)); }

// Panel: per month, regime + forward-1m return of SPY and every sector.
const rows = [];
for (const d of dates) {
  const macro = await regimeStationaryAsOf(d);
  const spy = await fwd1("SPY", d);
  if (spy == null || !macro?.regime_id) continue;
  const sec = {}; for (const s of SECTORS) sec[s] = await fwd1(s, d);
  rows.push({ d, regime: macro.regime_id, spy, sec });
}

// Expanding-window rank: for month index i, avg forward EXCESS of each sector across PAST
// months of the same regime (only s<i, fully realized). Returns the ranked sector list.
function rankPast(i, pool) {
  const rg = rows[i].regime;
  const train = rows.slice(0, i).filter((r) => r.regime === rg);
  if (train.length < MIN_TRAIN) return null; // not enough history yet → caller falls back
  return pool.map((s) => {
    const ex = train.map((r) => (r.sec[s] != null ? r.sec[s] - r.spy : null)).filter((x) => x != null);
    return [s, mean(ex) ?? -99];
  }).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

// Sector-tilt OOS strategy: hold top-K favored sectors (equal weight); before enough regime
// history, fall back to SPY. `pool` lets us drop XLK to test the Tech artifact.
function sectorTiltRets(K, pool) {
  const rets = []; let prevHeld = ["SPY"];
  for (let i = 0; i < rows.length; i++) {
    const ranked = rankPast(i, pool);
    const held = ranked ? ranked.slice(0, K) : ["SPY"];
    const r = held[0] === "SPY" ? rows[i].spy : mean(held.map((s) => rows[i].sec[s]).filter((x) => x != null));
    if (r == null) continue;
    const turn = held.join() === prevHeld.join() ? 0 : 1;
    rets.push(r - turn * COST_BPS / 100); prevHeld = held;
  }
  return rets;
}

// Momentum-based sector rotation (the existing Layer-3): top-3 by 12-1m, for comparison.
async function momentumRotationRets(K) {
  const rets = []; let prev = [];
  for (const r of rows) {
    const ms = [];
    for (const s of SECTORS) { const m = await mom(s, r.d); if (m != null) ms.push([s, m]); }
    const held = ms.sort((a, b) => b[1] - a[1]).slice(0, K).map((x) => x[0]);
    const ret = held.length ? mean(held.map((s) => r.sec[s]).filter((x) => x != null)) : r.spy;
    if (ret == null) continue;
    const turn = held.join() === prev.join() ? 0 : 1;
    rets.push(ret - turn * COST_BPS / 100); prev = held;
  }
  return rets;
}

const spyRets = rows.map((r) => r.spy);
const ewRets = rows.map((r) => mean(SECTORS.map((s) => r.sec[s]).filter((x) => x != null))).filter((x) => x != null);

const out = {};
console.log(`\n  ${"strategy".padEnd(34)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}`);
const line = (name, rets) => { const st = stats(rets); out[name] = st; console.log(`  ${name.padEnd(34)}${("+" + st.total.toFixed(0) + "%").padStart(9)}${(st.cagr.toFixed(1) + "%").padStart(7)}${st.sharpe.toFixed(2).padStart(8)}${(st.maxDD.toFixed(1) + "%").padStart(8)}`); };
line("SPY buy & hold", spyRets);
line("Equal-weight 9 sectors", ewRets);
line("Sector-tilt top-2 (OOS)", sectorTiltRets(2, SECTORS));
line("Sector-tilt top-3 (OOS)", sectorTiltRets(3, SECTORS));
line("Sector-tilt top-2 · NO TECH", sectorTiltRets(2, SECTORS.filter((s) => s !== "XLK")));
line("Sector-tilt top-3 · NO TECH", sectorTiltRets(3, SECTORS.filter((s) => s !== "XLK")));
line("Momentum rotation top-3", await momentumRotationRets(3));

// ── DECISIVE TEST: sector-tilt AS the Growth allocator's equity sleeve, vs plain SPY ──
// Full production Growth path, but when the switch says "hold equities" (risk-on), hold the
// OOS top-K favored sectors instead of SPY. Same dual-momentum gate + BTC sleeve otherwise.
async function growthWithEquity(equityRetFn) {
  const rets = []; let prev = {};
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i].d, macro = await regimeStationaryAsOf(d);
    const btcM = await mom("BTCUSD", d);
    const base = growthWeights(macro.risk_on, btcM);
    const m = {}; for (const a of ASSETS) m[a] = await mom(a, d);
    const w = applyDualMomentum(base, m).weights;
    let gross = 0;
    for (const a of ASSETS) {
      const wa = w[a] || 0; if (!wa) continue;
      let r = a === "SPY" ? await equityRetFn(i) : await fwd1(a, d);
      if (r == null) continue; gross += wa * r;
    }
    let turn = 0; for (const a of ASSETS) turn += Math.abs((w[a] || 0) - (prev[a] || 0));
    rets.push(gross - (turn / 2) * 2 * COST_BPS / 100); prev = w;
  }
  return rets;
}
// Precompute the top-K OOS sector return per month index (equity sleeve replacement).
function tiltEquityRet(K, pool) {
  return async (i) => { const ranked = rankPast(i, pool); const held = ranked ? ranked.slice(0, K) : ["SPY"]; return held[0] === "SPY" ? rows[i].spy : mean(held.map((s) => rows[i].sec[s]).filter((x) => x != null)); };
}
// Momentum-rotation equity sleeve (the VALIDATED sector signal): top-K by 12-1m each month.
function momEquityRet(K) {
  return async (i) => {
    const r = rows[i]; const ms = [];
    for (const s of SECTORS) { const m = await mom(s, r.d); if (m != null) ms.push([s, m]); }
    const held = ms.sort((a, b) => b[1] - a[1]).slice(0, K).map((x) => x[0]);
    return held.length ? mean(held.map((s) => r.sec[s]).filter((x) => x != null)) : r.spy;
  };
}
console.log(`\n  ── DECISIVE: sector strategies as the Growth equity sleeve (full allocator, 2000-2026) vs plain SPY sleeve ──`);
const gSpy = await growthWithEquity(async (i) => rows[i].spy);
const gTilt3 = await growthWithEquity(tiltEquityRet(3, SECTORS));
const gTilt2 = await growthWithEquity(tiltEquityRet(2, SECTORS));
const gMom3 = await growthWithEquity(momEquityRet(3));
const repSpy = riskReport(gSpy, spyRets), repT3 = riskReport(gTilt3, spyRets), repT2 = riskReport(gTilt2, spyRets), repM3 = riskReport(gMom3, spyRets);
const gl = (name, rep, rets) => { out["FULL:" + name] = { total: +stats(rets).total.toFixed(1), ...rep }; console.log(`  ${name.padEnd(30)} total +${stats(rets).total.toFixed(0)}% · Sharpe ${rep.sharpe} · Sortino ${rep.sortino} · maxDD ${rep.maxDrawdown}% · α ${rep.alpha}`); };
gl("Growth · plain SPY sleeve", repSpy, gSpy);
gl("Growth · regime-tilt top-3", repT3, gTilt3);
gl("Growth · regime-tilt top-2", repT2, gTilt2);
gl("Growth · momentum-rotation top-3", repM3, gMom3);

const better = repT3.sharpe > repSpy.sharpe + 0.02 || repT2.sharpe > repSpy.sharpe + 0.02;
const verdict = better
  ? `VALIDATED — sector-tilt improves the full Growth allocator's risk-adjusted return OOS. Worth productizing (favor the top-3 / less-concentrated variant unless top-2 clearly dominates).`
  : `NOT VALIDATED — OOS, the sector-tilt does NOT improve the full Growth allocator vs a plain SPY sleeve (the leave-one-out result was leakage). Keep it as the informative panel; do not productize as a strategy.`;
console.log(`\n  VERDICT: ${verdict}`);
writeFileSync(join(OUT, "sector_tilt_validate.json"), JSON.stringify({ generatedAt: new Date().toISOString(), months: rows.length, minTrain: MIN_TRAIN, results: out, verdict: better ? "validated" : "not-validated" }, null, 2));
console.log(`  → wrote research/out/sector_tilt_validate.json\n`);
