// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY screener feed (Phase 4 applied) — ranks the current S&P 500 by the
// validated momentum factor (12-1m, the edge that earns IC +0.07 when correlation is
// low). Free: Yahoo/Tiingo prices + EDGAR sector. Writes the top names to Supabase
// sl_discovery (or research/out/discovery.json when no service key is present).
// Run: TIINGO_TOKEN=… node --experimental-strip-types --no-warnings research/discovery.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { fwdReturn, rawPriceAsOf, hasPriceAt } from "./prices.mjs";
import { tickerToCik, sicSector } from "./edgar.mjs";

const TOP = 150;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

// momentum score 0-100 (matches lib/microScore trajectoryRating with growth omitted → momentum-primary)
function momScore(m12_1, m6) {
  let s = 0;
  if (m12_1 != null) s += m12_1 > 40 ? 45 : m12_1 > 20 ? 38 : m12_1 > 10 ? 30 : m12_1 > 0 ? 20 : m12_1 > -15 ? 8 : 0;
  if (m6 != null) s += m6 > 20 ? 25 : m6 > 8 ? 18 : m6 > 0 ? 12 : m6 > -15 ? 5 : 0;
  return Math.round(Math.min(100, s / 70 * 100)); // scale the 0-70 momentum range to 0-100
}

const table = await loadSP500Historical();
const members = [...new Set(membersAsOf(table, today) || [])];
console.log(`\n  DISCOVERY · S&P 500 momentum ranking · ${members.length} names · ${today}\n  computing 12-1m momentum…`);

const rows = [];
let done = 0;
for (const t of members) {
  done++;
  if (done % 100 === 0) console.log(`  …${done}/${members.length}`);
  try {
    if (!(await hasPriceAt(t, addMonths(today, -1)))) continue;
    const m12_1 = await fwdReturn(t, addMonths(today, -12), addMonths(today, -1));
    if (m12_1 == null) continue;
    const m6 = await fwdReturn(t, addMonths(today, -6), today);
    const price = await rawPriceAsOf(t, today);
    rows.push({ ticker: t, mom_12_1: +m12_1.toFixed(1), mom_6m: m6 != null ? +m6.toFixed(1) : null, price: price != null ? +price.toFixed(2) : null, score: momScore(m12_1, m6) });
  } catch { /* skip */ }
}
rows.sort((a, b) => b.mom_12_1 - a.mom_12_1);
const top = rows.slice(0, TOP);
console.log(`  ranked ${rows.length} names; fetching sector for top ${top.length}…`);

// sector for the top names (EDGAR, best-effort, cached)
for (const r of top) {
  try { const cik = await tickerToCik(r.ticker); r.sector = cik ? (await sicSector(cik)) || null : null; } catch { r.sector = null; }
}
top.forEach((r, i) => { r.rank = i + 1; r.updated_at = new Date().toISOString(); });

console.log(`\n  Top 20 momentum leaders (${today}):`);
for (const r of top.slice(0, 20)) console.log(`  #${String(r.rank).padStart(2)} ${r.ticker.padEnd(6)} 12-1m ${(r.mom_12_1 >= 0 ? "+" : "") + r.mom_12_1}%  score ${r.score}  ${r.sector ?? ""}`);

writeFileSync(join(OUT, "discovery.json"), JSON.stringify(top, null, 2));
console.log(`\n  → wrote research/out/discovery.json (${top.length} rows)`);

// Optional direct upsert if a service key is present (else seed via MCP from the JSON)
const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_discovery?on_conflict=ticker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(top),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed sl_discovery from the JSON)");
}
