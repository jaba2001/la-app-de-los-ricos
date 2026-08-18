// ─────────────────────────────────────────────────────────────────────────────
// FACTOR LAB (F1) — la MEDICIÓN del modelo de riesgo, no su construcción.
// PLAN_TEORIA_FINANCIERA_SCORA.md §2.7 + §3.3.
//
// UNA hipótesis, declarada antes de correr, derivada de teoría y no de un barrido:
//
//   H: si una señal pública y barata tiene algún poder predictivo, debe concentrarse
//      donde el arbitraje es CARO. Shleifer & Vishny (1997) explican por qué: el
//      profesional que corregiría el precio gestiona dinero ajeno y se ve forzado a
//      liquidar cuando la posición va en contra. Pontiff (2006) identifica el coste de
//      mantenimiento dominante: la VOLATILIDAD IDIOSINCRÁTICA — justo lo que el CAPM
//      llama diversificable y gratis.
//
//   Predicción falsable: IC(fricción alta) > IC(fricción baja).
//   Si sale plano o al revés, la señal no está capturando límites al arbitraje: es ruido.
//
// Esto suma UN ensayo al libro (research/trialsLedger.mjs), no cuarenta. La diferencia
// entre una hipótesis preespecificada y un barrido es la que decide si el resultado
// significa algo — ver el plan §3.3.
//
// Run: node --experimental-strip-types --no-warnings research/factor_lab.mjs [--full N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { rawPriceAsOf, fwdReturn, momentum, hasPriceAt, returnsSeries } from "./prices.mjs";
import { scoreStock } from "./score.mjs";
import { CURATED, loadSP500Historical, membersAsOf } from "./universe.mjs";
import { regimeAsOf, preloadRegimeSeries } from "./regimeReal.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const START = "2020-01-01";
const FWD_MONTHS = 3;          // horizonte de la IC, igual que el resto del harness
const VOL_WINDOW = 250;        // sesiones de la ventana de vol idiosincrática (~1 año)
/** Desviación típica del IC transversal mensual en este universo (momentum_audit A8). */
const IC_SD = 0.22;

const addMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const monthStarts = (from, to) => { const out = []; let d = from.slice(0, 8) + "01"; while (d <= to) { out.push(d); d = addMonths(d, 1); } return out; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) r[idx[k][1]] = avg;
    i = j;
  }
  return r;
}
function spearman(x, y) {
  if (x.length < 5) return null;
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : null;
}
const fmtIC = (v) => (v == null ? "  —  " : (v >= 0 ? "+" : "") + v.toFixed(3));

// ── universo ──────────────────────────────────────────────────────────────────
const FULL = process.argv.includes("--full");
const CAP = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 120);
const today = new Date().toISOString().slice(0, 10);
const dates = monthStarts(START, addMonths(today, -FWD_MONTHS - 1));

let UNIVERSE = CURATED;
const memberSet = new Map();
if (FULL) {
  const table = await loadSP500Historical();
  if (table) {
    for (const d of dates) memberSet.set(d, new Set(membersAsOf(table, d)));
    const freq = new Map();
    for (const d of dates) for (const t of memberSet.get(d)) freq.set(t, (freq.get(t) || 0) + 1);
    UNIVERSE = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, CAP).map((e) => e[0]);
    console.log(`  full S&P 500 mode · ${UNIVERSE.length} names (cap ${CAP}) · point-in-time`);
  } else console.log("  --full: constituents load failed → CURATED");
}
const isMember = (t, d) => !FULL || (memberSet.get(d)?.has(t) ?? false);

console.log(`\n  FACTOR LAB · ${UNIVERSE.length} nombres · ${dates.length} meses ${dates[0]}→${dates.at(-1)}`);
console.log(`  H: la IC del score debe ser MAYOR donde el arbitraje es caro (vol idiosincrática alta).`);
console.log(`  loading data…`);

