// ─────────────────────────────────────────────────────────────────────────────
// LABORATORIO DEL VETO FORENSE (Fase F3) — las tres hipótesis, PRE-REGISTRADAS
//
// Escritas en PLAN_SCORA_FORENSE.md §3 ANTES de medir nada. Se ejecutan en este orden y no
// en otro, y el orden es la parte importante:
//
//   HF3 · EL FALSADOR, y manda sobre las otras dos. El veto NO PUEDE excluir a los nombres
//         del decil superior de rentabilidad futura a una tasa mayor que a los demás. Si lo
//         hace, no es un filtro de calidad contable: es un filtro de CRECIMIENTO disfrazado,
//         y se descarta aunque HF1 y HF2 salgan bien.
//
//         Existe por un caso con nombre: de los 40 mejores por calidad a 2025-06-02, ocho
//         tenían devengos de baja calidad y el primero era NVDA. El ratio de Sloan castiga el
//         crecimiento del circulante, así que confunde crecer con inflar. Este repositorio ya
//         cometió ese error —la regla de 180 días vendía a los ganadores y costó 63-74 pp—.
//
//   HF1 · LA COHORTE. Entre los nombre-fecha que superan el percentil 70 de calidad, el
//         quintil de peores devengos rinde menos a 12 meses que el de mejores, CON EL MISMO
//         SIGNO en las dos ventanas. Error estándar de Newey-West por solapamiento.
//
//   HF2 · LA CARTERA. Comprobación de sanidad, NO evidencia: con 49 y 54 posiciones en quince
//         años, un veto que marca al 8 % toca 4 nombres. Eso no se mide, se cuenta.
//
// El MDE se calcula y se imprime ANTES del resultado, para que no haya forma de acomodar el
// listón a lo que salga.
//
//   node --experimental-strip-types --no-warnings research/forense_lab.mjs [--long]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { devengos, beneish, piotroski, vetados, BENEISH_UMBRAL, PIOTROSKI_MIN, ACCRUALS_PCTL } from "./forenseSignal.mjs";
import * as px from "./prices.mjs";
import * as pxl from "./pricesLong.mjs";

const LONG = process.argv.includes("--long");
const REBUILD = process.argv.includes("--rebuild");
const VENTANA = LONG ? "2011-2018" : "2019-2026";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const PANEL_SENAL = join(OUT, `picks_signal_panel_${VENTANA}.json`);
const PANEL_FORENSE = join(OUT, `forense_panel_${VENTANA}.json`);

// La caché de `prices.mjs` arranca en 2018-06: para la ventana antigua hay que usar la larga
// o los retornos futuros salen todos a null sin decir por qué (`fuente-precios-por-ventana`).
const precio = LONG ? pxl : px;

if (!existsSync(PANEL_SENAL)) {
  console.error(`  ✖ falta ${PANEL_SENAL.split(/[\\/]/).pop()}. Constrúyelo antes con:`);
  console.error(`      node --experimental-strip-types --no-warnings research/picks_rules_backtest.mjs --rebuild${LONG ? " --long" : ""}`);
  process.exit(1);
}
const senal = JSON.parse(readFileSync(PANEL_SENAL, "utf8"));
const fechas = senal.dates.filter((f) => Object.keys(senal.panel[f] ?? {}).length >= 50);
console.log(`\n  VETO FORENSE · ${VENTANA} · ${fechas.length} fechas de decisión\n`);

