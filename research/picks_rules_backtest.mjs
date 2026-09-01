// ─────────────────────────────────────────────────────────────────────────────
// ¿FUNCIONAN LAS REGLAS DE SCORA PICKS, O SÓLO LA SEÑAL?
//
// Todo lo medido hasta ahora (§3 de SCORA_PICKS_REGLAS.md) reconstruye el top 40 cada
// trimestre y punto. Eso mide si la CALIDAD ORDENA. No mide el PRODUCTO, que es otra cosa:
// dos compras al mes en fechas fijas, persistencia de 60 días, umbrales de entrada y
// salida, la regla de los 180 días, cuarentena de 12 meses y un tope de 40 posiciones.
//
// La diferencia no es cosmética. Comprando 2 al mes se tarda VEINTE MESES en tener la
// cartera montada, y durante esos veinte meses el producto es otra cosa —más concentrada,
// con caja, y comprando a los precios que toquen—. Un backtest trimestral se salta esa
// fase entera y empieza la película con la cartera ya llena.
//
// ═══ HIPÓTESIS Y CRITERIOS, ESCRITOS ANTES DE VER UN SOLO NÚMERO ═══
//
//   H1. Las reglas no destruyen la señal: la cartera con reglas queda como mucho 15 pp por
//       debajo del top-40 trimestral de §3, en las dos ventanas. Si pierde más, las reglas
//       (no la señal) son el problema y hay que rediseñarlas, no venderlas.
//   H2. La cartera con reglas bate al universo elegible equiponderado en las dos ventanas.
//   H3. La rampa cuesta, y hay que cuantificar cuánto: se reporta el resultado CON caja
//       (lo que vive el suscriptor) y SIN caja (sólo los picks), y la diferencia entre
//       ambos es el precio de comprar de dos en dos.
//
//   NO es criterio de aceptación batir al SPY: ya se midió (§1) que a 40 posiciones la
//   calidad casi empata con el índice en 2019-2026. Si las reglas lo arreglaran sería
//   sospechoso, no bueno.
//
// UMBRALES PREESPECIFICADOS, y por qué estos: entrada en el percentil 80 (quintil
// superior) y salida por debajo del 50 (la mediana). Son números redondos y convencionales,
// elegidos ANTES de medir, exactamente por lo que pasó con TOP_N=25: si se eligen mirando
// el resultado, el mejor de diez combinaciones no significa nada. El barrido de
// sensibilidad está al final y es para ver si la FORMA aguanta, no para escoger el pico.
//
// SIN LOOK-AHEAD: la señal de cada fecha usa `fundamentalsAsOf` (EDGAR a esa fecha) y la
// membresía del índice a esa fecha. Los precios sólo se usan hacia adelante.
//
// ⚠️ CON `--max-old-space-size=8192`, y no es una precaución: la ventana antigua REVIENTA sin
// él. El 2026-08-29 abortó con «JavaScript heap out of memory» DESPUÉS de construir las 192
// fechas del panel — o sea tras la parte cara, en el análisis. Y aborta de la peor manera
// posible para quien lo lanza y se va: el panel queda escrito, el artefacto NO, así que los
// números publicados siguen siendo los de la corrida anterior y nada lo dice.
//
// El consumo crece con el universo, y el universo crece cada vez que se arregla la cobertura:
// esa corrida fue la primera con BlackRock dentro. Si vuelve a reventar, súbelo más.
//
// Si el panel ya está en disco y sólo se quiere recalcular, se omite `--rebuild` y tarda
// minutos en vez de horas.
//
//   node --max-old-space-size=8192 --experimental-strip-types --no-warnings //        research/picks_rules_backtest.mjs [--long] [--entry 80] [--exit 50] [--top 40] [--rebuild]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
// CURATED no se importa: el backtest que respalda un producto no puede caer en silencio a
// un universo de laboratorio. Ver el guardián de `construirPanel`.
import { getHeapStatistics } from "v8";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { huellaEntradas } from "./huella.mjs";
import { señalAt } from "./picksSignal.mjs";
import { tickerToCik, sicSector } from "./edgar.mjs";
import { returnsSeries } from "./prices.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";
import { addMonths, mean, std, fx, loadPanel, idxOnOrBefore } from "./momentumSignals.mjs";
// El motor de reglas, COMPARTIDO con producción. Import de VALOR ⇒ necesita la extensión.
import { decide, emptyState } from "../lib/picks.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
/**
 * ⚠️ SE NIEGA A ARRANCAR SIN MEMORIA SUFICIENTE, y eso es el arreglo — no el comentario.
 *
 * El 2026-08-29 esta corrida abortó por falta de memoria DESPUÉS de construir las 192 fechas
 * del panel: cinco horas de trabajo tiradas, el artefacto sin escribir, y los números
 * publicados siguiendo siendo los del día anterior sin que nada lo dijera.
 *
 * Dejarlo documentado en la cabecera no sirve: quien lanza esto y se va no vuelve a leer la
 * cabecera. Comprobarlo aquí convierte un fallo silencioso de la hora cinco en un error
 * ruidoso del segundo cero, que es la diferencia entre perder una tarde y perder un minuto.
 *
 * El umbral no es un número inventado: la corrida que reventó tenía el límite por defecto y
 * la que funcionó llevaba 8 GB. Se pide 6 para dejar margen sin exigir de más — y crece con el
 * universo, así que si vuelve a reventar con 6, hay que subirlo aquí y en el mensaje.
 */
const HEAP_MINIMO_MB = 6000;
{
  const limite = getHeapStatistics().heap_size_limit / 1024 / 1024;
  if (limite < HEAP_MINIMO_MB) {
    console.error(`
  ⛔ Memoria insuficiente: el límite del montón es ${Math.round(limite)} MB y hacen falta ${HEAP_MINIMO_MB}.`);
    console.error(`     Esta corrida tarda horas y reventaría al final, después del trabajo caro, sin escribir`);
    console.error(`     el artefacto — dejando publicados los números de la corrida anterior sin avisar.
`);
    console.error(`     node --max-old-space-size=8192 --experimental-strip-types --no-warnings ${process.argv[1].split(/[\/]/).pop()} ${process.argv.slice(2).join(" ")}
`);
    process.exit(1);
  }
}

const LONG = process.argv.includes("--long");
const REBUILD = process.argv.includes("--rebuild");
const SMOKE = process.argv.includes("--smoke");
const seriesFn = LONG ? returnsSeriesLong : returnsSeries;

