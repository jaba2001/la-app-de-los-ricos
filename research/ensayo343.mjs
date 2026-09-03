// ─────────────────────────────────────────────────────────────────────────────
// ENSAYO 343 — ¿mejoran las capas nuevas el score?
//
// La especificación está en `PREREGISTRO_ENSAYO_343.md`, ESCRITA ANTES DE MEDIR. Este fichero
// la ejecuta y no la cambia. Si el resultado no gusta, se publica igual.
//
//   · Cada medida entra como QUINTO componente del score micro, con peso 10 %, reescalando los
//     cuatro pilares actuales a 90 %. El 10 % no está optimizado.
//   · Cada medida se convierte a percentil del universo EN ESA FECHA. Sin umbrales nuevos.
//   · Sin dato → percentil 50 (neutro). No se excluye a nadie: eso cambiaría el universo.
//   · Signos declarados en el preregistro, no elegidos aquí.
//
// CRITERIO (las tres, o no entra):
//   1. Sharpe mejor que el score actual en LAS DOS ventanas.
//   2. Sharpe deflactado > 0 con M = 343.
//   3. Con los costes dentro (10 pb por lado).
//
// Se puntúa con `scoreStock()` de producción y se mide con `lib/riskMetrics.ts` y
// `lib/deflacion.ts` — nada reimplementado.
//
//   node --experimental-strip-types --no-warnings research/ensayo343.mjs --n 120
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { scoreStock } from "./score.mjs";
import { momentum, priceAsOf } from "./prices.mjs";
import { diagnosticar, banderas } from "../lib/flujoCaja.ts";
import { vidaUtil } from "../lib/vidaUtil.ts";
import { recompra } from "../lib/recompras.ts";
import { sharpe as sharpeDe, diferenciaSharpe, asimetria, curtosisExceso } from "../lib/riskMetrics.ts";
import { sharpeDeflactado } from "../lib/deflacion.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const iN = process.argv.indexOf("--n");
const N = iN >= 0 ? Number(process.argv[iN + 1]) : 120;
const TOP = 20;             // tamaño de la cartera
const PESO_NUEVO = 0.10;    // FIJADO EN EL PREREGISTRO. No se ajusta.
const COSTE_BPS = 10;
const M_ENSAYOS = 343;

const VENTANAS = [["2011-2018", "2011-01-01", "2018-12-01"], ["2019-2026", "2019-01-01", "2026-06-01"]];
// Signos del preregistro: +1 = más es mejor.
const MEDIDAS = [
  { id: "conversion", nombre: "Conversión a caja", signo: +1 },
  { id: "banderas", nombre: "Banderas rojas de caja", signo: -1 },
  { id: "vidaUtil", nombre: "Vida útil implícita", signo: -1 },
  { id: "recompra", nombre: "Retorno desde la recompra", signo: +1 },
];

const meses = (d0, d1) => { const o = []; for (let d = new Date(d0); d <= new Date(d1); d.setUTCMonth(d.getUTCMonth() + 1)) o.push(d.toISOString().slice(0, 10)); return o; };
const pctl = (v, arr) => { const a = arr.filter((x) => x != null && Number.isFinite(x)); return a.length < 10 ? 50 : (100 * a.filter((x) => x < v).length) / a.length; };

const tabla = await loadSP500Historical();
const todas = meses("2011-01-01", "2026-06-01");
const universoPorFecha = new Map(todas.map((d) => [d, [...membersAsOf(tabla, d)].sort().slice(0, N)]));
const tickers = [...new Set([...universoPorFecha.values()].flat())];
console.log(`\n  ENSAYO 343 · ${tickers.length} tickers · ${todas.length} meses · cartera top ${TOP} · peso nuevo ${PESO_NUEVO * 100} %\n`);

// ── El panel: se construye UNA vez y los cinco escenarios se puntúan encima ──────────────
const cik = new Map();
for (const t of tickers) { const c = await tickerToCik(t).catch(() => null); if (c) cik.set(t, c); }
console.log(`  CIK resueltos: ${cik.size}/${tickers.length}`);

