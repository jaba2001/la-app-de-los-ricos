// LIVE monthly scoring cron — the forward analog of the backtest. Scores the universe
// as of today (point-in-time by construction, since "today" only knows today's data)
// and appends an immutable cohort to sl_cohort. Runs on GitHub Actions, 1st of month.
//   node --experimental-strip-types --no-warnings research/cron-score.mjs [--dry]
// Env: FMP_KEY, FRED_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, priceAsOf, momentum } from "./prices.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED } from "./universe.mjs";
import { SCORE_VERSION_ABSOLUTE_BANDS, SCORE_VERSION_SECTOR_PCTL } from "../lib/scoring.ts";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// F2 — distribuciones sectoriales. Si el artefacto existe, el score se calcula contra el
// sector y la cohorte se sella como versión 2; si no, bandas absolutas y versión 1.
// La VERSIÓN va en cada fila a propósito: cambiar el criterio sin sellarlo haría que las
// cohortes nuevas y las viejas parecieran comparables sin serlo, y el track record se
// rompería por dentro sin que nada fallara.
const DIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "out", "factor_dist.json");
let DIST = null;
try { if (existsSync(DIST_PATH)) DIST = JSON.parse(readFileSync(DIST_PATH, "utf8")).dist ?? null; } catch { DIST = null; }
// Medido (research/score_v2_validate.mjs): v2 NO mejora a v1 contra retornos, así que las
// cohortes se siguen sellando con bandas absolutas. La tabla se carga igualmente porque el
// artefacto sirve para los grados de la ficha; simplemente no alimenta el score.
const USE_SECTOR_PCTL = false;
const SCORE_VERSION = USE_SECTOR_PCTL ? SCORE_VERSION_SECTOR_PCTL : SCORE_VERSION_ABSOLUTE_BANDS;
console.log(`score v${SCORE_VERSION} (${USE_SECTOR_PCTL ? "percentiles sector-relativos" : "bandas absolutas"})`);

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
    const { scores, ic } = scoreStock(f, raw, mom, sector, null, USE_SECTOR_PCTL ? DIST : null); // pure-micro base score (matches backtest)
    rows.push({ score_date: today, ticker: t, score_total: scores.total, ic_score: Math.round(ic), sector, raw_price: raw, adj_price: adj, score_version: SCORE_VERSION });
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
