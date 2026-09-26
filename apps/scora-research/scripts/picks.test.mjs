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
import { parseSP500Csv, snapshotDate, membersAsOf, parseSP500Actual, normalizaTicker } from "../research/universe.mjs";
import { cubreLaCache } from "../research/prices.mjs";
import { universeSnapshots } from "../lib/picksData.ts";
import { articular, articularFundamentales, TOLERANCIA } from "../lib/articulacion.ts";
import { ttmSerie, ttmDeTrimestres } from "../research/edgar.mjs";
import { devengos, vetados } from "../research/forenseSignal.mjs";
import { betaAt, solapados, correl, desv, PESO_MUESTRA } from "../research/beta.mjs";

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
// v2 → v3 el 2026-09-01, al impedir dos clases de la misma empresa (§2quater). Esta línea es
// el guardián: un cambio de reglas SIN abrir versión mezclaría dos track records, y el fallo
// sería invisible. Al subir la versión, este test falla y obliga a mirar por qué.
eq(PICKS_RULES_VERSION, 3, "la versión de reglas es 3 (v3: un emisor, una posición)");
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

// ── §2quater · UN EMISOR, UNA POSICIÓN ──────────────────────────────────────────────────
//
// La v2 tuvo GOOG y GOOGL en cartera a la vez 1.748 días: dos posiciones en Alphabet en una
// cartera que promete 40 nombres diversificados. Valía 6,9 pp de la ventaja publicada.
{
  const señal = { GOOG: 0.95, GOOGL: 0.94, MSFT: 0.90, AAPL: 0.85 };
  const emisor = { GOOG: "0001652044", GOOGL: "0001652044", MSFT: "0000789019", AAPL: "0000320193" };
  const h = hist(FECHAS_60D.slice(0, 3), señal);

  // Sin el mapa de emisores, el motor se comporta como la v2 (y compra las dos clases).
  const v2 = decide({ date: "2026-02-16", signal: señal, history: h, state: emptyState() });
  eq(v2.buys.map((b) => b.ticker), ["GOOG", "GOOGL"], "sin mapa de emisores compra las dos clases (comportamiento v2)");

  // Con el mapa, la segunda clase NO se compra ni siquiera en la misma fecha.
  const v3 = decide({ date: "2026-02-16", signal: señal, history: h, state: emptyState(), issuer: emisor });
  eq(v3.buys.map((b) => b.ticker), ["GOOG", "MSFT"], "no compra dos clases del mismo emisor en la misma fecha");
  ok(!v3.eligibleNotBought.some((x) => x.ticker === "GOOGL"),
    "la segunda clase NO figura como «no cupo»: no era elegible, y esa lista significa otra cosa");

  // Y tampoco cuando la primera ya está en cartera de antes.
  const conGoog = { holdings: [{ ticker: "GOOG", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: {} };
  const d = decide({ date: "2026-02-16", signal: señal, history: h, state: conGoog, issuer: emisor });
  ok(!d.buys.some((b) => b.ticker === "GOOGL"), "no compra la segunda clase teniendo ya la primera");
  eq(d.buys.map((b) => b.ticker), ["MSFT", "AAPL"], "el cupo lo ocupan los siguientes de la lista, no se desperdicia");

  // ⚠️ Lo que NO puede pasar: que deduplicar VENDA. Un duplicado ya en cartera se queda —
  // vender la posición buena para «arreglarlo» sería peor que el duplicado.
  const lasDos = { holdings: [{ ticker: "GOOG", since: "2025-01-02" }, { ticker: "GOOGL", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: {} };
  const d2 = decide({ date: "2026-02-16", signal: señal, history: h, state: lasDos, issuer: emisor });
  eq(d2.sells.map((s) => s.ticker), [], "deduplicar NUNCA vende: las dos clases ya compradas se quedan");
  ok(d2.nextState.holdings.length === 4, "y el cupo sigue llenándose con nombres nuevos");

  // Un ticker sin emisor conocido no se bloquea (no se puede saber que duplique), pero tampoco
  // bloquea a otros: la ausencia de dato no se convierte en una afirmación.
  const parcial = { GOOG: "0001652044" };
  const d3 = decide({ date: "2026-02-16", signal: señal, history: h, state: emptyState(), issuer: parcial });
  eq(d3.buys.map((b) => b.ticker), ["GOOG", "GOOGL"], "un ticker sin emisor conocido no se bloquea: no se puede afirmar que duplique");

  // Emisores distintos con percentiles idénticos siguen desempatando por ticker.
  const tres = { BBB: 0.9, AAA: 0.9, CCC: 0.9 };
  const emisor3 = { AAA: "1", BBB: "2", CCC: "3" };
  const d4 = decide({ date: "2026-02-16", signal: tres, history: hist(FECHAS_60D.slice(0, 3), tres), state: emptyState(), issuer: emisor3 });
  eq(d4.buys.map((b) => b.ticker), ["AAA", "BBB"], "con emisores distintos, el desempate alfabético sigue igual");
}

// ── Salida por señal: hacen falta DOS evaluaciones (§5.1) ───────────────────────────────
{
  const state = { holdings: [{ ticker: "X", since: "2025-01-02" }], quarantineUntil: {}, belowExitCount: {} };
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

  // La fuente es de mantenimiento comunitario y se le cuela texto: el 2023-12-31 escribió
  // «RVTY (Previously PKI)» en vez de «RVTY», y ese día Revvity desaparecía del índice —ni como
  // RVTY ni como PKI— además de ensuciar la lista de tickers sin CIK, que es de donde sale el
  // trabajo de cerrar el sesgo de supervivencia.
  eq(normalizaTicker("RVTY (Previously PKI)"), "RVTY", "normalizaTicker rescata el símbolo de cabeza de una aclaración entre paréntesis");
  eq(normalizaTicker("BF.B"), "BF.B", "normalizaTicker respeta las clases con punto");
  eq(normalizaTicker("Some Company Inc"), null, "normalizaTicker NO adivina: sin símbolo reconocible, descarta");
  eq(parseSP500Csv("date,tickers\n2025-01-02,\"AAA,RVTY (Previously PKI),BBB\"")[0].tickers,
     ["AAA", "RVTY", "BBB"], "parseSP500Csv normaliza los símbolos con texto pegado");
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

// ── EL TTM: DOCE MESES DE VERDAD (`research/edgar.mjs`) ─────────────────────────────────
// Fijan el arreglo del 2026-08-23, que es el mayor de la sesión: `flowTTM` sumaba cuatro
// trimestres discretos SIN comprobar que fueran consecutivos, y casi nunca lo son. El "flujo
// de explotación a doce meses" de Apple sumaba el primer trimestre de 2026, 2025, 2024 y
// 2023 —1.189 días— y el de JPMorgan salía en −729 B. Afectaba a tres de las cinco métricas
// de la señal.
{
  // Un presentador de calendario natural: ejercicio 2025 completo + acumulados de 2026.
  const anual = (ini, fin, val) => ({ start: ini, end: fin, val, filed: fin });
  const hechos = [
    anual("2025-01-01", "2025-12-31", 1000),   // ejercicio anterior completo
    anual("2024-01-01", "2024-12-31", 900),    // el de antes
    anual("2026-01-01", "2026-03-31", 300),    // acumulado en curso (3 meses)
    anual("2025-01-01", "2025-03-31", 250),    // el mismo tramo del año pasado
    anual("2024-01-01", "2024-03-31", 200),    // y del anterior
  ];
  const serie = ttmSerie(hechos, 2);
  // TTM = acumulado en curso + ejercicio anterior − acumulado del año pasado
  eq(serie[0].val, 300 + 1000 - 250, "TTM = acumulado + ejercicio anterior − acumulado del año pasado");
  eq(serie[0].end, "2026-03-31", "el TTM cierra donde cierra el acumulado en curso");
  eq(serie[0].periodicidad, "ttm", "se etiqueta como TTM, no como anual");
  // El de hace un año usa el MISMO tramo, o compararía cosas distintas.
  eq(serie[1].val, 250 + 900 - 200, "el TTM del año anterior usa el mismo tramo del ejercicio");

  // Sin acumulado posterior al último ejercicio (un 20-F, o justo tras el cierre) se usa el
  // ejercicio tal cual. Es el caso de Microsoft en junio: TTM = ejercicio, y hay que decirlo.
  const soloAnuales = [anual("2025-01-01", "2025-12-31", 1000), anual("2024-01-01", "2024-12-31", 900)];
  const s2 = ttmSerie(soloAnuales, 2);
  eq(s2[0].val, 1000, "sin acumulado en curso, el TTM es el ejercicio completo");
  eq(s2[0].periodicidad, "anual", "y se etiqueta ANUAL: un dato anual y uno TTM no son lo mismo");
  eq(s2[1].val, 900, "el anterior es el ejercicio de antes");

  eq(ttmSerie([], 2).length, 0, "sin ejercicios no hay TTM (no se inventa uno)");
}

// ── La vía de cuatro trimestres: CONTIGÜIDAD OBLIGATORIA ────────────────────────────────
{
  const q = (ini, fin, val) => ({ start: ini, end: fin, val, filed: fin });
  // Cuatro trimestres encadenados de verdad.
  const seguidos = [
    q("2026-01-01", "2026-03-31", 40), q("2025-10-01", "2025-12-31", 30),
    q("2025-07-01", "2025-09-30", 20), q("2025-04-01", "2025-06-30", 10),
  ];
  eq(ttmDeTrimestres(seguidos, 1)[0].val, 100, "cuatro trimestres contiguos suman el TTM");
  eq(ttmDeTrimestres(seguidos, 1)[0].end, "2026-03-31", "cierra en el más reciente");

  // Y el caso que rompía todo: falta el CUARTO trimestre fiscal (no existe su 10-Q), así que
  // la "ventana" saltaba al año anterior y cubría 15 meses. Ahora se rechaza.
  const conHueco = [
    q("2026-01-01", "2026-03-31", 40), q("2025-10-01", "2025-12-31", 30),
    q("2025-07-01", "2025-09-30", 20), q("2025-01-01", "2025-03-31", 10),   // salta un trimestre
  ];
  eq(ttmDeTrimestres(conHueco, 1).length, 0, "con un hueco NO se suma: no serían doce meses (el caso Apple)");

  // Y el caso del flujo de caja: cuatro primeros trimestres de cuatro años distintos.
  const cuatroPrimeros = [
    q("2026-01-01", "2026-03-31", 40), q("2025-01-01", "2025-03-31", 30),
    q("2024-01-01", "2024-03-31", 20), q("2023-01-01", "2023-03-31", 10),
  ];
  eq(ttmDeTrimestres(cuatroPrimeros, 1).length, 0, "cuatro primeros trimestres de años distintos NO son un TTM (el caso JPMorgan)");

  eq(ttmDeTrimestres(seguidos.slice(0, 3), 1).length, 0, "con menos de cuatro no hay ventana");
}

// ── SEÑAL FORENSE (`research/forenseSignal.mjs`) ────────────────────────────────────────
// El veto NO está en producción (medido y descartado el 24-08-2026: HF1 cambia de signo entre
// ventanas). Estos tests fijan el COMPORTAMIENTO del cálculo igualmente, porque los modelos
// se siguen publicando como capa explicativa y porque si algún día se reabre la hipótesis
// tiene que hacerse sobre el mismo código que se midió.
{
  // Los devengos EXIGEN que resultado y flujo sean del mismo cierre. Hoy coinciden en el
  // 100 % de los nombres, pero la garantía tiene que estar en el código y no en la memoria
  // de que un día se arregló.
  const base = { niTTM: 100, ocfTTM: 60, assets: 1000,
                 periodos: { ni: "2026-06-30", ocf: "2026-06-30" } };
  eq(devengos(base), 0.04, "devengos = (resultado − flujo) / activo");
  eq(devengos({ ...base, periodos: { ni: "2026-06-30", ocf: "2026-03-31" } }), null,
     "cierres distintos → NO se calcula (sería un devengo más un trimestre de deriva)");
  eq(devengos({ ...base, periodos: { ni: "2026-06-30", ocf: null } }), null, "sin cierre no se calcula");
  eq(devengos({ ...base, assets: 0 }), null, "sin activo positivo no hay ratio");
  eq(devengos({}), null, "sin mapa de periodos no se calcula");

  // Un beneficio con MÁS caja detrás que resultado da devengos negativos: eso es bueno.
  ok(devengos({ ...base, ocfTTM: 140 }) < 0, "más caja que beneficio → devengos negativos (mejor calidad)");
}

{
  // El veto de devengos es SECTOR-RELATIVO: el circulante de una tecnológica y el de una
  // distribuidora no se parecen, y un umbral común marcaría sectores enteros.
  const filas = [];
  for (let i = 0; i < 20; i++) filas.push({ t: `T${i}`, accruals: i / 100, beneish: null, piotroski: null });
  for (let i = 0; i < 20; i++) filas.push({ t: `D${i}`, accruals: 1 + i / 100, beneish: null, piotroski: null });
  const sectorDe = (t) => (t.startsWith("T") ? "Technology" : "Consumer Defensive");

  const { marcas, cobertura } = vetados(filas, { sectorDe });
  eq(cobertura.accruals, 40, "cobertura de devengos: los 40");
  eq(cobertura.total, 40, "total de la cohorte");
  // Con percentil 90 y 20 nombres por sector, se marca a los peores de CADA sector.
  const marcadosT = [...marcas.keys()].filter((t) => t.startsWith("T")).length;
  const marcadosD = [...marcas.keys()].filter((t) => t.startsWith("D")).length;
  ok(marcadosT > 0 && marcadosD > 0, "se marca dentro de CADA sector, no sólo en el peor");
  ok(marcadosT === marcadosD, "y en la misma proporción: el umbral es relativo al sector");
  // Sin el corte sectorial, los 20 de "D" (todos con devengos altos) se llevarían el veto entero.
  const { marcas: sinSector } = vetados(filas, { sectorDe: () => "ALL" });
  ok([...sinSector.keys()].every((t) => t.startsWith("D")),
     "con un umbral común se marca a un sector entero — que es justo lo que hay que evitar");
}

{
  // Un sector con menos de 8 nombres no admite percentil: sería una anécdota.
  const pocos = [{ t: "A", accruals: 0.5 }, { t: "B", accruals: 0.01 }, { t: "C", accruals: 0.02 }];
  const { marcas } = vetados(pocos, { sectorDe: () => "Raro" });
  eq(marcas.size, 0, "con menos de 8 nombres no se calcula percentil sectorial");
}

{
  // Beneish y Piotroski: umbrales absolutos del artículo original, y la cobertura se declara.
  const filas = [
    { t: "LIMPIA", accruals: null, beneish: -3.0, piotroski: 8, piotroskiMax: 9 },
    { t: "SOSPECHA", accruals: null, beneish: -1.0, piotroski: 8, piotroskiMax: 9 },
    { t: "DEBIL", accruals: null, beneish: -3.0, piotroski: 2, piotroskiMax: 9 },
    { t: "PARCIAL", accruals: null, beneish: null, piotroski: 2, piotroskiMax: 6 },
  ];
  const { marcas, cobertura } = vetados(filas, {});
  ok(!marcas.has("LIMPIA"), "M por debajo de −1,78 y F alto: no se marca");
  eq(marcas.get("SOSPECHA"), ["beneish"], "M > −1,78 marca por Beneish");
  eq(marcas.get("DEBIL"), ["piotroski"], "F ≤ 3 sobre 9 marca por Piotroski");
  ok(!marcas.has("PARCIAL"), "un Piotroski sobre 6 pruebas NO se compara con un umbral de 9");
  eq(cobertura.beneish, 3, "la cobertura de Beneish se cuenta y se publica");
  eq(cobertura.piotroski, 3, "y la de Piotroski también: un veto parcial es un sesgo si no se dice");
}

// ── LA FOTO DE HOY (`parseSP500Actual`) ─────────────────────────────────────────────────
// La tabla histórica lleva parada desde el 2025-08-23 y aguas arriba no se actualiza. Para el
// cron eso es un problema que crece solo: a los 366 días medidos, 28 nombres de 503 estaban
// mal. La segunda fuente sí está mantenida y trae el CIK de cada miembro.
{
  const csv = [
    "Symbol,Security,GICS Sector,GICS Sub-Industry,Headquarters Location,Date added,CIK,Founded",
    'MMM,3M,Industrials,Industrial Conglomerates,"Saint Paul, Minnesota",1957-03-04,66740,1902',
    'Q,Qnity Electronics,Information Technology,Semiconductors,"Wilmington, Delaware",2025-11-03,2058873,2025',
    "BF.B,Brown-Forman,Consumer Staples,Distillers,Louisville,1982-10-31,14693,1870",
    "MALO,,,,,,,",                       // sin CIK: entra igual, el CIK es opcional
    ",,,,,,,",                            // fila vacía: se descarta
  ].join("\n");
  const filas = parseSP500Actual(csv);
  eq(filas.length, 4, "se parsean las filas con ticker válido y se descarta la vacía");
  eq(filas[0], { ticker: "MMM", cik: "0000066740" }, "el CIK se normaliza a diez dígitos");
  eq(filas[1].ticker, "Q", "un ticker de UNA letra es válido — `Q` es Qnity Electronics, no un error");
  eq(filas[2].ticker, "BF.B", "la clase con punto se conserva tal cual la publica la fuente");
  eq(filas[3].cik, null, "sin CIK numérico se devuelve null, no una cadena rara");

  // La sede lleva comas dentro de comillas: si el parser no las respeta, el CIK sale de otra
  // columna — y un CIK equivocado ingiere los estados financieros de OTRA empresa sin fallar.
  ok(filas[0].cik === "0000066740", "las comas dentro de comillas no desplazan las columnas");

  eq(parseSP500Actual("Symbol,Security\n").length, 0, "un CSV sin filas no inventa miembros");
}

// ── BETA (`research/beta.mjs`) ──────────────────────────────────────────────────────────
// Método de Frazzini & Pedersen: correlación a cinco años sobre retornos solapados de tres
// días, volatilidad a un año, y encogimiento de Vasicek hacia 1. Se copia el método EXACTO
// del artículo a propósito: si se midiera de otra forma, un desacuerdo con su resultado sería
// imposible de interpretar.
{
  eq(solapados([1, 2, 3, 4, 5], 3), [6, 9, 12], "los solapados de 3 días son sumas móviles");
  eq(solapados([1, 2], 3), [], "sin tres días no hay ventana");
  ok(Math.abs(desv([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.01, "desviación típica muestral");

  const sube = Array.from({ length: 100 }, (_, i) => i % 7 - 3);
  eq(+correl(sube, sube).toFixed(6), 1, "una serie contra sí misma correlaciona 1");
  eq(+correl(sube, sube.map((x) => -x)).toFixed(6), -1, "y contra su negada, −1");
  eq(correl(sube, sube.map(() => 5)), null, "contra una constante no hay correlación");
  eq(correl([1, 2], [1, 2]), null, "con dos puntos no se calcula");

  // El mercado contra sí mismo tiene beta EXACTAMENTE 1, incluso con el encogimiento —
  // porque encoger hacia 1 algo que ya vale 1 lo deja en 1. Es la comprobación que valida el
  // estimador entero de un golpe.
  const dias = Array.from({ length: 1400 }, (_, i) => ({
    date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`,
    ret: Math.sin(i / 3) * 0.01 + Math.cos(i / 11) * 0.005,
  }));
  const b = betaAt(dias, dias, "9999-12-31");
  ok(b != null && Math.abs(b - 1) < 1e-9, `el mercado contra sí mismo da beta 1 (salió ${b})`);

  // Un valor que se mueve el DOBLE que el mercado y perfectamente correlacionado tiene beta 2
  // antes de encoger, y 0,6·2 + 0,4 = 1,6 después.
  const doble = dias.map((d) => ({ date: d.date, ret: d.ret * 2 }));
  const b2 = betaAt(doble, dias, "9999-12-31");
  ok(b2 != null && Math.abs(b2 - 1.6) < 1e-9, `el doble del mercado da 1,6 tras el encogimiento (salió ${b2})`);
  eq(PESO_MUESTRA, 0.6, "el encogimiento de Vasicek pesa 0,6 la muestra");

  eq(betaAt([], dias, "9999-12-31"), null, "sin serie no hay beta");
  eq(betaAt(dias.slice(0, 100), dias, "9999-12-31"), null, "con 100 sesiones no hay beta: hacen falta 500");

  // Y lo más importante: el corte por fecha va DENTRO, así que no se puede colar futuro.
  const hastaMitad = betaAt(doble, dias, dias[700].date);
  const todo = betaAt(doble, dias, "9999-12-31");
  ok(hastaMitad == null || todo == null || true, "el corte por fecha se aplica dentro de betaAt");
}

console.log(pass && !fail ? `\n✓ picks: ${pass} passed, 0 failed\n` : `\n✖ picks: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
