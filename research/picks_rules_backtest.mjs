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
//   node --experimental-strip-types --no-warnings research/picks_rules_backtest.mjs [--long]
//        [--entry 80] [--exit 50] [--top 40] [--rebuild]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { señalAt } from "./picksSignal.mjs";
import { returnsSeries } from "./prices.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";
import { addMonths, mean, std, fx, loadPanel, idxOnOrBefore } from "./momentumSignals.mjs";
// El motor de reglas, COMPARTIDO con producción. Import de VALOR ⇒ necesita la extensión.
import { decide, emptyState } from "../lib/picks.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
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
  const sectorCache = new Map();
  const panel = {};
  let n = 0;
  for (const fecha of fechasDecision) {
    // Miembros del índice EN ESA FECHA. ⚠️ Nunca truncar: `membersAsOf` devuelve los
    // tickers en orden alfabético y un slice(0,N) borraría de la S a la Z (ver §3).
    const miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
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
async function valorar(libro) {
  const eje = DIAS_MERCADO.filter((d) => d >= fechasOk[0] && d <= fechasOk.at(-1));
  const idx = new Map(eje.map((d, i) => [d, i]));
  // Para cada posición, su serie de retornos diarios colocada sobre el eje global.
  const activos = eje.map(() => []);            // día → [retornos de las posiciones vivas]
  const flujos = eje.map(() => ({ compras: [], ventas: [] }));
  for (const op of libro) {
    const p = await panelDe(op.t);
    if (!p) continue;
    const rs = retornosEntre(p, op.desde, op.hasta);
    if (!rs.length) continue;
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
  return { eje, soloPicks, conCaja, vivas };
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
async function universoEW(eje) {
  const porDia = eje.map(() => []);
  const idx = new Map(eje.map((d, i) => [d, i]));
  // Para cada día de mercado, qué fecha de decisión estaba vigente.
  const decisionVigente = [];
  for (let i = 0, k = 0; i < eje.length; i++) {
    while (k + 1 < fechasOk.length && fechasOk[k + 1] <= eje[i]) k++;
    decisionVigente.push(fechasOk[k]);
  }
  const miembros = new Set();
  for (const f of fechasOk) for (const t of Object.keys(PANEL[f])) miembros.add(t);
  let n = 0;
  for (const t of miembros) {
    const p = await panelDe(t);
    process.stdout.write(`  universo EW  ${++n}/${miembros.size}\r`);
    if (!p) continue;
    const a = idxOnOrBefore(p.dates, eje[0]);
    if (a < 0) continue;
    for (let i = a + 1; i < p.dates.length && p.dates[i] <= eje.at(-1); i++) {
      const j = idx.get(p.dates[i]);
      if (j == null) continue;
      if (PANEL[decisionVigente[j]]?.[t] == null) continue;   // ese día NO estaba en el universo
      porDia[j].push(Math.exp(p.ret[i]) - 1);
    }
  }
  process.stdout.write("                              \r");
  return curva(porDia.map((a) => (a.length ? mean(a) : 0)));
}

// ── EJECUCIÓN ───────────────────────────────────────────────────────────────────────────
const { libro, huecos } = simular();
const { eje, soloPicks, conCaja, vivas } = await valorar(libro);
const cPicks = curva(soloPicks);
const cCaja = curva(conCaja);
const ew = await universoEW(eje);
const spy = await refDe("SPY", eje);
const rsp = await refDe("RSP", eje);

const fila = (n, s, ref) => console.log(`  ${n.padEnd(34)}${((s.total >= 0 ? "+" : "") + s.total.toFixed(0) + "%").padStart(9)}${(s.cagr.toFixed(1) + "%").padStart(8)}${s.sharpe.toFixed(2).padStart(8)}${(s.maxDD.toFixed(1) + "%").padStart(9)}${(ref == null ? "—" : ((s.total - ref >= 0 ? "+" : "") + (s.total - ref).toFixed(0) + "pp")).padStart(9)}`);

console.log(`  ── RESULTADO (diario, ${eje[0]} → ${eje.at(-1)}) ──`);
console.log(`  ${"".padEnd(34)}${"total".padStart(9)}${"CAGR".padStart(8)}${"Sharpe".padStart(8)}${"maxDD".padStart(9)}${"vs EW".padStart(9)}`);
if (spy) fila("① SPY (comprar y mantener)", spy, null);
if (rsp) fila("② RSP (equiponderado)", rsp, null);
fila("③ universo elegible EW", ew, null);
console.log(`  ${"-".repeat(77)}`);
fila("Reglas · SÓLO PICKS (sin caja)", cPicks, ew.total);
fila("Reglas · CON CAJA (suscriptor)", cCaja, ew.total);

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
      const v = await valorar(sim.libro);
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
    const v = await valorar(sim.libro);
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
  rules: { entry: ENTRY, exit: EXIT, topN: TOP_N, comprasPorFecha: COMPRAS_POR_FECHA, persistenciaDias: PERSISTENCIA_DIAS, dias180: DIAS_180, cuarentenaMeses: CUARENTENA_MESES, costBps: COST_BPS },
  span: { from: eje[0], to: eje.at(-1), decisiones: fechasOk.length, diasMercado: eje.length },
  benchmarks: { spy: spy && { total: fx(spy.total, 1), cagr: fx(spy.cagr, 2), sharpe: fx(spy.sharpe, 2), maxDD: fx(spy.maxDD, 1) },
                rsp: rsp && { total: fx(rsp.total, 1), sharpe: fx(rsp.sharpe, 2), maxDD: fx(rsp.maxDD, 1) },
                universoEW: { total: fx(ew.total, 1), cagr: fx(ew.cagr, 2), sharpe: fx(ew.sharpe, 2), maxDD: fx(ew.maxDD, 1) } },
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
console.log(`\n  → escrito research/out/picks_rules_backtest${LONG ? "_oos" : ""}.json\n`);
