// LIVE monthly scoring cron — the forward analog of the backtest. Scores the universe
// as of today (point-in-time by construction, since "today" only knows today's data)
// and appends an immutable cohort to sl_cohort. Runs on GitHub Actions, 1st of month.
//   node --experimental-strip-types --no-warnings research/cron-score.mjs [--dry]
// Env: FMP_KEY, FRED_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, priceAsOf, momentum } from "./prices.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED } from "./universe.mjs";

const DRY = process.argv.includes("--dry");
const today = new Date().toISOString().slice(0, 10);
// SUPABASE_URL is public (already in the app client) — default it so only the
// service_role key needs to be a secret.
const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";

const rows = [];
for (const t of CURATED) {
  try {
    const cik = await tickerToCik(t);
    if (!cik) continue;
    const f = await fundamentalsAsOf(cik, today);
    const raw = await rawPriceAsOf(t, today);
    const adj = await priceAsOf(t, today);
    if (!f || f.revTTM == null || raw == null || adj == null) continue;
    const sector = await sicSector(cik);
    const mom = await momentum(t, today);
    const { scores, ic } = scoreStock(f, raw, mom, sector, null); // pure-micro base score (matches backtest)
    rows.push({ score_date: today, ticker: t, score_total: scores.total, ic_score: Math.round(ic), sector, raw_price: raw, adj_price: adj });
  } catch (e) { console.error(`  ${t}: ${e.message}`); }
}
console.log(`scored ${rows.length}/${CURATED.length} names as of ${today}`);

if (DRY || !process.env.SUPABASE_SERVICE_KEY) {
  console.log(rows.map((r) => `  ${r.ticker.padEnd(6)} ${String(r.score_total).padStart(3)}  ${(r.sector || "").slice(0, 12).padEnd(12)} $${r.adj_price}`).join("\n"));
  if (!DRY) console.error("\nSUPABASE_SERVICE_KEY not set — not writing.");
  process.exit(0);
}

const res = await fetch(`${SB_URL}/rest/v1/sl_cohort?on_conflict=score_date,ticker`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: process.env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    Prefer: "resolution=merge-duplicates",
  },
  body: JSON.stringify(rows),
});
console.log(`supabase sl_cohort: ${res.status} ${res.ok ? "ok" : await res.text()}`);
if (!res.ok) process.exit(1);