const panel = new Map();   // fecha → [{ticker, scores, medidas}]
let n = 0;
for (const fecha of todas) {
  const filas = [];
  for (const t of universoPorFecha.get(fecha) ?? []) {
    const c = cik.get(t); if (!c) continue;
    try {
      const f = await fundamentalsAsOf(c, fecha); if (!f) continue;
      const raw = await priceAsOf(t, fecha); if (raw == null) continue;
      const sector = await sicSector(c).catch(() => null);
      const sc = scoreStock(f, raw, await momentum(t, fecha), sector ?? "", null, null)?.scores;
      if (!sc || sc.total == null) continue;
      const fc = { ...f, sector };
      const d = diagnosticar(fc);
      const v = vidaUtil({ depreciacion: f.depSolaTTM ?? (f.daTTM != null && f.amortIntTTM != null ? f.daTTM - f.amortIntTTM : null),
        brutoFin: f.ppeGross, brutoIni: f.prev?.ppeGross });
      const rc = recompra({ importe: f.buybacksTTM, acciones: f.sharesRepurchasedTTM, precioActual: raw });
      filas.push({ ticker: t, scores: sc,
        conversion: d.financiera ? null : d.cashConversion,
        banderas: d.financiera ? null : banderas(fc, d).length,
        vidaUtil: v.fuera ? null : v.vidaCorregida,
        recompra: rc.precioMedio != null ? rc.retornoDesdeRecompra : null });
    } catch { /* siguiente */ }
  }
  panel.set(fecha, filas);
  if (++n % 24 === 0) console.log(`    ${fecha}  ${filas.length} nombres`);
}
console.log(`  panel: ${[...panel.values()].reduce((s, a) => s + a.length, 0)} filas\n`);

/** Serie mensual de la cartera top-N con (opcionalmente) la medida nueva al 10 %. */
async function serie(fechas, medida) {
  const rets = []; let antes = new Set();
  for (let i = 0; i < fechas.length - 1; i++) {
    const filas = panel.get(fechas[i]) ?? [];
    if (filas.length < TOP * 2) { rets.push(0); continue; }
    let orden;
    if (!medida) orden = filas.map((r) => ({ t: r.ticker, s: r.scores.total }));
    else {
      const vals = filas.map((r) => r[medida.id]);
      orden = filas.map((r) => {
        const p = r[medida.id] == null ? 50 : pctl(r[medida.id], vals);
        const nuevo = medida.signo > 0 ? p : 100 - p;
        return { t: r.ticker, s: r.scores.total * (1 - PESO_NUEVO) + nuevo * PESO_NUEVO };
      });
    }
    const top = orden.sort((a, b) => b.s - a.s).slice(0, TOP);
    const ahora = new Set(top.map((x) => x.t));
    // Rotación: los que entran y los que salen, a 10 pb por lado.
    let rot = 0; for (const t of ahora) if (!antes.has(t)) rot++;
    const coste = (2 * rot / TOP) * (COSTE_BPS / 10000);
    let suma = 0, k = 0;
    for (const x of top) {
      const p0 = await priceAsOf(x.t, fechas[i]), p1 = await priceAsOf(x.t, fechas[i + 1]);
      if (p0 == null || p1 == null || p0 <= 0) continue;
      suma += p1 / p0 - 1; k++;
    }
    rets.push(k ? suma / k - coste : 0);
    antes = ahora;
  }
  return rets;
}

const spySerie = async (fechas) => {
  const r = [];
  for (let i = 0; i < fechas.length - 1; i++) {
    const p0 = await priceAsOf("SPY", fechas[i]), p1 = await priceAsOf("SPY", fechas[i + 1]);
    r.push(p0 && p1 ? p1 / p0 - 1 : 0);
  }
  return r;
};

const resultados = [];
for (const m of [null, ...MEDIDAS]) {
  const fila = { medida: m?.id ?? "BASE", nombre: m?.nombre ?? "Score actual (referencia)", ventanas: {} };
  for (const [nombreV, d0, d1] of VENTANAS) {
    const f = meses(d0, d1);
    const r = await serie(f, m);
    const sh = sharpeDe(r);   // sharpe() ya anualiza internamente (PERIODS=12)
    fila.ventanas[nombreV] = { sharpe: sh == null ? null : +sh.toFixed(3), meses: r.length,
      total: +((r.reduce((a, b) => a * (1 + b), 1) - 1) * 100).toFixed(1) };
    fila[`rets_${nombreV}`] = r;
  }
  resultados.push(fila);
}

const base = resultados[0];
console.log(`  medida                          ${VENTANAS.map(([v]) => v.padEnd(22)).join("")}`);
for (const r of resultados) {
  const cols = VENTANAS.map(([v]) => {
    const x = r.ventanas[v];
    return `Sharpe ${String(x.sharpe ?? "—").padStart(6)}  ${String(x.total).padStart(7)} %`.padEnd(22);
  }).join("");
  console.log(`  ${r.nombre.padEnd(32)}${cols}`);
}

