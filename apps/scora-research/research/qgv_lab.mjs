// ─────────────────────────────────────────────────────────────────────────────
// QGV LAB (2026-07-13) — the honest test of the Silverway thesis: VALUE alone is a value
// trap (our own backtest: value/quality micro +127.6% vs SPY +154.2%, IC 0.007). The claim
// is that VALUE + QUALITY + GROWTH, with a STRICT gate (fail one pillar → discard) and
// CONCENTRATION (hold only the top handful), beats the index where value alone doesn't.
// We replicate it point-in-time, survivorship-controlled, on free EDGAR fundamentals:
//   VALUE   = earnings yield, FCF yield, EBIT/EV (cheap)
//   QUALITY = gross profitability (Novy-Marx GP/assets), ROIC, operating margin, FCF
//             conversion, low leverage (the moat/predictability proxies)
//   GROWTH  = revenue growth, earnings growth
// Each pillar = cross-sectional percentile of its components. We compare, honestly:
//   SPY · current Scora score≥60 · QGV blend (weighted) · QGV STRICT-GATE (the thesis) ·
//   each pillar alone — to see what actually pays. Measure before we believe the marketing.
//   node --experimental-strip-types --no-warnings research/qgv_lab.mjs --full 350
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, fwdReturn, momentum, hasPriceAt } from "./prices.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";

const COST_BPS = 10;                 // per side
const N_HOLD = Number(process.env.N_HOLD || 25);   // concentration
const GATE = Number(process.env.GATE || 0.6);      // strict-gate percentile threshold (all 3)
const START = process.env.BT_START || "2016-01-01";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function rank(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j; } return r; }
function spearman(x, y) { if (x.length < 5) return null; const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : null; }

const today = new Date().toISOString().slice(0, 10);
const END = process.env.BT_END || addMonths(today, -1);
const dates = monthStarts(START, END);
const FULL = process.argv.includes("--full");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 350);
let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
  }
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);
console.log(`\n  QGV LAB · ${UNIVERSE.length} names · ${dates.length} months ${dates[0]}→${dates.at(-1)} · N=${N_HOLD} · gate=${GATE}\n  loading panel…`);

const meta = {};
for (const t of UNIVERSE) { const cik = await tickerToCik(t); meta[t] = { cik, sector: cik ? await sicSector(cik) : "" }; }
const spyFwd = new Map();
async function spy1(d) { if (!spyFwd.has(d)) spyFwd.set(d, await fwdReturn("SPY", d, addMonths(d, 1))); return spyFwd.get(d); }

// ── build panel: per name-month, the raw pillar components + score + forward returns ──
const byDate = new Map();
for (const d of dates) {
  await spy1(d);
  const bucket = [];
  for (const t of UNIVERSE) {
    if (!isMember(t, d)) continue;
    const { cik, sector } = meta[t];
    if (!cik || !(await hasPriceAt(t, d))) continue;
    const f = await fundamentalsAsOf(cik, d);
    const raw = await rawPriceAsOf(t, d);
    if (!f || f.revTTM == null || raw == null || !f.shares) continue;
    const mcap = raw * f.shares;
    const ev = mcap + (f.debt ?? 0) - (f.cash ?? 0);
    const fcf = f.ocfTTM != null && f.capexTTM != null ? f.ocfTTM - f.capexTTM : null;
    const ebitda = f.oiTTM != null && f.daTTM != null ? f.oiTTM + f.daTTM : null;
    const inv = (f.equity ?? 0) + (f.debt ?? 0);
    const mom = await momentum(t, d);
    const { ic } = scoreStock(f, raw, mom, sector, null);
    const fwd1 = await fwdReturn(t, d, addMonths(d, 1));
    const fwd3 = await fwdReturn(t, d, addMonths(d, 3));
    if (fwd1 == null) continue;
    bucket.push({
      t, sector, fwd1, fwd3, ic,
      // VALUE (higher = cheaper)
      ey: f.niTTM != null && mcap > 0 ? f.niTTM / mcap : null,
      fy: fcf != null && mcap > 0 ? fcf / mcap : null,
      ee: f.oiTTM != null && ev > 0 ? f.oiTTM / ev : null,
      // QUALITY (higher = better)
      gprof: f.gpTTM != null && f.assets > 0 ? f.gpTTM / f.assets : null,     // Novy-Marx
      roic: inv > 0 && f.oiTTM != null ? (f.oiTTM * 0.79) / inv : null,
      opm: f.revTTM > 0 && f.oiTTM != null ? f.oiTTM / f.revTTM : null,
      fcfconv: fcf != null && f.oiTTM > 0 ? fcf / f.oiTTM : null,
      lev: ebitda > 0 ? -((f.debt ?? 0) - (f.cash ?? 0)) / ebitda : null,     // less levered = higher
      // GROWTH (higher = better)
      revg: f.revPrevTTM > 0 ? f.revTTM / f.revPrevTTM - 1 : null,
      epsg: f.niPrevTTM > 0 && f.niTTM != null ? f.niTTM / f.niPrevTTM - 1 : null,
    });
  }
  byDate.set(d, bucket);
}
const nm = [...byDate.values()].reduce((s, b) => s + b.length, 0);
console.log(`  built ${nm} name-months (avg ${(nm / dates.length).toFixed(0)}/mo)\n`);