// ── vol idiosincrática: residuo de un modelo de mercado de 1 factor ──────────
// Pontiff (2006): es el coste de mantenimiento dominante del arbitraje. Se calcula sobre
// la ventana de 250 sesiones que TERMINA en la fecha as-of (PIT-safe).
const spyRets = await returnsSeries("SPY");
const spyByDate = new Map(spyRets.map((r) => [r.date, r.ret]));
const retCache = new Map();
async function idioVol(ticker, asOf) {
  if (!retCache.has(ticker)) retCache.set(ticker, await returnsSeries(ticker));
  const rs = retCache.get(ticker);
  // Ventana que acaba en asOf (excluye el futuro por construcción).
  const win = [];
  for (const r of rs) {
    if (r.date > asOf) break;
    const m = spyByDate.get(r.date);
    if (m != null) win.push([r.ret, m]);
  }
  if (win.length < 60) return null;
  const w = win.slice(-VOL_WINDOW);
  const my = mean(w.map((p) => p[0])), mx = mean(w.map((p) => p[1]));
  let cov = 0, varx = 0;
  for (const [y, x] of w) { cov += (y - my) * (x - mx); varx += (x - mx) ** 2; }
  if (!(varx > 0)) return null;
  const beta = cov / varx;
  const alpha = my - beta * mx;
  let rss = 0;
  for (const [y, x] of w) { const e = y - (alpha + beta * x); rss += e * e; }
  // Anualizada, en %, para que sea legible junto al resto.
  return Math.sqrt(rss / (w.length - 2)) * Math.sqrt(252) * 100;
}

// ── panel ─────────────────────────────────────────────────────────────────────
await preloadRegimeSeries();
const meta = {};
for (const t of UNIVERSE) { const cik = await tickerToCik(t); meta[t] = { cik, sector: cik ? await sicSector(cik) : "" }; }

// H2 necesita el estrés de crédito por fecha. `regimeAsOf` NO devuelve hy_oas/vix/nfci en
// crudo, así que se usa su composite `credit_stress` (0-100) como PROXY del estrés de
// capital de arbitraje. Es un proxy, no el compuesto de lib/frictions.ts, y se declara así
// en los caveats: mide condiciones de crédito, que es la mitad del fenómeno.
const stressByDate = new Map();
for (const date of dates) {
  const m = await regimeAsOf(date);
  if (m?.credit_stress != null) stressByDate.set(date, m.credit_stress);
}

const rows = [];
for (const date of dates) {
  for (const t of UNIVERSE) {
    if (!isMember(t, date)) continue;
    const { cik, sector } = meta[t];
    if (!cik || !(await hasPriceAt(t, date))) continue;
    const f = await fundamentalsAsOf(cik, date);
    const raw = await rawPriceAsOf(t, date);
    if (!f || f.revTTM == null || raw == null) continue;
    const mom = await momentum(t, date);
    const { ic: score } = scoreStock(f, raw, mom, sector, null); // score puro-micro
    const iv = await idioVol(t, date);
    const fwd = await fwdReturn(t, date, addMonths(date, FWD_MONTHS));
    if (score == null || iv == null || fwd == null) continue;
    rows.push({ date, t, score, idioVol: iv, fwd });
  }
}
console.log(`  ${rows.length} nombre-mes con score, vol idiosincrática y retorno a ${FWD_MONTHS}M\n`);

// ── terciles de fricción, DENTRO de cada mes ─────────────────────────────────
// Transversal a propósito: bucketizar sobre toda la muestra mezclaría el nivel de vol de
// 2020 con el de 2024 y el tercil "alto" sería sobre todo "año volátil", no "nombre difícil
// de arbitrar".
const BUCKETS = ["baja", "media", "alta"];
const perMonthIC = { baja: [], media: [], alta: [] };
const volByBucket = { baja: [], media: [], alta: [] };

for (const d of dates) {
  const g = rows.filter((r) => r.date === d);
  if (g.length < 15) continue; // menos de 5 por tercil no da una IC honesta
  const sorted = [...g].sort((a, b) => a.idioVol - b.idioVol);
  const third = Math.floor(sorted.length / 3);
  const groups = { baja: sorted.slice(0, third), media: sorted.slice(third, 2 * third), alta: sorted.slice(2 * third) };
  for (const b of BUCKETS) {
    const gb = groups[b];
    if (gb.length < 5) continue;
    const c = spearman(gb.map((r) => r.score), gb.map((r) => r.fwd));
    if (c != null) perMonthIC[b].push(c);
    volByBucket[b].push(mean(gb.map((r) => r.idioVol)));
  }
}

