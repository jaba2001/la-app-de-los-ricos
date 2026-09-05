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
// ⚠️ LOS DOS EXTREMOS DE UN RETORNO TIENEN QUE VENIR DE LA MISMA BASE DE AJUSTE.
// Antes la acción se medía `hoy / r.adj_price`, donde `adj_price` es el precio ajustado
// CONGELADO al sellar la cohorte, mientras que el índice se medía con sus dos extremos
// sacados de la serie de HOY. El adjClose de Yahoo se reajusta hacia atrás con cada dividendo
// posterior, así que el precio congelado es más alto que lo que esa misma fecha vale hoy: el
// denominador se queda grande y el retorno de la acción sale CORTO. El sesgo era sistemático
// y jugaba EN CONTRA del track record publicado, no a favor.
// `adj_price` se conserva intacto en la tabla: es el registro de auditoría de lo que se vio al
// decidir. Simplemente ya no se mezcla con una serie reajustada al calcular un retorno.
let sinBaseConsistente = 0;
for (const r of cohort) {
  if (AGE(r.score_date) < 25) continue; // needs ~1M to be meaningful
  const now = await priceAsOf(r.ticker, today);
  const p0 = await priceAsOf(r.ticker, r.score_date);
  const spyNow = await spyAt(today);
  const spy0 = await spyAt(r.score_date);
  // Si no hay precio de origen en la MISMA base, se salta y se cuenta. Caer al congelado
  // aquí reintroduciría el sesgo en silencio, que es justo lo que se está arreglando.
  if (!now || !p0 || !spyNow || !spy0) { if (now && !p0 && r.adj_price) sinBaseConsistente++; continue; }
  const ret = (now / p0 - 1) * 100;
  const spyRet = (spyNow / spy0 - 1) * 100;
  measured.push({ ...r, ret, alpha: ret - spyRet });
}
if (sinBaseConsistente) console.log(`  ⚠ ${sinBaseConsistente} puntuaciones sin precio de origen en la base de hoy — se saltan (antes se medían con el congelado y sesgaban a la baja)`);

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
  // ⚠️ `months_live` VALÍA `dates.length`, que es el número de COHORTES, no de meses. Con
  // cohortes selladas el 05-jul, el 09-jul, el 02-ago y el 02-sep —dos de ellas a cuatro días
  // una de otra— eso publicaba «3 meses en vivo» sobre un histórico real de 59 días. El span
  // se mide entre la primera y la última, que es lo que la palabra «meses» promete.
  months_live: dates.length > 1
    ? +(((new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000) / 30.44).toFixed(1)
    : 0,
  cohorts: dates.length, names_scored: cohort.length,
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
