// ─────────────────────────────────────────────────────────────────────────────
// CROSS-ASSET DISCOVERY (Phase 2) — ranks a curated, liquid multi-asset universe
// (metals · commodities · fixed income · broad equity · sectors) by the SAME 12-1m
// momentum factor that drives the validated dual-momentum allocation (Sharpe ~1.0).
// This is the cross-asset momentum board: which sleeve is leading right now.
// Free: Yahoo/Tiingo prices (research/prices.mjs). Writes feed='cross-asset' rows to
// Supabase sl_discovery (or research/out/discovery_instruments.json without a key).
// Run: node --experimental-strip-types --no-warnings research/discovery_instruments.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fwdReturn, rawPriceAsOf, hasPriceAt } from "./prices.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

// momentum score 0-100 — identical scale to research/discovery.mjs & lib/microScore
function momScore(m12_1, m6) {
  let s = 0;
  if (m12_1 != null) s += m12_1 > 40 ? 45 : m12_1 > 20 ? 38 : m12_1 > 10 ? 30 : m12_1 > 0 ? 20 : m12_1 > -15 ? 8 : 0;
  if (m6 != null) s += m6 > 20 ? 25 : m6 > 8 ? 18 : m6 > 0 ? 12 : m6 > -15 ? 5 : 0;
  return Math.round(Math.min(100, s / 70 * 100));
}

// Curated, liquid one-per-sleeve universe (mirrors lib/instrument.ts labels).
const UNIVERSE = [
  // Metals
  ["GLD", "Gold", "Metals"], ["SLV", "Silver", "Metals"], ["PPLT", "Platinum", "Metals"],
  ["CPER", "Copper", "Metals"], ["GDX", "Gold miners", "Metals"],
  // Commodities
  ["DBC", "Broad commodities", "Commodities"], ["USO", "Crude oil", "Commodities"],
  ["UNG", "Natural gas", "Commodities"], ["DBA", "Agriculture", "Commodities"], ["DBB", "Base metals", "Commodities"],
  // Fixed income
  ["TLT", "Long Treasuries", "Fixed income"], ["IEF", "7-10y Treasuries", "Fixed income"],
  ["SHY", "Short Treasuries", "Fixed income"], ["LQD", "IG credit", "Fixed income"],
  ["HYG", "High yield", "Fixed income"], ["TIP", "TIPS", "Fixed income"],
  ["AGG", "Aggregate bonds", "Fixed income"], ["MUB", "Munis", "Fixed income"],
  ["EMB", "EM bonds", "Fixed income"], ["MBB", "Mortgage-backed", "Fixed income"],
  // Broad equity
  ["SPY", "S&P 500", "Equity index"], ["QQQ", "Nasdaq 100", "Equity index"],
  ["IWM", "US small caps", "Equity index"], ["DIA", "Dow 30", "Equity index"],
  ["VTI", "Total US market", "Equity index"], ["VEA", "Developed intl", "Equity index"],
  ["VWO", "Emerging markets", "Equity index"],
  // Sector ETFs (GICS + semis)
  ["XLK", "Technology", "Sector equity"], ["XLF", "Financials", "Sector equity"],
  ["XLE", "Energy", "Sector equity"], ["XLV", "Health care", "Sector equity"],
  ["XLI", "Industrials", "Sector equity"], ["XLP", "Staples", "Sector equity"],
  ["XLY", "Discretionary", "Sector equity"], ["XLB", "Materials", "Sector equity"],
  ["XLU", "Utilities", "Sector equity"], ["XLRE", "Real estate", "Sector equity"],
  ["XLC", "Communications", "Sector equity"], ["SMH", "Semiconductors", "Sector equity"],
];

console.log(`\n  CROSS-ASSET DISCOVERY · ${UNIVERSE.length} instruments · ${today}\n  computing 12-1m momentum…`);

const rows = [];
for (const [t, label, assetClass] of UNIVERSE) {
  try {
    if (!(await hasPriceAt(t, addMonths(today, -1)))) { console.log(`  · ${t.padEnd(5)} no price — skip`); continue; }
    const m12_1 = await fwdReturn(t, addMonths(today, -12), addMonths(today, -1));
    if (m12_1 == null) { console.log(`  · ${t.padEnd(5)} no 12-1m — skip`); continue; }
    const m6 = await fwdReturn(t, addMonths(today, -6), today);
    const price = await rawPriceAsOf(t, today);
    rows.push({
      ticker: t, sector: assetClass, asset_class: assetClass, label,
      feed: "cross-asset",
      mom_12_1: +m12_1.toFixed(1), mom_6m: m6 != null ? +m6.toFixed(1) : null,
      price: price != null ? +price.toFixed(2) : null, score: momScore(m12_1, m6),
    });
  } catch (e) { console.log(`  · ${t.padEnd(5)} error ${e?.message ?? e}`); }
}

rows.sort((a, b) => b.mom_12_1 - a.mom_12_1);
rows.forEach((r, i) => { r.rank = i + 1; r.updated_at = new Date().toISOString(); });

console.log(`\n  Cross-asset momentum leaders (${today}):`);
for (const r of rows) console.log(`  #${String(r.rank).padStart(2)} ${r.ticker.padEnd(5)} ${r.label.padEnd(18)} 12-1m ${(r.mom_12_1 >= 0 ? "+" : "") + r.mom_12_1}%  score ${r.score}  ${r.asset_class}`);

writeFileSync(join(OUT, "discovery_instruments.json"), JSON.stringify(rows, null, 2));
console.log(`\n  → wrote research/out/discovery_instruments.json (${rows.length} rows)`);

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_discovery?on_conflict=ticker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed the cross-asset rows from the JSON)");
}