// ── resultado + MDE por tercil ───────────────────────────────────────────────
// El MDE sube al dividir la muestra: cada tercil tiene menos nombres, así que su IC es más
// ruidosa. Declararlo es obligatorio — sin el MDE, "no significativo" no significa nada.
console.log("  tercil de fricción   vol idio media   IC (score→3M)   meses   MDE");
const buckets = {};
for (const b of BUCKETS) {
  const ic = mean(perMonthIC[b]);
  const n = perMonthIC[b].length;
  const mde = n > 0 ? (2.8 * IC_SD) / Math.sqrt(n) : null;
  buckets[b] = { ic, months: n, mde, avgIdioVol: mean(volByBucket[b]), detectable: ic != null && mde != null && Math.abs(ic) >= mde };
  console.log(`  ${b.padEnd(20)} ${(buckets[b].avgIdioVol ?? 0).toFixed(1).padStart(9)}%   ${fmtIC(ic).padStart(13)}   ${String(n).padStart(5)}   ${mde ? mde.toFixed(3) : "—"}`);
}

const spread = buckets.alta.ic != null && buckets.baja.ic != null ? buckets.alta.ic - buckets.baja.ic : null;
// El contraste alta−baja es la diferencia de dos medias: su error típico es sqrt(2) veces
// el de una sola, así que el MDE del CONTRASTE es mayor que el de cada tercil.
const spreadMde = buckets.alta.months && buckets.baja.months
  ? 2.8 * IC_SD * Math.sqrt(1 / buckets.alta.months + 1 / buckets.baja.months)
  : null;

let verdict;
if (spread == null || spreadMde == null) {
  verdict = "SIN DATOS — no hay meses suficientes en los terciles extremos.";
} else if (spread > spreadMde) {
  verdict = `CONSISTENTE CON H — la IC es ${spread.toFixed(3)} mayor en fricción alta que en baja, por encima del MDE del contraste (${spreadMde.toFixed(3)}). Es la única lectura que apoyaría buscar alfa donde el arbitraje es caro; sigue necesitando un OOS antes de tocar nada.`;
} else if (spread < -spreadMde) {
  verdict = `CONTRARIO A H — la IC es MENOR donde el arbitraje es caro (${spread.toFixed(3)}, MDE ${spreadMde.toFixed(3)}). La señal no captura límites al arbitraje.`;
} else {
  verdict = `NO CONCLUYENTE — el diferencial alta−baja es ${spread.toFixed(3)} con un MDE de contraste de ${spreadMde.toFixed(3)}. Con esta muestra la hipótesis no se puede aprobar ni descartar; no es "no funciona", es "no se puede saber". Haría falta ampliar el universo o la ventana, no probar más variantes.`;
}

console.log(`\n  diferencial alta − baja: ${fmtIC(spread)}  (MDE del contraste ${spreadMde ? spreadMde.toFixed(3) : "—"})`);
console.log(`  VEREDICTO: ${verdict}\n`);

// ── H2 · puerta de estrés del capital de arbitraje (serie temporal) ──────────
// Shleifer & Vishny también hacen una predicción TEMPORAL, no solo transversal: cuando el
// capital de arbitraje está bajo presión, los diferenciales se ENSANCHAN antes de cerrarse.
// Predicción falsable: la IC del score debe ser MENOR en los meses de más estrés.
// Segunda hipótesis preespecificada. No es un barrido: son dos, declaradas de antemano.
const stressVals = dates.map((d) => stressByDate.get(d)).filter((v) => v != null).sort((a, b) => a - b);
const sLo = stressVals.length ? stressVals[Math.floor(stressVals.length / 3)] : null;
const sHi = stressVals.length ? stressVals[Math.floor((2 * stressVals.length) / 3)] : null;
const stressIC = { calmo: [], medio: [], tenso: [] };
if (sLo != null && sHi != null) {
  for (const d of dates) {
    const st = stressByDate.get(d);
    if (st == null) continue;
    const g = rows.filter((r) => r.date === d);
    if (g.length < 5) continue;
    const c = spearman(g.map((r) => r.score), g.map((r) => r.fwd));
    if (c == null) continue;
    (st <= sLo ? stressIC.calmo : st >= sHi ? stressIC.tenso : stressIC.medio).push(c);
  }
}
console.log("\n  ── H2 · estrés de capital (proxy: composite credit_stress) ──");
console.log("  régimen de estrés   IC (score→3M)   meses   MDE");
const stressBuckets = {};
for (const b of ["calmo", "medio", "tenso"]) {
  const ic = mean(stressIC[b]);
  const n = stressIC[b].length;
  const mde = n > 0 ? (2.8 * IC_SD) / Math.sqrt(n) : null;
  stressBuckets[b] = { ic, months: n, mde, detectable: ic != null && mde != null && Math.abs(ic) >= mde };
  console.log(`  ${b.padEnd(19)} ${fmtIC(ic).padStart(13)}   ${String(n).padStart(5)}   ${mde ? mde.toFixed(3) : "—"}`);
}
const stressSpread = stressBuckets.tenso.ic != null && stressBuckets.calmo.ic != null
  ? stressBuckets.tenso.ic - stressBuckets.calmo.ic : null;
