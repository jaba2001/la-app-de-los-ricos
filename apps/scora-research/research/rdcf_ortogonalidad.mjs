// ─────────────────────────────────────────────────────────────────────────────
// EL REVERSE DCF, ¿DICE ALGO QUE NO DIGAN YA LOS MÚLTIPLOS?
//
// QUÉ ES Y POR QUÉ SE MIRA. `lib/reverseDcf.ts` despeja el **crecimiento implícito**: qué
// crecimiento tendría que lograr una empresa para justificar el precio al que cotiza hoy. Está
// implementado, tiene test golden, alimenta la valoración del app con peso propio —y **nunca ha
// pasado por un backtest**: `grep` sobre `research/*.mjs` daba cero referencias.
//
// LA HIPÓTESIS, ESCRITA ANTES DE MEDIR: el crecimiento implícito es información de VALORACIÓN
// ortogonal a los múltiplos clásicos, porque no compara un precio con un beneficio sino con lo
// que ese precio EXIGE. Dirección esperada, también fijada de antemano: **crecimiento implícito
// BAJO = mejor retorno futuro** (al mercado se le pide poco, es más fácil superarlo).
//
// ⚠️ ESTE GUION NO MIDE RETORNOS. Es sólo la PRE-COMPROBACIÓN, y existe para poder pararse a
// tiempo: si el crecimiento implícito resulta ser casi lo mismo que un factor que ya tenemos,
// no hace falta gastar un ensayo del presupuesto —van 343— para descubrirlo midiendo retornos.
//
// ⚠️ Y ORTOGONAL NO IMPLICA ÚTIL. Precedente directo: las cuatro medidas nuevas de la sesión
// anterior SÍ eran ortogonales (R² 0,012-0,077 contra los pilares) y aun así **no mejoraron
// nada**. Así que un R² bajo aquí no es una buena noticia: es sólo permiso para seguir.
//
// DE DÓNDE SALE CADA ENTRADA, y las dos que no son triviales:
//   · precio, ingresos, deuda neta, acciones → `fundamentalsAsOf` + caché de precios.
//   · margen de caja libre = (flujo de explotación − inversión) / ingresos.
//   · **BETA**: no viene en los fundamentales. Se calcula rodando contra el índice con el
//     histórico de precios, que además es más point-in-time que tomarla de un proveedor.
//   · **TIPO SIN RIESGO**: DGS10 de la caché de FRED, con la unidad comprobada en el nombre
//     del fichero (una caché compartida sin unidades ya hizo publicar «+2.464 % de crecimiento
//     de la vivienda»).
//
//   node --experimental-strip-types --no-warnings research/rdcf_ortogonalidad.mjs [--asof YYYY-MM-DD]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { metricsOf } from "./fundamentalMetrics.mjs";
import { computeReverseDCF } from "../lib/reverseDcf.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", "2026-06-30");

// ── Precios ─────────────────────────────────────────────────────────────────────────────
const serie = (t) => {
  for (const d of ["px", "px_long"]) {
    const f = join(AQUI, ".cache", d, t + ".json");
    if (existsSync(f)) { try { return JSON.parse(readFileSync(f, "utf8")); } catch { /* siguiente */ } }
  }
  return null;
};
const precioEn = (barras, fecha) => {
  if (!barras) return null;
  for (let i = barras.length - 1; i >= 0; i--) if (barras[i].date <= fecha) return barras[i].raw ?? barras[i].adj;
  return null;
};

/** Beta rodada contra el índice con los retornos mensuales de los últimos `meses`. */
function betaContra(barras, spy, fecha, meses = 36) {
  if (!barras || !spy) return null;
  const desde = new Date(fecha); desde.setUTCMonth(desde.getUTCMonth() - meses);
  const d0 = desde.toISOString().slice(0, 10);
  const mensual = (b) => {
    const out = new Map();
    for (const x of b) { if (x.date < d0 || x.date > fecha) continue; out.set(x.date.slice(0, 7), x.adj ?? x.raw); }
    return out;
  };
  const A = mensual(barras), B = mensual(spy);
  const meses_ = [...A.keys()].filter((k) => B.has(k)).sort();
  if (meses_.length < 24) return null;                     // sin historia suficiente, no se inventa
  const ra = [], rb = [];
  for (let i = 1; i < meses_.length; i++) {
    const a0 = A.get(meses_[i - 1]), a1 = A.get(meses_[i]), b0 = B.get(meses_[i - 1]), b1 = B.get(meses_[i]);
    if (!a0 || !a1 || !b0 || !b1 || a0 <= 0 || b0 <= 0) continue;
    ra.push(a1 / a0 - 1); rb.push(b1 / b0 - 1);
  }
  if (ra.length < 20) return null;
  const mb = rb.reduce((s, x) => s + x, 0) / rb.length, ma = ra.reduce((s, x) => s + x, 0) / ra.length;
  let cov = 0, varb = 0;
  for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); varb += (rb[i] - mb) ** 2; }
  return varb > 0 ? cov / varb : null;
}

