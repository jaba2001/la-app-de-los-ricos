// REAL macro regime as-of, for the backtest — reuses the PRODUCTION regime engine
// (computeCompositeScores + classifyRegime from ic-proxy/lib/macro.js), so the
// backtest sees the exact same LCC/CSC/RPC/GRC/HSC composites and regime the live
// app computes. We only rebuild the `ds` input historically: for each MACRO_SERIES
// we fetch its full FRED history once (cached) and, for a given date, take the two
// most-recent observations on-or-before it — mirroring the production fetchFredObs
// (latest + prior) exactly. Market/weekly series are unrevised → this is point-in-
// time; monthly series use their latest print (ALFRED vintages are a refinement).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { computeCompositeScores, classifyRegime, MACRO_SERIES, FRED_UNIT_CONVERSIONS } from "../../ic-proxy/lib/macro.js";

const FRED = process.env.FRED_KEY || "89002273b3b4289f0869a5e5318b7277";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "fredfull");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const YOY = new Set(["CSUSHPINSA"]); // → units=pc1 (matches macro.js YOY_SERIES)
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function history(id) {
  if (mem.has(id)) return mem.get(id);
  const path = join(DIR, id + ".json");
  let obs = null;
  if (existsSync(path)) { try { obs = JSON.parse(readFileSync(path, "utf8")); } catch { obs = null; } }
  if (!obs) {
    await sleep(120);
    const u = YOY.has(id) ? "&units=pc1" : "";
    try {
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json${u}`);
      const j = r.ok ? await r.json() : null;
      obs = (j?.observations ?? []).filter((o) => o.value !== "." && o.value !== "").map((o) => ({ date: o.date, v: parseFloat(o.value) }));
    } catch { obs = []; }
    if (obs.length) writeFileSync(path, JSON.stringify(obs));
  }
  mem.set(id, obs);
  return obs;
}

/** Preload all regime series once (call before a batch). */
export async function preloadRegimeSeries() { for (const id of MACRO_SERIES) await history(id); }

// two most-recent obs on-or-before date (latest, prior) — mirrors fetchFredObs desc[0],[1]
function twoAsOf(obs, date) {
  let i = -1; for (let lo = 0, hi = obs.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (obs[m].date <= date) { i = m; lo = m + 1; } else hi = m - 1; }
  return i < 0 ? [null, null] : [obs[i], i > 0 ? obs[i - 1] : null];
}

async function dsAsOf(date) {
  const ds = {};
  for (const id of MACRO_SERIES) {
    const [cur, prev] = twoAsOf(await history(id), date);
    if (!cur) continue;
    const f = FRED_UNIT_CONVERSIONS[id] ?? 1;
    const v = cur.v * f, pv = prev ? prev.v * f : null;
    ds[id] = { value: v, prevValue: pv, change: pv != null ? v - pv : null, changePct: pv ? ((v - pv) / pv) * 100 : null, date: cur.date, status: "LIVE" };
  }
  return ds;
}

/** macroState (regime_id + composites) as known on `date`, via the production engine. */
export async function regimeAsOf(date) {
  const s = computeCompositeScores(await dsAsOf(date));
  const reg = classifyRegime(s.liquidityCycle, s.recessionProbability, s.creditStress);
  return {
    regime_id: reg.id,
    liquidity_cycle: s.liquidityCycle,
    credit_stress: s.creditStress,
    recession_prob: s.recessionProbability,
    geopolitical_risk: s.geopoliticalRisk,
    housing_stress: s.housingStress,
    ic_score: null, fear_greed: null, ted_spread: null,
  };
}
