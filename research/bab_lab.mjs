// ─────────────────────────────────────────────────────────────────────────────
// BETTING-AGAINST-BETA en la forma que usa este producto (Fase F9)
//
// Hipótesis PRE-REGISTRADAS en PLAN_SCORA_FORENSE.md §9, escritas antes de tocar los datos.
// Se ejecutan en este orden y no en otro:
//
//   PUERTA · Si la correlación de rangos entre beta y `lowvol` supera 0,85, esto NO es una
//            señal nueva —`quality_lowvol_lab` ya la mide— y la hipótesis se retira sin
//            contrastarse ni contar como ensayo. Medir dos veces lo mismo infla el
//            denominador de la significancia sin aportar información.
//
//   HB3 ···· EL FALSADOR, y manda. Beta bajo no puede ser un proxy de sector. Si al
//            neutralizar por sector la ventaja desaparece, lo medido es «tener utilities y
//            consumo básico», que ya se sabe que es un sesgo sectorial y no una prima por
//            restricción de apalancamiento.
//
//   HB1 ···· Beta bajo solo bate al universo elegible EW, con el mismo signo en las dos
//            ventanas.
//
//   HB2 ···· Calidad + beta bajo bate a cada una por separado. Es lo que predice la
//            descomposición de Buffett: el alfa aparece al CRUZAR QMJ con BAB.
//
// El MDE se imprime ANTES del resultado. Con M = 309 ensayos gastados sobre la misma historia
// de mercado, el Sharpe esperado del mejor de la búsqueda bajo la nula es 1,15 anualizado.
//
//   node --experimental-strip-types --no-warnings research/bab_lab.mjs [--long] [--rebuild]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, sicSector } from "./edgar.mjs";
import { betaAt } from "./beta.mjs";
import { returnsSeries, fwdReturn } from "./prices.mjs";
import { returnsSeriesLong, fwdReturnLong } from "./pricesLong.mjs";

const LONG = process.argv.includes("--long");
const REBUILD = process.argv.includes("--rebuild");
const VENTANA = LONG ? "2011-2018" : "2019-2026";
const TOP_N = 40;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const PANEL_SENAL = join(OUT, `picks_signal_panel_${VENTANA}.json`);
const PANEL_BETA = join(OUT, `beta_panel_${VENTANA}.json`);

// La caché corta arranca en 2018-06 y beta necesita CINCO AÑOS de historia previa, así que
// hasta para la ventana reciente hace falta la larga. Sin esto, las primeras fechas saldrían
// sin beta y nadie se enteraría (`fuente-precios-por-ventana`).
const retornosDe = async (t) => {
  const larga = await returnsSeriesLong(t);
  if (larga?.length >= 500) return larga;
  return await returnsSeries(t);
};
const retornoFuturo = LONG ? fwdReturnLong : fwdReturn;   // los dos devuelven PORCENTAJE

if (!existsSync(PANEL_SENAL)) {
  console.error(`  ✖ falta ${PANEL_SENAL.split(/[\\/]/).pop()}`);
  process.exit(1);
}
const senal = JSON.parse(readFileSync(PANEL_SENAL, "utf8"));
const fechas = senal.dates.filter((f) => Object.keys(senal.panel[f] ?? {}).length >= 50);
console.log(`\n  BETTING-AGAINST-BETA · ${VENTANA} · ${fechas.length} fechas · top ${TOP_N}\n`);