// ── Tipo sin riesgo ─────────────────────────────────────────────────────────────────────
// ⚠️ La unidad va en el NOMBRE del fichero. Leer una serie en variación interanual como si
// fuera un nivel ya produjo una cifra publicada absurda.
function tipoSinRiesgo(fecha) {
  // Dos directorios distintos guardan series de FRED; DGS10 vive en `fredfull`.
  let ruta = null;
  for (const d of ["fredfull", "fred"]) {
    const dir = join(AQUI, ".cache", d);
    if (!existsSync(dir)) continue;
    const f = readdirSync(dir).find((n) => /^DGS10(\.lin)?\.json$/i.test(n));
    if (f) { ruta = join(dir, f); break; }
  }
  if (!ruta) return null;
  try {
    const j = JSON.parse(readFileSync(ruta, "utf8"));
    const obs = Array.isArray(j) ? j : (j.observations ?? j.data ?? []);
    let mejor = null;
    for (const o of obs) {
      const d = o.date ?? o.d, v = Number(o.value ?? o.v);
      if (!d || !Number.isFinite(v) || d > fecha) continue;
      if (!mejor || d > mejor.d) mejor = { d, v };
    }
    // Un tipo a 10 años fuera de [0, 20] es una unidad mal leída, no un tipo.
    return mejor && mejor.v >= 0 && mejor.v <= 20 ? mejor.v : null;
  } catch { return null; }
}

