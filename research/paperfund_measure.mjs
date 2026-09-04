// ─────────────────────────────────────────────────────────────────────────────
// PAPER FUND · measure + auto-grade (Phase 8). Replays the fund's own sealed rebalance
// snapshots (sl_paper_fund) forward on free total-return prices: base 100 at inception,
// each month held at the weights of the most recent rebalance, compounded. Computes NAV
// vs SPY, max drawdown, annualized Sharpe, and an honest letter grade, then upserts one
// row to sl_paper_fund_track (a NAV history). No hindsight — only sealed decisions.
// Run: SUPABASE_SERVICE_KEY=… node --experimental-strip-types --no-warnings research/paperfund_measure.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { priceAsOf } from "./prices.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));

const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const today = new Date().toISOString().slice(0, 10);
const ASSETS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];

async function fetchRebalances() {
  if (!SB_KEY) return [];
  const r = await fetch(`${SB_URL}/rest/v1/sl_paper_fund?select=rebalance_date,weights&order=rebalance_date.asc`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  return r.ok ? await r.json() : [];
}

// Rejilla de medición: mensual, PERO anclada al inicio REAL del fondo y conteniendo TODAS
// las fechas de rebalanceo.
//
// ⚠️ ESTO ARREGLA UN DEFECTO QUE PUBLICÓ UNA CIFRA FALSA. La versión anterior hacía
// `d.setUTCDate(1)`, así que con un inicio el 2026-07-09 la rejilla arrancaba el 2026-07-01:
// medía OCHO DÍAS EN LOS QUE EL FONDO NO EXISTÍA. Y como `pesosEn()` retrocede al primer
// rebalanceo cuando no encuentra ninguno anterior, ese tramo fantasma se medía además con
// una cartera multiactivo que el fondo tuvo UN SOLO DÍA antes de irse a 100 % SPY.
// Todo el exceso publicado (+0,59 pp) salía de ahí.
//
// Por eso la rejilla incluye ahora las fechas de rebalanceo: una rejilla sólo mensual no ve
// los cambios intramensuales, y mide al fondo con pesos que no tenía.
function gridDeMedicion(rebs, fromISO, toISO) {
  const s = new Set([fromISO, toISO]);
  for (const r of rebs) if (r.rebalance_date >= fromISO && r.rebalance_date <= toISO) s.add(r.rebalance_date);
  const d = new Date(fromISO + "T00:00:00Z"); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const end = new Date(toISO + "T00:00:00Z");
  while (d <= end) { s.add(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return [...s].sort();
}
// Devuelve los pesos vigentes en `date`. Si `date` es ANTERIOR al primer rebalanceo, eso es un
// defecto de quien construyó la rejilla, no un caso a cubrir: devolver los pesos del primer
// rebalanceo ahí es inventarse una cartera. Falla ruidosamente en vez de mentir en silencio.
const pesosEn = (rebs, date) => {
  if (date < rebs[0].rebalance_date) throw new Error(`pesosEn(${date}): anterior al inicio del fondo (${rebs[0].rebalance_date}) — la rejilla está mal construida`);
  let w = rebs[0].weights;
  for (const r of rebs) { if (r.rebalance_date <= date) w = r.weights; else break; }
  return w;
};

const rebs = await fetchRebalances();
if (!rebs.length) { console.log("  no rebalances yet — run paperfund_rebalance first."); process.exit(0); }

const inception = rebs[0].rebalance_date;
const grid = gridDeMedicion(rebs, inception, today);
console.log(`\n  PAPER FUND measure · inception ${inception} · ${grid.length - 1} periods → ${today}`);

// price cache
const px = {};
async function P(a, d) { const k = a + d; if (k in px) return px[k]; const v = await priceAsOf(a, d); px[k] = v; return v; }

/**
 * COSTES REALES POR ACTIVO — Y POR QUE ESTO NO ES «AJUSTAR PARA GANAR».
 *
 * Hasta ahora este guion no cobraba NADA: ni diferencial ni comision de gestion, ni al fondo ni
 * a sus referencias. Parece simetrico y no lo es, por dos motivos:
 *   · el fondo ROTA y el indice comprado y quieto no, asi que solo uno paga diferenciales;
 *   · el fondo lleva oro al 0,40 % de comision y el SPY cuesta 0,0945 %.
 * Cobrar cero a los dos favorecia al fondo en las dos direcciones.
 *
 * Los diferenciales NO son un supuesto: los publica cada emisor a diario POR OBLIGACION LEGAL
 * (regla 6c-11 de la SEC, mediana de los ultimos 30 dias sobre el NBBO). Ver `etf_spreads.json`.
 *
 * ⚠️ Y por eso esto se aplica AQUI y no al backtest historico: el dato es el de HOY. El registro
 * vivo va hacia delante, asi que usarlo es correcto en el tiempo. Aplicarlo a una serie que
 * empieza en 2007 seria anacronico —los diferenciales eran mucho mas anchos— y con 5,1 pp de
 * retorno por punto basico es la forma exacta de batir al indice con una hoja de calculo.
 *
 * CONVENIO: cruzar el diferencial cuesta LA MITAD de la horquilla, y `rot` ya cuenta las dos
 * patas de cada trasvase (vender A y comprar B suman |Δw| cada una). Asi que el coste es
 * Σ|Δw_i| × spread_i / 2. El backtest historico cobra `Σ|Δw| × 10 pb`, que equivale a una
 * horquilla de 20 pb de ida y vuelta: mas conservador todavia de lo que parecia.
 */
const COSTES = JSON.parse(readFileSync(join(AQUI, "out", "etf_spreads.json"), "utf8"));
const spreadBps = (a) => {
  const x = COSTES.activos?.[a];
  if (!x) throw new Error(`spreadBps(${a}): no hay entrada en etf_spreads.json — anadela antes de medir`);
  if (Number.isFinite(x.spreadBps)) return x.spreadBps;             // medido bajo 6c-11
  if (Number.isFinite(x.supuestoDeclaradoBps)) return x.supuestoDeclaradoBps;  // fuera del regimen
  throw new Error(`spreadBps(${a}): ni medicion ni supuesto declarado — no se inventa un coste`);
};
// Igual que el diferencial: una comision ausente NO vale cero. DBC cobra 0,85 % —el activo mas
// caro de la cesta con diferencia— y devolver 0 por no encontrarlo lo habria regalado.
const terPct = (a) => {
  const x = COSTES.activos?.[a];
  if (!x) throw new Error(`terPct(${a}): no hay entrada en etf_spreads.json`);
  if (Number.isFinite(x.terPct)) return x.terPct;
  throw new Error(`terPct(${a}): sin comision declarada — cero no es un valor por defecto valido`);
};
const TER_SPY = terPct("SPY"), TER_IEF = terPct("IEF");

let nav = 100, spyNav = 100, b6040Nav = 100, peak = 100, maxDD = 0;
let costeTotalPb = 0, comisionTotalPb = 0;
let pesosPrevios = null;
const rets = [], diasDeCadaTramo = [];
for (let i = 1; i < grid.length; i++) {
  const d0 = grid[i - 1], d1 = grid[i];
  const w = pesosEn(rebs, d0);
  let portRet = 0, ok = false;
  for (const a of ASSETS) {
    const wa = Number(w[a]) || 0; if (wa === 0) continue;
    const p0 = await P(a, d0), p1 = await P(a, d1);
    if (p0 != null && p1 != null && p0 > 0) { portRet += wa * (p1 / p0 - 1); ok = true; }
  }
  const s0 = await P("SPY", d0), s1 = await P("SPY", d1);
  const spyRet = s0 != null && s1 != null && s0 > 0 ? s1 / s0 - 1 : 0;
  // Declared benchmark: static 60/40 (SPY/IEF), rebalanced on the same monthly grid —
  // the same construction the GROWTH_BACKTEST claim is measured against.
  const i0 = await P("IEF", d0), i1 = await P("IEF", d1);
  const iefRet = i0 != null && i1 != null && i0 > 0 ? i1 / i0 - 1 : 0;
  const dias = (new Date(d1 + "T00:00:00Z") - new Date(d0 + "T00:00:00Z")) / 86400000;
  const anos = dias / 365.25;

  // Diferencial: solo se paga sobre lo que CAMBIA de manos, y solo media horquilla por pata.
  let coste = 0;
  if (pesosPrevios) {
    for (const a of ASSETS) {
      const d = Math.abs((Number(w[a]) || 0) - (Number(pesosPrevios[a]) || 0));
      if (d > 1e-9) coste += d * (spreadBps(a) / 10000) / 2;
    }
  }
  // Comision de gestion: prorrateada por el tiempo que se tiene cada activo.
  let comision = 0;
  for (const a of ASSETS) comision += (Number(w[a]) || 0) * (terPct(a) / 100) * anos;

  if (ok) {
    nav *= 1 + portRet - coste - comision; rets.push(portRet - coste - comision);
    diasDeCadaTramo.push(dias);
    costeTotalPb += coste * 10000; comisionTotalPb += comision * 10000;
  }
  pesosPrevios = { ...w };
  // Las referencias pagan SU comision: tener SPY tampoco es gratis. Sin esto la comparacion
  // enfrenta una cartera con costes contra una serie de precios que no los tiene.
  spyNav *= 1 + spyRet - (TER_SPY / 100) * anos;
  b6040Nav *= 1 + (0.6 * spyRet + 0.4 * iefRet) - ((0.6 * TER_SPY + 0.4 * TER_IEF) / 100) * anos;
  peak = Math.max(peak, nav);
  maxDD = Math.min(maxDD, nav / peak - 1);
}

const totalRet = nav / 100 - 1, spyTotalRet = spyNav / 100 - 1, b6040TotalRet = b6040Nav / 100 - 1;
const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
const variance = rets.length > 1 ? rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1) : 0;
// ⚠️ NO se puede anualizar con √12: la rejilla ya no es mensual (contiene las fechas de
// rebalanceo, y un tramo puede ser de un día). Se anualiza con la duración REAL media.
const diasMedios = diasDeCadaTramo.length ? diasDeCadaTramo.reduce((a, b) => a + b, 0) / diasDeCadaTramo.length : 30.4;
const tramosPorAno = 365.25 / Math.max(1, diasMedios);
const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(tramosPorAno) : 0;

// ⚠️ EL LISTÓN ERA 2 RETORNOS, Y ESO PUBLICABA UNA «A» A PARTIR DE RUIDO. Un Sharpe con
// tres tramos no tiene error estándar interpretable. Doce tramos ≈ un año de historia: por
// debajo de eso el fondo ACUMULA, no se califica.
const MINIMO_TRAMOS_PARA_CALIFICAR = 12;
const grade = rets.length < MINIMO_TRAMOS_PARA_CALIFICAR ? "Accruing"
  : sharpe >= 1.0 ? "A" : sharpe >= 0.7 ? "B" : sharpe >= 0.4 ? "C" : sharpe >= 0 ? "D" : "F";

const row = {
  as_of: today, inception,
  nav: +nav.toFixed(2), spy_nav: +spyNav.toFixed(2),
  bench6040_nav: +b6040Nav.toFixed(2), bench6040_ret: +(b6040TotalRet * 100).toFixed(2),
  total_ret: +(totalRet * 100).toFixed(2), spy_ret: +(spyTotalRet * 100).toFixed(2),
  max_dd: +(maxDD * 100).toFixed(2), sharpe: +sharpe.toFixed(2), grade,
  coste_spread_pb: +costeTotalPb.toFixed(2), coste_comision_pb: +comisionTotalPb.toFixed(2),
  updated_at: new Date().toISOString(), // refresh on re-measure (PostgREST won't touch it otherwise)
};
console.log(`  NAV ${row.nav} (${row.total_ret >= 0 ? "+" : ""}${row.total_ret}%) vs 60/40 ${row.bench6040_nav} (${row.bench6040_ret}%) vs SPY ${row.spy_nav} (${row.spy_ret}%) · maxDD ${row.max_dd}% · Sharpe ${row.sharpe} · grade ${grade}`);

// Los costes, a la vista. Si no se ven, nadie comprueba que se estan cobrando.
console.log(`
  COSTES COBRADOS (antes se cobraba CERO, a la cartera y a sus referencias)`);
console.log(`     diferencial acumulado : ${costeTotalPb.toFixed(2)} pb   (media horquilla por pata, solo sobre lo que rota)`);
console.log(`     comision de gestion   : ${comisionTotalPb.toFixed(2)} pb   (prorrateada por tiempo de tenencia)`);
console.log(`     y las referencias pagan la suya: SPY ${TER_SPY} %/año · 60/40 ${(0.6 * TER_SPY + 0.4 * TER_IEF).toFixed(4)} %/año`);
console.log(`     origen de los diferenciales: ${COSTES.fuente.slice(0, 96)}…`);

if (SB_KEY) {
  const resp = await fetch(`${SB_URL}/rest/v1/sl_paper_fund_track?on_conflict=as_of`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  console.log(`  Supabase upsert: ${resp.status} ${resp.ok ? "OK" : await resp.text()}`);
} else {
  console.log("  (no SUPABASE_SERVICE_KEY — seed sl_paper_fund_track from the JSON)");
  const { writeFileSync } = await import("fs");
  writeFileSync(new URL("./out/paperfund_track.json", import.meta.url), JSON.stringify(row, null, 2));
}
