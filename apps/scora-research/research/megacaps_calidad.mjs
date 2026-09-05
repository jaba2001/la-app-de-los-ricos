// ─────────────────────────────────────────────────────────────────────────────
// ¿LA CALIDAD DE SCORA PUNTÚA BAJO A LAS MEGACAPS QUE MOVIERON EL ÍNDICE?
//
// LA PREGUNTA. Scora hace +652,6 % en ~20 años frente a +668,4 % del S&P 500 — pierde por
// 16 pp con un tercio de la caída máxima. Y en 2020-2026 el S&P 500 rindió 3,54 pp/año MÁS
// que su versión equiponderada (`concentracion.json`): el índice ganó por CONCENTRACIÓN en
// las mayores, no porque la mediana de sus negocios fuera mejor. De ahí la hipótesis: si la
// señal de `picksSignal.mjs` —percentil transversal de cinco métricas de CALIDAD contable,
// ninguna de precio— sistemáticamente NO puntúa alto a las megacaps, los 16 pp que faltan
// no son un fallo eligiendo negocios: son el tamaño, que la calidad no mide.
//
// ⚠️ EL BLOQUEO QUE ESTO LEVANTA. `concentracion.mjs` documenta —medido— que la capitalización
// por acciones × precio NO se puede construir: `dei:EntityCommonStockSharesOutstanding` falla
// justo en cinco de las quince mayores (GOOGL y META no lo etiquetan por ser de clase doble,
// Berkshire devuelve 1 M de acciones de 2011 y Visa 469 M de 2010) y falla EN SILENCIO, en la
// dirección que arruina la medida. Comprobado aquí de nuevo: 0 observaciones en GOOGL y META,
// 7 en BRK y 2 en V.
//
// La salida es OTRO tag: **`dei:EntityPublicFloat`**, el valor de mercado de las acciones en
// manos de no-afiliados que la propia empresa declara en la portada de cada 10-K/10-Q. Los
// cinco casos rotos lo publican sin excepción (BRK 902,7 B$, GOOGL 1.900 B$, META 1.600 B$,
// V 601,1 B$, AAPL 3.253,4 B$). Y no es un sucedáneo: **el S&P 500 pondera por capitalización
// AJUSTADA POR FLOTANTE**, así que el flotante es más cercano al peso en el índice que la
// capitalización bruta — la participación de los Walton en WMT o la de Buffett en BRK no
// cuentan en el índice y tampoco cuentan aquí.
//
// DOS CORRECCIONES QUE HACEN FALTA, y las dos con datos reales:
//   1. PUNTO EN EL TIEMPO. Sólo se usa la observación con `filed <= fecha`. El flotante se
//      mide el último día hábil del 2.º trimestre fiscal y se publica meses después: usar el
//      `end` sin mirar el `filed` sería mirar al futuro. Hay un aserto que lo comprueba.
//   2. RANCIEDAD. Aun así el dato llega con 6-18 meses de retraso, y eso NO es un detalle:
//      a 2024-01-02 el último flotante publicado de NVDA era el de 2022-07-29 (~430 B$)
//      cuando la empresa valía ~1,2 T$ — NVDA se caería del top-10 justo en el año en que lo
//      dominó. Se corrige multiplicando por el cociente de precios CRUDOS (ajustados por
//      split, no por dividendo) entre `end` y la fecha de corte, de la caché `px_long`. Se
//      publican LAS DOS clasificaciones: la escalada y la del flotante reportado a secas.
//
// LO QUE SE MIDE. En cada corte anual: las diez mayores del índice por flotante, y en qué
// percentil de la señal de calidad caían. El listón de compra de Scora Picks es el percentil
// 80 (`--entry 80` en `picks_rules_backtest.mjs`), así que "¿las habría comprado?" tiene
// respuesta binaria: pctl ≥ 0,80.
//
// LA SEÑAL NO SE RECALCULA: se lee de `out/picks_signal_panel_{ventana}.json`, el mismo panel
// que consume el backtest. Reconstruirla con `priceAsOf` daría 6-11 nombres antes de 2019.
//
// CONTROLES POSITIVOS (se ejecutan SIEMPRE, no a mano). En este repo cuatro guardas nacieron
// rotas y pasaban en verde, así que el resultado no vale nada sin comprobar que la tubería
// detecta lo que dice detectar:
//   · `tamano`  — se sustituye el panel por una señal que ES el propio ranking de tamaño.
//                 Si el cruce ticker↔flotante funciona, el top-10 tiene que salir en ~1,00 y
//                 100 % elegible. Si sale otra cosa, el JOIN está roto y el resultado real
//                 no significa nada.
//   · `barajado`— se permutan las etiquetas ticker→percentil dentro de cada fecha (semilla
//                 fija). El top-10 tiene que caer a la media del universo (~0,50). Si el
//                 resultado real coincidiera con éste, no habría asociación ninguna.
//
//   node --max-old-space-size=8192 --experimental-strip-types --no-warnings \
//        research/megacaps_calidad.mjs [--top 10] [--rebuild-float]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { YAHOO_ALIAS, simboloBloqueado, truncarEn } from "./prices.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
const CACHE = join(AQUI, ".cache");
const PX = join(CACHE, "px_long");
const FLOAT_SERIE = join(CACHE, "float_publico_serie.json");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const TOP = Number(arg("--top", "10"));
const REBUILD = process.argv.includes("--rebuild-float");
const ENTRADA = 0.80;   // el listón de compra de Scora Picks (§ reglas v3, `--entry 80`)