// ── R² de una regresión simple ──────────────────────────────────────────────────────────
function r2(x, y) {
  const n = x.length; if (n < 20) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  if (sxx <= 0 || syy <= 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  return +(r * r).toFixed(4);
}

// ── Recogida ────────────────────────────────────────────────────────────────────────────
const rf = tipoSinRiesgo(ASOF);
if (rf == null) { console.error("\n  ⛔ sin tipo sin riesgo utilizable para " + ASOF + " — no se inventa\n"); process.exit(1); }
const spy = serie("SPY");
const tabla = await loadSP500Historical();
const miembros = [...new Set(membersAsOf(tabla, ASOF) || [])];

console.log(`\n  ORTOGONALIDAD DEL REVERSE DCF · ${ASOF} · ${miembros.length} miembros`);
console.log(`  tipo sin riesgo ${rf} %\n`);

const filas = [];
const descartes = { sinCik: 0, sinFundamentales: 0, sinPrecio: 0, sinBeta: 0, sinAcciones: 0, sinIngresos: 0, dcfNulo: 0 };
for (const t of miembros) {
  try {
    const cik = await tickerToCik(t); if (!cik) { descartes.sinCik++; continue; }
    const f = await fundamentalsAsOf(cik, ASOF); if (!f) { descartes.sinFundamentales++; continue; }
    const barras = serie(t);
    const precio = precioEn(barras, ASOF); if (!precio || precio <= 0) { descartes.sinPrecio++; continue; }
    if (!f.shares || f.shares <= 0) { descartes.sinAcciones++; continue; }
    if (!f.revTTM || f.revTTM <= 0) { descartes.sinIngresos++; continue; }
    const beta = betaContra(barras, spy, ASOF); if (beta == null) { descartes.sinBeta++; continue; }
    const fcf = (f.ocfTTM ?? 0) - (f.capexTTM ?? 0);
    const r = computeReverseDCF({
      currentPrice: precio, revenueTTM: f.revTTM, fcfMarginTTM: fcf / f.revTTM,
      netDebt: (f.debt ?? 0) - (f.cash ?? 0), sharesOut: f.shares, beta, rfRate: rf,
    });
    if (!r || !Number.isFinite(r.impliedGrowthCagr)) { descartes.dcfNulo++; continue; }
    filas.push({ t, sector: (await sicSector(cik)) || null, g: r.impliedGrowthCagr, wacc: r.wacc, tv: r.tvShare, beta, m: metricsOf(f, precio, null) });
  } catch { /* saltar */ }
}

console.log(`  con crecimiento implícito calculado: ${filas.length} de ${miembros.length}`);
console.log(`  descartes: ${Object.entries(descartes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguno"}\n`);
if (filas.length < 50) { console.error("  ⛔ muestra insuficiente para juzgar ortogonalidad\n"); process.exit(1); }

// ── Distribución, para saber si el número es siquiera sensato ────────────────────────────
const gs = filas.map((f) => f.g).sort((a, b) => a - b);
const q = (p) => gs[Math.floor(p * (gs.length - 1))];
console.log(`  DISTRIBUCIÓN DEL CRECIMIENTO IMPLÍCITO`);
console.log(`     p10 ${q(0.1).toFixed(1)} %  ·  mediana ${q(0.5).toFixed(1)} %  ·  p90 ${q(0.9).toFixed(1)} %  ·  min ${gs[0].toFixed(1)}  max ${gs.at(-1).toFixed(1)}`);

// ⚠️ CENSURA EN LOS EXTREMOS, Y ES LO QUE DECIDE SI ESTE FACTOR SIRVE PARA UN ESTUDIO POR
// DECILES. `bisect` busca entre -5 y 80: todo lo que caiga fuera se queda PEGADO al tope. Y la
// hipotesis dice que la señal esta en el decil BAJO — que es justo donde se acumulan los que el
// modelo no supo resolver hacia abajo. Si ahi hay un empate masivo, ese decil no es «los de
// crecimiento implicito mas bajo» sino «los que el modelo no pudo explicar», que es otra cosa.
const EPS = 0.05;
const enSuelo = filas.filter((f) => Math.abs(f.g - (-5)) < EPS).length;
const enTecho = filas.filter((f) => Math.abs(f.g - 80) < EPS).length;
const pctSuelo = enSuelo / filas.length * 100, pctTecho = enTecho / filas.length * 100;
console.log(`
  CENSURA EN LOS TOPES DE LA BÚSQUEDA (bisect busca entre −5 y 80)`);
console.log(`     pegados al suelo (−5 %):  ${enSuelo}  (${pctSuelo.toFixed(1)} % de la muestra)`);
console.log(`     pegados al techo (80 %):  ${enTecho}  (${pctTecho.toFixed(1)} %)`);
const decil = Math.ceil(filas.length / 10);
if (enSuelo >= decil) {
  console.log(`     ⛔ EL DECIL INFERIOR ENTERO ESTÁ EMPATADO EN EL SUELO (${enSuelo} ≥ ${decil} = un decil).`);
  console.log(`        Ese decil no es «crecimiento implícito más bajo»: es «el modelo no lo pudo resolver».`);
  console.log(`        Un estudio por deciles sobre esto mediría otra cosa y no lo diría.`);
} else if (enSuelo > 0) {
  console.log(`     ⚠️ hay censura pero no llena el decil inferior (${enSuelo} de ${decil}).`);
}

// ── R² contra cada factor existente ─────────────────────────────────────────────────────
const METRICAS = Object.keys(filas[0].m);
const tabla2 = [];
for (const k of METRICAS) {
  const pares = filas.filter((f) => Number.isFinite(f.m[k]) && Number.isFinite(f.g));
  if (pares.length < 30) continue;
  const v = r2(pares.map((f) => f.m[k]), pares.map((f) => f.g));
  if (v != null) tabla2.push({ metrica: k, n: pares.length, r2: v });
}
tabla2.sort((a, b) => b.r2 - a.r2);
console.log(`\n  R² DEL CRECIMIENTO IMPLÍCITO CONTRA CADA FACTOR QUE YA TENEMOS`);
console.log(`     factor                  n      R²`);
for (const r of tabla2) console.log(`     ${r.metrica.padEnd(20)}${String(r.n).padStart(5)}${r.r2.toFixed(4).padStart(10)}${r.r2 >= 0.5 ? "   ← redundante" : ""}`);

const maxR2 = tabla2.length ? tabla2[0].r2 : null;
const ORTOGONAL_SI = 0.5;
console.log(`\n  ⇒ R² MÁXIMO: ${maxR2?.toFixed(4)} contra «${tabla2[0]?.metrica}»`);
if (maxR2 != null && maxR2 < ORTOGONAL_SI) {
  console.log(`     ES ORTOGONAL: ningún factor existente explica ni la mitad de su varianza.`);
  console.log(`     ⚠️ Pero ortogonal NO implica útil. Las cuatro medidas de la sesión anterior también`);
  console.log(`        lo eran (R² 0,012-0,077) y no mejoraron nada. Esto es permiso para medir, no un hallazgo.`);
} else {
  console.log(`     NO ES ORTOGONAL: «${tabla2[0]?.metrica}» ya dice casi lo mismo. Se para aquí y no se gasta ensayo.`);
}

writeFileSync(join(OUT, "rdcf_ortogonalidad.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/rdcf_ortogonalidad.mjs", asOf: ASOF,
  hipotesis: "El crecimiento implicito es informacion de valoracion ortogonal a los multiplos clasicos. Direccion esperada: crecimiento implicito BAJO = mejor retorno futuro.",
  rfRate: rf, universo: miembros.length, calculados: filas.length, descartes,
  censura: { enSuelo, enTecho, pctSuelo: +pctSuelo.toFixed(1), pctTecho: +pctTecho.toFixed(1), limites: [-5, 80], decil: Math.ceil(filas.length / 10) },
  distribucion: { p10: +q(0.1).toFixed(2), mediana: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), min: +gs[0].toFixed(2), max: +gs.at(-1).toFixed(2) },
  r2PorFactor: tabla2, r2Maximo: maxR2, umbralOrtogonal: ORTOGONAL_SI,
  veredicto: maxR2 != null && maxR2 < ORTOGONAL_SI ? "ORTOGONAL" : "REDUNDANTE",
  nota: "PRE-COMPROBACION, no mide retornos. Ortogonal NO implica util: las cuatro medidas de la sesion anterior eran ortogonales (R2 0,012-0,077) y no mejoraron nada. Un R2 bajo aqui es permiso para medir, no un hallazgo.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/rdcf_ortogonalidad.json\n`);