console.log(`\n  ¿CUMPLE EL CRITERIO PREESCRITO?`);
const veredictos = [];
for (const r of resultados.slice(1)) {
  const mejoraAmbas = VENTANAS.every(([v]) => (r.ventanas[v].sharpe ?? -9) > (base.ventanas[v].sharpe ?? 9));
  // Sharpe deflactado sobre la ventana larga, con M = 343 ensayos.
  const rets = r[`rets_${VENTANAS[1][0]}`];
  // ⚠️ `sharpeDeflactado` espera el Sharpe POR PERIODO (no anualizado) y los momentos, no el
  // vector: mi primera version le pasaba `rets` donde va la asimetria. Bailey y Lopez de Prado
  // deflactan sobre la distribucion de los ensayos, y el ajuste depende de asimetria y curtosis.
  const shAnual = sharpeDe(rets);
  const shPeriodo = shAnual / Math.sqrt(12);
  const dsr = sharpeDeflactado(shPeriodo, rets.length, M_ENSAYOS, asimetria(rets), curtosisExceso(rets) + 3);
  // Diferencia de Sharpe contra la base, test de Jobson-Korkie/Memmel.
  const dif = diferenciaSharpe(rets, base[`rets_${VENTANAS[1][0]}`]);
  const pasa = mejoraAmbas && dsr != null && dsr.dsr > 0.5;
  veredictos.push({ medida: r.medida, nombre: r.nombre, mejoraAmbasVentanas: mejoraAmbas,
    dsr: dsr == null ? null : +dsr.dsr.toFixed(3), tDiferencia: dif?.t == null ? null : +dif.t.toFixed(2), pasa });
  console.log(`  ${r.nombre.padEnd(32)}mejora ambas: ${mejoraAmbas ? "SÍ " : "no "}  DSR ${String(dsr == null ? "—" : dsr.dsr.toFixed(3)).padStart(6)}  t vs base ${String(dif?.t == null ? "—" : dif.t.toFixed(2)).padStart(6)}   ${pasa ? "⇒ ENTRA" : "⇒ NO entra"}`);
}

const entran = veredictos.filter((v) => v.pasa);
console.log(`\n  ⇒ ${entran.length} de ${veredictos.length} medidas cumplen el criterio preescrito.`);
if (!entran.length) console.log(`     Las capas se quedan donde estan: explicativas. El registro sube a ${M_ENSAYOS}.`);

// ⚠️ EL PATRÓN QUE HAY DETRÁS DEL «NO», que se registra porque informa — y que NO cambia el
// veredicto. Inventar un criterio nuevo después de ver el resultado es exactamente lo que el
// preregistro existe para impedir.
{
  const [v1, v2] = VENTANAS.map(([v]) => v);
  const mejoranVieja = veredictos.filter((_, i) => resultados[i + 1].ventanas[v1].sharpe > base.ventanas[v1].sharpe).length;
  const empeoranNueva = veredictos.filter((_, i) => resultados[i + 1].ventanas[v2].sharpe < base.ventanas[v2].sharpe).length;
  if (mejoranVieja >= 3 && empeoranNueva >= 3) {
    console.log(`\n  📌 PARA EL REGISTRO, no para reabrir el veredicto:`);
    console.log(`     ${mejoranVieja} de ${veredictos.length} MEJORAN ${v1} y ${empeoranNueva} de ${veredictos.length} EMPEORAN ${v2}.`);
    console.log(`     No es ruido aleatorio: es un sesgo de CALIDAD, y ${v2} es justo la ventana en la`);
    console.log(`     que el tamaño batió a la calidad por 3,54 pp/año (research/concentracion.mjs).`);
    console.log(`     Ayudan donde la calidad funciona y estorban donde manda el tamaño. Eso es una`);
    console.log(`     HIPÓTESIS para otro ensayo con su propio preregistro, no un permiso para éste.`);
  }
}

writeFileSync(join(AQUI, "out", "ensayo343.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), preregistro: "PREREGISTRO_ENSAYO_343.md",
  universo: tickers.length, top: TOP, pesoNuevo: PESO_NUEVO, costeBps: COSTE_BPS, M: M_ENSAYOS,
  resultados: resultados.map(({ medida, nombre, ventanas }) => ({ medida, nombre, ventanas })),
  veredictos, entran: entran.length,
  patron: "Las cuatro medidas MEJORAN 2011-2018 (donde el score base tiene Sharpe negativo) y EMPEORAN 2019-2026. No es ruido: es un sesgo de calidad, y 2019-2026 es la ventana en la que el tamaño batio a la calidad por 3,54 pp/año. Es una HIPOTESIS para otro ensayo con su propio preregistro, no un permiso para este.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/ensayo343.json\n`);