const VENTANAS = [
  { nombre: "2011-2018", panel: join(OUT, "picks_signal_panel_2011-2018.json"), backtest: join(OUT, "picks_rules_backtest_oos.json") },
  { nombre: "2019-2026", panel: join(OUT, "picks_signal_panel_2019-2026.json"), backtest: join(OUT, "picks_rules_backtest.json") },
];

const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r4 = (x) => (x == null ? null : +x.toFixed(4));
const r2 = (x) => (x == null ? null : +x.toFixed(2));

// ── 1. FLOTANTE PÚBLICO, leído de los `companyfacts` que ya están en `.cache/` ───────────
//
// Se extrae por subcadena en vez de con `JSON.parse` del fichero entero porque la caché son
// 3,1 GB en 1.566 ficheros: parsearlos todos cuesta minutos y varios GB de memoria, y de cada
// uno hacen falta ~20 números. Si el patrón no aparece donde se espera, NO se adivina: se cae
// al `JSON.parse` completo de ese fichero, que es lento pero no puede equivocarse de tag.
export function extraeArray(texto, tag, unidad) {
  const i = texto.indexOf(`"${tag}":{`);
  if (i < 0) return [];
  const cabecera = texto.slice(i, i + 2000);
  const rel = cabecera.indexOf(`"units":{"${unidad}":[`);
  if (rel < 0) return null;                       // otra forma → que decida `JSON.parse`
  const ini = i + rel + `"units":{"${unidad}":`.length;
  const fin = texto.indexOf("]", ini);
  if (fin < 0) return null;
  let arr;
  try { arr = JSON.parse(texto.slice(ini, fin + 1)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  return arr;
}

function datosDeFichero(path) {
  const texto = readFileSync(path, "utf8");
  const leer = (tag, unidad, ruta) => {
    let arr = extraeArray(texto, tag, unidad);
    if (arr === null) { const j = JSON.parse(texto); arr = ruta(j) ?? []; }   // respaldo caro pero seguro
    const obs = [];
    for (const o of arr) { if (o && typeof o.val === "number" && o.val > 0 && o.end && o.filed) obs.push({ end: o.end, filed: o.filed, val: o.val }); }
    // Un mismo `end` se re-declara en varias presentaciones. Se queda la de `filed` más
    // temprano: es la primera fecha en la que ese dato SE PUDO conocer.
    const porEnd = new Map();
    for (const o of obs.sort((a, b) => a.filed.localeCompare(b.filed))) if (!porEnd.has(o.end)) porEnd.set(o.end, o);
    return [...porEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
  };
  return {
    obs: leer("EntityPublicFloat", "USD", (j) => j?.facts?.dei?.EntityPublicFloat?.units?.USD),
    acciones: leer("EntityCommonStockSharesOutstanding", "shares", (j) => j?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares),
  };
}

// ── 1 bis. EL FLOTANTE DECLARADO TIENE ERRORES DE ESCALA, Y NO SON RAROS ────────────────
//
// Descubierto ejecutando: la primera corrida puso a VIACOM como la MAYOR empresa del índice
// en todos los cortes de 2011 a 2019. No es un fallo del cruce: es que Viacom declaró
// 17.026.436,7 B$ de flotante el 2009-09-30, entre dos observaciones suyas de 14,7 B$ y
// 17,4 B$. Un factor de un millón, en el propio XBRL de la presentación. Y hay más: M&T Bank,
// IQVIA, Host Hotels, Zimmer, Packaging Corp y Waters con ×10⁶; Garmin, Apollo, Sherwin-
// Williams y Domino's con ×10³.
//
// ⚠️ ES EXACTAMENTE EL FALLO QUE MÁS DAÑO HACE AQUÍ: no rompe nada, no da un error, y el
// nombre corrupto se cuela EN EL TOP-10 —que es lo único que este estudio mira— desplazando
// a una megacap real. Sin esta guarda el resultado habría salido en verde y habría sido falso.
//
// Tres reglas, cada una con su mecanismo, aplicadas en orden:
//
//   R1 · TOPE ABSOLUTO. Ningún flotante puede pasar de 10 billones de dólares: la mayor
//        empresa que ha existido vale ~4 T$ (el mayor valor que sobrevive en esta muestra se
//        publica en `mayorAceptadoB` para que la deriva se vea).
//   R2 · LA FAMILIA DE LOS MIL. Con el nivel de la empresa = mediana de log10 de sus propias
//        observaciones, un valor que se separa 3, 6 o 9 órdenes de magnitud (±0,8) es el
//        mismo número mal escalado: dividido por esa potencia de mil, encaja con su serie.
//        Un crecimiento real, por bestia que sea, no cae a 0,8 de un múltiplo exacto de 1.000.
//   R3 · CORROBORACIÓN, sólo para series de menos de 4 observaciones, donde la mediana no
//        distingue nada. La observación tiene que cuadrar con otra de la misma empresa una
//        vez descontado el movimiento del precio entre las dos fechas; si no, se descarta.
const TOPE_ABS = 1e13;
export function marcaEscala(obs, precioDe = () => null) {
  const vivas = obs.map((o) => ({ ...o }));
  for (const o of vivas) if (o.val > TOPE_ABS) o.sospechoso = `R1 tope absoluto: ${(o.val / 1e12).toFixed(1)} T$`;
  const sanas = vivas.filter((o) => !o.sospechoso);
  if (sanas.length >= 4) {
    const logs = sanas.map((o) => Math.log10(o.val)).sort((a, b) => a - b);
    const m = logs.length >> 1;
    const nivel = logs.length % 2 ? logs[m] : (logs[m - 1] + logs[m]) / 2;
    for (const o of sanas) {
      const dev = Math.log10(o.val) - nivel;
      for (const k of [3, 6, 9]) {
        if (Math.abs(Math.abs(dev) - k) < 0.8) { o.sospechoso = `R2 error de escala ×10^${dev > 0 ? k : -k} (se separa ${dev.toFixed(2)} órdenes de su propio nivel)`; break; }
      }
    }
  } else if (sanas.length) {
    for (const o of sanas) {
      const corrobora = sanas.some((p) => {
        if (p === o) return false;
        const p0 = precioDe(p.end), p1 = precioDe(o.end);
        if (!(p0 > 0) || !(p1 > 0)) return false;
        const esperado = p.val * (p1 / p0);
        const r = o.val / esperado;
        return r > 0.1 && r < 10;
      });
      if (!corrobora) o.sospechoso = `R3 serie de ${sanas.length} obs y ninguna otra la corrobora descontando el precio`;
    }
  }
  return vivas;
}

/** Serie de flotante por TICKER, cacheada en `.cache/float_publico_serie.json`. */
async function serieFlotante(tickers) {
  let cache = {};
  if (!REBUILD && existsSync(FLOAT_SERIE)) { try { cache = JSON.parse(readFileSync(FLOAT_SERIE, "utf8")); } catch { cache = {}; } }
  const faltan = tickers.filter((t) => !(t in cache));
  if (faltan.length) {
    let n = 0, ok = 0;
    for (const t of faltan) {
      let cik = null;
      try { cik = await tickerToCik(t); } catch { cik = null; }
      const path = cik ? join(CACHE, `CIK${cik}.json`) : null;
      if (!path || !existsSync(path)) { cache[t] = { cik, obs: [], acciones: [], motivo: cik ? "sin companyfacts en caché" : "sin CIK" }; }
      else { try { cache[t] = { cik, ...datosDeFichero(path) }; ok++; } catch (e) { cache[t] = { cik, obs: [], acciones: [], motivo: "error: " + e.message }; } }
      process.stdout.write(`  flotante  ${String(++n).padStart(4)}/${faltan.length}  ${t.padEnd(6)} ${cache[t].obs.length} obs   \r`);
    }
    console.log(`\n  → ${ok}/${faltan.length} con companyfacts; serie escrita en .cache/float_publico_serie.json\n`);
    writeFileSync(FLOAT_SERIE, JSON.stringify(cache));
  }
  return cache;
}

// ── 2. PRECIOS CRUDOS, sólo de caché (cero red: este script no debe descargar nada) ──────
const pxMem = new Map();
function serieRaw(ticker) {
  if (pxMem.has(ticker)) return pxMem.get(ticker);
  const y = YAHOO_ALIAS[ticker] ?? ticker;
  let rows = [];
  if (!simboloBloqueado(y)) {
    const p = join(PX, y.replace(/[^A-Za-z0-9_.-]/g, "") + ".json");
    if (existsSync(p)) {
      try {
        const c = JSON.parse(readFileSync(p, "utf8"));
        if (Array.isArray(c)) rows = c.filter((r) => r && r.raw != null && r.raw > 0).map((r) => ({ date: r.date, raw: r.raw }));
      } catch { rows = []; }
    }
  }
  const hasta = truncarEn(ticker);
  if (hasta) rows = rows.filter((r) => r.date <= hasta);
  pxMem.set(ticker, rows);
  return rows;
}
function precioEn(ticker, fecha) {
  const r = serieRaw(ticker);
  let lo = 0, hi = r.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (r[m].date <= fecha) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : r[ans].raw;
}

// ── 3. Tamaño de cada nombre en una fecha, point-in-time ─────────────────────────────────
let ASERTOS_PIT = 0;
function tamanoEn(ticker, fecha, serie) {
  const obs = serie[ticker]?.obs ?? [];
  let ult = null;
  for (const o of obs) { if (o.filed <= fecha) { if (!ult || o.end > ult.end) ult = o; } }
  if (!ult) return null;
  if (ult.filed > fecha) throw new Error(`look-ahead: ${ticker} usa un flotante presentado el ${ult.filed} para la fecha ${fecha}`);
  ASERTOS_PIT++;
  const p0 = precioEn(ticker, ult.end), p1 = precioEn(ticker, fecha);
  const escalable = p0 != null && p1 != null && p0 > 0;
  return {
    reportado: ult.val,
    escalado: escalable ? ult.val * (p1 / p0) : ult.val,
    escalable,
    end: ult.end,
    filed: ult.filed,
    mesesRancio: +(((new Date(fecha) - new Date(ult.end)) / 86400000) / 30.44).toFixed(1),
  };
}

// ── 4. El estudio ────────────────────────────────────────────────────────────────────────
const table = await loadSP500Historical();
if (!table) { console.error("\n  ✖ sin tabla histórica de miembros: se aborta (un universo a medias no da un número peor, da uno que no significa nada).\n"); process.exit(1); }

// Cortes: la PRIMERA fecha de panel de cada año natural. No es un barrido de parámetros —
// es la rejilla más simple posible y se fija antes de mirar nada.
function cortesDe(panel) {
  const vistos = new Set(), out = [];
  for (const d of panel.dates) { const y = d.slice(0, 4); if (!vistos.has(y)) { vistos.add(y); out.push(d); } }
  return out;
}

/** Percentiles a usar en una fecha, según el modo. `real` = el panel tal cual. */
function panelDeModo(modo, sig, ranking) {
  if (modo === "real") return sig;
  if (modo === "tamano") {                        // control positivo: la señal ES el tamaño
    const n = ranking.length, out = {};
    ranking.forEach((r, i) => { out[r.ticker] = +((n - 1 - i) / Math.max(1, n - 1)).toFixed(4); });
    return out;
  }
  if (modo === "barajado") {                      // control negativo: se rompe la asociación
    const ts = Object.keys(sig).sort(), vs = ts.map((t) => sig[t]);
    let s = 12345;                                 // semilla fija → reproducible
    for (let i = vs.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [vs[i], vs[j]] = [vs[j], vs[i]]; }
    const out = {}; ts.forEach((t, i) => { out[t] = vs[i]; });
    return out;
  }
  throw new Error("modo desconocido " + modo);
}

const resultado = { generatedAt: new Date().toISOString(), pregunta: "¿la señal de calidad de Scora puntúa bajo a las megacaps que impulsaron el índice?", top: TOP, entrada: ENTRADA, fuenteTamano: "dei:EntityPublicFloat (companyfacts, point-in-time por `filed`), escalado por precio crudo hasta la fecha de corte", ventanas: {}, controles: {} };

for (const V of VENTANAS) {
  if (!existsSync(V.panel)) { console.error(`  ✖ falta ${V.panel}`); process.exit(1); }
  const P = JSON.parse(readFileSync(V.panel, "utf8"));
  const cortes = cortesDe(P);
  console.log(`\n  ── ${V.nombre} · ${cortes.length} cortes: ${cortes.join(" ")}`);

  // Universo de tickers que hará falta resolver
  const universo = new Set();
  for (const f of cortes) for (const t of membersAsOf(table, f) ?? []) universo.add(t);
  const serie = await serieFlotante([...universo].sort());

  const porModo = {};
  for (const modo of ["real", "tamano", "barajado"]) porModo[modo] = { cortes: [], top10: [], resto: [], elegibles: 0, plazas: 0, sinSenal: 0 };

  for (const f of cortes) {
    const miembros = [...new Set(membersAsOf(table, f) ?? [])];
    const sig = P.panel[f] ?? {};

    // Ranking por tamaño, deduplicado POR CIK (Alphabet cuenta una vez, no dos: el mismo
    // fallo que costó 6,9 pp en las reglas v2).
    const filas = [];
    for (const t of miembros) {
      const tam = tamanoEn(t, f, serie);
      if (tam) filas.push({ ticker: t, cik: serie[t].cik, ...tam, pctl: sig[t] ?? null });
    }
    const porCik = new Map();
    for (const r of filas.sort((a, b) => b.escalado - a.escalado)) {
      const prev = porCik.get(r.cik);
      // entre dos clases del mismo emisor gana la que TIENE señal (si sólo una la tiene)
      if (!prev) porCik.set(r.cik, { ...r, hermanos: [] });
      else { prev.hermanos.push(r.ticker); if (prev.pctl == null && r.pctl != null) { const h = prev.hermanos; Object.assign(prev, r, { hermanos: h }); } }
    }
    const ranking = [...porCik.values()].sort((a, b) => b.escalado - a.escalado);

    for (const modo of ["real", "tamano", "barajado"]) {
      const pct = panelDeModo(modo, sig, ranking);
      const top = ranking.slice(0, TOP).map((r, i) => ({
        rank: i + 1, ticker: r.ticker, hermanos: r.hermanos.length ? r.hermanos : undefined,
        flotanteB: r2(r.escalado / 1e9), flotanteReportadoB: r2(r.reportado / 1e9), escalado: r.escalable,
        floatEnd: r.end, floatFiled: r.filed, mesesRancio: r.mesesRancio,
        pctl: pct[r.ticker] ?? null, elegible: (pct[r.ticker] ?? null) != null && pct[r.ticker] >= ENTRADA,
      }));
      const topTk = new Set(top.map((x) => x.ticker));
      const pTop = top.map((x) => x.pctl).filter((x) => x != null);
      const pResto = Object.entries(pct).filter(([t]) => !topTk.has(t)).map(([, v]) => v);
      const acc = porModo[modo];
      acc.plazas += top.length;
      acc.elegibles += top.filter((x) => x.elegible).length;
      acc.sinSenal += top.filter((x) => x.pctl == null).length;
      acc.top10.push(...pTop); acc.resto.push(...pResto);
      acc.cortes.push({
        fecha: f, miembros: miembros.length, conSenal: Object.keys(sig).length, conFlotante: ranking.length,
        pctlMedioTop: r4(media(pTop)), pctlMedioResto: r4(media(pResto)),
        elegibles: top.filter((x) => x.elegible).length, sinSenal: top.filter((x) => x.pctl == null).length,
        top: modo === "real" ? top : undefined,
      });
    }
  }

  // Ranking por flotante REPORTADO (sin escalar) — la comprobación de robustez del punto 2
  const sinEscalar = [];
  for (const f of cortes) {
    const miembros = [...new Set(membersAsOf(table, f) ?? [])];
    const sig = P.panel[f] ?? {};
    const filas = [];
    for (const t of miembros) { const tam = tamanoEn(t, f, serie); if (tam) filas.push({ ticker: t, cik: serie[t].cik, val: tam.reportado, pctl: sig[t] ?? null }); }
    const porCik = new Map();
    for (const r of filas.sort((a, b) => b.val - a.val)) if (!porCik.has(r.cik)) porCik.set(r.cik, r);
    const top = [...porCik.values()].sort((a, b) => b.val - a.val).slice(0, TOP);
    sinEscalar.push({ fecha: f, nombres: top.map((x) => x.ticker), pctlMedio: r4(media(top.map((x) => x.pctl).filter((x) => x != null))), elegibles: top.filter((x) => x.pctl != null && x.pctl >= ENTRADA).length });
  }

  // Frecuencia por nombre en el top-N y su percentil medio
  const frec = new Map();
  for (const c of porModo.real.cortes) for (const x of c.top) {
    if (!frec.has(x.ticker)) frec.set(x.ticker, { ticker: x.ticker, veces: 0, pctls: [] });
    const e = frec.get(x.ticker); e.veces++; if (x.pctl != null) e.pctls.push(x.pctl);
  }
  const nombres = [...frec.values()].map((e) => ({ ticker: e.ticker, veces: e.veces, pctlMedio: r4(media(e.pctls)), vecesElegible: e.pctls.filter((p) => p >= ENTRADA).length, sinSenal: e.veces - e.pctls.length }))
    .sort((a, b) => b.veces - a.veces || (b.pctlMedio ?? 0) - (a.pctlMedio ?? 0));

  // ¿Las compró de verdad el backtest de las reglas?
  let comprados = null;
  if (existsSync(V.backtest)) {
    const bt = JSON.parse(readFileSync(V.backtest, "utf8"));
    const tk = new Set((bt.operaciones ?? []).map((o) => o.t));
    comprados = {
      fuente: V.backtest.split(/[\\/]/).pop(), posiciones: (bt.operaciones ?? []).length, distintos: tk.size,
      megacapsComprados: nombres.filter((n) => tk.has(n.ticker)).map((n) => n.ticker),
      megacapsNoComprados: nombres.filter((n) => !tk.has(n.ticker)).map((n) => n.ticker),
    };
  }

  resultado.ventanas[V.nombre] = {
    cortes: porModo.real.cortes,
    resumen: {
      plazas: porModo.real.plazas, elegibles: porModo.real.elegibles,
      pctElegibles: r2((100 * porModo.real.elegibles) / porModo.real.plazas),
      sinSenal: porModo.real.sinSenal,
      pctlMedioTop: r4(media(porModo.real.top10)), pctlMedianoTop: r4(mediana(porModo.real.top10)),
      pctlMedioResto: r4(media(porModo.real.resto)),
      brecha: r4(media(porModo.real.top10) - media(porModo.real.resto)),
    },
    nombres, comprados, rankingSinEscalar: sinEscalar,
  };
  for (const modo of ["tamano", "barajado"]) {
    resultado.controles[`${V.nombre}/${modo}`] = {
      pctlMedioTop: r4(media(porModo[modo].top10)), pctlMedioResto: r4(media(porModo[modo].resto)),
      pctElegibles: r2((100 * porModo[modo].elegibles) / porModo[modo].plazas),
    };
  }
}

// ── 5. Los controles, con su veredicto ───────────────────────────────────────────────────
const fallos = [];
for (const [k, v] of Object.entries(resultado.controles)) {
  if (k.endsWith("/tamano") && !(v.pctlMedioTop >= 0.95 && v.pctElegibles === 100)) fallos.push(`${k}: el control de tamaño debería dar ~1,00 y 100 % elegible, dio ${v.pctlMedioTop} / ${v.pctElegibles} %`);
  if (k.endsWith("/barajado") && Math.abs(v.pctlMedioTop - v.pctlMedioResto) > 0.06) fallos.push(`${k}: el control barajado debería dar top ≈ resto, dio ${v.pctlMedioTop} vs ${v.pctlMedioResto}`);
}
resultado.controles.veredicto = fallos.length ? { ok: false, fallos } : { ok: true, nota: "el cruce tamaño↔señal detecta una asociación cuando la hay (control `tamano`) y la pierde cuando se rompe (control `barajado`)" };
resultado.asertosPointInTime = ASERTOS_PIT;
resultado.limitaciones = [
  "El flotante lo declara la empresa en portada de 10-K/10-Q: se mide el último día hábil del 2.º trimestre fiscal y se publica meses después. Point-in-time se respeta por `filed`, pero el dato usado es rancio (ver `mesesRancio`) y por eso se escala por precio.",
  "`dei:EntityPublicFloat` es capitalización AJUSTADA POR FLOTANTE, que es la que pondera el S&P 500 — no la capitalización bruta. Berkshire, Walmart o Meta salen por debajo de su valor total de mercado, igual que en el índice.",
  "El escalado usa el cierre CRUDO (ajustado por split, no por dividendo) y supone recuento de acciones constante entre `end` y el corte: ignora recompras y emisiones de ese tramo.",
  "`sp500_historical_components.csv` está congelado desde 2025-08-23: en los cortes posteriores la membresía es la de esa foto.",
  "Los cortes anuales del mismo panel NO son observaciones independientes (la señal es lenta y los miembros se repiten). Por eso se publican medias y recuentos, y NO se calcula ningún p-valor.",
];

writeFileSync(join(OUT, "megacaps_calidad.json"), JSON.stringify(resultado, null, 2));

// ── 6. Informe por consola ───────────────────────────────────────────────────────────────
for (const [nombre, V] of Object.entries(resultado.ventanas)) {
  console.log(`\n  ══ ${nombre} ═══════════════════════════════════════════════════════════`);
  console.log(`  fecha        top-${TOP} por flotante (percentil de calidad)`);
  for (const c of V.cortes) {
    const s = c.top.map((x) => `${x.ticker} ${x.pctl == null ? "s/s" : x.pctl.toFixed(2)}${x.elegible ? "*" : ""}`).join("  ");
    console.log(`  ${c.fecha}  ${s}`);
  }
  const R = V.resumen;
  console.log(`\n  percentil medio del top-${TOP}: ${R.pctlMedioTop}   ·  resto del universo: ${R.pctlMedioResto}   ·  brecha ${R.brecha}`);
  console.log(`  plazas elegibles (pctl ≥ ${ENTRADA}): ${R.elegibles}/${R.plazas} (${R.pctElegibles} %)   ·  sin señal: ${R.sinSenal}`);
  if (V.comprados) {
    console.log(`  de esos nombres, el backtest de reglas SÍ compró: ${V.comprados.megacapsComprados.join(" ") || "(ninguno)"}`);
    console.log(`                                    NO compró nunca: ${V.comprados.megacapsNoComprados.join(" ") || "(ninguno)"}`);
  }
}
console.log(`\n  controles: ${JSON.stringify(resultado.controles.veredicto)}`);
console.log(`  → research/out/megacaps_calidad.json\n`);