const ENTRY = Number(arg("--entry", "80")) / 100;   // percentil de calidad para poder ENTRAR
const EXIT = Number(arg("--exit", "50")) / 100;     // por debajo de esto, empieza la cuenta de salida
const TOP_N = Number(arg("--top", "40"));           // tope de posiciones (decidido en §6)
// ⚠️ POR FECHA DE DECISIÓN, y hay DOS fechas al mes → el ritmo mensual es el DOBLE.
// Esta confusión ya coló una vez: las variantes de la ablación estaban etiquetadas "al mes"
// cuando el valor era por fecha, así que el "4 al mes" medido eran en realidad 8. Toda
// etiqueta de cadencia dice ahora las dos cifras.
const COMPRAS_POR_FECHA = 1;                        // §4 v1: "dos posiciones nuevas AL MES"
const PERSISTENCIA_DIAS = 60;                       // §3
const DIAS_180 = 180;                               // §5.3
const CUARENTENA_MESES = 12;                        // §5
const COST_BPS = 10;                                // por lado, igual que el resto de labs

const today = new Date().toISOString().slice(0, 10);
const START = LONG ? "2011-01-01" : "2019-01-01";
const END = LONG ? "2018-12-31" : addMonths(today, -1);
const VENTANA = LONG ? "2011-2018" : "2019-2026";
const PANEL_FILE = join(OUT, `picks_signal_panel_${VENTANA}${SMOKE ? "_smoke" : ""}.json`);

const dias = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

// ── Calendario de decisión: día 1 y día 15 de cada mes, movidos al siguiente día hábil ──
// El calendario "hábil" sale de las fechas reales de cotización del SPY, no de un
// calendario teórico: si el mercado estuvo cerrado, no se pudo comprar.
const spyPanel = await loadPanel("SPY", seriesFn);
if (!spyPanel) { console.error("  ✖ sin panel de SPY"); process.exit(1); }
const DIAS_MERCADO = spyPanel.dates;

function siguienteHabil(fecha) {
  const i = DIAS_MERCADO.findIndex((d) => d >= fecha);
  return i < 0 ? null : DIAS_MERCADO[i];
}
const fechasDecision = [];
{
  let m = START.slice(0, 8) + "01";
  while (m <= END) {
    for (const dia of ["01", "15"]) {
      const f = siguienteHabil(m.slice(0, 8) + dia);
      if (f && f >= START && f <= END && !fechasDecision.includes(f)) fechasDecision.push(f);
    }
    m = addMonths(m, 1);
  }
}
// --smoke recorta a las primeras 14 fechas: sirve para comprobar que la mecánica no
// revienta antes de gastar media hora de EDGAR, no para concluir nada.
if (SMOKE) fechasDecision.splice(14);

console.log(`\n  SCORA PICKS · BACKTEST DE LAS REGLAS · ${VENTANA}`);
console.log(`  ${fechasDecision.length} fechas de decisión (2/mes) · entrada p${ENTRY * 100} · salida p${EXIT * 100} · tope ${TOP_N}\n`);

// ── Panel de señal: percentil de calidad de cada nombre en cada fecha de decisión ────────
// Se cachea en disco porque construirlo cuesta ~500 lecturas de EDGAR por fecha y el
// simulador se ejecuta muchas veces (barrido de umbrales) sobre exactamente los mismos datos.
async function construirPanel() {
  const table = await loadSP500Historical();
  // ⚠️ NI UNA FECHA CON EL UNIVERSO EQUIVOCADO. Aquí había un `table ? … : CURATED`, y en un
  // bucle que tarda media hora eso es peor que en el cron: un parpadeo de red a mitad de
  // construcción habría dejado unas fechas con 500 miembros y otras con 43 megacaps
  // supervivientes, TODO ELLO ESCRITO AL PANEL CACHEADO y reutilizado en cada ejecución
  // posterior sin volver a preguntar. Un backtest con el universo cambiando a mitad de
  // película no da un número peor: da un número que no significa nada, y no lo parece.
  if (!table) {
    console.error(`\n  ✖ no se pudo cargar la tabla histórica de miembros (red + caché local).`);
    console.error(`    Se aborta sin escribir panel: media hora perdida es más barata que un panel mestizo.\n`);
    process.exit(1);
  }
  const sectorCache = new Map();
  const panel = {};
  let n = 0;
  for (const fecha of fechasDecision) {
    // Miembros del índice EN ESA FECHA. ⚠️ Nunca truncar: `membersAsOf` devuelve los
    // tickers en orden alfabético y un slice(0,N) borraría de la S a la Z (ver §3).
    const miembros = [...new Set(membersAsOf(table, fecha) || [])];
    // La definición de la señal NO vive aquí: `picksSignal.mjs` es la misma función que
    // ejecutará el cron de producción.
    const sig = await señalAt(miembros, fecha, sectorCache);
    panel[fecha] = sig;
    process.stdout.write(`  construyendo panel  ${fecha}  ${String(Object.keys(sig).length).padStart(3)} nombres   (${++n}/${fechasDecision.length})\r`);
  }
  writeFileSync(PANEL_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), window: VENTANA, dates: fechasDecision, panel }));
  console.log(`\n  → panel escrito en ${PANEL_FILE.split(/[\\/]/).pop()}\n`);
  return panel;
}

let PANEL;
if (!REBUILD && existsSync(PANEL_FILE)) {
  const c = JSON.parse(readFileSync(PANEL_FILE, "utf8"));
  if (c.dates?.length === fechasDecision.length) { PANEL = c.panel; console.log(`  panel reutilizado (${c.dates.length} fechas, generado ${c.generatedAt.slice(0, 10)})\n`); }
}
if (!PANEL) PANEL = await construirPanel();

const fechasOk = fechasDecision.filter((f) => Object.keys(PANEL[f] ?? {}).length >= 50);
if (fechasOk.length < (SMOKE ? 6 : 24)) { console.error(`  ✖ sólo ${fechasOk.length} fechas con datos suficientes`); process.exit(1); }

