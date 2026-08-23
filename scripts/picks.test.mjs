// Tests del motor de reglas de Scora Picks (`lib/picks.ts`).
//
// Fija el COMPORTAMIENTO de §3-§5 de SCORA_PICKS_REGLAS.md, no la implementación. Si alguien
// cambia una regla sin abrir una `rules_version` nueva, estos tests tienen que gritar: el
// track record publicado de una versión no puede mezclarse con el de otra.
//
//   node --experimental-strip-types --no-warnings scripts/picks.test.mjs
import {
  decide, emptyState, addMonths, daysBetween, cotizaEn,
  PICKS_RULES_VERSION, ENTRY_PCTL, EXIT_PCTL, TARGET_POSITIONS, BUYS_PER_DATE,
  PERSISTENCE_DAYS, QUARANTINE_MONTHS, EXIT_CONSECUTIVE, MAX_PRICE_LAG_DAYS,
} from "../lib/picks.ts";
import { percentilesDe, metricasDe, METRICAS_CALIDAD, MIN_METRICAS } from "../research/picksSignal.mjs";
import { parseSP500Csv, snapshotDate, membersAsOf } from "../research/universe.mjs";
import { cubreLaCache } from "../research/prices.mjs";
import { universeSnapshots } from "../lib/picksData.ts";
import { articular, articularFundamentales, TOLERANCIA } from "../lib/articulacion.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

// ── Fechas ──────────────────────────────────────────────────────────────────────────────
eq(daysBetween("2026-01-01", "2026-01-31"), 30, "daysBetween cuenta días naturales");
eq(daysBetween("2026-03-01", "2026-02-27"), -2, "daysBetween admite negativo");
eq(daysBetween("2024-02-28", "2024-03-01"), 2, "daysBetween cruza un 29 de febrero");
eq(addMonths("2026-01-15", 12), "2027-01-15", "addMonths de un año");
eq(addMonths("2026-01-31", 1), "2026-02-28", "addMonths satura al último día del mes");
eq(addMonths("2024-01-31", 1), "2024-02-29", "addMonths respeta el año bisiesto");

// ── Constantes: el contrato de la v2 ────────────────────────────────────────────────────
eq(PICKS_RULES_VERSION, 2, "la versión de reglas es 2");
eq(ENTRY_PCTL, 0.70, "entrada en p70 (§3)");
eq(EXIT_PCTL, 0.50, "salida en p50 (§5.1)");
eq(TARGET_POSITIONS, 40, "tope de 40 posiciones (§6)");
eq(BUYS_PER_DATE, 2, "2 compras POR FECHA = 4 al mes (§4)");
eq(PERSISTENCE_DAYS, 60, "persistencia de 60 días (§3)");
eq(QUARANTINE_MONTHS, 12, "cuarentena de 12 meses (§5)");
eq(EXIT_CONSECUTIVE, 2, "dos evaluaciones consecutivas para vender (§5.1)");
// La regla de los 180 días NO existe en la v2: se midió que costaba 63-74 pp.
ok(!Object.keys({ PICKS_RULES_VERSION }).some((k) => k.includes("180")), "no queda rastro de la regla de 180 días");

// ── Ayudas para construir historia ──────────────────────────────────────────────────────
const hist = (fechas, señal) => fechas.map((date) => ({ date, signal: señal }));
const FECHAS_60D = ["2026-01-02", "2026-01-15", "2026-02-02", "2026-02-16"];   // ~45 días

