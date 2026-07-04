// Historical macro regime as-of a date, for the backtest's by-regime breakdown.
// A lightweight classifier from a few FRED series (yield curve, HY credit spread,
// unemployment trend) — market series are daily and unrevised, so "latest obs <= t"
// is effectively point-in-time. (Full ALFRED vintages are a later refinement.)
// Produces a macroState shaped for getMacroTilt() in scoring.ts.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const FRED = process.env.FRED_KEY || "89002273b3b4289f0869a5e5318b7277";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache", "fred");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const mem = new Map();

async function fredSeries(id) {
  if (mem.has(id)) return mem.get(id);
  const path = join(DIR, id + ".json");
  let obs = null;
  if (existsSync(path)) { try { obs = JSON.parse(readFileSync(path, "utf8")); } catch { obs = null; } }
  if (!obs) {
    try {
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json`);
      const j = r.ok ? await r.json() : null;
      obs = (j?.observations ?? []).filter((o) => o.value !== ".").map((o) => ({ date: o.date, v: Number(o.value) }));
      writeFileSync(path, JSON.stringify(obs));
    } catch { obs = []; }
  }
  mem.set(id, obs);
  return obs;
}
const asOf = (obs, date) => { const on = obs.filter((o) => o.date <= date); return on.length ? on[on.length - 1] : null; };
const asOfBack = (obs, date, days) => asOf(obs, new Date(new Date(date) - days * 86400000).toISOString().slice(0, 10));

/** macroState (regime_id, credit_stress 0-100, recession_prob 0-100) as known on `date`. */
export async function regimeAsOf(date) {
  const [curve, hyoas, unrate] = await Promise.all([fredSeries("T10Y2Y"), fredSeries("BAMLH0A0HYM2"), fredSeries("UNRATE")]);
  const c = asOf(curve, date)?.v ?? null;      // 10y-2y spread (%)
  const oas = asOf(hyoas, date)?.v ?? null;     // HY OAS (%)
  const u = asOf(unrate, date)?.v ?? null;      // unemployment %
  const uPrev = asOfBack(unrate, date, 180)?.v ?? null; // ~6m ago
  const uRising = u != null && uPrev != null && u - uPrev > 0.3;

  // credit_stress 0-100 from HY OAS: ~3% calm → 0, ~10% crisis → 100
  const credit_stress = oas == null ? 50 : Math.max(0, Math.min(100, ((oas - 3) / 7) * 100));
  // recession_prob from curve inversion + rising unemployment
  let recession_prob = 30;
  if (c != null && c < 0) recession_prob += 30;
  if (uRising) recession_prob += 25;
  if (oas != null && oas > 6) recession_prob += 20;
  recession_prob = Math.max(0, Math.min(100, recession_prob));

  // Coarse regime from curve + credit (the real product uses macro.js's full engine):
  //   credit blowout → contraction · inverted curve → contraction/stagflation ·
  //   wide-but-calm credit → stagflation · steep curve + tight credit → expansion.
  let regime_id;
  if (oas != null && oas > 6) regime_id = "contraction";                 // COVID-style credit spike
  else if (c != null && c < 0) regime_id = oas != null && oas > 4.5 ? "contraction" : "stagflation"; // inverted (2022)
  else if (oas != null && oas > 5) regime_id = "stagflation";
  else if (c != null && c > 0.5 && oas != null && oas < 4 && !uRising) regime_id = "expansion";
  else regime_id = "reflation";

  return { regime_id, credit_stress, recession_prob, ic_score: null, fear_greed: null, ted_spread: null,
           _debug: { curve: c, hyoas: oas, unrate: u } };
}
