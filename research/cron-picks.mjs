// ─────────────────────────────────────────────────────────────────────────────
// SCORA PICKS — el cron quincenal que aplica las reglas (SCORA_PICKS_REGLAS.md v2)
//
// Corre el día 1 y el día 15 de cada mes (o el hábil siguiente). Calcula la señal, aplica
// §3-§5 y escribe la decisión. NO decide nada por su cuenta: la lógica está en
// `lib/picks.ts` y la señal en `research/picksSignal.mjs`, las mismas piezas que ejecuta el
// backtest. Este fichero sólo hace de fontanería entre la base de datos y el motor.
//
// ═══ SIN ESTADO OCULTO ═══
// Todo el estado del motor se DERIVA de lo que hay en la base:
//   · cartera            ← sl_picks_position con closed_on nulo
//   · cuarentenas        ← posiciones cerradas, closed_on + 12 meses
//   · contador de salida ← los paneles de señal guardados en sl_picks_run
//   · persistencia       ← esos mismos paneles, los de los últimos 60 días
// No hay ningún contador en memoria ni columna auxiliar que pueda desincronizarse. Si la
// base dice una cosa, el motor decide eso; no hay una segunda fuente de verdad.
//
// ═══ ESCRIBE SIEMPRE ═══
// Aunque no compre nada. §4 dice que un hueco vacío es un resultado legítimo y §7 que se
// publica cada decisión: sin la fila, un día sin compras sería indistinguible de un cron
// que no llegó a correr. Esa ambigüedad es justo por donde se cuela un track record
// maquillado.
//
//   node --experimental-strip-types --no-warnings research/cron-picks.mjs [--dry] [--date YYYY-MM-DD] [--force]
//
// Env: SUPABASE_URL (opcional), SUPABASE_SERVICE_KEY (obligatoria para escribir)
// ─────────────────────────────────────────────────────────────────────────────
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { señalAt } from "./picksSignal.mjs";
import { rawPriceAsOf } from "./prices.mjs";
import { loadPanel } from "./momentumSignals.mjs";
import {
  decide, emptyState, addMonths, daysBetween,
  PICKS_RULES_VERSION, ENTRY_PCTL, EXIT_PCTL, EXIT_CONSECUTIVE,
  TARGET_POSITIONS, BUYS_PER_DATE, PERSISTENCE_DAYS, QUARANTINE_MONTHS,
} from "../lib/picks.ts";

// ⚠️ ANTES DE NADA: la caché de precios de `prices.mjs` NO CADUCA — está pensada para
// backtests reproducibles. Un proceso en vivo que la leyera se quedaría clavado en la última
// fecha descargada, decidiría "hoy no toca" para siempre y NO FALLARÍA. Este cron descarga
// de nuevo. `--no-refresh` existe sólo para iterar en desarrollo.
if (!process.argv.includes("--no-refresh")) process.env.PX_REFRESH = "1";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");
const HOY = arg("--date", new Date().toISOString().slice(0, 10));
const SB_URL = process.env.SUPABASE_URL || "https://acxaosesbsprrusdvgop.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = async (path, init = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`supabase ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};

console.log(`\n  SCORA PICKS · cron · ${HOY} · reglas v${PICKS_RULES_VERSION}${DRY ? "  (DRY RUN)" : ""}`);

// ── 1 · ¿Toca hoy? ──────────────────────────────────────────────────────────────────────
// El calendario hábil sale de las fechas reales de cotización del SPY: si el mercado estuvo
// cerrado, no se pudo comprar. Un calendario teórico de "días laborables" se equivocaría en
// Acción de Gracias y en cada festivo.
const spy = await loadPanel("SPY", undefined);
if (!spy) { console.error("  ✖ sin calendario de mercado (panel de SPY)"); process.exit(1); }
// Un cron verde puede estar muerto. Si el calendario no llega a hoy, los datos están
// rancios y CUALQUIER conclusión sería falsa — incluida "hoy no es fecha de decisión", que
// es la que se tomaría en silencio. Se falla en alto, que es lo que hay que hacer.
{
  const ultimo = spy.dates.at(-1);
  const retraso = daysBetween(ultimo, HOY);
  if (retraso > 5) {
    console.error(`  ✖ el calendario de mercado termina el ${ultimo}, ${retraso} días antes de ${HOY}.`);
    console.error(`    Los precios están rancios. Se aborta en vez de decidir con datos viejos.`);
    process.exit(1);
  }
}
const siguienteHabil = (f) => spy.dates.find((d) => d >= f) ?? null;
const objetivos = ["01", "15"].map((d) => siguienteHabil(`${HOY.slice(0, 8)}${d}`));

