// ─────────────────────────────────────────────────────────────────────────────
// ¿EL SCORE v2 (percentiles sector-relativos) ES MEJOR QUE EL v1 (bandas absolutas)?
//
// Hasta ahora v2 se justificaba por ARGUMENTO —"un PER de 12 no significa lo mismo en un
// banco que en una utility"— y por una medición de impacto que sólo decía CUÁNTO cambia,
// no si cambia a mejor. Esto lo mide contra retornos futuros, que es lo único que decide.
//
// SIN LOOK-AHEAD: cada fecha usa la distribución sectorial más reciente ANTERIOR a ella
// (`factor_dist_history.mjs`, semestral). Nunca se juzga 2019 con los múltiplos de 2026.
//
// EL DISEÑO ESTADÍSTICO IMPORTA. Medir "IC de v2" y "IC de v1" por separado y compararlos
// a ojo sería repetir el error que ya cazó la auditoría del momentum: con sigma ~0,2 el
// efecto mínimo detectable ronda 0,06 y ninguno de los dos IC sería distinguible de cero.
// Pero aquí la comparación es PAREADA —mismo universo, misma fecha, mismos retornos, sólo
// cambia la fórmula—, así que lo que se contrasta es la DIFERENCIA mes a mes, donde el
// ruido común se cancela y la potencia es muchísimo mayor.
//
//   node --experimental-strip-types --no-warnings research/score_v2_validate.mjs [--cap 400]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { collectRows } from "./factorDistCore.mjs";
import { fwdReturn } from "./prices.mjs";
import { calcScores } from "../lib/scoring.ts";
import { addMonths, monthStarts, mean, std, fx, spearman } from "./momentumSignals.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const CAP = Number(arg("--cap", "400"));
const COST_BPS = 10;

const histFile = join(OUT, "factor_dist_history.json");
if (!existsSync(histFile)) { console.error("  ✖ falta factor_dist_history.json — correr antes research/factor_dist_history.mjs"); process.exit(1); }
const HIST = JSON.parse(readFileSync(histFile, "utf8")).history;
const HIST_DATES = Object.keys(HIST).sort();

/** La distribución vigente en una fecha = la más reciente ANTERIOR o igual. Aquí vive el
 *  point-in-time: si se cogiera la más cercana (aunque fuese posterior) el backtest estaría
 *  usando información del futuro y v2 saldría ganando por construcción. */
function distAsOf(fecha) {
  let elegida = null;
  for (const d of HIST_DATES) { if (d <= fecha) elegida = d; else break; }
  return elegida ? HIST[elegida] : null;
}

const today = new Date().toISOString().slice(0, 10);
const START = arg("--from", "2019-01-01");
const END = addMonths(today, -2);
// Trimestral: los fundamentales son trimestrales y las distribuciones semestrales, así que
// scorear cada mes multiplicaría el coste de EDGAR sin añadir información independiente.
const fechas = monthStarts(START, END).filter((_, i) => i % 3 === 0);

const table = await loadSP500Historical();
console.log(`\n  VALIDACIÓN v1 (bandas) vs v2 (percentiles PIT) · ${fechas.length} trimestres ${fechas[0]} → ${fechas.at(-1)}\n`);

const sectorCache = new Map();
const porFecha = new Map();
for (const fecha of fechas) {
  const dist = distAsOf(fecha);
  if (!dist) { console.log(`  ${fecha}  sin distribución previa → se omite (no se usa una futura)`); continue; }
  const miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
  // ⚠️ NO truncar: `membersAsOf` devuelve los tickers EN ORDEN ALFABÉTICO, así que un
  // slice(0, N) borraba sistemáticamente de la S a la Z — 99 nombres en 2020, entre ellos
  // UnitedHealth, Visa, Walmart, Exxon, Verizon y Wells Fargo. Un universo truncado por la
  // inicial no es "el S&P 500". Si hace falta limitar por coste, se limita por FRECUENCIA
  // de pertenencia (como los labs de momentum), nunca por orden alfabético.
  if (CAP > 0 && miembros.length > CAP) {
    console.log(`  ⚠ CAP=${CAP} ignorado: truncar por orden alfabético sesgaría el universo. Usando los ${miembros.length} miembros.`);
  }
  const filas = await collectRows(miembros, fecha, sectorCache);
  const bucket = [];
  for (const f of filas) {
    const inputs = { ...f.m, sector: f.sector };
    const v1 = calcScores(inputs);            // bandas absolutas
    const v2 = calcScores(inputs, dist);      // percentiles sector-relativos, PIT
    const fwd3 = await fwdReturn(f.ticker, fecha, addMonths(fecha, 3));
    if (fwd3 == null) continue;
    bucket.push({ t: f.ticker, sector: f.sector, v1: v1.total, v2: v2.total, fwd3 });
  }
  if (bucket.length >= 30) porFecha.set(fecha, bucket);
  console.log(`  ${fecha}  ${String(bucket.length).padStart(3)} nombres`);
}

const fechasOk = [...porFecha.keys()];
if (fechasOk.length < 8) { console.error("  ✖ muy pocas fechas para concluir"); process.exit(1); }

// ── IC pareado por fecha ─────────────────────────────────────────────────────────
const ic1 = [], ic2 = [], dif = [];
for (const f of fechasOk) {
  const b = porFecha.get(f);
  const a = spearman(b.map((r) => r.v1), b.map((r) => r.fwd3));
  const c = spearman(b.map((r) => r.v2), b.map((r) => r.fwd3));
  if (a == null || c == null) continue;
  ic1.push(a); ic2.push(c); dif.push(c - a);
}
const tOf = (arr) => { const m = mean(arr), s = std(arr); return s ? m / (s / Math.sqrt(arr.length)) : null; };
const t1 = tOf(ic1), t2 = tOf(ic2), tD = tOf(dif);
const mde = (arr) => 2.8 * std(arr) / Math.sqrt(arr.length);