// ── Panel de beta ─────────────────────────────────────────────────────────────────────────
let panelBeta = null;
if (!REBUILD && existsSync(PANEL_BETA)) {
  const c = JSON.parse(readFileSync(PANEL_BETA, "utf8"));
  if (c.window === VENTANA && c.dates?.length === fechas.length) { panelBeta = c.panel; console.log(`  panel de beta en caché\n`); }
}
if (!panelBeta) {
  const table = await loadSP500Historical();
  if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }
  const mercado = await retornosDe("SPY");
  if (!mercado?.length) { console.error("  ✖ sin serie del mercado (SPY)"); process.exit(1); }
  const cacheRet = new Map();
  panelBeta = {};
  for (let i = 0; i < fechas.length; i++) {
    const f = fechas[i];
    const miembros = [...new Set(membersAsOf(table, f) || [])];
    const fila = {};
    for (const t of miembros) {
      if (!cacheRet.has(t)) cacheRet.set(t, await retornosDe(t));
      const b = betaAt(cacheRet.get(t), mercado, f);
      if (b != null) fila[t] = +b.toFixed(4);
    }
    panelBeta[f] = fila;
    process.stdout.write(`\r  construyendo panel de beta  ${f}  ${Object.keys(fila).length} nombres   (${i + 1}/${fechas.length})   `);
  }
  writeFileSync(PANEL_BETA, JSON.stringify({ generatedAt: new Date().toISOString(), window: VENTANA, dates: fechas, panel: panelBeta }));
  console.log(`\n  → ${PANEL_BETA.split(/[\\/]/).pop()}\n`);
}

// ── Volatilidad, para la puerta previa ────────────────────────────────────────────────────
// Es la MISMA definición que usa `quality_lowvol_lab`: desviación típica de los retornos
// diarios del último año. Si se usara otra, la comparación no probaría nada.
const cacheRet2 = new Map();
async function volAt(t, hasta) {
  if (!cacheRet2.has(t)) cacheRet2.set(t, await retornosDe(t));
  const r = cacheRet2.get(t);
  if (!r?.length) return null;
  const hasta_ = r.filter((x) => x.date <= hasta).slice(-252).map((x) => x.ret);
  if (hasta_.length < 120) return null;
  const m = hasta_.reduce((s, x) => s + x, 0) / hasta_.length;
  return Math.sqrt(hasta_.reduce((s, x) => s + (x - m) ** 2, 0) / (hasta_.length - 1));
}

/** Spearman con empates promediados. */
function spearman(mapaA, mapaB) {
  const ks = Object.keys(mapaA).filter((k) => mapaB[k] != null && mapaA[k] != null);
  if (ks.length < 30) return null;
  const rangos = (v) => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = m; i = j + 1; } return r; };
  const ra = rangos(ks.map((k) => mapaA[k])), rb = rangos(ks.map((k) => mapaB[k]));
  const n = ks.length, mu = (n + 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const u = ra[i] - mu, v = rb[i] - mu; num += u * v; da += u * u; db += v * v; }
  return da && db ? num / Math.sqrt(da * db) : null;
}

// ══ PUERTA PREVIA ═════════════════════════════════════════════════════════════════════════
console.log("  ══ PUERTA · ¿es beta lo mismo que la volatilidad que ya se mide? ═══════════\n");
const muestra = fechas.filter((_, i) => i % Math.ceil(fechas.length / 8) === 0);
const rhos = [];
for (const f of muestra) {
  const bs = panelBeta[f] ?? {};
  const vs = {};
  for (const t of Object.keys(bs)) { const v = await volAt(t, f); if (v != null) vs[t] = -v; }   // negada: mayor = mejor
  const r = spearman(bs, vs);
  if (r != null) rhos.push({ fecha: f, rho: +r.toFixed(3), n: Object.keys(vs).length });
}
const rhoMedio = rhos.length ? rhos.reduce((s, x) => s + x.rho, 0) / rhos.length : null;
for (const r of rhos) console.log(`    ${r.fecha}   rho(beta, −vol) = ${String(r.rho).padStart(6)}   n = ${r.n}`);
console.log(`\n    media: ${rhoMedio != null ? rhoMedio.toFixed(3) : "—"}`);
const PUERTA = 0.85;
const mismaSenal = rhoMedio != null && Math.abs(rhoMedio) > PUERTA;
console.log(`\n  ${mismaSenal ? `✖ PUERTA CERRADA: |${rhoMedio.toFixed(3)}| > ${PUERTA}. Beta y volatilidad ordenan el universo igual.\n    La hipótesis se RETIRA sin contrastarse y NO cuenta como ensayo.`
  : `✓ puerta abierta: |${rhoMedio?.toFixed(3)}| ≤ ${PUERTA}. Beta y volatilidad NO son la misma señal.`}`);