// ⚠️ CUÁNTAS FECHAS CORREN SOBRE UNA FOTO DE MIEMBROS VIEJA, y por qué hay que decirlo.
//
// `sp500_historical_components.csv` dejó de actualizarse aguas arriba el 2025-08-23. Para toda
// fecha posterior, `membersAsOf` devuelve esa foto: las altas del índice desde entonces no
// existen y las bajas siguen dentro. Es la eleccion correcta —usar la foto de HOY para fechas
// pasadas sería mirar al futuro, que es peor— pero es una limitación real que hasta ahora sólo
// constaba en un comentario de `universe.mjs`, lejos de los números que afecta.
//
// Medido el 2026-08-28: 23 de 185 fechas de la ventana reciente (12 %). Y CRECE SOLO: cada día
// que la fuente siga congelada añade otra.
const tablaMiembros = await loadSP500Historical();
const membresiaCongelada = ((t) => {
  let ultimaReal = null;
  for (let i = 1; i < (t?.length ?? 0); i++) {
    const d = (new Date(t[i].date) - new Date(t[i - 1].date)) / 86400000;
    if (d > 60) ultimaReal = t[i - 1].date;
  }
  if (!ultimaReal) return { fechasAfectadas: 0, de: fechasOk.length };
  const afectadas = fechasOk.filter((f) => f > ultimaReal);
  return {
    ultimaFotoReal: ultimaReal,
    fechasAfectadas: afectadas.length,
    de: fechasOk.length,
    pct: fechasOk.length ? +((100 * afectadas.length) / fechasOk.length).toFixed(1) : 0,
    nota: "Para estas fechas la membresía es la de ultimaFotoReal: las altas posteriores del índice no aparecen y las bajas siguen dentro.",
  };
})(tablaMiembros);

// ── SIMULACIÓN DE LAS REGLAS ────────────────────────────────────────────────────────────
// ⚠️ LA LÓGICA NO VIVE AQUÍ. Vive en `lib/picks.ts`, que es lo que ejecuta también el cron
// de producción. Si el backtest tuviera su propia copia, el track record publicado dejaría
// de ser el de lo que se midió — que es exactamente el fallo que ya costó meses de deriva
// silenciosa con los pesos del ensemble.
//
// Lo único que este fichero añade es la REGLA DE LOS 180 DÍAS, que la v2 eliminó pero que
// hay que poder seguir midiendo para justificar por qué se eliminó. Se aplica como un
// descalificador externo (el motor ya sabe vender descalificados y poner la cuarentena) y
// luego se reetiqueta el motivo en el libro, para que la tabla de ablación siga siendo
// legible. La regla NO está dentro del motor: producción no puede aplicarla ni por error.
function simular({ entry = ENTRY, exit = EXIT, topN = TOP_N, persistencia = PERSISTENCIA_DIAS,
                   dias180 = DIAS_180, cuarentenaMeses = CUARENTENA_MESES, comprasPorFecha = COMPRAS_POR_FECHA } = {}) {
  const overrides = { entryPctl: entry, exitPctl: exit, targetPositions: topN,
                      buysPerDate: comprasPorFecha, persistenceDays: persistencia,
                      quarantineMonths: cuarentenaMeses };
  let state = emptyState();
  const ultimaSobreEntrada = new Map();   // sólo para la regla de 180 días
  const libro = [];
  const huecos = [];

  for (let k = 0; k < fechasOk.length; k++) {
    const fecha = fechasOk[k];
    const sig = PANEL[fecha];

    // Fechas de decisión anteriores que caen dentro de la ventana de persistencia.
    const history = [];
    for (let j = k - 1; j >= 0 && dias(fechasOk[j], fecha) <= persistencia; j--) {
      history.unshift({ date: fechasOk[j], signal: PANEL[fechasOk[j]] });
    }

    // Regla de 180 días (sólo backtest histórico).
    const porLos180 = [];
    if (dias180 > 0) {
      for (const h of state.holdings) {
        const p = sig[h.ticker];
        if (p != null && p >= entry) ultimaSobreEntrada.set(h.ticker, fecha);
        const ultima = ultimaSobreEntrada.get(h.ticker) ?? h.since;
        if (p != null && dias(ultima, fecha) > dias180) porLos180.push(h.ticker);
      }
    }

    const d = decide({ date: fecha, signal: sig, history, state, disqualified: porLos180, overrides });

    for (const v of d.sells) {
      const motivo = porLos180.includes(v.ticker) ? "180 días sin recuperar"
        : v.reason === "senal_bajo_umbral" ? "señal bajo umbral 2 evaluaciones"
        : "fuera del universo";
      libro.push({ t: v.ticker, desde: v.since, hasta: fecha, motivo });
      ultimaSobreEntrada.delete(v.ticker);
    }
    for (const b of d.buys) ultimaSobreEntrada.set(b.ticker, fecha);
    if (!d.buys.length && state.holdings.length < topN) {
      huecos.push({ fecha, candidatos: d.eligibleNotBought.length, libres: topN - state.holdings.length });
    }
    state = d.nextState;
  }
  for (const h of state.holdings) libro.push({ t: h.ticker, desde: h.since, hasta: fechasOk.at(-1), motivo: "abierta al cierre" });
  return { libro, huecos };
}

// ── VALORACIÓN DIARIA ───────────────────────────────────────────────────────────────────
const panels = new Map();
async function panelDe(t) {
  if (!panels.has(t)) panels.set(t, await loadPanel(t, seriesFn));
  return panels.get(t);
}

/** Retornos simples diarios de un ticker entre dos fechas, sobre el eje de días de mercado. */
function retornosEntre(p, desde, hasta) {
  const a = idxOnOrBefore(p.dates, desde), b = idxOnOrBefore(p.dates, hasta);
  if (a < 0 || b <= a) return [];
  const out = [];
  for (let i = a + 1; i <= b; i++) out.push({ d: p.dates[i], r: Math.exp(p.ret[i]) - 1 });
  return out;
}

