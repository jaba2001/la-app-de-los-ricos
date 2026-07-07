// ─────────────────────────────────────────────────────────────────────────────
// STATIONARY regime for historical backtests + recalibration (Phase 1). The production
// regime is reliable NOW but not over history: its composites map raw LEVELS through
// absolute thresholds calibrated to ~2020-26 (verified: LCC≈43-46 through QE1-QE3).
//
// This module stationarizes ALL THREE regime drivers onto ONE comparable percentile
// scale (0-100, rank vs a trailing window), so thresholds mean the same thing across
// decades and across composites:
//   • LCC_stat  — liquidity IMPULSE: 6-month change in net liquidity (WALCL−WTREGEN−RRP),
//                 percentile-ranked. High = liquidity expanding = risk-on.
//   • RPC_stat  — recession risk: blend of the inverted yield curve (−T10Y3M) and the
//                 Sahm rule (SAHMREALTIME), each percentile-ranked. High = recession risk.
//   • CSC_stat  — financial stress: STLFSI4 (St Louis Fed Financial Stress Index, 1993+,
//                 designed stationary), percentile-ranked. High = stress. (Replaces the
//                 HY-OAS composite, which FRED only serves from 2023 on this endpoint.)
//
// Two consumers:
//   • regimeStationaryAsOf() — a RECALIBRATED discrete regime (risk-on as the default,
//     defense only on genuinely elevated recession/stress), for the classic 5-regime path.
//   • riskOnAsOf() — a CONTINUOUS 0-100 risk-on gauge (liquidity-led), for a smooth tilt
//     that avoids brittle thresholds. This is the overlay's fairest test.
// If either validates over 19 years, port the stationarity into production.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { preloadRegimeSeries } from "./regimeReal.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "fredfull");
const LOOKBACK = 60;      // trailing months for percentile rank (5y)
const IMPULSE = 6;        // net-liquidity change horizon (months)
const GRID_START = "2003-01-01";

const loadObs = (id) => { const p = join(DIR, id + ".json"); if (!existsSync(p)) return []; try { return JSON.parse(readFileSync(p, "utf8")); } catch { return []; } };
const asOf = (obs, date) => { let i = -1; for (let lo = 0, hi = obs.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (obs[m].date <= date) { i = m; lo = m + 1; } else hi = m - 1; } return i < 0 ? null : obs[i].v; };
const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

let GRID = [];               // monthly date grid
const S = {};                // id → array of values aligned to GRID (null where missing)

function buildMonthly(id) {
  const obs = loadObs(id);
  return GRID.map((d) => asOf(obs, d));
}

/** Preload FRED series + build all monthly stationary inputs. Call once. */
export async function preloadStationary() {
  await preloadRegimeSeries();
  const walcl = loadObs("WALCL");
  const end = walcl.length ? walcl.at(-1).date : new Date().toISOString().slice(0, 10);
  GRID = []; for (let d = GRID_START; d <= end; d = addMonths(d, 1)) GRID.push(d);
  const walclA = buildMonthly("WALCL"), wtA = buildMonthly("WTREGEN"), rrA = buildMonthly("RRPONTSYD");
  // net liquidity in $T
  S.netliq = GRID.map((_, i) => walclA[i] == null ? null : (walclA[i] - (wtA[i] ?? 0)) / 1e6 - (rrA[i] ?? 0) / 1000);
  // liquidity impulse = 6m change
  S.liqImpulse = GRID.map((_, i) => (i >= IMPULSE && S.netliq[i] != null && S.netliq[i - IMPULSE] != null) ? S.netliq[i] - S.netliq[i - IMPULSE] : null);
  S.negCurve = buildMonthly("T10Y3M").map((v) => (v == null ? null : -v)); // inverted curve → recession
  S.sahm = buildMonthly("SAHMREALTIME");
  S.stlfsi = buildMonthly("STLFSI4");
}

const idxAsOf = (date) => { let i = -1; for (let lo = 0, hi = GRID.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (GRID[m] <= date) { i = m; lo = m + 1; } else hi = m - 1; } return i; };

// percentile rank (0-100) of series[i] vs the trailing LOOKBACK window (PIT)
function pctile(arr, i) {
  if (i < 0 || arr[i] == null) return null;
  const cur = arr[i]; const hist = [];
  for (let j = Math.max(0, i - LOOKBACK); j <= i; j++) if (arr[j] != null) hist.push(arr[j]);
  if (hist.length < 12) return null;
  return (hist.filter((x) => x <= cur).length / hist.length) * 100;
}

/** The three stationarized composites (0-100) + a continuous risk-on gauge, as-of date. */
export function compositesAsOf(date) {
  const i = idxAsOf(date);
  const lcc = pctile(S.liqImpulse, i) ?? 50;
  const rpcCurve = pctile(S.negCurve, i), rpcSahm = pctile(S.sahm, i);
  const rpc = rpcCurve != null && rpcSahm != null ? 0.5 * rpcCurve + 0.5 * rpcSahm : (rpcCurve ?? rpcSahm ?? 50);
  const csc = pctile(S.stlfsi, i) ?? 50;
  // liquidity-led risk-on: liquidity up is good, recession/stress are bad
  const riskOn = Math.max(0, Math.min(100, 0.5 * lcc + 0.25 * (100 - rpc) + 0.25 * (100 - csc)));
  return { lcc, rpc, csc, riskOn };
}

/** Continuous 0-100 risk-on gauge (higher = more risk-on). */
export function riskOnAsOf(date) { return compositesAsOf(date).riskOn; }

// Recalibrated discrete regime: risk-on is the DEFAULT; defense triggers only on
// genuinely elevated recession (RPC>65) or stress (CSC>70). Thresholds are percentile
// levels (top-third-ish), not hand-fit to returns.
function classifyRecal(lcc, rpc, csc) {
  if (rpc > 65) return lcc > 50 ? "reflation" : "stagflation"; // recession risk high
  if (csc > 70) return "contraction";                          // financial stress high
  if (lcc > 45) return "expansion";                            // liquidity supportive → risk-on
  if (lcc < 30) return "contraction";                          // liquidity clearly contracting
  return "neutral";
}

/** macroState as-of with recalibrated discrete regime + risk_on, all stationary. */
export async function regimeStationaryAsOf(date) {
  const c = compositesAsOf(date);
  return {
    regime_id: classifyRecal(c.lcc, c.rpc, c.csc),
    risk_on: parseFloat(c.riskOn.toFixed(1)),
    liquidity_cycle: parseFloat(c.lcc.toFixed(1)),
    recession_prob: parseFloat(c.rpc.toFixed(1)),
    credit_stress: parseFloat(c.csc.toFixed(1)),
    geopolitical_risk: null, housing_stress: null, ic_score: null, fear_greed: null, ted_spread: null,
  };
}