// ── Persistencia (§3) ───────────────────────────────────────────────────────────────────
{
  const señal = { AAA: 0.95, BBB: 0.90 };
  const sinHistoria = decide({ date: "2026-03-02", signal: señal, history: [], state: emptyState() });
  eq(sinHistoria.buys.length, 0, "sin historia no se compra nada");

  const conHistoria = decide({
    date: "2026-02-16", signal: señal,
    history: hist(FECHAS_60D.slice(0, 3), señal), state: emptyState(),
  });
  eq(conHistoria.buys.map((b) => b.ticker), ["AAA", "BBB"], "con la señal sostenida se compra");

  // Un nombre que cae UNA sola evaluación por debajo del umbral queda descartado.
  const historiaRota = [
    { date: "2026-01-02", signal: { AAA: 0.95, BBB: 0.90 } },
    { date: "2026-01-15", signal: { AAA: 0.95, BBB: 0.60 } },   // BBB se hunde aquí
    { date: "2026-02-02", signal: { AAA: 0.95, BBB: 0.90 } },
  ];
  const roto = decide({ date: "2026-02-16", signal: señal, history: historiaRota, state: emptyState() });
  eq(roto.buys.map((b) => b.ticker), ["AAA"], "un pico de un día no basta: BBB queda fuera");

  // Un nombre que no existía hace 60 días tampoco entra.
  const nuevo = decide({
    date: "2026-02-16", signal: { AAA: 0.95, NEW: 0.99 },
    history: hist(FECHAS_60D.slice(0, 3), { AAA: 0.95 }), state: emptyState(),
  });
  eq(nuevo.buys.map((b) => b.ticker), ["AAA"], "sin 60 días de cobertura no se compra, por alto que sea el percentil");
}

// ── Umbral de entrada y tope por fecha (§3-§4) ──────────────────────────────────────────
{
  const señal = { A: 0.99, B: 0.85, C: 0.75, D: 0.69, E: 0.71 };
  const d = decide({ date: "2026-02-16", signal: señal, history: hist(FECHAS_60D.slice(0, 3), señal), state: emptyState() });
  eq(d.buys.map((b) => b.ticker), ["A", "B"], "compra las 2 mejores, no más (§4)");
  eq(d.eligibleNotBought.map((b) => b.ticker), ["C", "E"], "las elegibles que no caben se publican");
  ok(!d.buys.concat(d.eligibleNotBought).some((x) => x.ticker === "D"), "p69 no es elegible con umbral p70");
}

// ── Desempate determinista ──────────────────────────────────────────────────────────────
{
  const señal = { ZZZ: 0.80, AAA: 0.80, MMM: 0.80 };
  const d1 = decide({ date: "2026-02-16", signal: señal, history: hist(FECHAS_60D.slice(0, 3), señal), state: emptyState() });
  const revuelto = { MMM: 0.80, ZZZ: 0.80, AAA: 0.80 };
  const d2 = decide({ date: "2026-02-16", signal: revuelto, history: hist(FECHAS_60D.slice(0, 3), revuelto), state: emptyState() });
  eq(d1.buys.map((b) => b.ticker), ["AAA", "MMM"], "a igualdad de percentil desempata el ticker");
  eq(d1.buys.map((b) => b.ticker), d2.buys.map((b) => b.ticker), "el orden de las claves NO cambia la decisión");
}