const curva = (rets, porAño = 252) => {
  let eq = 1, peak = 1, mdd = 0;
  for (const r of rets) { eq *= 1 + r; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
  const años = rets.length / porAño;
  return {
    total: (eq - 1) * 100,
    cagr: años > 0 ? (Math.pow(eq, 1 / años) - 1) * 100 : 0,
    sharpe: std(rets) ? mean(rets) / std(rets) * Math.sqrt(porAño) : 0,
    maxDD: mdd * 100,
  };
};

/** Convierte el libro de operaciones en dos curvas diarias: CON caja y SIN caja. */
// `silencioso` para el barrido y la ablación: ahí `valorar` se llama decenas de veces y el
// aviso de posiciones no valoradas se repetiría hasta enterrar el resultado. En la corrida
// principal —la que produce los números que se publican— SÍ se dice.
async function valorar(libro, { silencioso = false } = {}) {
  const eje = DIAS_MERCADO.filter((d) => d >= fechasOk[0] && d <= fechasOk.at(-1));
  const idx = new Map(eje.map((d, i) => [d, i]));
  // Para cada posición, su serie de retornos diarios colocada sobre el eje global.
  const activos = eje.map(() => []);            // día → [retornos de las posiciones vivas]
  const flujos = eje.map(() => ({ compras: [], ventas: [] }));
  // ⚠️ ESTOS DOS `continue` YA HICIERON DAÑO, y en silencio. El 2026-08-21 `EA` se quedó con
  // seis barras y `loadPanel` —que exige 300— devolvió null: las DOS posiciones de EA
  // desaparecieron del libro con `retorno: null`, y los números publicados de 2011-2018
  // salieron con 2 de 64 posiciones evaporadas sin un solo aviso.
  //
  // El riesgo dejó de ser teórico al resolver los CIK de las empresas muertas: ~150 nombres
  // nuevos entran al universo, y son justo los de historia corta o interrumpida. Si una parte
  // apreciable del libro se cae por aquí, el resultado NO es comparable con el anterior — así
  // que ahora se cuenta y se dice, en vez de saltarse.
  const saltadas = { sinPanel: [], sinRetornos: [] };
  for (const op of libro) {
    const p = await panelDe(op.t);
    if (!p) { saltadas.sinPanel.push(op.t); continue; }
    const rs = retornosEntre(p, op.desde, op.hasta);
    if (!rs.length) { saltadas.sinRetornos.push(`${op.t} ${op.desde}→${op.hasta}`); continue; }
    op.retorno = (rs.reduce((s, x) => s * (1 + x.r), 1) - 1) * 100;
    op.dias = dias(op.desde, op.hasta);
    for (const x of rs) { const i = idx.get(x.d); if (i != null) activos[i].push({ t: op.t, r: x.r }); }
    const ic = idx.get(op.desde), iv = idx.get(op.hasta);
    if (ic != null) flujos[ic].compras.push(op.t);
    if (iv != null) flujos[iv].ventas.push(op.t);
  }

  // MODELO B — sólo los picks, equiponderados. Mide si las elecciones fueron buenas,
  // sin el lastre de la rampa.
  const soloPicks = activos.map((a) => (a.length ? mean(a.map((x) => x.r)) : 0));

  // MODELO A — lo que vive el suscriptor: capital fijo, la caja NO renta (declarado; con
  // letras del Tesoro rentaría algo y el resultado sería algo mejor en 2023-2026).
  let caja = 100;
  const valor = new Map();                       // ticker → valor de mercado de la posición
  const conCaja = [];
  let patrimonioAyer = 100;
  for (let i = 0; i < eje.length; i++) {
    for (const x of activos[i]) if (valor.has(x.t)) valor.set(x.t, valor.get(x.t) * (1 + x.r));
    for (const t of flujos[i].ventas) { caja += (valor.get(t) ?? 0) * (1 - COST_BPS / 10000); valor.delete(t); }
    const antes = caja + [...valor.values()].reduce((s, x) => s + x, 0);
    for (const t of flujos[i].compras) {
      const objetivo = Math.min(caja, antes / TOP_N);
      if (objetivo <= 0.01) continue;
      caja -= objetivo; valor.set(t, objetivo * (1 - COST_BPS / 10000));
    }
    const ahora = caja + [...valor.values()].reduce((s, x) => s + x, 0);
    conCaja.push(patrimonioAyer > 0 ? ahora / patrimonioAyer - 1 : 0);
    patrimonioAyer = ahora;
  }

  // Nº medio de posiciones vivas y rotación
  const vivas = activos.map((a) => a.length);
  const nSalt = saltadas.sinPanel.length + saltadas.sinRetornos.length;
  if (nSalt && !silencioso) {
    const pct = (100 * nSalt) / libro.length;
    console.warn(`  ⚠ ${nSalt} de ${libro.length} posiciones (${pct.toFixed(1)} %) no se pudieron valorar y NO están en el resultado.`);
    if (saltadas.sinPanel.length) console.warn(`     sin panel de precios: ${[...new Set(saltadas.sinPanel)].join(" ")}`);
    if (saltadas.sinRetornos.length) console.warn(`     sin retornos en su periodo: ${saltadas.sinRetornos.slice(0, 12).join(" · ")}`);
    if (pct > 5) console.warn(`     ⚠⚠ por encima del 5 %: este resultado no es comparable con uno calculado sobre el libro completo.`);
  }
  return { eje, soloPicks, conCaja, vivas, saltadas: { sinPanel: [...new Set(saltadas.sinPanel)], sinRetornos: saltadas.sinRetornos.length, total: nSalt, deCuantas: libro.length } };
}

/** Referencia: comprar y mantener un ETF durante toda la ventana. */
async function refDe(ticker, eje) {
  const p = await panelDe(ticker);
  if (!p) return null;
  const rs = retornosEntre(p, eje[0], eje.at(-1));
  return rs.length >= eje.length * 0.9 ? curva(rs.map((x) => x.r)) : null;
}

/** Universo elegible equiponderado, diario: la referencia que dice si SELECCIONAR aporta.
 *
 *  ⚠️ PUNTO EN EL TIEMPO — y la primera versión de esto NO lo era. Cogía la UNIÓN de todos
 *  los tickers que aparecen en cualquier fecha del panel y los hacía cotizar desde el día
 *  uno. Como una empresa entra en el S&P 500 justamente DESPUÉS de haberlo hecho bien, eso
 *  metía en el índice de 2019 a los ganadores de 2024 y subía el listón artificialmente: el
 *  universo EW salía +221% cuando el SPY hizo +233%. Mismo error de familia que el truncado
 *  alfabético — usar información que en aquel momento no existía.
 *
 *  Aquí cada día promedia SÓLO los nombres que estaban en el panel en la última fecha de
 *  decisión anterior o igual a ese día.
 */
/**
 * `excluir` permite construir la MISMA referencia dejando fuera un conjunto de nombres.
 *
 * Existe para separar dos cosas que el resultado mezcla: **elegir bien** y **no tener bancos**.
 * §2ter dejó medido que la señal no puntúa a ni uno de los 18 mayores bancos del índice, y que
 * los bancos rindieron por debajo del SPY en las dos ventanas — así que parte de la ventaja
 * podría ser simplemente no haberlos tenido. Comparando contra el universo elegible **sin
 * financieros en ninguna de las dos partes**, lo que sobre es selección.
 */
/**
 * ¿Trae esta serie un salto que ninguna acción real hace?
 *
 * Devuelve el texto del salto, o null si la serie es plausible. El umbral (+300 % en una sesión)
 * está puesto MUY por encima de los récords reales a propósito: GME +135 %, NKTR +156 %. No se
 * trata de filtrar días extraordinarios, sino de cazar series que pertenecen a otro instrumento.
 */
const TOPE_SALTO = Math.log(4); // +300 % en un día
function saltoImposible(p, desde, hasta) {
  // Sólo el tramo que la referencia usa de verdad. Mirar la serie entera excluiría un nombre
  // bueno en la ventana por una anomalía posterior — y precisamente los símbolos reutilizados
  // se estropean DESPUÉS de que la empresa muera, o sea fuera de las ventanas antiguas.
  for (let i = Math.max(1, desde + 1); i < p.ret.length && p.dates[i] <= hasta; i++) {
    const r = p.ret[i];
    if (Number.isFinite(r) && r > TOPE_SALTO) {
      return `+${((Math.exp(r) - 1) * 100).toFixed(0)} % el ${p.dates[i]}`;
    }
  }
  return null;
}

async function universoEW(eje, excluir = null) {
  const porDia = eje.map(() => []);
  const idx = new Map(eje.map((d, i) => [d, i]));
  // Para cada día de mercado, qué fecha de decisión estaba vigente.
  const decisionVigente = [];
  for (let i = 0, k = 0; i < eje.length; i++) {
    while (k + 1 < fechasOk.length && fechasOk[k + 1] <= eje[i]) k++;
    decisionVigente.push(fechasOk[k]);
  }
  const todos = new Set();
  for (const f of fechasOk) for (const t of Object.keys(PANEL[f])) todos.add(t);

  // ⚠️ `excluir` FILTRA DE VERDAD. Hasta el 2026-09-01 este parámetro sólo se usaba para
  // cambiar el texto del aviso de abajo, y `miembros` se construía entero: la referencia «sin
  // financieros» era el MISMO cálculo que la de con ellos, y por eso daba exactamente los
  // mismos cuatro números —total, CAGR, Sharpe y drawdown— con 56 nombres supuestamente fuera.
  //
  // No fallaba: contestaba. Y contestaba que los financieros no aportaban nada a la referencia,
  // que es justo la pregunta de §11 —¿ganamos por elegir bien o por no tener bancos?— y la
  // misma que decide si merece la pena meter bancos en el universo elegible.
  const miembros = excluir?.size ? new Set([...todos].filter((t) => !excluir.has(t))) : todos;

  // Y que no pueda volver en silencio: si se pidió excluir y no se quitó a nadie, es este fallo
  // otra vez, y la referencia saldría idéntica en vez de rota.
  if (excluir?.size && miembros.size === todos.size) {
    throw new Error(`universoEW: se pidió excluir ${excluir.size} nombres y no se quitó ninguno — la referencia sin financieros sería idéntica a la normal`);
  }
  let n = 0;
  // Esta referencia es CONTRA LO QUE SE MIDE TODO, así que un nombre que desaparezca de ella en
  // silencio desplaza el listón sin que nada avise. Los dos descartes de abajo se cuentan:
  //   · `sinPanel`  — no hay precios (o están bloqueados por símbolo reutilizado).
  //   · `empiezaTarde` — la serie arranca DESPUÉS del inicio de la ventana, y entonces el
  //     nombre se cae entero en vez de aportar desde que existe.
  const fuera = { sinPanel: [], empiezaTarde: [], saltosImposibles: [] };
  for (const t of miembros) {
    const p = await panelDe(t);
    process.stdout.write(`  universo EW  ${++n}/${miembros.size}\r`);
    if (!p) { fuera.sinPanel.push(t); continue; }
    const a = idxOnOrBefore(p.dates, eje[0]);
    if (a < 0) { fuera.empiezaTarde.push(`${t} (${p.dates[0]})`); continue; }
    // Una acción no sube un 300 % en una sesión. GME hizo +135 % en el squeeze de 2021 y NKTR
    // +156 % con resultados de un ensayo — los dos REALES, y por eso el listón está tan alto:
    // lo que se busca no es un día extraordinario sino una serie que no es de esta empresa.
    // CBE (Cooper Industries, fusionada en 2012) traía +3.399.900 % en un día; ese solo nombre
    // llevó esta referencia a +83.575 % el 2026-09-01.
    const salto = saltoImposible(p, a, eje.at(-1));
    if (salto) { fuera.saltosImposibles.push(`${t} (${salto})`); continue; }
    for (let i = a + 1; i < p.dates.length && p.dates[i] <= eje.at(-1); i++) {
      const j = idx.get(p.dates[i]);
      if (j == null) continue;
      if (PANEL[decisionVigente[j]]?.[t] == null) continue;   // ese día NO estaba en el universo
      porDia[j].push(Math.exp(p.ret[i]) - 1);
    }
  }
  process.stdout.write("                              \r");
  const nFuera = fuera.sinPanel.length + fuera.empiezaTarde.length + fuera.saltosImposibles.length;
  if (nFuera) {
    const pct = (100 * nFuera) / miembros.size;
    console.warn(`  ⚠ universo EW${excluir ? " (sin financieros)" : ""}: ${nFuera} de ${miembros.size} nombres (${pct.toFixed(1)} %) NO entran en la referencia.`);
    if (fuera.sinPanel.length) console.warn(`     sin precios: ${fuera.sinPanel.slice(0, 20).join(" ")}${fuera.sinPanel.length > 20 ? ` … (+${fuera.sinPanel.length - 20})` : ""}`);
    if (fuera.empiezaTarde.length) console.warn(`     su serie empieza después del inicio de la ventana: ${fuera.empiezaTarde.slice(0, 10).join(" · ")}`);
    if (fuera.saltosImposibles.length) console.warn(`     ⛔ saltos imposibles (la serie no es de esta empresa): ${fuera.saltosImposibles.join(" · ")}`);
  }
  return { ...curva(porDia.map((a) => (a.length ? mean(a) : 0))), fuera: { sinPanel: fuera.sinPanel, empiezaTarde: fuera.empiezaTarde.length, saltosImposibles: fuera.saltosImposibles, deCuantos: miembros.size }, excluidos: todos.size - miembros.size };
}

// ── EJECUCIÓN ───────────────────────────────────────────────────────────────────────────
const { libro, huecos } = simular();
const { eje, soloPicks, conCaja, vivas, saltadas } = await valorar(libro);
const cPicks = curva(soloPicks);
const cCaja = curva(conCaja);
const ew = await universoEW(eje);

// ⚠️ RED FINAL, puesta el 2026-09-01 después de publicar una referencia con +83.575 % y un CAGR
// del 133 %. Salió con código 0 y sin un solo aviso; sólo se cazó al compararla a mano con la
// corrida del día anterior. Una cesta equiponderada del S&P 500 no compone al 133 % anual: si
// sale eso, hay una serie que no es de quien dice ser, y publicar el número es peor que fallar.
{
  const TOPE_CAGR = 40, SUELO_CAGR = -30;
  if (!Number.isFinite(ew.cagr) || ew.cagr > TOPE_CAGR || ew.cagr < SUELO_CAGR) {
    console.error(`\n  ⛔ La referencia equiponderada da un CAGR de ${ew.cagr?.toFixed?.(2) ?? ew.cagr} % (total ${ew.total?.toFixed?.(1)} %).`);
    console.error(`     Una cesta equiponderada del indice no hace eso. Casi seguro hay una serie que pertenece`);
    console.error(`     a otro instrumento: revisa los avisos de "saltos imposibles" y la auditoria de simbolos.`);
    console.error(`     No se publica una referencia que no puede ser cierta.\n`);
    process.exit(1);
  }
}

// ── SESGO SECTORIAL (§11, medición pendiente desde el 2026-08-21) ─────────────────────────
// Se marca como financiero a quien lo sea según el SIC de la SEC, y se rehace la referencia
// equiponderada SIN ellos. Es la comparación que separa "elegimos bien" de "no tenemos bancos".
const financieros = new Set();
{
  const vistos = new Set();
  for (const f of fechasOk) for (const t of Object.keys(PANEL[f])) vistos.add(t);
  for (const t of vistos) {
    try {
      const cik = await tickerToCik(t);
      if (!cik) continue;
      const sec = await sicSector(cik);
      if (sec === "Financial Services" || sec === "Real Estate") financieros.add(t);
    } catch { /* sin sector: se queda dentro, que es lo conservador */ }
  }
}
// El indice tiene ~70 financieras. Si aqui salen cuatro, no es que el indice haya cambiado:
// es que las consultas de sector no respondieron y el catch de arriba las dejo a todas dentro.
// Publicar la referencia igualmente daria un "+0 pp" indistinguible de una medicion de verdad,
// que es como §11 estuvo meses contestando lo que no habia medido.
{
  const vistosEnPanel = new Set();
  for (const f of fechasOk) for (const t of Object.keys(PANEL[f])) vistosEnPanel.add(t);
  const MINIMO = 20;
  if (vistosEnPanel.size > 200 && financieros.size < MINIMO) {
    console.error(`\n  ⛔ §11: solo ${financieros.size} financieros identificados sobre ${vistosEnPanel.size} nombres del panel.`);
    console.error(`     El indice tiene del orden de 70. Con tan pocos, la referencia "sin financieros" seria`);
    console.error(`     casi la misma que la normal y su "+0 pp" no significaria nada.`);
    console.error(`     Causa probable: las consultas de SIC a la SEC no respondieron (sin red, o 429).`);
    console.error(`     No se publica una medicion que no se ha hecho. Reintenta con la cache de EDGAR caliente.\n`);
    process.exit(1);
  }
}
const ewSinFin = await universoEW(eje, financieros);
const spy = await refDe("SPY", eje);
const rsp = await refDe("RSP", eje);

const fila = (n, s, ref) => console.log(`  ${n.padEnd(34)}${((s.total >= 0 ? "+" : "") + s.total.toFixed(0) + "%").padStart(9)}${(s.cagr.toFixed(1) + "%").padStart(8)}${s.sharpe.toFixed(2).padStart(8)}${(s.maxDD.toFixed(1) + "%").padStart(9)}${(ref == null ? "—" : ((s.total - ref >= 0 ? "+" : "") + (s.total - ref).toFixed(0) + "pp")).padStart(9)}`);

console.log(`  ── RESULTADO (diario, ${eje[0]} → ${eje.at(-1)}) ──`);
console.log(`  ${"".padEnd(34)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}${"vs EW".padStart(9)}`);
if (spy) fila("① SPY (comprar y mantener)", spy, null);
if (rsp) fila("② RSP (equiponderado)", rsp, null);
fila("③ universo elegible EW", ew, null);
fila("③b universo elegible EW SIN financieros", ewSinFin, null);
console.log(`  ${"-".repeat(77)}`);
fila("Reglas · SÓLO PICKS (sin caja)", cPicks, ew.total);
fila("Reglas · CON CAJA (suscriptor)", cCaja, ew.total);
console.log(`  ${"-".repeat(77)}`);
console.log(`  SESGO SECTORIAL — ¿cuánto de la ventaja es "no tener bancos"?`);
console.log(`    financieros dentro del universo elegible: ${financieros.size} de ${new Set(fechasOk.flatMap((f) => Object.keys(PANEL[f]))).size} nombres`);
console.log(`    vs universo EW  (con financieros)  ${((cCaja.total - ew.total >= 0 ? "+" : "") + (cCaja.total - ew.total).toFixed(0) + "pp")}`);
console.log(`    vs universo EW  (SIN financieros)  ${((cCaja.total - ewSinFin.total >= 0 ? "+" : "") + (cCaja.total - ewSinFin.total).toFixed(0) + "pp")}`);
console.log(`    → la diferencia entre las dos, ${((ewSinFin.total - ew.total >= 0 ? "+" : "") + (ewSinFin.total - ew.total).toFixed(0) + "pp")}, es lo que aportaban los financieros a la referencia.`);

// ── Lo que sólo se ve simulando las reglas ──────────────────────────────────────────────
const mesesRampa = vivas.findIndex((v) => v >= TOP_N);
const porMotivo = {};
for (const op of libro) porMotivo[op.motivo] = (porMotivo[op.motivo] ?? 0) + 1;
const cerradas = libro.filter((o) => o.motivo !== "abierta al cierre" && o.retorno != null);
const ganadoras = cerradas.filter((o) => o.retorno > 0).length;

console.log(`\n  ── LA MECÁNICA DEL PRODUCTO (esto no se ve en un backtest trimestral) ──`);
console.log(`  Posiciones abiertas en total       ${libro.length}`);
console.log(`  Cartera llena (${TOP_N} nombres) a los    ${mesesRampa < 0 ? "NUNCA se llenó" : (mesesRampa / 21).toFixed(0) + " meses"}`);
console.log(`  Nº medio de posiciones vivas       ${mean(vivas).toFixed(1)}`);
console.log(`  Fechas SIN compra (hueco vacío)    ${huecos.length} de ${fechasOk.length}  (${(huecos.length / fechasOk.length * 100).toFixed(0)}%)`);
console.log(`  Permanencia media                  ${cerradas.length ? (mean(cerradas.map((o) => o.dias)) / 30.4).toFixed(1) + " meses" : "—"}`);
console.log(`  Aciertos (retorno > 0)             ${cerradas.length ? (ganadoras / cerradas.length * 100).toFixed(0) + "%" : "—"} de ${cerradas.length} cerradas`);
console.log(`  Motivos de venta:`);
for (const [m, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${m}`);

// ── SENSIBILIDAD DE LOS UMBRALES (§5 los dejaba como [DECISIÓN PENDIENTE]) ──────────────
// Esto NO es para elegir el mejor. Es para ver si la FORMA del efecto aguanta al mover los
// umbrales, igual que se hizo con el número de posiciones. Si el resultado sólo funciona
// con una combinación concreta, esa combinación está ajustada al pasado y no vale nada.
// La elección final se toma con las DOS ventanas delante y a propósito fuera del pico.
if (!process.argv.includes("--no-sweep")) {
  console.log(`
  ── ¿DEPENDE EL RESULTADO DE LOS UMBRALES? (total vs universo EW, con caja) ──`);
  // Se reportan las DOS curvas a propósito. Si sólo se mirara la de "con caja", un umbral
  // alto parecería catastrófico cuando lo único que pasa es que no encuentra nada que
  // comprar y el dinero se queda parado. Separarlas distingue "la señal es peor" de
  // "el sistema no llega a invertir", que son dos problemas distintos con dos arreglos
  // distintos.
  console.log(`  ${"entrada".padStart(9)}${"salida".padStart(8)}${"picks".padStart(9)}${"c/caja".padStart(9)}${"Sharpe".padStart(8)}${"vs EW".padStart(9)}${"posic.".padStart(8)}${"%invert".padStart(9)}`);
  const barrido = [];
  for (const e of [70, 75, 80, 85, 90]) {
    for (const x of [40, 50, 60]) {
      const sim = simular({ entry: e / 100, exit: x / 100 });
      const v = await valorar(sim.libro, { silencioso: true });
      const c = curva(v.conCaja), cp = curva(v.soloPicks);
      const invertido = mean(v.vivas) / TOP_N * 100;   // % del cupo de posiciones realmente ocupado
      barrido.push({ entry: e, exit: x, soloPicks: fx(cp.total, 1), conCaja: fx(c.total, 1), sharpe: fx(c.sharpe, 2), maxDD: fx(c.maxDD, 1), vsEW: fx(c.total - ew.total, 1), posiciones: sim.libro.length, pctInvertido: fx(invertido, 0) });
      const marca = e === ENTRY * 100 && x === EXIT * 100 ? "  ← preespecificado" : "";
      console.log(`  ${("p" + e).padStart(9)}${("p" + x).padStart(8)}${((cp.total >= 0 ? "+" : "") + cp.total.toFixed(0) + "%").padStart(9)}${((c.total >= 0 ? "+" : "") + c.total.toFixed(0) + "%").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${String(sim.libro.length).padStart(8)}${(invertido.toFixed(0) + "%").padStart(9)}${marca}`);
    }
  }
  const gana = barrido.filter((b) => b.vsEW > 0).length;
  console.log(`  → bate al universo EW en ${gana}/${barrido.length} combinaciones de umbrales.`);
  globalThis.__barrido = barrido;
}

// ── ¿QUÉ REGLA HACE EL TRABAJO? (ablación: se quita una y se mira qué pasa) ─────────────
// Motivo para mirar esto: en la primera corrida, 52 de las 55 ventas las provocó la regla
// de los 180 días y sólo 3 el umbral de salida. O sea que §5.1 está casi muerta y §5.3 ES
// la política de venta. Y en el libro de operaciones esa regla vendió NVDA en noviembre de
// 2020 tras un +220%, porque su percentil de calidad se hundió mientras el negocio se
// disparaba. Una regla que hace el 95% de las ventas merece que se mida si aporta o resta.
if (!process.argv.includes("--no-ablacion")) {
  console.log(`
  ── ¿QUÉ REGLA HACE EL TRABAJO? (quitar una regla cada vez) ──`);
  console.log(`  ${"variante".padEnd(32)}${"picks".padStart(9)}${"c/caja".padStart(9)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}${"vs EW".padStart(9)}${"posic.".padStart(8)}${"%invert".padStart(9)}`);
  const VARIANTES = {
    "reglas completas (§2-§6)":      {},
    "sin la regla de 180 días":      { dias180: 0 },
    "sin cuarentena de 12 meses":    { cuarentenaMeses: 0 },
    "sin persistencia de 60 días":   { persistencia: 0 },
    "2/fecha = 4 al mes":            { comprasPorFecha: 2 },
    "4/fecha = 8 al mes":            { comprasPorFecha: 4 },
    "sin 180d + 4 al mes":           { dias180: 0, comprasPorFecha: 2 },
    "sin 180d + 8 al mes":           { dias180: 0, comprasPorFecha: 4 },
    // Los dos candidatos a v2, medidos COMO CONJUNTO: las mejoras no tienen por qué
    // sumarse. Se separan por cadencia porque es lo único que los distingue, y porque
    // 4 y 8 compras al mes son productos distintos para quien las ejecuta a mano.
    "v2 · p70 · 4 al mes · sin180d": { entry: 0.70, dias180: 0, comprasPorFecha: 2 },
    "v2 · p70 · 8 al mes · sin180d": { entry: 0.70, dias180: 0, comprasPorFecha: 4 },
  };
  const ablacion = {};
  for (const [nombre, opts] of Object.entries(VARIANTES)) {
    const sim = simular(opts);
    const v = await valorar(sim.libro, { silencioso: true });
    const c = curva(v.conCaja), cp = curva(v.soloPicks);
    ablacion[nombre] = { soloPicks: fx(cp.total, 1), conCaja: fx(c.total, 1), sharpe: fx(c.sharpe, 2), maxDD: fx(c.maxDD, 1), vsEW: fx(c.total - ew.total, 1), posiciones: sim.libro.length, pctInvertido: fx(mean(v.vivas) / TOP_N * 100, 0) };
    console.log(`  ${nombre.padEnd(32)}${((cp.total >= 0 ? "+" : "") + cp.total.toFixed(0) + "%").padStart(9)}${((c.total >= 0 ? "+" : "") + c.total.toFixed(0) + "%").padStart(9)}${c.sharpe.toFixed(2).padStart(8)}${(c.maxDD.toFixed(1) + "%").padStart(9)}${(((c.total - ew.total) >= 0 ? "+" : "") + (c.total - ew.total).toFixed(0) + "pp").padStart(9)}${String(sim.libro.length).padStart(8)}${(fx(mean(v.vivas) / TOP_N * 100, 0) + "%").padStart(9)}`);
  }
  globalThis.__ablacion = ablacion;
}

// ── Criterios de aceptación, contrastados contra lo preespecificado ─────────────────────
// H1 necesita el top-40 trimestral de §3 como referencia; se lee del artefacto ya
// versionado en vez de recalcularlo, para que sea EXACTAMENTE el número publicado.
let refTrimestral = null;
try {
  const f = join(OUT, LONG ? "quality_lowvol_lab_oos.json" : "quality_lowvol_lab.json");
  const d = JSON.parse(readFileSync(f, "utf8"));
  if (d.topN === TOP_N) refTrimestral = d.results?.["Calidad"]?.total ?? null;   // artefacto de quality_lowvol_lab
} catch { /* sin referencia */ }

console.log(`\n  CRITERIOS (escritos antes de correr esto):`);
const h1 = refTrimestral == null ? null : cPicks.total - refTrimestral >= -15;
console.log(`  ${h1 == null ? "?" : h1 ? "✔" : "✖"}  H1 las reglas no destruyen la señal ${refTrimestral == null ? "(sin referencia trimestral)" : `(${cPicks.total.toFixed(0)}% con reglas vs ${refTrimestral.toFixed(0)}% trimestral · ${(cPicks.total - refTrimestral >= 0 ? "+" : "") + (cPicks.total - refTrimestral).toFixed(0)}pp, tolerancia −15pp)`}`);
const h2 = cCaja.total > ew.total;
console.log(`  ${h2 ? "✔" : "✖"}  H2 la cartera con reglas bate al universo EW (${cCaja.total.toFixed(0)}% vs ${ew.total.toFixed(0)}%)`);
console.log(`  ℹ  H3 el precio de la rampa: ${(cPicks.total - cCaja.total).toFixed(0)} pp entre sólo-picks y con-caja`);

writeFileSync(join(OUT, `picks_rules_backtest${LONG ? "_oos" : ""}${SMOKE ? "_smoke" : ""}.json`), JSON.stringify({
  generatedAt: new Date().toISOString(), window: VENTANA,
  // ⚠️ DE QUÉ ENTRADAS SALIÓ ESTO. Sin la huella, un artefacto viejo es indistinguible de uno
  // nuevo salvo mirando la fecha — y nadie la mira. El 2026-08-29 esta corrida abortó por
  // memoria DESPUÉS del panel, no escribió, y los números publicados siguieron siendo los del
  // día anterior sin que nada lo dijera. `research/frescura_artefactos.mjs` la comprueba.
  huella: huellaEntradas(tablaMiembros?.length ? tablaMiembros[tablaMiembros.length - 1] : null),
  rules: { entry: ENTRY, exit: EXIT, topN: TOP_N, comprasPorFecha: COMPRAS_POR_FECHA, persistenciaDias: PERSISTENCIA_DIAS, dias180: DIAS_180, cuarentenaMeses: CUARENTENA_MESES, costBps: COST_BPS },
  span: { from: eje[0], to: eje.at(-1), decisiones: fechasOk.length, diasMercado: eje.length },
  // Lo que NO entró en el cálculo, que es tan parte del resultado como lo que sí. Sin esto,
  // una caída silenciosa de posiciones o de nombres de la referencia desplaza los números sin
  // dejar rastro — que es exactamente lo que pasó con `EA` el 2026-08-21.
  cobertura: {
    posicionesNoValoradas: saltadas,
    membresiaCongelada,
    universoEWFuera: ew.fuera,
    universoEWSinFinancierosFuera: ewSinFin.fuera,
    nota: "Si `posicionesNoValoradas.total` pasa del 5 % del libro, este resultado no es comparable con uno calculado sobre el libro completo.",
  },
  benchmarks: { spy: spy && { total: fx(spy.total, 1), cagr: fx(spy.cagr, 2), sharpe: fx(spy.sharpe, 2), maxDD: fx(spy.maxDD, 1) },
                rsp: rsp && { total: fx(rsp.total, 1), sharpe: fx(rsp.sharpe, 2), maxDD: fx(rsp.maxDD, 1) },
                universoEW: { total: fx(ew.total, 1), cagr: fx(ew.cagr, 2), sharpe: fx(ew.sharpe, 2), maxDD: fx(ew.maxDD, 1) },
                universoEWSinFinancieros: { total: fx(ewSinFin.total, 1), cagr: fx(ewSinFin.cagr, 2), sharpe: fx(ewSinFin.sharpe, 2), maxDD: fx(ewSinFin.maxDD, 1),
                  financierosExcluidos: financieros.size,
                  nota: "Misma referencia sin financieros ni inmobiliario. Separa la selección del sesgo sectorial (§11)." } },
  carteras: { soloPicks: { total: fx(cPicks.total, 1), cagr: fx(cPicks.cagr, 2), sharpe: fx(cPicks.sharpe, 2), maxDD: fx(cPicks.maxDD, 1) },
              conCaja: { total: fx(cCaja.total, 1), cagr: fx(cCaja.cagr, 2), sharpe: fx(cCaja.sharpe, 2), maxDD: fx(cCaja.maxDD, 1) } },
  mecanica: { posiciones: libro.length, mesesHastaLlenar: mesesRampa < 0 ? null : +(mesesRampa / 21).toFixed(1),
              posicionesMedias: fx(mean(vivas), 1), fechasSinCompra: huecos.length,
              permanenciaMesesMedia: cerradas.length ? fx(mean(cerradas.map((o) => o.dias)) / 30.4, 1) : null,
              aciertosPct: cerradas.length ? fx(ganadoras / cerradas.length * 100, 1) : null, motivos: porMotivo },
  // El libro de operaciones completo. Va al artefacto por dos motivos: sin él nadie puede
  // comprobar QUÉ habría comprado el sistema (y §7 promete publicar cada decisión), y es lo
  // único que permite ver la composición sectorial sin volver a correr el backtest entero.
  operaciones: libro.map((o) => ({ t: o.t, desde: o.desde, hasta: o.hasta, motivo: o.motivo, dias: o.dias ?? null, retorno: o.retorno == null ? null : fx(o.retorno, 1) }))
                    .sort((a, b) => a.desde.localeCompare(b.desde)),
  barridoUmbrales: globalThis.__barrido ?? null,
  ablacionReglas: globalThis.__ablacion ?? null,
  criterios: { H1_reglasNoDestruyenSeñal: h1, H1_refTrimestral: refTrimestral == null ? null : fx(refTrimestral, 1),
               H2_bateUniversoEW: h2, H3_precioDeLaRampaPp: fx(cPicks.total - cCaja.total, 1) },
}, null, 2));
// El nombre que se imprime tiene que ser el que se ESCRIBE. Le faltaba el `_smoke`, asi que al
// terminar una corrida de humo anunciaba «escrito research/out/picks_rules_backtest.json» — el
// artefacto de VERDAD, el que sostiene las cifras publicadas del documento de reglas. No lo
// pisa (la escritura si lleva el sufijo), pero invita a creer que si, y en las dos direcciones:
// o corres un smoke para revisar algo y te quedas pensando que has machacado los numeros
// buenos, o abres ese fichero convencido de que trae lo que acabas de correr.
console.log(`\n  → escrito research/out/picks_rules_backtest${LONG ? "_oos" : ""}${SMOKE ? "_smoke" : ""}.json\n`);