const salida = {
  generatedAt: new Date().toISOString(), window: VENTANA, topN: TOP_N, fechas: fechas.length,
  puerta: { rhoMedio, umbral: PUERTA, mismaSenal, porFecha: rhos,
            nota: "Si |rho| > 0,85, beta y `lowvol` ordenan igual y la hipótesis se retira sin gastar ensayo." },
};

if (mismaSenal) {
  writeFileSync(join(OUT, `bab_lab${LONG ? "_oos" : ""}.json`), JSON.stringify({ ...salida, retirada: true }, null, 1));
  console.log(`\n  → ${join(OUT, `bab_lab${LONG ? "_oos" : ""}.json`)}\n`);
  process.exit(0);
}

// ── Utilidades de cartera ─────────────────────────────────────────────────────────────────
const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
function neweyWest(serie, retardo = 24) {
  const n = serie.length; if (n < 3) return null;
  const m = media(serie), d = serie.map((x) => x - m);
  let suma = d.reduce((s, x) => s + x * x, 0) / n;
  for (let l = 1; l <= Math.min(retardo, n - 1); l++) {
    let g = 0; for (let i = l; i < n; i++) g += d[i] * d[i - l]; g /= n;
    suma += 2 * (1 - l / (retardo + 1)) * g;
  }
  return Math.sqrt(Math.max(suma, 0) / n);
}
const sumaMeses = (f, n) => { const d = new Date(f + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

// Rentabilidades a 12 meses de todo lo que tenga beta.
console.log("\n  calculando rentabilidades a 12 meses…");
const fwd = {};
const ultima = fechas[fechas.length - 1];
for (const f of fechas) {
  const hasta = sumaMeses(f, 12);
  if (hasta > ultima) continue;
  fwd[f] = {};
  for (const t of Object.keys(panelBeta[f] ?? {})) {
    const r = await retornoFuturo(t, f, hasta);
    if (r != null && isFinite(r)) fwd[f][t] = r;      // PORCENTAJE
  }
}
const utiles = Object.keys(fwd).filter((f) => Object.keys(fwd[f]).length >= 40);
console.log(`  ${utiles.length} fechas con rentabilidad futura utilizable\n`);
if (utiles.length < 12) { console.error("  ✖ muy pocas fechas"); process.exit(1); }

const ENTRADA = 0.70;
/** Universo elegible en una fecha: con señal de calidad por encima del umbral Y con beta. */
const elegibles = (f) => {
  const sig = senal.panel[f] ?? {}, bs = panelBeta[f] ?? {};
  return Object.keys(sig).filter((t) => sig[t] >= ENTRADA && bs[t] != null && fwd[f]?.[t] != null);
};
/** Todos los que tienen beta y retorno, sin filtro de calidad (la referencia EW). */
const conBeta = (f) => Object.keys(panelBeta[f] ?? {}).filter((t) => fwd[f]?.[t] != null);

/** Retorno medio a 12m de los `n` primeros según `puntua` (mayor = mejor). */
function cartera(f, universo, puntua, n = TOP_N) {
  const ord = [...universo].sort((a, b) => puntua(b) - puntua(a) || a.localeCompare(b)).slice(0, n);
  return ord.length ? { ret: media(ord.map((t) => fwd[f][t])), nombres: ord } : null;
}

const sectorDe = await (async () => {
  const m = new Map();
  const vistos = new Set(fechas.flatMap((f) => Object.keys(panelBeta[f] ?? {})));
  for (const t of vistos) {
    try { const cik = await tickerToCik(t); if (cik) m.set(t, (await sicSector(cik)) || "sin sector"); } catch { /* sin sector */ }
  }
  return (t) => m.get(t) ?? "sin sector";
})();

// ══ HB3 · EL FALSADOR ═════════════════════════════════════════════════════════════════════
console.log("  ══ HB3 · ¿es beta bajo sólo un proxy de sector? ════════════════════════════\n");
{
  const brutos = [], neutros = [];
  const sectoresTop = new Map();
  for (const f of utiles) {
    const uni = conBeta(f);
    if (uni.length < 100) continue;
    const bs = panelBeta[f];
    const ew = media(uni.map((t) => fwd[f][t]));

    // Bruto: los 40 de beta más bajo del universo.
    const c = cartera(f, uni, (t) => -bs[t]);
    if (!c) continue;
    brutos.push(c.ret - ew);
    for (const t of c.nombres) { const s = sectorDe(t); sectoresTop.set(s, (sectoresTop.get(s) ?? 0) + 1); }

    // Neutralizado por sector: los de beta más bajo DENTRO de cada sector, en proporción al
    // peso del sector en el universo. Si la ventaja sobrevive a esto, no es una apuesta
    // sectorial; si desaparece, lo era.
    const porSector = new Map();
    for (const t of uni) { const s = sectorDe(t); if (!porSector.has(s)) porSector.set(s, []); porSector.get(s).push(t); }
    const elegidos = [];
    for (const [, ts] of porSector) {
      const cuota = Math.max(1, Math.round(TOP_N * ts.length / uni.length));
      elegidos.push(...[...ts].sort((a, b) => bs[a] - bs[b]).slice(0, cuota));
    }
    if (elegidos.length >= 20) neutros.push(media(elegidos.map((t) => fwd[f][t])) - ew);
  }
  const mB = media(brutos), seB = neweyWest(brutos), mN = media(neutros), seN = neweyWest(neutros);
  const mdeB = seB != null ? 2.8 * seB : null;
  console.log(`  MDE (antes de mirar): ${mdeB != null ? mdeB.toFixed(1) + " pp" : "—"}   ·   fechas: ${brutos.length}`);
  console.log(`  beta bajo, BRUTO             vs universo EW: ${mB?.toFixed(2)} pp  ±${seB?.toFixed(2)}`);
  console.log(`  beta bajo, NEUTRAL POR SECTOR vs universo EW: ${mN?.toFixed(2)} pp  ±${seN?.toFixed(2)}`);
  const sobrevive = mN != null && mB != null && (mB <= 0 || mN / mB >= 0.5);
  console.log(`\n  ${sobrevive ? "✓ HB3 pasa: la ventaja NO es sólo sector" : "✖ HB3 FALLA: al neutralizar por sector se evapora — es una apuesta sectorial"}`);
  const top5 = [...sectoresTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const tot = [...sectoresTop.values()].reduce((s, x) => s + x, 0);
  console.log(`\n  sectores del top 40 por beta bajo: ${top5.map(([s, n]) => `${s} ${Math.round(100 * n / tot)}%`).join(" · ")}`);
  salida.HB3 = { bruto: mB, seBruto: seB, neutral: mN, seNeutral: seN, mde: mdeB, fechas: brutos.length, pasa: sobrevive,
                 sectoresTop: Object.fromEntries(top5.map(([s, n]) => [s, +(100 * n / tot).toFixed(1)])) };
}

// ══ HB1 · BETA BAJO SOLO ══════════════════════════════════════════════════════════════════
console.log("\n  ══ HB1 · ¿bate el beta bajo al universo elegible? ═════════════════════════\n");
{
  const dif = [];
  for (const f of utiles) {
    const uni = elegibles(f);
    if (uni.length < 60) continue;
    const bs = panelBeta[f];
    const ew = media(uni.map((t) => fwd[f][t]));
    const c = cartera(f, uni, (t) => -bs[t]);
    if (c) dif.push(c.ret - ew);
  }
  const m = media(dif), se = neweyWest(dif), mde = se != null ? 2.8 * se : null;
  console.log(`  MDE (antes de mirar): ${mde != null ? mde.toFixed(1) + " pp" : "—"}   ·   fechas: ${dif.length}`);
  console.log(`  top 40 por beta bajo vs universo elegible EW: ${m?.toFixed(2)} pp  ±${se?.toFixed(2)}  t = ${m != null && se ? (m / se).toFixed(2) : "—"}`);
  const sig = m != null && mde != null && Math.abs(m) > mde;
  console.log(`\n  ${sig ? (m > 0 ? "✓ supera el MDE y es positivo" : "✖ supera el MDE pero es NEGATIVO") : "○ dentro del ruido: no se puede afirmar nada"}`);
  salida.HB1 = { spread: m, se, mde, t: m != null && se ? m / se : null, fechas: dif.length, significativo: sig };
}

// ══ HB2 · LA COMBINACIÓN DE BUFFETT ═══════════════════════════════════════════════════════
console.log("\n  ══ HB2 · calidad + beta bajo, ¿bate a cada una por separado? ══════════════\n");
{
  const vsCal = [], vsBeta = [], vsEW = [];
  for (const f of utiles) {
    const uni = elegibles(f);
    if (uni.length < 60) continue;
    const bs = panelBeta[f], sig = senal.panel[f];
    const ew = media(uni.map((t) => fwd[f][t]));
    // Percentil dentro del universo elegible para poder sumar las dos ordenaciones.
    const pct = (vals) => { const o = [...uni].sort((a, b) => vals(a) - vals(b)); const m = new Map();
      o.forEach((t, i) => m.set(t, i / Math.max(1, o.length - 1))); return m; };
    const pCal = pct((t) => sig[t]), pBeta = pct((t) => -bs[t]);
    const soloCal = cartera(f, uni, (t) => pCal.get(t));
    const soloBeta = cartera(f, uni, (t) => pBeta.get(t));
    const combo = cartera(f, uni, (t) => pCal.get(t) + pBeta.get(t));
    if (!soloCal || !soloBeta || !combo) continue;
    vsCal.push(combo.ret - soloCal.ret);
    vsBeta.push(combo.ret - soloBeta.ret);
    vsEW.push(combo.ret - ew);
  }
  const f2 = (a) => ({ m: media(a), se: neweyWest(a) });
  const c1 = f2(vsCal), c2 = f2(vsBeta), c3 = f2(vsEW);
  console.log(`  fechas: ${vsCal.length}`);
  console.log(`  combo − sólo calidad   : ${c1.m?.toFixed(2)} pp  ±${c1.se?.toFixed(2)}   (MDE ${(2.8 * c1.se).toFixed(1)} pp)`);
  console.log(`  combo − sólo beta bajo : ${c2.m?.toFixed(2)} pp  ±${c2.se?.toFixed(2)}   (MDE ${(2.8 * c2.se).toFixed(1)} pp)`);
  console.log(`  combo − universo EW    : ${c3.m?.toFixed(2)} pp  ±${c3.se?.toFixed(2)}   (MDE ${(2.8 * c3.se).toFixed(1)} pp)`);
  const bate = c1.m > 2.8 * c1.se && c2.m > 2.8 * c2.se;
  console.log(`\n  ${bate ? "✓ HB2: la combinación bate a las dos por separado" : "○ HB2: no bate a las dos por separado por encima del MDE"}`);
  salida.HB2 = { vsCalidad: c1, vsBeta: c2, vsEW: c3, fechas: vsCal.length, bateAAmbas: bate };
}

salida.nota = "Long-only top-N, que es la forma del producto. NO es el factor BAB del artículo, que es largo-corto y neutralizado en beta.";
const ruta = join(OUT, `bab_lab${LONG ? "_oos" : ""}.json`);
writeFileSync(ruta, JSON.stringify(salida, null, 1));
console.log(`\n  → ${ruta}\n`);