console.log(`\n  ── IC vs retorno a 3 meses (${ic1.length} trimestres) ──`);
console.log(`  v1 bandas absolutas       IC ${mean(ic1) >= 0 ? "+" : ""}${mean(ic1).toFixed(4)}   t=${(t1 ?? 0).toFixed(2)}   (MDE ${mde(ic1).toFixed(4)})`);
console.log(`  v2 percentiles PIT        IC ${mean(ic2) >= 0 ? "+" : ""}${mean(ic2).toFixed(4)}   t=${(t2 ?? 0).toFixed(2)}   (MDE ${mde(ic2).toFixed(4)})`);
console.log(`  DIFERENCIA PAREADA (v2−v1) ${mean(dif) >= 0 ? "+" : ""}${mean(dif).toFixed(4)}   t=${(tD ?? 0).toFixed(2)}   (MDE ${mde(dif).toFixed(4)})  ← el contraste con potencia`);
console.log(`  v2 gana en ${dif.filter((x) => x > 0).length}/${dif.length} trimestres`);

// ── carteras: decil superior de cada versión, contra las tres referencias ────────
function curva(sel) {
  let eq = 1, peak = 1, mdd = 0; const rets = []; let prev = new Set();
  for (const f of fechasOk) {
    const b = porFecha.get(f);
    const held = sel(b);
    const rs = held.map((r) => r.fwd3).filter((x) => x != null);
    const r = rs.length ? mean(rs) : 0;
    const set = new Set(held.map((x) => x.t));
    let nuevos = 0; for (const t of set) if (!prev.has(t)) nuevos++;
    const net = r - (set.size ? nuevos / set.size : 0) * 2 * COST_BPS / 100;
    rets.push(net); eq *= 1 + net / 100; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); prev = set;
  }
  const años = (fechasOk.length * 3) / 12;
  return { total: (eq - 1) * 100, cagr: (Math.pow(eq, 1 / años) - 1) * 100, sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(4) : 0, maxDD: mdd * 100 };
}
const topN = (b, key) => { const n = Math.max(1, Math.floor(b.length / 10)); return [...b].sort((x, y) => y[key] - x[key]).slice(0, n); };
const c1 = curva((b) => topN(b, "v1"));
const c2 = curva((b) => topN(b, "v2"));
const cEW = curva((b) => b);   // el universo entero equiponderado: la referencia honesta

console.log(`\n  ── CARTERAS (decil superior, trimestral, neto de costes) ──`);
console.log(`  ${"".padEnd(30)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(8)}${"vs EW".padStart(9)}`);
const pr = (n, s, ref) => console.log(`  ${n.padEnd(30)}${("+" + s.total.toFixed(0) + "%").padStart(9)}${(s.cagr.toFixed(1) + "%").padStart(8)}${s.sharpe.toFixed(2).padStart(8)}${(s.maxDD.toFixed(1) + "%").padStart(8)}${(ref == null ? "—" : ((s.total - ref >= 0 ? "+" : "") + (s.total - ref).toFixed(0) + "pp")).padStart(9)}`);
pr("Universo EW (sin seleccionar)", cEW, null);
pr("Decil top · v1 bandas", c1, cEW.total);
pr("Decil top · v2 percentiles", c2, cEW.total);

// ── veredicto, con la disciplina de la casa ──────────────────────────────────────
const mejoraIC = mean(dif) > 0 && Math.abs(tD ?? 0) > 1.96;
const mejoraCartera = c2.total > c1.total;
const bateEW = c2.total > cEW.total;
const veredicto = mejoraIC && mejoraCartera
  ? "v2 MEJORA a v1 de forma estadísticamente sólida y también en cartera."
  : mejoraCartera && mean(dif) > 0
    ? "v2 va por delante de v1 en IC y en cartera, pero la diferencia NO alcanza significancia: es una mejora plausible, no demostrada."
    : mean(dif) > 0
      ? "v2 tiene mejor IC que v1 pero no se traduce en cartera: mejora de medición, no de rentabilidad."
      : "v2 NO mejora a v1 contra retornos. Se sostiene sólo como mejora de coherencia interna, y hay que decirlo así.";
console.log(`\n  VEREDICTO: ${veredicto}`);
if (!bateEW) console.log(`  ⚠ Ninguna de las dos versiones bate al universo equiponderado — el score ordena, pero seleccionar por él no ha pagado en esta ventana.`);

writeFileSync(join(OUT, "score_v2_validate.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), quarters: ic1.length, universeCap: CAP,
  window: { start: fechasOk[0], end: fechasOk.at(-1) },
  ic: { v1: fx(mean(ic1)), v1_t: fx(t1, 2), v2: fx(mean(ic2)), v2_t: fx(t2, 2),
        pairedDiff: fx(mean(dif)), pairedDiff_t: fx(tD, 2), pairedMDE: fx(mde(dif)),
        v2WinsQuarters: dif.filter((x) => x > 0).length },
  portfolios: { universeEW: { total: fx(cEW.total, 1), sharpe: fx(cEW.sharpe, 2) },
                v1: { total: fx(c1.total, 1), sharpe: fx(c1.sharpe, 2) },
                v2: { total: fx(c2.total, 1), sharpe: fx(c2.sharpe, 2) } },
  verdict: veredicto, beatsEqualWeight: bateEW,
}, null, 2));
console.log(`\n  → escrito research/out/score_v2_validate.json\n`);
