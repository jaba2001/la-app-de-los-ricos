// LIVE weekly measurement cron — reads the immutable sl_cohort scores, marks each to
// today's price, computes realized alpha vs SPY, and writes the aggregated live track
// record to sl_track_summary. Runs on GitHub Actions, weekly. Starts empty and grows
// into a clean, un-backtested forward record.
//   node --experimental-strip-types --no-warnings research/cron-measure.mjs [--dry]
// Env: FMP_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
import { priceAsOf } from "./prices.mjs";

const DRY = process.argv.includes("--dry");
const SB = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;
const today = new Date().toISOString().slice(0, 10);
const BUY = 60;

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function spearman(x, y) {
  if (x.length < 5) return null;
  const rk = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const av = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = av; i = j; } return r; };
  const rx = rk(x), ry = rk(y), mx = mean(rx), my = mean(ry); let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}

async function readCohort() {
  const r = await fetch(`${SB}/rest/v1/sl_cohort?select=score_date,ticker,score_total,adj_price,score_version&order=score_date.asc&limit=100000`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return r.ok ? await r.json() : [];
}

const cohort = KEY ? await readCohort() : [];
console.log(`read ${cohort.length} cohort rows`);

const spyAtCache = new Map();
const spyAt = async (d) => { if (!spyAtCache.has(d)) spyAtCache.set(d, await priceAsOf("SPY", d)); return spyAtCache.get(d); };
const AGE = (d) => (Date.now() - new Date(d)) / 86400000;

const measured = [];
for (const r of cohort) {
  if (AGE(r.score_date) < 25) continue; // needs ~1M to be meaningful
  const now = await priceAsOf(r.ticker, today);
  const spyNow = await spyAt(today);
  const spy0 = await spyAt(r.score_date);
  if (!now || !r.adj_price || !spyNow || !spy0) continue;
  const ret = (now / r.adj_price - 1) * 100;
  const spyRet = (spyNow / spy0 - 1) * 100;
  measured.push({ ...r, ret, alpha: ret - spyRet });
}

const dates = [...new Set(cohort.map((r) => r.score_date))];
const buy = measured.filter((r) => r.score_total >= BUY);

// ── DESGLOSE POR VERSIÓN DEL SCORE ───────────────────────────────────────────────
// El IC agregado correlaciona score contra retorno mezclando cohortes calculadas con
// fórmulas distintas (v1 bandas absolutas, v2 percentiles sector-relativos). No están en
// la misma escala, así que ese número agregado es —literalmente— una media de dos cosas
// que no se pueden promediar. Se sigue publicando por continuidad, pero el desglose es el
// que hay que mirar, y `mixes_versions` avisa cuando el agregado no es de fiar.
const versiones = [...new Set(measured.map((r) => r.score_version ?? 1))].sort();
const byVersion = {};
for (const v of versiones) {
  const filas = measured.filter((r) => (r.score_version ?? 1) === v);
  const compras = filas.filter((r) => r.score_total >= BUY);
  byVersion[`v${v}`] = {
    names: filas.length,
    cohorts: [...new Set(filas.map((r) => r.score_date))].length,
    ic: filas.length >= 5 ? spearman(filas.map((r) => r.score_total), filas.map((r) => r.ret)) : null,
    buy_hit_rate: compras.length ? compras.filter((r) => r.alpha > 0).length / compras.length : null,
    buy_avg_alpha: mean(compras.map((r) => r.alpha)),
    label: v === 2 ? "percentiles sector-relativos" : "bandas absolutas",
  };
}
if (versiones.length > 1) {
  console.log(`⚠ el track record mezcla ${versiones.length} versiones del score (${versiones.map((v) => "v" + v).join(", ")}) — el agregado NO es comparable; mirar by_version`);
}
const summary = {
  id: 1, as_of: today,
  months_live: dates.length, cohorts: dates.length, names_scored: cohort.length,
  buy_hit_rate: buy.length ? buy.filter((r) => r.alpha > 0).length / buy.length : null,
  buy_total_return: mean(buy.map((r) => r.ret)),
  spy_total_return: measured.length ? mean(measured.map((r) => r.ret - r.alpha)) : null,
  information_coefficient: measured.length >= 5 ? spearman(measured.map((r) => r.score_total), measured.map((r) => r.ret)) : null,
  sharpe: null, max_drawdown: null,
  by_horizon: { matured: measured.length, buyAvgAlpha: mean(buy.map((r) => r.alpha)) },
  by_version: { ...byVersion, mixes_versions: versiones.length > 1 },
  updated_at: new Date().toISOString(),
};
console.log(summary);

if (DRY || !KEY) { if (!DRY) console.error("SUPABASE_SERVICE_KEY not set — not writing."); process.exit(0); }
const res = await fetch(`${SB}/rest/v1/sl_track_summary?on_conflict=id`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify(summary),
});
console.log(`supabase sl_track_summary: ${res.status} ${res.ok ? "ok" : await res.text()}`);
if (!res.ok) process.exit(1);
