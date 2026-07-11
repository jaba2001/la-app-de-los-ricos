// ─────────────────────────────────────────────────────────────────────────────
// REGIME → FACTOR ROTATION VALIDATION (2026-07-11) — before folding a regime→factor
// tilt into the score (getMacroTilt), validate the SIGNAL over a long window: does a
// regime-driven growth/value rotation beat holding either style statically and the S&P?
// Uses IWF (growth) / IWD (value) — Russell 1000 style ETFs with history back to 2000,
// so this spans the dot-com bust, GFC, and the 2010s growth regime. Monthly, net 10bp/side.
//
// Rule (from the MEASURED regime→factor rotation, research/regime_sector_lab.mjs):
//   growth-favored regimes (expansion, reflation, stagflation) → hold IWF
//   value-favored  regimes (contraction, neutral)              → hold IWD
// vs: SPY, static 50/50, always-growth (IWF), always-value (IWD).
// Run: node --experimental-strip-types --no-warnings research/regime_factor_validate.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn } from "./prices.mjs";
import { regimeStationaryAsOf, preloadStationary } from "./regimeStationary.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const COST_BPS = 10;
const START = process.env.BT_START || "2000-06-01";
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const GROWTH_REGIMES = new Set(["expansion", "reflation", "stagflation"]);
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -2));
console.log(`\n  REGIME → FACTOR ROTATION · ${dates.length} months ${dates[0]}→${dates.at(-1)} · IWF(growth)/IWD(value)`);
await preloadStationary();
const fc = new Map();
async function fwd1(a, d) { const k = a + d; if (!fc.has(k)) fc.set(k, await fwdReturn(a, d, addMonths(d, 1))); return fc.get(k); }

async function run(step) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = null;
  for (const d of dates) {
    const macro = await regimeStationaryAsOf(d);
    const pick = step(macro?.regime_id);           // "IWF" | "IWD" | {IWF:.5,IWD:.5}
    let r;
    if (typeof pick === "string") r = await fwd1(pick, d);
    else { r = 0; let w = 0; for (const [a, wa] of Object.entries(pick)) { const x = await fwd1(a, d); if (x != null) { r += wa * x; w += wa; } } if (w === 0) r = null; }
    if (r == null) continue;
    const turn = prev == null ? 1 : (typeof pick === "string" && typeof prev === "string" ? (pick === prev ? 0 : 1) : 0.5);
    const net = r - turn * COST_BPS / 100;
    eq *= 1 + net / 100; rets.push(net); prev = pick;
    peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
  }
  const yrs = dates.length / 12;
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 1 / yrs) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100 };
}

const rotation = (rg) => (rg && GROWTH_REGIMES.has(rg) ? "IWF" : "IWD");
const strategies = {
  "Regime rotation (G/V)": rotation,
  "SPY": () => "SPY",
  "Static 50/50": () => ({ IWF: 0.5, IWD: 0.5 }),
  "Always growth (IWF)": () => "IWF",
  "Always value (IWD)": () => "IWD",
};
const results = {};
console.log(`\n  ${"strategy".padEnd(24)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}`);
for (const [name, step] of Object.entries(strategies)) {
  const r = await run(step); results[name] = r;
  console.log(`  ${name.padEnd(24)}${("+" + r.total.toFixed(0) + "%").padStart(9)}${(r.cagr.toFixed(1) + "%").padStart(7)}${r.sharpe.toFixed(2).padStart(8)}${(r.maxDD.toFixed(1) + "%").padStart(8)}`);
}
const rot = results["Regime rotation (G/V)"], sp = results["SPY"], st = results["Static 50/50"];
const beats = rot.sharpe > sp.sharpe && rot.sharpe > st.sharpe;
console.log(`\n  VERDICT: ${beats ? "VALIDATED" : "WEAK"} — regime G/V rotation Sharpe ${rot.sharpe.toFixed(2)} vs SPY ${sp.sharpe.toFixed(2)} / static ${st.sharpe.toFixed(2)}. ${beats ? "Fold the regime→factor tilt into the score." : "Keep as context only."}`);
writeFileSync(join(OUT, "regime_factor_validate.json"), JSON.stringify({ generatedAt: new Date().toISOString(), months: dates.length, results, verdict: beats ? "validated" : "weak" }, null, 2));
console.log(`  → wrote research/out/regime_factor_validate.json\n`);