// Cross-sectional percentile of one component across a month's rows (average-rank, 0..1).
function pct(rows, key) {
  const v = rows.map((r) => [r.t, r[key]]).filter(([, x]) => x != null && isFinite(x));
  const m = new Map(); const n = v.length; if (n < 5) return m;
  v.sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < n;) { let j = i; while (j < n && v[j][1] === v[i][1]) j++; const p = ((i + j - 1) / 2) / (n - 1); for (let k = i; k < j; k++) m.set(v[k][0], p); i = j; }
  return m;
}
// Pillar percentile = mean of its component percentiles present for that name.
function pillar(rows, keys) {
  const maps = keys.map((k) => pct(rows, k));
  const out = new Map();
  for (const r of rows) { let s = 0, c = 0; for (const mp of maps) { const p = mp.get(r.t); if (p != null) { s += p; c++; } } if (c) out.set(r.t, s / c); }
  return out;
}

// Per-date selections + composite for IC.
const sel = new Map();   // date -> { composite:Map, V, Q, G, gate:Set }
const icPairs = [];      // {composite, fwd3} for IC across the panel
let passCounts = [], emptyMonths = 0;
for (const d of dates) {
  const rows = byDate.get(d) || [];
  const V = pillar(rows, ["ey", "fy", "ee"]);
  const Q = pillar(rows, ["gprof", "roic", "opm", "fcfconv", "lev"]);
  const G = pillar(rows, ["revg", "epsg"]);
  const composite = new Map();
  for (const r of rows) { const v = V.get(r.t), q = Q.get(r.t), g = G.get(r.t); if (v != null && q != null && g != null) composite.set(r.t, (v + q + g) / 3); }
  const gate = new Set([...composite.keys()].filter((t) => V.get(t) >= GATE && Q.get(t) >= GATE && G.get(t) >= GATE));
  // GARP = Quality + Growth, value gate RELAXED (the 2016-26 window showed the value gate hurt).
  const garp = new Map();
  for (const r of rows) { const q = Q.get(r.t), g = G.get(r.t); if (q != null && g != null) garp.set(r.t, (q + g) / 2); }
  const garpGate = new Set([...garp.keys()].filter((t) => Q.get(t) >= GATE && G.get(t) >= GATE));
  sel.set(d, { composite, V, Q, G, gate, garp, garpGate });
  passCounts.push(gate.size); if (gate.size === 0) emptyMonths++;
  for (const r of rows) { const c = composite.get(r.t); if (c != null && r.fwd3 != null) icPairs.push([c, r.fwd3, d]); }
}

// Equity curve for a per-date selector (returns array of held tickers; [] = cash).
function curve(selector) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const d of dates) {
    const held = selector(d);
    const rowMap = new Map((byDate.get(d) || []).map((r) => [r.t, r]));
    const rs = held.map((t) => rowMap.get(t)?.fwd1).filter((x) => x != null);
    const r = held.length && rs.length ? mean(rs) : 0; // empty → cash
    const set = new Set(held); let ch = 0; for (const t of set) if (!prev.has(t)) ch++;
    const turn = set.size ? ch / set.size : 0;
    const net = r - turn * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = set;
  }
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / rets.length) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(12) : 0, maxDD: mdd * 100, rets };
}
const topBy = (d, mapKey, n) => { const s = sel.get(d); return [...s[mapKey].entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]); };
const topGated = (d, n) => { const s = sel.get(d); return [...s.gate].map((t) => [t, s.composite.get(t)]).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]); };
const topGarpGated = (d, n) => { const s = sel.get(d); return [...s.garpGate].map((t) => [t, s.garp.get(t)]).sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]); };