// ── Panel forense ─────────────────────────────────────────────────────────────────────────
let forense = null;
if (!REBUILD && existsSync(PANEL_FORENSE)) {
  const c = JSON.parse(readFileSync(PANEL_FORENSE, "utf8"));
  if (c.window === VENTANA && c.dates?.length === fechas.length) { forense = c.panel; console.log(`  panel forense en caché (${fechas.length} fechas)\n`); }
}
if (!forense) {
  const table = await loadSP500Historical();
  if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
  const sectorCache = new Map();
  forense = {};
  for (let i = 0; i < fechas.length; i++) {
    const f = fechas[i];
    const miembros = [...new Set(membersAsOf(table, f) || [])];
    const filas = [];
    for (const t of miembros) {
      try {
        const cik = await tickerToCik(t); if (!cik) continue;
        const fu = await fundamentalsAsOf(cik, f); if (!fu) continue;
        if (!sectorCache.has(t)) sectorCache.set(t, (await sicSector(cik)) || null);
        const pio = piotroski(fu);
        filas.push({ t, sector: sectorCache.get(t), accruals: devengos(fu), beneish: beneish(fu),
                     piotroski: pio ? pio.score : null, piotroskiMax: pio ? pio.max : null });
      } catch { /* saltar */ }
    }
    forense[f] = filas;
    process.stdout.write(`\r  construyendo panel forense  ${f}  ${filas.length} nombres   (${i + 1}/${fechas.length})   `);
  }
  writeFileSync(PANEL_FORENSE, JSON.stringify({ generatedAt: new Date().toISOString(), window: VENTANA, dates: fechas, panel: forense }));
  console.log(`\n  → ${PANEL_FORENSE.split(/[\\/]/).pop()}\n`);
}

