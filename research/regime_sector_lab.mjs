// ─────────────────────────────────────────────────────────────────────────────
// REGIME → SECTOR/FACTOR LAB (2026-07-11) — tests the CORE Scora thesis the user
// insists on: does the MACRO REGIME predict which SECTORS/FACTORS (baskets of stocks)
// have tailwinds? This is the honest unit of "macro predicts which stocks rise" — not
// single names (idiosyncratic, weak), but the sector/factor buckets a regime lifts.
//
// Measures, per stationary regime (expansion/reflation/stagflation/contraction/neutral):
//   (a) average forward 1-month return of each of the 11 SPDR sectors + factor ETFs,
//   (b) whether a regime-tilt strategy (hold the sectors that lead in the CURRENT regime,
//       trained on the OTHER months to avoid look-ahead) beats SPY and equal-weight,
//   (c) the same for style factors (value/growth/quality/lowvol/smallcap/momentum).
// Run: node --experimental-strip-types --no-warnings research/regime_sector_lab.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const START = process.env.BT_START || "1999-01-01";
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const SECTORS = { XLK: "Technology", XLF: "Financials", XLE: "Energy", XLV: "Health Care", XLI: "Industrials", XLP: "Staples", XLY: "Discretionary", XLB: "Materials", XLU: "Utilities" };
const FACTORS = { IWD: "Value", IWF: "Growth", QUAL: "Quality", USMV: "Low-Vol", IWM: "Small-cap", MTUM: "Momentum", SPY: "Market" };
const REGIMES = ["expansion", "reflation", "stagflation", "contraction", "neutral"];

const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -2));
console.log(`\n  REGIME → SECTOR/FACTOR LAB · ${dates.length} months ${dates[0]}→${dates.at(-1)}\n  loading regime + ETF prices…`);
await preloadStationary();

const fCache = new Map();
async function fwd1(a, d) { const k = a + d; if (!fCache.has(k)) fCache.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fCache.get(k); }

// Build the monthly panel: regime + forward return of each ETF + SPY.
const rows = [];
for (const d of dates) {
  const macro = await regimeStationaryAsOf(d);
  const spy = await fwd1("SPY", d);
  if (spy == null || !macro?.regime_id) continue;
  const secR = {}; for (const s of Object.keys(SECTORS)) secR[s] = await fwd1(s, d);
  const facR = {}; for (const f of Object.keys(FACTORS)) facR[f] = await fwd1(f, d);
  rows.push({ d, regime: macro.regime_id, spy, secR, facR });
}
console.log(`  usable months: ${rows.length}`);

// (a) Average forward EXCESS return (vs SPY) of each sector, by regime.
console.log(`\n  ── Avg forward 1m EXCESS return vs SPY, by regime (which sectors get the macro tailwind) ──`);
console.log(`  ${"regime".padEnd(13)}${"n".padStart(4)}   ` + Object.values(SECTORS).map((x) => x.slice(0, 5).padStart(6)).join(""));
const regimeSectorExcess = {};
for (const rg of REGIMES) {
  const g = rows.filter((r) => r.regime === rg);
  if (!g.length) continue;
  regimeSectorExcess[rg] = {};
  const cells = Object.keys(SECTORS).map((s) => {
    const ex = g.map((r) => (r.secR[s] != null ? r.secR[s] - r.spy : null)).filter((x) => x != null);
    const m = mean(ex); regimeSectorExcess[rg][s] = m;
    return (m == null ? "  —  " : (m >= 0 ? "+" : "") + m.toFixed(1)).padStart(6);
  });
  console.log(`  ${rg.padEnd(13)}${String(g.length).padStart(4)}   ${cells.join("")}`);
}

// (b) Regime-tilt strategy: each month, hold the top-K sectors by their TRAIN-set (all OTHER
// months) average excess return in the CURRENT regime — i.e., "which sectors historically
// lead this regime", leave-one-period-out to avoid look-ahead. Compare to SPY + equal-weight.
function regimeTilt(K) {
  const rets = [], ew = [], spyR = [];
  for (const r of rows) {
    const train = rows.filter((x) => x.regime === r.regime && x.d !== r.d);
    const ranked = Object.keys(SECTORS).map((s) => {
      const ex = train.map((t) => (t.secR[s] != null ? t.secR[s] - t.spy : null)).filter((x) => x != null);
      return [s, mean(ex) ?? -99];
    }).sort((a, b) => b[1] - a[1]).slice(0, K).map((x) => x[0]);
    const held = ranked.map((s) => r.secR[s]).filter((x) => x != null);
    if (held.length) { rets.push(mean(held)); spyR.push(r.spy); const allSec = Object.keys(SECTORS).map((s) => r.secR[s]).filter((x) => x != null); ew.push(mean(allSec)); }
  }
  const ann = (a) => { let e = 1; for (const x of a) e *= 1 + x / 100; const yrs = a.length / 12; return { cagr: (Math.pow(e, 1 / yrs) - 1) * 100, sharpe: std(a) ? mean(a) / std(a) * Math.sqrt(12) : 0, total: (e - 1) * 100 }; };
  return { tilt: ann(rets), spy: ann(spyR), ew: ann(ew), n: rets.length };
}
console.log(`\n  ── Regime-sector tilt (hold top-K sectors that lead the current regime, leave-one-out) ──`);
for (const K of [2, 3, 4]) {
  const r = regimeTilt(K);
  console.log(`  top-${K}: tilt ${r.tilt.cagr.toFixed(1)}%/yr Sharpe ${r.tilt.sharpe.toFixed(2)} (+${r.tilt.total.toFixed(0)}%)  vs  SPY ${r.spy.cagr.toFixed(1)}%/${r.spy.sharpe.toFixed(2)} (+${r.spy.total.toFixed(0)}%)  vs  EW-sectors ${r.ew.cagr.toFixed(1)}%/${r.ew.sharpe.toFixed(2)}`);
}

// (c) Style factors by regime (shorter history; ETFs from ~2013).
console.log(`\n  ── Avg forward 1m EXCESS return vs SPY, by regime · STYLE FACTORS (ETFs ~2013+) ──`);
console.log(`  ${"regime".padEnd(13)}${"n".padStart(4)}   ` + Object.values(FACTORS).filter((x) => x !== "Market").map((x) => x.slice(0, 6).padStart(8)).join(""));
const regimeFactorExcess = {};
for (const rg of REGIMES) {
  const g = rows.filter((r) => r.regime === rg && r.facR.SPY != null);
  regimeFactorExcess[rg] = {};
  const cells = Object.keys(FACTORS).filter((f) => f !== "SPY").map((f) => {
    const ex = g.map((r) => (r.facR[f] != null ? r.facR[f] - r.spy : null)).filter((x) => x != null);
    const m = mean(ex); regimeFactorExcess[rg][f] = m;
    return (m == null ? "   —  " : (m >= 0 ? "+" : "") + m.toFixed(2)).padStart(8);
  });
  const n = g.filter((r) => r.facR.IWD != null).length;
  console.log(`  ${rg.padEnd(13)}${String(n).padStart(4)}   ${cells.join("")}`);
}

writeFileSync(join(OUT, "regime_sector_lab.json"), JSON.stringify({ generatedAt: new Date().toISOString(), months: rows.length, regimeSectorExcess, regimeFactorExcess, tilt: { top2: regimeTilt(2), top3: regimeTilt(3) } }, null, 2));
console.log(`\n  → wrote research/out/regime_sector_lab.json\n`);
