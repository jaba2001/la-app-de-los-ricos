// Tests del motor de reglas de Scora Picks (`lib/picks.ts`).
//
// Fija el COMPORTAMIENTO de §3-§5 de SCORA_PICKS_REGLAS.md, no la implementación. Si alguien
// cambia una regla sin abrir una `rules_version` nueva, estos tests tienen que gritar: el
// track record publicado de una versión no puede mezclarse con el de otra.
//
//   node --experimental-strip-types --no-warnings scripts/picks.test.mjs
import {
  decide, emptyState, addMonths, daysBetween,
  PICKS_RULES_VERSION, ENTRY_PCTL, EXIT_PCTL, TARGET_POSITIONS, BUYS_PER_DATE,
  PERSISTENCE_DAYS, QUARANTINE_MONTHS, EXIT_CONSECUTIVE,
} from "../lib/picks.ts";

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

console.log(pass && !fail ? `\n✓ picks: ${pass} passed, 0 failed\n` : `\n✖ picks: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