if (!objetivos.includes(HOY)) {
  console.log(`  hoy no es fecha de decisión (las de este mes: ${objetivos.filter(Boolean).join(", ")})`);
  if (!FORCE) { console.log(`  → nada que hacer. Usa --force para saltarte el calendario.\n`); process.exit(0); }
  console.log(`  ⚠ --force: se ejecuta igualmente. Esto rompe la disciplina de fecha fija (§4) — sólo para pruebas.`);
}

// ── 2 · Reconstruir el estado desde la base ─────────────────────────────────────────────
let abiertas = [], cerradas = [], runs = [];
if (KEY) {
  const v = `rules_version=eq.${PICKS_RULES_VERSION}`;
  abiertas = await sb(`sl_picks_position?${v}&closed_on=is.null&select=ticker,opened_on,open_pctl&order=opened_on.asc`);
  cerradas = await sb(`sl_picks_position?${v}&closed_on=not.is.null&select=ticker,closed_on&order=closed_on.desc&limit=500`);
  // Sólo hacen falta los paneles recientes: los de la ventana de persistencia y los que
  // alimentan el contador de salida. Se piden de sobra y se filtran abajo.
  runs = await sb(`sl_picks_run?${v}&decision_date=lt.${HOY}&select=decision_date,signal&order=decision_date.desc&limit=12`);
} else {
  console.log(`  ⚠ SUPABASE_SERVICE_KEY no definida — se asume cartera vacía (sólo tiene sentido con --dry).`);
}

const previos = [...runs].reverse();   // cronológico

// Cuarentena: 12 meses desde el cierre. Si un ticker se vendió varias veces, manda el
// cierre MÁS RECIENTE, que es el que impone la espera más larga.
const quarantineUntil = {};
for (const c of cerradas) {
  const hasta = addMonths(c.closed_on, QUARANTINE_MONTHS);
  if (hasta > HOY && (!quarantineUntil[c.ticker] || hasta > quarantineUntil[c.ticker])) quarantineUntil[c.ticker] = hasta;
}

// Contador de salida: evaluaciones consecutivas por debajo del umbral, contadas hacia atrás
// desde la última decisión. Derivado de los paneles guardados, no almacenado.
const belowExitCount = {};
for (const p of abiertas) {
  let n = 0;
  for (let i = previos.length - 1; i >= 0; i--) {
    const s = previos[i].signal?.[p.ticker];
    if (s != null && s < EXIT_PCTL) n++; else break;
    if (n >= EXIT_CONSECUTIVE) break;
  }
  if (n > 0) belowExitCount[p.ticker] = n;
}

const state = {
  holdings: abiertas.map((p) => ({ ticker: p.ticker, since: p.opened_on })),
  quarantineUntil, belowExitCount,
};
console.log(`  estado: ${state.holdings.length} posiciones abiertas · ${Object.keys(quarantineUntil).length} en cuarentena · ${previos.length} decisiones previas cargadas`);

// ── 3 · La señal de hoy ─────────────────────────────────────────────────────────────────
const table = await loadSP500Historical();
// ⚠️ Nunca truncar: `membersAsOf` devuelve los tickers en orden alfabético.
const miembros = table ? [...new Set(membersAsOf(table, HOY) || [])] : CURATED;
process.stdout.write(`  calculando señal sobre ${miembros.length} miembros del índice…\r`);
const signal = await señalAt(miembros, HOY);
const universeSize = Object.keys(signal).length;
console.log(`  señal: ${universeSize} nombres con datos suficientes (de ${miembros.length} miembros)          `);
if (universeSize < 50) { console.error(`  ✖ cobertura insuficiente (${universeSize} nombres). No se decide a ciegas.`); process.exit(1); }

// ── 4 · Decidir ─────────────────────────────────────────────────────────────────────────
const history = previos
  .filter((r) => daysBetween(r.decision_date, HOY) <= PERSISTENCE_DAYS)
  .map((r) => ({ date: r.decision_date, signal: r.signal ?? {} }));

const d = decide({ date: HOY, signal, history, state });