// ── Utilidades estadísticas ───────────────────────────────────────────────────────────────
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const desv = (a) => { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/**
 * Error estándar de Newey-West sobre una serie de diferencias POR FECHA.
 *
 * Hace falta porque las rentabilidades a 12 meses medidas cada quincena se solapan: dos
 * observaciones consecutivas comparten once meses y medio de historia, así que tratarlas como
 * independientes multiplica la significación por un factor de tres o cuatro. El retardo es el
 * número de fechas que caben dentro del horizonte (24 quincenas ≈ 12 meses).
 */
function neweyWest(serie, retardo = 24) {
  const n = serie.length;
  if (n < 3) return null;
  const m = media(serie);
  const d = serie.map((x) => x - m);
  let g0 = d.reduce((s, x) => s + x * x, 0) / n;
  let suma = g0;
  for (let l = 1; l <= Math.min(retardo, n - 1); l++) {
    let g = 0;
    for (let i = l; i < n; i++) g += d[i] * d[i - l];
    g /= n;
    suma += 2 * (1 - l / (retardo + 1)) * g;
  }
  return Math.sqrt(Math.max(suma, 0) / n);
}

const HORIZONTE_MESES = 12;
const sumaMeses = (f, n) => { const d = new Date(f + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

// ── Retornos futuros a 12 meses para todo el panel ────────────────────────────────────────
console.log("  calculando rentabilidades a 12 meses…");
const fwd = {};                        // fecha → { ticker: retorno }
const ultima = fechas[fechas.length - 1];
for (const f of fechas) {
  const hasta = sumaMeses(f, HORIZONTE_MESES);
  if (hasta > ultima) continue;        // sin doce meses por delante no hay observación
  fwd[f] = {};
  for (const t of Object.keys(senal.panel[f] ?? {})) {
    try { const r = await precio.fwdReturn(t, f, hasta); if (r != null && isFinite(r)) fwd[f][t] = r; } catch { /* sin precio */ }
  }
}
const fechasConFwd = Object.keys(fwd).filter((f) => Object.keys(fwd[f]).length >= 30);
console.log(`  ${fechasConFwd.length} fechas con rentabilidad futura utilizable\n`);
if (fechasConFwd.length < 12) { console.error("  ✖ muy pocas fechas: no se mide"); process.exit(1); }

// ── La cohorte elegible: los que superan el percentil de entrada ──────────────────────────
const ENTRADA = 0.70;
const sectorDe = (() => {
  const m = new Map();
  for (const f of fechas) for (const r of forense[f]) if (r.sector) m.set(r.t, r.sector);
  return (t) => m.get(t) ?? null;
})();

/** Para cada fecha: la cohorte con su veto y su rentabilidad futura. */
function cohortes(opciones) {
  const out = [];
  for (const f of fechasConFwd) {
    const sig = senal.panel[f] ?? {};
    const elegibles = Object.keys(sig).filter((t) => sig[t] >= ENTRADA && fwd[f][t] != null);
    if (elegibles.length < 20) continue;
    const filas = forense[f].filter((r) => elegibles.includes(r.t));
    const { marcas, cobertura } = vetados(filas, { sectorDe, ...opciones });
    out.push({ fecha: f, elegibles, marcas, cobertura, filas });
  }
  return out;
}

const resultados = { ventana: VENTANA, fechas: fechasConFwd.length, horizonteMeses: HORIZONTE_MESES, entrada: ENTRADA };

// ══ HF3 · EL FALSADOR — se ejecuta PRIMERO ════════════════════════════════════════════════
console.log("  ══ HF3 · ¿el veto se come a los ganadores? ══════════════════════════════════\n");
{
  const porFecha = [];
  let vetTop = 0, nTop = 0, vetResto = 0, nResto = 0;
  const ganadoresVetados = [];
  for (const c of cohortes({})) {
    const rets = c.elegibles.map((t) => ({ t, r: fwd[c.fecha][t] })).sort((a, b) => b.r - a.r);
    const corte = Math.max(1, Math.round(rets.length * 0.10));
    const top = new Set(rets.slice(0, corte).map((x) => x.t));
    let vt = 0, vr = 0;
    for (const t of c.elegibles) {
      const vetado = c.marcas.has(t);
      if (top.has(t)) { nTop++; if (vetado) { vetTop++; vt++; ganadoresVetados.push({ fecha: c.fecha, t, ret: +(fwd[c.fecha][t] * 100).toFixed(1), motivos: c.marcas.get(t) }); } }
      else { nResto++; if (vetado) { vetResto++; vr++; } }
    }
    porFecha.push((vt / Math.max(1, corte)) - (vr / Math.max(1, c.elegibles.length - corte)));
  }
  const tasaTop = vetTop / Math.max(1, nTop), tasaResto = vetResto / Math.max(1, nResto);
  const se = neweyWest(porFecha);
  const mde = se != null ? 2.8 * se : null;      // 80 % de potencia, 5 % a dos colas
  const dif = tasaTop - tasaResto;

  console.log(`  MDE (calculado ANTES de mirar el resultado): ${mde != null ? (mde * 100).toFixed(1) + " pp" : "—"}`);
  console.log(`  tasa de veto en el decil GANADOR : ${(tasaTop * 100).toFixed(1)} %   (${vetTop}/${nTop})`);
  console.log(`  tasa de veto en el resto         : ${(tasaResto * 100).toFixed(1)} %   (${vetResto}/${nResto})`);
  console.log(`  diferencia                       : ${(dif * 100).toFixed(1)} pp   ±${se != null ? (se * 100).toFixed(1) : "—"} (Newey-West)`);
  const falla = mde != null && dif > mde;
  console.log(`\n  ${falla ? "✖ HF3 FALLA" : "✓ HF3 pasa"}: el veto ${falla ? "SÍ" : "no"} castiga a los ganadores por encima del MDE.`);
  if (ganadoresVetados.length) {
    console.log(`\n  ganadores vetados (muestra de los mejores):`);
    for (const g of ganadoresVetados.sort((a, b) => b.ret - a.ret).slice(0, 10)) {
      console.log(`    ${g.fecha}  ${g.t.padEnd(6)} +${String(g.ret).padStart(6)} %   por ${g.motivos.join(", ")}`);
    }
  }
  resultados.HF3 = { tasaTop, tasaResto, diferencia: dif, se, mde, pasa: !falla, nTop, nResto,
                     ganadoresVetados: ganadoresVetados.sort((a, b) => b.ret - a.ret).slice(0, 40) };
}

// ══ HF1 · LA COHORTE ══════════════════════════════════════════════════════════════════════
console.log("\n  ══ HF1 · ¿los peores devengos rinden menos dentro de la cohorte? ═══════════\n");
{
  const spreads = [];
  let nObs = 0;
  for (const c of cohortes({})) {
    const conAcc = c.filas.filter((r) => r.accruals != null && fwd[c.fecha][r.t] != null);
    if (conAcc.length < 25) continue;
    const orden = [...conAcc].sort((a, b) => a.accruals - b.accruals);   // menor devengo = mejor
    const q = Math.max(3, Math.floor(orden.length / 5));
    const mejores = orden.slice(0, q).map((r) => fwd[c.fecha][r.t]);
    const peores = orden.slice(-q).map((r) => fwd[c.fecha][r.t]);
    spreads.push(media(mejores) - media(peores));
    nObs += conAcc.length;
  }
  const m = media(spreads), se = neweyWest(spreads), mde = se != null ? 2.8 * se : null;
  console.log(`  MDE (antes de mirar): ${mde != null ? (mde * 100).toFixed(1) + " pp" : "—"}`);
  console.log(`  fechas con cohorte suficiente: ${spreads.length}   ·   observaciones nombre-fecha: ${nObs}`);
  console.log(`  quintil de MEJORES devengos − quintil de PEORES, a 12 meses:`);
  console.log(`    ${m != null ? (m * 100).toFixed(2) + " pp" : "—"}   ±${se != null ? (se * 100).toFixed(2) : "—"}   t = ${m != null && se ? (m / se).toFixed(2) : "—"}`);
  const significativo = m != null && mde != null && Math.abs(m) > mde;
  console.log(`\n  ${significativo ? (m > 0 ? "✓ los mejores devengos rinden MÁS" : "✖ los mejores devengos rinden MENOS (signo contrario)") : "○ dentro del ruido: no se puede afirmar nada"}`);
  resultados.HF1 = { spread: m, se, mde, t: m != null && se ? m / se : null, fechas: spreads.length, nObs, significativo, signo: m > 0 ? "+" : "−" };
}

// ══ HF2 · LA CARTERA (comprobación de sanidad, NO evidencia) ══════════════════════════════
console.log("\n  ══ HF2 · efecto sobre la cartera — SIN POTENCIA, es una comprobación ═══════\n");
{
  let tocadas = 0, total = 0;
  for (const c of cohortes({})) {
    const sig = senal.panel[c.fecha] ?? {};
    const top40 = Object.entries(sig).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 40).map(([t]) => t);
    total += top40.length;
    tocadas += top40.filter((t) => c.marcas.has(t)).length;
  }
  console.log(`  del top 40 por calidad, marcados por el veto: ${tocadas}/${total}  (${(100 * tocadas / Math.max(1, total)).toFixed(1)} %)`);
  console.log(`  ⚠ la v2 abre 49 posiciones en 2019-2026 y 54 en 2011-2018. Un veto que marca a`);
  console.log(`    este ritmo toca un puñado de nombres: no hay potencia para medir su efecto`);
  console.log(`    sobre la rentabilidad final, y así se reporta.`);
  resultados.HF2 = { marcadosEnTop40: tocadas, deTop40: total, pct: +(100 * tocadas / Math.max(1, total)).toFixed(1), nota: "sin potencia: comprobación, no evidencia" };
}

// ── Cobertura del veto: sin esto, un filtro parcial es un sesgo mudo ──────────────────────
{
  const cs = cohortes({});
  const suma = cs.reduce((a, c) => ({ accruals: a.accruals + c.cobertura.accruals, beneish: a.beneish + c.cobertura.beneish,
                                      piotroski: a.piotroski + c.cobertura.piotroski, total: a.total + c.cobertura.total }),
                         { accruals: 0, beneish: 0, piotroski: 0, total: 0 });
  console.log(`\n  cobertura del veto sobre la cohorte elegible:`);
  for (const k of ["accruals", "beneish", "piotroski"]) {
    console.log(`    ${k.padEnd(11)} ${suma[k]}/${suma.total}  ${(100 * suma[k] / Math.max(1, suma.total)).toFixed(1)} %`);
  }
  resultados.cobertura = suma;
}

resultados.generatedAt = new Date().toISOString();
resultados.parametros = { BENEISH_UMBRAL, PIOTROSKI_MIN, ACCRUALS_PCTL, ENTRADA, HORIZONTE_MESES };
resultados.orden = "HF3 se ejecuta primero y manda: si el veto castiga a los ganadores, HF1 y HF2 son irrelevantes.";
const ruta = join(OUT, `forense_lab${LONG ? "_oos" : ""}.json`);
writeFileSync(ruta, JSON.stringify(resultados, null, 1));
console.log(`\n  → ${ruta}\n`);
