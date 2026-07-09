// ─────────────────────────────────────────────────────────────────────────────
// MICRO → MACRO breadth aggregator (Phase A2 of the top-down 10/10 loop). Builds the
// arrow that was missing: it aggregates the whole equity universe into BREADTH signals
// and writes them to macro_state, so the macro view can be CONFIRMED or CONTRADICTED by
// what the individual names are actually doing. Breadth is the classic tell — the market
// can rise while participation narrows, and that divergence (see A3) is an early warning.
// Free: reuses the S&P 500 universe loader + cached Yahoo prices (same the discovery cron
// already warmed). Run: node --experimental-strip-types --no-warnings research/macro_breadth.mjs [--limit N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { aboveSMA, fwdReturn, hasPriceAt } from "./prices.mjs";
import { regimeConfirmation } from "../lib/regimeLoop.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const pct = (hit, tot) => (tot > 0 ? +((hit / tot) * 100).toFixed(1) : null);

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;

const table = await loadSP500Historical();
let members = [...new Set(membersAsOf(table, today) || [])];
if (LIMIT > 0) members = members.slice(0, LIMIT);
console.log(`\n  MACRO BREADTH · ${members.length} names · ${today}`);

let n200 = 0, d200 = 0, n50 = 0, d50 = 0, nMom = 0, dMom = 0, n1m = 0, d1m = 0, done = 0;
for (const t of members) {
  done++; if (done % 100 === 0) console.log(`  …${done}/${members.length}`);
  try {
    if (!(await hasPriceAt(t, today))) continue;
    const a200 = await aboveSMA(t, 200, today);
    if (a200 != null) { d200++; if (a200) n200++; }
    const a50 = await aboveSMA(t, 50, today);
    if (a50 != null) { d50++; if (a50) n50++; }
    const m121 = await fwdReturn(t, addMonths(today, -12), addMonths(today, -1));
    if (m121 != null) { dMom++; if (m121 > 0) nMom++; }
    const m1 = await fwdReturn(t, addMonths(today, -1), today);
    if (m1 != null) { d1m++; if (m1 > 0) n1m++; }
  } catch { /* skip */ }
}

const row = {
  id: 1,
  breadth_200dma: pct(n200, d200),   // % of universe above its 200-day SMA (the classic breadth gauge)
  breadth_50dma:  pct(n50, d50),     // % above 50-day SMA (shorter-term participation)
  breadth_mom:    pct(nMom, dMom),   // % with positive 12-1m momentum
  breadth_1m:     pct(n1m, d1m),     // % up over the last month (near-term thrust)
  breadth_updated_at: new Date().toISOString(),
};
console.log(`  200dma ${row.breadth_200dma}%  ·  50dma ${row.breadth_50dma}%  ·  12-1m>0 ${row.breadth_mom}%  ·  1m>0 ${row.breadth_1m}%  (n≈${d200})`);

writeFileSync(join(OUT, "macro_breadth.json"), JSON.stringify(row, null, 2));
console.log(`  → wrote research/out/macro_breadth.json`);

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// Close the loop (A3): read the live top-down gauge and compare it to bottom-up breadth.
let confirmation = null;
if (SB_KEY) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/macro_state?id=eq.1&select=risk_on`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const j = await r.json();
    const riskOn = Array.isArray(j) ? Number(j[0]?.risk_on) : NaN;
    const conf = regimeConfirmation(isNaN(riskOn) ? null : riskOn, row.breadth_200dma);
    confirmation = conf.state;
    console.log(`  regime confirmation: ${conf.state} (risk-on ${isNaN(riskOn) ? "?" : riskOn} vs breadth ${row.breadth_200dma}, gap ${conf.gap})`);
  } catch { /* keep null */ }
}

if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/macro_state?id=eq.1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "return=minimal" },
    body: JSON.stringify({ breadth_200dma: row.breadth_200dma, breadth_50dma: row.breadth_50dma, breadth_mom: row.breadth_mom, breadth_1m: row.breadth_1m, breadth_updated_at: row.breadth_updated_at, regime_confirmation: confirmation }),
  });
  console.log(`  Supabase macro_state PATCH: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — patch macro_state from the JSON via MCP)");
}