console.log(`\n  ── DECISIÓN ──`);
console.log(`  Ventas   ${d.sells.length ? "" : "— ninguna"}`);
for (const s of d.sells) console.log(`     ${s.ticker.padEnd(6)} desde ${s.since}   motivo: ${s.reason}`);
console.log(`  Compras  ${d.buys.length ? "" : "— ninguna (hueco vacío: es un resultado legítimo, §4)"}`);
for (const b of d.buys) console.log(`     ${b.ticker.padEnd(6)} percentil ${(b.pctl * 100).toFixed(1)}`);
console.log(`  Elegibles que no cupieron: ${d.eligibleNotBought.length}`);
if (d.eligibleNotBought.length) {
  console.log(`     ${d.eligibleNotBought.slice(0, 8).map((e) => `${e.ticker} ${(e.pctl * 100).toFixed(0)}`).join(" · ")}${d.eligibleNotBought.length > 8 ? " …" : ""}`);
}
console.log(`  Cartera resultante: ${d.nextState.holdings.length}/${TARGET_POSITIONS}`);

if (history.length < 3 && d.buys.length === 0) {
  console.log(`\n  ℹ Sin 3 decisiones previas dentro de ${PERSISTENCE_DAYS} días no se puede comprobar la persistencia, así que el motor NO compra.`);
  console.log(`    Es lo correcto al arrancar: las primeras ~6 semanas la cartera se queda vacía a propósito.`);
}

// ── 5 · Precios de ejecución ────────────────────────────────────────────────────────────
// El precio CRUDO, no el ajustado: es el que se habría pagado. El ajustado cambia hacia
// atrás cada vez que hay un dividendo o un split, y un registro de operación no puede
// cambiar después.
const precio = {};
for (const t of [...d.buys.map((b) => b.ticker), ...d.sells.map((s) => s.ticker)]) {
  try { precio[t] = await rawPriceAsOf(t, HOY); } catch { precio[t] = null; }
}
const sinPrecio = Object.entries(precio).filter(([, p]) => p == null).map(([t]) => t);
if (sinPrecio.length) console.log(`\n  ⚠ sin precio para: ${sinPrecio.join(", ")} — se registran con precio nulo, no se omiten.`);

// ── 6 · Escribir ────────────────────────────────────────────────────────────────────────
const runRow = {
  decision_date: HOY, rules_version: PICKS_RULES_VERSION,
  universe_size: universeSize, eligible_count: d.buys.length + d.eligibleNotBought.length,
  bought_count: d.buys.length, sold_count: d.sells.length,
  positions_after: d.nextState.holdings.length,
  not_bought: d.eligibleNotBought.map((e) => ({ ticker: e.ticker, pctl: e.pctl })),
  signal,
};

if (DRY || !KEY) {
  console.log(`\n  ${DRY ? "DRY RUN" : "SIN SUPABASE_SERVICE_KEY"} — no se escribe nada.`);
  console.log(`  La fila de sl_picks_run que se habría escrito: universo ${runRow.universe_size} · elegibles ${runRow.eligible_count} · compras ${runRow.bought_count} · ventas ${runRow.sold_count} · cartera ${runRow.positions_after}\n`);
  process.exit(0);
}

// Las ventas primero: si el proceso muere entre medias, es preferible una posición cerrada
// sin su compra correspondiente que dos posiciones abiertas del mismo ticker (que el índice
// único parcial rechazaría, dejando el cron atascado en cada ejecución).
for (const s of d.sells) {
  await sb(`sl_picks_position?rules_version=eq.${PICKS_RULES_VERSION}&ticker=eq.${encodeURIComponent(s.ticker)}&closed_on=is.null`, {
    method: "PATCH",
    body: JSON.stringify({ closed_on: HOY, close_price: precio[s.ticker], close_reason: s.reason }),
  });
}
if (d.buys.length) {
  await sb(`sl_picks_position`, {
    method: "POST",
    body: JSON.stringify(d.buys.map((b) => ({
      ticker: b.ticker, rules_version: PICKS_RULES_VERSION,
      opened_on: HOY, open_pctl: b.pctl, open_price: precio[b.ticker],
    }))),
  });
}
// La fila de la decisión, al final: es la que certifica que el ciclo se completó.
await sb(`sl_picks_run?on_conflict=decision_date,rules_version`, {
  method: "POST",
  headers: { Prefer: "resolution=merge-duplicates" },
  body: JSON.stringify([runRow]),
});

console.log(`\n  ✓ escrito: ${d.sells.length} ventas · ${d.buys.length} compras · cartera ${d.nextState.holdings.length}/${TARGET_POSITIONS}\n`);