const stressMde = stressBuckets.tenso.months && stressBuckets.calmo.months
  ? 2.8 * IC_SD * Math.sqrt(1 / stressBuckets.tenso.months + 1 / stressBuckets.calmo.months) : null;
const stressVerdict = stressSpread == null || stressMde == null
  ? "SIN DATOS."
  : stressSpread < -stressMde
    ? `CONSISTENTE CON H2 — la IC cae ${Math.abs(stressSpread).toFixed(3)} en meses de estrés alto (MDE ${stressMde.toFixed(3)}). Apoya usar el estrés como puerta de régimen.`
    : stressSpread > stressMde
      ? `CONTRARIO A H2 — la IC SUBE con el estrés (${stressSpread.toFixed(3)}, MDE ${stressMde.toFixed(3)}).`
      : `NO CONCLUYENTE — diferencial ${stressSpread.toFixed(3)} con MDE de contraste ${stressMde.toFixed(3)}. La muestra no puede decidirlo; ampliar ventana, no probar más variantes.`;
console.log(`  diferencial tenso − calmo: ${fmtIC(stressSpread)}  (MDE ${stressMde ? stressMde.toFixed(3) : "—"})`);
console.log(`  VEREDICTO H2: ${stressVerdict}\n`);

const out = {
  generatedAt: new Date().toISOString(),
  hypothesis: "IC(friccion alta) > IC(friccion baja) — Shleifer-Vishny (1997) + Pontiff (2006). Preespecificada: 1 ensayo, no un barrido.",
  hypothesis2: "IC menor en meses de estres de capital alto — la prediccion TEMPORAL de Shleifer-Vishny. Segunda hipotesis preespecificada.",
  stressGate: { buckets: stressBuckets, spread: stressSpread, spreadMde: stressMde, verdict: stressVerdict, proxy: "composite credit_stress de regimeAsOf" },
  mode: FULL ? "full-sp500-pit" : "curated",
  universe: UNIVERSE.length,
  months: dates.length,
  nameMonths: rows.length,
  fwdMonths: FWD_MONTHS,
  volWindowSessions: VOL_WINDOW,
  icStdDevAssumed: IC_SD,
  // `results` con `sharpe` ausente a propósito: esto mide IC, no una cartera. El libro de
  // ensayos cuenta las entradas de results, así que aquí suma 3 (un tercil cada una).
  results: buckets,
  spread, spreadMde, verdict,
  caveats: [
    FULL ? "membresía point-in-time del S&P 500" : "universo curado: sesgo de supervivencia",
    "vol idiosincrática = residuo de un modelo de mercado de 1 factor sobre 250 sesiones que terminan en la fecha as-of",
    "terciles transversales dentro de cada mes, no sobre toda la muestra",
    "el MDE del contraste es mayor que el de cada tercil: son dos medias, no una",
    "H2 usa el composite credit_stress como PROXY del estres de capital de arbitraje: regimeAsOf no expone hy_oas/vix/nfci en crudo, asi que mide condiciones de credito, que es la mitad del fenomeno",
    "dos hipotesis preespecificadas, no un barrido: suman al libro de ensayos lo que corresponde y nada mas",
  ],
};
writeFileSync(join(OUT, "factor_lab.json"), JSON.stringify(out, null, 2));
console.log(`  → research/out/factor_lab.json`);
console.log(`  Recuerda: node --experimental-strip-types research/trialsLedger.mjs para actualizar el libro de ensayos.\n`);