const spyRets = dates.map((d) => spyFwd.get(d)).filter((x) => x != null);
const spyStat = (() => { let eq = 1, peak = 1, mdd = 0; for (const r of spyRets) { eq *= 1 + r / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); } return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 12 / spyRets.length) - 1) * 100, sharpe: std(spyRets) ? mean(spyRets) / std(spyRets) * Math.sqrt(12) : 0, maxDD: mdd * 100 }; })();

const strategies = {
  "SPY buy & hold": null,
  "Current Scora score≥60": (d) => (byDate.get(d) || []).filter((r) => r.ic >= 60).map((r) => r.t),
  "QGV blend · top-N (no gate)": (d) => topBy(d, "composite", N_HOLD),
  "QGV STRICT-GATE · top-N": (d) => topGated(d, N_HOLD),
  "GARP blend · top-N (Q+G)": (d) => topBy(d, "garp", N_HOLD),
  "GARP gate · top-N (Q&G)": (d) => topGarpGated(d, N_HOLD),
  "Value pillar · top-N": (d) => topBy(d, "V", N_HOLD),
  "Quality pillar · top-N": (d) => topBy(d, "Q", N_HOLD),
  "Growth pillar · top-N": (d) => topBy(d, "G", N_HOLD),
};

const out = { generatedAt: new Date().toISOString(), universe: UNIVERSE.length, months: dates.length, nameMonths: nm, window: { start: START }, N_HOLD, GATE, gateAvgPass: +mean(passCounts).toFixed(1), gateEmptyMonths: emptyMonths, results: {} };
console.log(`  gate (all 3 ≥ ${GATE}): avg ${mean(passCounts).toFixed(0)} names/mo pass · ${emptyMonths} empty month(s)\n`);
console.log(`  ${"strategy".padEnd(30)}${"total".padStart(9)}${"CAGR".padStart(7)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}${"vs SPY".padStart(9)}`);
const line = (name, st) => { out.results[name] = { total: +st.total.toFixed(1), cagr: +st.cagr.toFixed(2), sharpe: +st.sharpe.toFixed(2), maxDD: +st.maxDD.toFixed(1) }; console.log(`  ${name.padEnd(30)}${("+" + st.total.toFixed(0) + "%").padStart(9)}${(st.cagr.toFixed(1) + "%").padStart(7)}${st.sharpe.toFixed(2).padStart(8)}${(st.maxDD.toFixed(1) + "%").padStart(8)}${((st.total - spyStat.total >= 0 ? "+" : "") + (st.total - spyStat.total).toFixed(0) + "pp").padStart(9)}`); };
line("SPY buy & hold", spyStat);
for (const [name, selector] of Object.entries(strategies)) { if (!selector) continue; line(name, curve(selector)); }

// IC of the QGV composite vs 3M forward (cross-sectional Spearman, avg over months).
const icByDate = [];
for (const d of dates) { const g = icPairs.filter((p) => p[2] === d); if (g.length >= 8) { const s = spearman(g.map((p) => p[0]), g.map((p) => p[1])); if (s != null) icByDate.push(s); } }
out.compositeIC = +mean(icByDate).toFixed(4);
console.log(`\n  QGV composite IC (Spearman ↔ 3M fwd): ${out.compositeIC >= 0 ? "+" : ""}${out.compositeIC}  (vs current value/quality score IC ~0.007-0.015)`);

const gated = out.results["QGV STRICT-GATE · top-N"];
out.verdict = gated && gated.total > spyStat.total
  ? `BEATS INDEX — QGV strict-gate top-${N_HOLD} returned +${gated.total.toFixed(0)}% vs SPY +${spyStat.total.toFixed(0)}% (${(gated.total - spyStat.total).toFixed(0)}pp), Sharpe ${gated.sharpe} vs ${spyStat.sharpe.toFixed(2)}. The Value+Quality+Growth gate + concentration adds selection alpha where value alone did not.`
  : `does NOT beat index on total return — QGV strict-gate ${gated ? "+" + gated.total.toFixed(0) + "%" : "n/a"} vs SPY +${spyStat.total.toFixed(0)}%. Check the risk-adjusted + which pillar carried it.`;
console.log(`\n  VERDICT: ${out.verdict}`);
const fname = process.env.BT_START || process.env.BT_END ? `qgv_lab_${START}_${END}.json` : "qgv_lab.json";
writeFileSync(join(OUT, fname), JSON.stringify(out, null, 2));
console.log(`  → wrote research/out/${fname}\n`);
