// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 validation — is the stationary risk-on gauge a LEADING signal for equities,
// and does its TRAJECTORY (rising vs falling) add early-warning value ("adelantarse")?
// For each month 2007-2026 we take risk_on as-of (regimeStationary) and its 3-month
// change, then measure forward SPY total return. If forward returns are clearly higher
// when risk_on is high AND rising, the gauge earns its place as a timing/early-warning
// signal — the honest test before we surface it as a "Regime Radar".
// Run: PX_FROM=2006-01-01 node --experimental-strip-types research/riskon_signal.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { fwdReturn } from "./prices.mjs";
import { preloadStationary, riskOnAsOf } from "./regimeStationary.mjs";

const START = "2007-07-01";
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const pct = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

await preloadStationary();
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -4)); // need ≥3M forward

const rows = [];
for (const d of dates) {
  const ro = riskOnAsOf(d);
  const roPrev = riskOnAsOf(addMonths(d, -3));
  const fwd1 = await fwdReturn("SPY", d, addMonths(d, 1));
  const fwd3 = await fwdReturn("SPY", d, addMonths(d, 3));
  if (ro == null || fwd3 == null) continue;
  rows.push({ d, ro, traj: roPrev != null ? ro - roPrev : 0, fwd1, fwd3 });
}
console.log(`\n  PHASE 3 · risk-on as a leading signal · ${rows.length} months ${rows[0].d}→${rows.at(-1).d}\n`);

// (1) forward SPY return by risk-on LEVEL tercile
console.log("  ── forward SPY return by risk-on LEVEL (tercile) ──");
const byLevel = [...rows].sort((a, b) => a.ro - b.ro);
const t = Math.floor(byLevel.length / 3);
const groups = [["LOW  risk-on", byLevel.slice(0, t)], ["MID  risk-on", byLevel.slice(t, byLevel.length - t)], ["HIGH risk-on", byLevel.slice(byLevel.length - t)]];
console.log("  bucket          n    avgRiskOn    fwd1M    fwd3M    3M hit    3M Sharpe(ann)");
for (const [lbl, g] of groups) {
  const f3 = g.map((r) => r.fwd3), f1 = g.map((r) => r.fwd1).filter((x) => x != null);
  const hit = g.filter((r) => r.fwd3 > 0).length / g.length * 100;
  const sh = std(f3) ? mean(f3) / std(f3) * Math.sqrt(4) : null; // 3M periods → √4/yr
  console.log(`  ${lbl}  ${String(g.length).padStart(3)}    ${mean(g.map(r=>r.ro)).toFixed(0).padStart(5)}     ${pct(mean(f1)).padStart(6)}%  ${pct(mean(f3)).padStart(6)}%   ${hit.toFixed(0)}%      ${sh != null ? sh.toFixed(2) : "—"}`);
}

// (2) forward SPY return by TRAJECTORY (rising vs falling risk-on) — the early-warning test
console.log("\n  ── forward SPY return by risk-on TRAJECTORY (3m change) ──");
const rising = rows.filter((r) => r.traj > 2), falling = rows.filter((r) => r.traj < -2), flat = rows.filter((r) => Math.abs(r.traj) <= 2);
for (const [lbl, g] of [["RISING (>+2)", rising], ["FLAT", flat], ["FALLING (<−2)", falling]]) {
  if (!g.length) continue;
  const f3 = g.map((r) => r.fwd3);
  const hit = g.filter((r) => r.fwd3 > 0).length / g.length * 100;
  console.log(`  ${lbl.padEnd(14)} n=${String(g.length).padStart(3)}   fwd3M ${pct(mean(f3)).padStart(6)}%   3M hit ${hit.toFixed(0)}%`);
}

// (3) the actionable 2×2: level × trajectory
console.log("\n  ── fwd 3M SPY: risk-on LEVEL × TRAJECTORY ──");
const hiLo = (r) => r.ro >= 50 ? "high" : "low";
const upDn = (r) => r.traj >= 0 ? "rising" : "falling";
for (const lv of ["high", "low"]) for (const tr of ["rising", "falling"]) {
  const g = rows.filter((r) => hiLo(r) === lv && upDn(r) === tr);
  if (g.length) console.log(`  risk-on ${lv.padEnd(4)} & ${tr.padEnd(7)}  n=${String(g.length).padStart(3)}   fwd3M ${pct(mean(g.map(r=>r.fwd3))).padStart(6)}%`);
}

const loRet = mean(groups[0][1].map(r=>r.fwd3)), hiRet = mean(groups[2][1].map(r=>r.fwd3));
console.log(`\n  Verdict: ${hiRet > loRet + 1 ? `LEADING — high risk-on fwd3M ${pct(hiRet)}% vs low ${pct(loRet)}% (${pct(hiRet-loRet)}pp spread). The gauge times equity risk.` : `weak level spread (${pct(hiRet-loRet)}pp) — trajectory may still help.`}\n`);