// ── Salida por señal: hacen falta DOS evaluaciones (§5.1) ───────────────────────────────
{
  let state = { holdings: [{ ticker: "X", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: {} };
  const primera = decide({ date: "2026-02-02", signal: { X: 0.40 }, history: [], state });
  eq(primera.sells.length, 0, "una sola evaluación bajo el umbral NO vende");
  const segunda = decide({ date: "2026-02-16", signal: { X: 0.40 }, history: [], state: primera.nextState });
  eq(segunda.sells.map((s) => s.reason), ["senal_bajo_umbral"], "dos consecutivas sí venden");

  // Y si se recupera en medio, el contador se reinicia.
  const recupera = decide({ date: "2026-02-16", signal: { X: 0.55 }, history: [], state: primera.nextState });
  const luegoCae = decide({ date: "2026-03-02", signal: { X: 0.40 }, history: [], state: recupera.nextState });
  eq(luegoCae.sells.length, 0, "recuperarse reinicia el contador de salida");
}

// ── Salida por desaparecer del universo (§5.3) ──────────────────────────────────────────
{
  const state = { holdings: [{ ticker: "OPA", since: "2025-06-02" }], quarantineUntil: {}, belowExitCount: {} };
  const d = decide({ date: "2026-02-16", signal: {}, history: [], state });
  eq(d.sells.map((s) => s.reason), ["fuera_del_universo"], "si deja de estar en el universo, se vende");
}

// ── Descalificador (§5.2) ───────────────────────────────────────────────────────────────
{
  const state = { holdings: [{ ticker: "MALA", since: "2025-06-02" }], quarantineUntil: {}, belowExitCount: {} };
  const d = decide({ date: "2026-02-16", signal: { MALA: 0.95 }, history: [], state, disqualified: ["MALA"] });
  eq(d.sells.map((s) => s.reason), ["descalificador"], "un descalificador vende aunque el percentil sea altísimo");
}

// ── Cuarentena (§5) ─────────────────────────────────────────────────────────────────────
{
  const señal = { Q: 0.99 };
  const state = { holdings: [{ ticker: "Q", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: { Q: 1 } };
  const vende = decide({ date: "2026-02-16", signal: { Q: 0.10 }, history: [], state });
  eq(vende.sells.length, 1, "se vende Q");
  eq(vende.nextState.quarantineUntil.Q, "2027-02-16", "la cuarentena vence 12 meses después");

  const antes = decide({
    date: "2026-12-01", signal: señal,
    history: hist(["2026-10-01", "2026-11-01", "2026-11-15"], señal), state: vende.nextState,
  });
  eq(antes.buys.length, 0, "no puede reentrar dentro de la cuarentena");

  const despues = decide({
    date: "2027-03-01", signal: señal,
    history: hist(["2027-01-04", "2027-02-01", "2027-02-15"], señal), state: vende.nextState,
  });
  eq(despues.buys.map((b) => b.ticker), ["Q"], "pasados 12 meses vuelve a ser elegible");
}

// ── Tope de cartera y hueco vacío (§4, §6) ──────────────────────────────────────────────
{
  const señal = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`T${String(i).padStart(2, "0")}`, 0.99 - i / 1000]));
  const llena = { holdings: Array.from({ length: 40 }, (_, i) => ({ ticker: `H${i}`, since: "2025-01-02" })), quarantineUntil: {}, belowExitCount: {} };
  const señalConHolds = { ...señal, ...Object.fromEntries(llena.holdings.map((h) => [h.ticker, 0.80])) };
  const d = decide({ date: "2026-02-16", signal: señalConHolds, history: hist(FECHAS_60D.slice(0, 3), señalConHolds), state: llena });
  eq(d.buys.length, 0, "con la cartera llena no se compra nada");
  ok(d.eligibleNotBought.length > 0, "pero los candidatos rechazados se publican igual");

  // Una venta libera plaza EN LA MISMA FECHA.
  const conHueco = { ...llena, holdings: llena.holdings.slice(0, 39) };
  const señalHueco = { ...señal, ...Object.fromEntries(conHueco.holdings.map((h) => [h.ticker, 0.80])) };
  const e = decide({ date: "2026-02-16", signal: señalHueco, history: hist(FECHAS_60D.slice(0, 3), señalHueco), state: conHueco });
  eq(e.buys.length, 1, "con una plaza libre se compra exactamente una");
}

// ── El hueco vacío es un resultado legítimo (§4) ────────────────────────────────────────
{
  const señal = { A: 0.10, B: 0.20 };
  const d = decide({ date: "2026-02-16", signal: señal, history: hist(FECHAS_60D.slice(0, 3), señal), state: emptyState() });
  eq(d.buys.length, 0, "si nadie cumple, no se compra");
  eq(d.eligibleNotBought.length, 0, "y no hay candidatos que publicar");
}

// ── Pureza: `decide` no muta el estado que recibe ───────────────────────────────────────
{
  const state = { holdings: [{ ticker: "P", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: {} };
  const copia = JSON.parse(JSON.stringify(state));
  decide({ date: "2026-02-16", signal: { P: 0.10 }, history: [], state });
  eq(state, copia, "decide() no muta su entrada");
}

// ── La señal (research/picksSignal.mjs) ─────────────────────────────────────────────────
// Sólo la parte PURA: convertir métricas crudas en percentiles. La parte que habla con
// EDGAR se valida por paridad contra el panel del backtest, no aquí.
eq(METRICAS_CALIDAD, ["gprof", "roic", "opm", "icov", "lev"], "las cinco métricas de calidad de §3");
eq(MIN_METRICAS, 3, "hacen falta al menos 3 de 5 métricas");

{
  // Diez nombres, la métrica `gprof` creciente y el resto constante: el orden del percentil
  // tiene que seguir a `gprof`, y el mejor debe quedar en 1 y el peor en 0.
  const rows = Array.from({ length: 10 }, (_, i) => ({
    t: `T${i}`, gprof: i, roic: 5, opm: 5, icov: 5, lev: -1,
  }));
  const p = percentilesDe(rows);
  eq(Object.keys(p).length, 10, "todos los nombres con las 5 métricas obtienen señal");
  ok(p.T9 > p.T0, "más rentabilidad bruta ⇒ mejor percentil");
  ok(p.T9 <= 1 && p.T0 >= 0, "el percentil vive en [0,1]");
  // Con cuatro métricas empatadas, cada una aporta 0,5 de percentil medio: el rango se
  // comprime pero el ORDEN se conserva, que es lo único que usa el motor.
  const orden = Object.entries(p).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  eq(orden[0], "T9", "el mejor por gprof queda primero");
  eq(orden.at(-1), "T0", "el peor queda último");
}

{
  // La deuda va al revés: `lev` es −netDebtEbitda, así que MENOS deuda debe puntuar mejor.
  const fila = (t, netDebtEbitda) => metricasDe({ ticker: t, m: { grossProfitability: 30, roic: 10, operatingMargin: 0.2, interestCoverage: 8, netDebtEbitda } });
  const rows = [fila("SANA", 0.5), fila("REGULAR", 3), fila("CARGADA", 6)];
  eq(rows[0].lev > rows[2].lev, true, "menos deuda ⇒ `lev` mayor");
  // Con 3 nombres `pct` no calcula (exige 8), así que se rellena hasta el mínimo.
  const muchos = [...rows, ...Array.from({ length: 7 }, (_, i) => fila(`X${i}`, 2 + i * 0.3))];
  const p = percentilesDe(muchos);
  ok(p.SANA > p.CARGADA, "la menos endeudada saca mejor señal que la más endeudada");
}

{
  // Un nombre al que le faltan 3 de 5 métricas no debe tener señal: con dos métricas, el
  // percentil medio lo decide qué datos FALTAN, no qué negocio es.
  const rows = Array.from({ length: 10 }, (_, i) => ({ t: `T${i}`, gprof: i, roic: i, opm: i, icov: i, lev: -i }));
  rows.push({ t: "COJO", gprof: 100, roic: 100, opm: null, icov: null, lev: null });
  const p = percentilesDe(rows);
  ok(p.COJO === undefined, "con sólo 2 de 5 métricas no hay señal");
  rows.push({ t: "JUSTO", gprof: 100, roic: 100, opm: 100, icov: null, lev: null });
  ok(percentilesDe(rows).JUSTO !== undefined, "con 3 de 5 sí hay señal");
}

{
  // El percentil es TRANSVERSAL: los mismos números absolutos dan señal distinta según
  // contra quién se comparen. Es la propiedad que hace que no envejezca como una banda fija.
  const base = (t, g) => ({ t, gprof: g, roic: 10, opm: 0.2, icov: 8, lev: -1 });
  const flojos = Array.from({ length: 9 }, (_, i) => base(`F${i}`, i));
  const fuertes = Array.from({ length: 9 }, (_, i) => base(`F${i}`, 100 + i));
  const entreFlojos = percentilesDe([...flojos, base("YO", 50)]).YO;
  const entreFuertes = percentilesDe([...fuertes, base("YO", 50)]).YO;
  ok(entreFlojos > entreFuertes, "la misma empresa puntúa peor rodeada de mejores");
}

// ── El universo: de dónde sale y qué foto se usó ────────────────────────────────────────
// Estas piezas existen porque el cron cayó a `CURATED` si GitHub parpadeaba, y porque la
// fuente del universo lleva congelada desde 2025-08-23 sin que nada lo dijera.
{
  const csv = [
    "date,tickers",
    '2025-08-21,"AAA,BBB,CCC"',
    '2025-08-23,"AAA,BBB,DDD"',
    '2025-08-22,"AAA,CCC"',
  ].join("\n");
  const t = parseSP500Csv(csv);
  eq(t.map((r) => r.date), ["2025-08-21", "2025-08-22", "2025-08-23"], "parseSP500Csv ordena por fecha");
  eq(t[2].tickers, ["AAA", "BBB", "DDD"], "parseSP500Csv separa los tickers de la fecha");
  eq(snapshotDate(t), "2025-08-23", "snapshotDate es la foto más reciente, no la de hoy");
  eq(snapshotDate([]), null, "snapshotDate de una tabla vacía es null");
  eq(snapshotDate(null), null, "snapshotDate tolera null");

  // El punto entero de guardar `universe_asof`: pedir miembros de una fecha MUY posterior
  // devuelve la última foto disponible sin avisar. Es correcto y es exactamente por lo que
  // hay que publicar de cuándo es esa foto.
  eq(membersAsOf(t, "2026-09-01"), ["AAA", "BBB", "DDD"], "membersAsOf de una fecha futura devuelve la última foto");

  // Una línea rota no puede colarse como fecha válida ni vaciar el universo.
  eq(parseSP500Csv("date,tickers\nbasura,\n2025-01-02,\"AAA\"").length, 1, "parseSP500Csv descarta líneas sin fecha válida");
  eq(parseSP500Csv('date,tickers\n2025-01-02,""').length, 0, "parseSP500Csv descarta fotos sin ningún ticker");
}

{
  const runs = [
    { decision_date: "2026-09-15", universe_asof: "2025-08-23" },
    { decision_date: "2026-09-01", universe_asof: "2025-08-23" },
    { decision_date: "2026-08-15", universe_asof: null },
  ];
  eq(universeSnapshots(runs), ["2025-08-23"], "universeSnapshots deduplica e ignora las filas antiguas sin foto");
  eq(universeSnapshots([]), [], "universeSnapshots sin decisiones no inventa nada");
  eq(
    universeSnapshots([{ universe_asof: "2025-08-23" }, { universe_asof: "2026-01-10" }]),
    ["2026-01-10", "2025-08-23"],
    "universeSnapshots ordena de más reciente a más antigua",
  );
}

// ── §2: "sin cotización suspendida" ─────────────────────────────────────────────────────
// El caso que lo obligó: BNY Mellon cotiza hoy como `BNY`, la foto de miembros congelada
// dice `BK`, y `tickerToCik("BK")` resuelve — así que la señal de BK sale perfecta con un
// precio de 14,79 $ que es de otro instrumento.
{
  eq(MAX_PRICE_LAG_DAYS, 10, "el desfase máximo de precio son 10 días naturales");
  ok(cotizaEn("2026-08-17", "2026-08-17"), "una serie que llega al día de la decisión cotiza");
  ok(cotizaEn("2026-08-07", "2026-08-17"), "diez días de desfase todavía cotiza");
  ok(!cotizaEn("2026-08-06", "2026-08-17"), "once días ya no");
  ok(!cotizaEn(null, "2026-08-17"), "sin serie no cotiza");
  ok(!cotizaEn(undefined, "2026-08-17"), "sin serie (undefined) no cotiza");
  ok(!cotizaEn("2026-06-10", "2026-08-17"), "el caso BK: última barra de junio, decisión de agosto");
  // Point-in-time: la comparación es contra la fecha de DECISIÓN, no contra hoy. Un valor
  // que se deslistó en 2020 seguía cotizando cuando se decidió en 2019.
  ok(cotizaEn("2020-05-01", "2019-06-03"), "una serie posterior a la decisión no invalida la decisión");
}

// ── La caché de precios no puede encogerse ──────────────────────────────────────────────
// Existe porque un refresco del 2026-08-21 dejó `EA` en 6 barras y `BK` en 5 (a 14,79 $, que
// no es el precio de Bank of New York), borrando años de historia irrecuperable. Y el fallo
// era mudo: `loadPanel` exige 300 barras, así que el nombre se cae de todos los paneles sin
// que nada falle.
{
  const serie = (ini, fin, n = 100) => Array.from({ length: n }, (_, i) => ({ date: i === 0 ? ini : i === n - 1 ? fin : `2020-01-${String((i % 28) + 1).padStart(2, "0")}`, raw: 1, adj: 1 }));
  const previa = serie("2018-06-01", "2026-08-20");

  ok(cubreLaCache(serie("2018-06-01", "2026-08-21"), previa), "una descarga que llega más lejos SÍ reemplaza");
  ok(cubreLaCache(serie("2018-05-01", "2026-08-20"), previa), "una que empieza antes y llega igual SÍ reemplaza");
  ok(!cubreLaCache(serie("2026-07-17", "2026-08-10", 6), previa), "una de 6 barras recientes NO reemplaza (el caso EA)");
  ok(!cubreLaCache(serie("2018-06-01", "2023-01-05"), previa), "una que se queda corta por el final NO reemplaza (deslistado)");
  ok(!cubreLaCache([], previa), "una descarga vacía NO reemplaza");
  ok(cubreLaCache(serie("2020-01-01", "2020-06-01", 5), null), "sin caché previa, se escribe lo que haya");
  ok(cubreLaCache(serie("2020-01-01", "2020-06-01", 5), []), "una caché vacía no es historia que perder");
}


// ── ARTICULACIÓN CONTABLE (`lib/articulacion.ts`) ───────────────────────────────────────
// La partida doble usada como test de datos. Estos tests fijan sobre todo UNA distinción,
// que es la que hace útil o inútil a un control de integridad: **no comprobable ≠ erróneo**.
// Confundirlas ya produjo tres tandas de falsas alarmas seguidas —minoritarios, efecto del
// tipo de cambio y patrimonio temporal—, todas por comprobaciones mal planteadas y no por
// datos malos.
{
  const base = { assets: 1000, liabilities: 600, equity: 400 };
  const c = (r, id) => r.comprobaciones.find((x) => x.id === id);

  // A1 · balance
  eq(c(articular(base), "balance").ok, true, "balance: A = P + PN cuadra");
  eq(c(articular({ assets: 1000, liabilities: 600, equity: 300 }), "balance").ok, false, "balance: un hueco del 10 % falla");
  eq(c(articular({ assets: 1000, liabilities: 600 }), "balance").ok, null, "balance: sin patrimonio NO es un fallo, es no comprobable");
  ok(c(articular({ assets: 1000, liabilities: 600 }), "balance").motivo.length > 0, "lo no comprobable siempre dice por qué");

  // Los tres sumandos que se olvidaron una vez cada uno.
  eq(c(articular({ assets: 1000, liabilities: 600, equity: 300, minorityInterest: 100 }), "balance").ok, true,
     "balance: los minoritarios cuentan (DaVita, Vornado…)");
  eq(c(articular({ assets: 1000, liabilities: 600, equity: 300, temporaryEquity: 100 }), "balance").ok, true,
     "balance: el patrimonio temporal cuenta (S&P Global, T. Rowe…)");
  eq(c(articular({ assets: 1000, liabilities: 500, equity: 300, minorityInterest: 100, temporaryEquity: 100 }), "balance").ok, true,
     "balance: minoritarios y mezzanine SUMAN, no son alternativos");

  // A2 · caja — el efecto del tipo de cambio es el cuarto sumando, no un ajuste opcional.
  eq(c(articular({ deltaCash: 100, ocf: 200, cfi: -150, cff: 50 }), "caja").ok, true, "caja: los tres flujos cuadran");
  eq(c(articular({ deltaCashConFx: 90, ocf: 200, cfi: -150, cff: 50, fxCash: -10, assets: 200 }), "caja").ok, true,
     "caja: con divisa, el efecto del tipo de cambio cierra la identidad");
  eq(c(articular({ deltaCashSinFx: 90, ocf: 200, cfi: -150, cff: 50, assets: 200 }), "caja").ok, false,
     "caja: 10 de descuadre sobre 200 de activo (5 %) sí es un fallo");

  // A4 · margen bruto
  eq(c(articular({ revenue: 1000, cost: 600, grossProfit: 400 }), "margen").ok, true, "margen: ingresos − coste = bruto");
  eq(c(articular({ revenue: 1000, cost: 600, grossProfit: 300 }), "margen").ok, false, "margen: un 25 % de desvío falla");

  // A3 · patrimonio: es el ruidoso a propósito (OCI, pagos en acciones, conversiones).
  eq(c(articular({ equityFin: 1100, equityPrev: 1000, netIncome: 200, dividends: 100 }), "patrimonio").ok, true,
     "patrimonio: PN + resultado − dividendos");
  ok(TOLERANCIA.patrimonio > TOLERANCIA.balance, "el patrimonio tolera más que el balance: no es una identidad exacta");
  eq(TOLERANCIA.balance, 0.01, "el balance es exacto y se le exige el 1 %");

  // El balance manda sobre las demás: es la única identidad que no admite ruido.
  eq(articular(base).confianza, "alta", "todo lo comprobable cuadra → confianza alta");
  eq(articular({ ...base, revenue: 1000, cost: 600, grossProfit: 300 }).confianza, "media", "falla una → media");
  eq(articular({ assets: 1000, liabilities: 100, equity: 100 }).confianza, "baja", "si falla el BALANCE, baja aunque sea el único fallo");
  eq(articular({}).confianza, "alta", "sin nada que comprobar no se inventa un fallo");
  eq(articular({}).comprobables, 0, "sin datos, cero comprobables");

  // ── Y lo más importante: periodos desalineados = NO COMPROBABLE, nunca un fallo ────────
  // `flowTTM` elige la ventana más reciente de cada tag por separado, así que el activo puede
  // ser de junio y el pasivo de marzo. Restarlos y llamarlo descuadre hacía "fallar" el
  // margen bruto en el 36 % de los nombres, todas alarmas falsas.
  const alineado = articularFundamentales({
    assets: 1000, liabilities: 600, equity: 400, revTTM: 1000, costTTM: 600, gpTTM: 400,
    periodos: { assets: "2026-06-30", liabilities: "2026-06-30", equity: "2026-06-30",
                rev: "2026-06-30", cost: "2026-06-30", gp: "2026-06-30" },
  });
  eq(c(alineado, "balance").ok, true, "mismo cierre → el balance se comprueba");
  eq(c(alineado, "margen").ok, true, "mismo cierre → el margen se comprueba");

  const desalineado = articularFundamentales({
    assets: 1000, liabilities: 600, equity: 400, revTTM: 1000, costTTM: 600, gpTTM: 400,
    periodos: { assets: "2026-06-30", liabilities: "2026-03-31", equity: "2026-06-30",
                rev: "2026-06-30", cost: "2011-02-28", gp: "2026-06-30" },
  });
  eq(c(desalineado, "balance").ok, null, "cierres distintos → balance NO comprobable (no fallo)");
  eq(c(desalineado, "margen").ok, null, "coste de 2011 con ingresos de 2026 → margen NO comprobable");
  eq(desalineado.confianza, "alta", "lo no comprobable no degrada la confianza: no es un defecto");

  // ── La escala del desvío: la caja se mide contra el ACTIVO, no contra sí misma ─────────
  // La variación de caja en doce meses ronda cero, así que un desvío relativo sobre esa base
  // convierte el ruido en catástrofe. Medido: los peores "fallos" eran EXPD, PWR, TPR y LW,
  // todos con los dos lados por debajo de 0,01 B. Escalado sobre el activo, 88,9 % → 99,2 %.
  {
    const ruido = { deltaCashConFx: -2e6, ocf: 500e6, cfi: -400e6, cff: -102e6, fxCash: 0, assets: 50e9 };
    eq(c(articular(ruido), "caja").ok, true, "caja: 2 M de diferencia sobre 50.000 M de activo es ruido, no un fallo");
    const deVerdad = { deltaCashConFx: -0.1e9, ocf: 1e9, cfi: -3e9, cff: -2.86e9, fxCash: 0, assets: 40e9 };
    eq(c(articular(deVerdad), "caja").ok, false, "caja: 4,76 B sobre 40 B de activo SÍ es un descuadre (el caso JCI)");
  }

  // Las dos convenciones de variación de caja no son intercambiables.
  {
    // El activo hace de escala: se elige pequeño a propósito para que 10 de descuadre sea
    // un 5 % y por tanto detectable. Con un activo grande, 10 es ruido — y ESE es el punto.
    const flujos = { ocf: 200, cfi: -150, cff: 50, fxCash: -10, assets: 200 };
    eq(c(articular({ ...flujos, deltaCashConFx: 90 }), "caja").ok, true,
       "caja: la variación que INCLUYE el tipo de cambio se compara con los flujos + ese efecto");
    eq(c(articular({ ...flujos, deltaCashSinFx: 100 }), "caja").ok, true,
       "caja: la que lo EXCLUYE se compara con los flujos a secas");
    eq(c(articular({ ...flujos, deltaCashConFx: 100 }), "caja").ok, false,
       "caja: aplicar el efecto dos veces se detecta");
  }

  // Sin mapa de periodos no se puede afirmar alineación, así que no se comprueba nada.
  eq(c(articularFundamentales({ assets: 1000, liabilities: 600, equity: 400 }), "balance").ok, null,
     "sin mapa de periodos no se da por buena la alineación");
}

console.log(pass && !fail ? `\n✓ picks: ${pass} passed, 0 failed\n` : `\n✖ picks: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
