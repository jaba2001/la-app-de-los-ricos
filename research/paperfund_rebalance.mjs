// ─────────────────────────────────────────────────────────────────────────────
// PAPER FUND · monthly rebalance (Phase 8). The autonomous, living proof of the model:
// each month it computes the SAME validated allocation the app shows — liquidity-led
// risk-on tilt (blendWeights) + Antonacci absolute momentum (applyDualMomentum) — and
// seals an immutable target-weight snapshot to sl_paper_fund. No discretion, no hindsight.
// Reuses research/allocate.mjs (the shared allocator) + prices.mjs (12-1m momentum).
// Run: SUPABASE_SERVICE_KEY=… node --experimental-strip-types --no-warnings research/paperfund_rebalance.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ASSETS, growthWeights, applyDualMomentum } from "./allocate.mjs";
import { fwdReturn } from "./prices.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// 1) current risk-on from the live macro_state row (the same field the app reads).
async function fetchRiskOn() {
  if (!SB_KEY) return null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/macro_state?id=eq.1&select=risk_on`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const j = await r.json();
    const v = Array.isArray(j) ? Number(j[0]?.risk_on) : NaN;
    return isNaN(v) ? null : v;
  } catch { return null; }
}

const riskOn = (process.env.RISK_ON != null ? Number(process.env.RISK_ON) : await fetchRiskOn()) ?? 50;
console.log(`\n  PAPER FUND rebalance · ${today} · risk-on ${riskOn.toFixed(1)}`);

// 2) GROWTH mandate (2026-07-10 lab, user-approved): regime switch — 100% equities when
// risk-on (≥50), defensive basket otherwise — then 3) the 12-1m momentum gate. No
// risk-parity (defensive-mandate feature; it dilutes the return engine). The fund's
// mandate change is disclosed in the rebalance note, like any fund would.
const base = growthWeights(riskOn);
const mom = {};
for (const a of ASSETS) {
  try { mom[a] = await fwdReturn(a, addMonths(today, -12), addMonths(today, -1)); } catch { mom[a] = null; }
}
const gated = applyDualMomentum(base, mom).weights;
const movedToCash = applyDualMomentum(base, mom).movedToCash;
// round + renormalize for a clean snapshot
let sum = 0; for (const a of ASSETS) sum += gated[a];
const w = {}; for (const a of ASSETS) w[a] = +(gated[a] / (sum || 1)).toFixed(4);

console.log("  target weights:", Object.entries(w).map(([a, v]) => `${a} ${(v * 100).toFixed(0)}%`).join("  "));
console.log("  moved to cash:", movedToCash.length ? movedToCash.join(", ") : "none");

const row = { rebalance_date: today, weights: w, risk_on: +riskOn.toFixed(1), moved_to_cash: movedToCash, note: `GROWTH mandate (adopted 2026-07-10): risk-on ${riskOn.toFixed(0)} → ${riskOn >= 50 ? "100% equities" : "defensive basket"}; momentum gate → ${movedToCash.length ? movedToCash.join("/") + " to cash" : "all sleeves kept"}` };
writeFileSync(join(OUT, "paperfund_rebalance.json"), JSON.stringify(row, null, 2));
console.log(`  → wrote research/out/paperfund_rebalance.json`);

if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_paper_fund?on_conflict=rebalance_date`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed sl_paper_fund from the JSON)");
}
