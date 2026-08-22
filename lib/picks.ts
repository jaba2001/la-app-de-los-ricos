// ─────────────────────────────────────────────────────────────────────────────
// SCORA PICKS — EL MOTOR DE REGLAS, v2
//
// Este fichero es la ÚNICA implementación de las reglas de `SCORA_PICKS_REGLAS.md`. Lo
// importan el backtest (`research/picks_rules_backtest.mjs`) y el cron de producción. Si
// hubiera dos copias, el track record publicado dejaría de ser el de lo que se midió — y
// ese fallo ya pasó en este repo con los pesos del ensemble, que derivaron meses en tres
// sitios a la vez sin que nadie lo viera.
//
// Es PURO a propósito: sin red, sin base de datos, sin reloj. Recibe el estado y la señal,
// devuelve qué comprar y qué vender. Así el golden test puede ejecutarlo headless y el
// backtest puede correrlo 200 veces por segundo.
//
// ⚠️ NADA AQUÍ ES EVIDENCIA FUERA DE MUESTRA. La v2 se diseñó mirando los datos (§0 del
// documento de reglas). Estos parámetros son una hipótesis a validar en vivo, no un
// resultado validado.
// ─────────────────────────────────────────────────────────────────────────────

/** Versión de las reglas. Un cambio aquí ABRE UNA SERIE NUEVA: los track records de dos
 *  versiones no se mezclan jamás, igual que `score_version` en `sl_cohort`. */
export const PICKS_RULES_VERSION = 2;

/** Percentil de calidad para poder ENTRAR. Medido: entre p70 y p85 la calidad de los picks
 *  es plana; lo que cambia es cuánto capital llega a invertirse (94% a p70, 47% a p80). */
export const ENTRY_PCTL = 0.70;

/** Por debajo de esto empieza la cuenta para salir. Casi decorativo: provocó 2-4 ventas en
 *  siete y ocho años. Se mantiene porque el caso que cubre (un negocio que se deteriora de
 *  verdad) es real aunque sea raro. */
export const EXIT_PCTL = 0.50;

/** Evaluaciones consecutivas por debajo de EXIT_PCTL antes de vender. */
export const EXIT_CONSECUTIVE = 2;

/** Tope de posiciones. Elegido FUERA del óptimo de las dos ventanas a propósito. */
export const TARGET_POSITIONS = 40;

/** Compras por fecha de decisión. ⚠️ Hay DOS fechas al mes, así que el ritmo mensual es el
 *  DOBLE: 2 aquí = 4 al mes. Esta unidad ya se confundió una vez y produjo un backtest que
 *  no era el del documento. */
export const BUYS_PER_DATE = 2;

/** Días naturales que la señal debe aguantar sobre el umbral antes de ser elegible. */
export const PERSISTENCE_DAYS = 60;

/** Un valor vendido no puede reentrar en este plazo. Medido inocuo para la rentabilidad; se
 *  mantiene porque evita el efecto sierra de comprar y vender el mismo nombre. */
export const QUARANTINE_MONTHS = 12;

/** §2 — desfase máximo, en días naturales, entre la última barra de precio de un valor y la
 *  fecha de decisión para considerarlo COTIZANDO. Diez cubre un puente largo sin dejar pasar
 *  un ticker muerto. */
export const MAX_PRICE_LAG_DAYS = 10;

/**
 * §2 · "sin cotización suspendida", que hasta el 2026-08-21 estaba escrito y no implementado.
 *
 * La señal sale de EDGAR y EDGAR no sabe de tickers: un valor puede tener fundamentales
 * impecables y no tener precio, o —peor— tener el precio de OTRA empresa. El caso real:
 * BNY Mellon cotiza hoy como `BNY`, pero la foto de miembros congelada dice `BK`. El CIK de
 * `BK` sí resuelve —por el override manual de `edgar.mjs`, no porque la SEC conserve el
 * ticker viejo—, así que su percentil de calidad se calcula perfectamente, mientras su
 * "precio" son 14,79 $ de otro instrumento. Sin este filtro, un `BK` en el top 40 se habría
 * registrado como compra a 14,79 $ y nada habría fallado.
 *
 * Es point-in-time: compara con la fecha de DECISIÓN, no con hoy. Un valor deslistado en 2020
 * sigue siendo elegible para una decisión de 2019, que es lo correcto.
 */
export function cotizaEn(lastBar: string | null | undefined, date: string): boolean {
  if (!lastBar) return false;
  return daysBetween(lastBar, date) <= MAX_PRICE_LAG_DAYS;
}

export type SellReason =
  | "senal_bajo_umbral"        // §5.1
  | "descalificador"           // §5.2 — NO cubierto por el backtest
  | "fuera_del_universo";      // §5.3

export interface Holding {
  ticker: string;
  /** Fecha de compra, YYYY-MM-DD. */
  since: string;
}

export interface PicksState {
  holdings: Holding[];
  /** ticker → fecha hasta la que no puede reentrar. */
  quarantineUntil: Record<string, string>;
  /** ticker → evaluaciones consecutivas por debajo del umbral de salida. */
  belowExitCount: Record<string, number>;
}

export interface PicksInput {
  /** Fecha de decisión, YYYY-MM-DD. */
  date: string;
  /** ticker → percentil de calidad [0..1] en esta fecha. Un ticker ausente = fuera del universo. */
  signal: Record<string, number>;
  /** Fechas de decisión anteriores con su señal, en orden cronológico. Sólo hacen falta las
   *  que caigan dentro de PERSISTENCE_DAYS. */
  history: { date: string; signal: Record<string, number> }[];
  state: PicksState;
  /** §5.2 — tickers con un pilar en el decil inferior de su sector. Opcional porque el
   *  backtest NO lo simuló: se declara aquí para que producción pueda aplicarlo, y para que
   *  quede escrito que esa regla concreta no está respaldada por el backtest. */
  disqualified?: string[];
  /** Sólo para tests: permite fijar los parámetros sin tocar las constantes. */
  overrides?: Partial<{
    entryPctl: number; exitPctl: number; targetPositions: number;
    buysPerDate: number; persistenceDays: number; quarantineMonths: number;
  }>;
}

export interface PicksDecision {
  sells: { ticker: string; reason: SellReason; since: string }[];
  /** En orden de compra. Nunca más de `buysPerDate`. */
  buys: { ticker: string; pctl: number }[];
  /** Candidatos que cumplían todo pero no cupieron. Se publica: forma parte de "cada
   *  decisión con su razón" (§7), y sin esto un hueco vacío es indistinguible de un fallo. */
  eligibleNotBought: { ticker: string; pctl: number }[];
  /** Estado resultante. `decide` no muta el que recibe. */
  nextState: PicksState;
}

/** Días naturales entre dos fechas YYYY-MM-DD. Puro y sin zona horaria. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Suma meses a una fecha YYYY-MM-DD, saturando al último día del mes destino. */
export function addMonths(date: string, n: number): string {
  const y = +date.slice(0, 4), m = +date.slice(5, 7) - 1, d = +date.slice(8, 10);
  const target = new Date(Date.UTC(y, m + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Aplica §3-§5 a una fecha de decisión.
 *
 * El orden importa y es deliberado: **primero las ventas**. Una plaza que se libera hoy se
 * puede ocupar hoy, que es lo que haría cualquiera con la lista delante.
 */
export function decide(input: PicksInput): PicksDecision {
  const o = input.overrides ?? {};
  const entryPctl = o.entryPctl ?? ENTRY_PCTL;
  const exitPctl = o.exitPctl ?? EXIT_PCTL;
  const targetPositions = o.targetPositions ?? TARGET_POSITIONS;
  const buysPerDate = o.buysPerDate ?? BUYS_PER_DATE;
  const persistenceDays = o.persistenceDays ?? PERSISTENCE_DAYS;
  const quarantineMonths = o.quarantineMonths ?? QUARANTINE_MONTHS;

  const { date, signal, history, state } = input;
  const disqualified = new Set(input.disqualified ?? []);

  const holdings = state.holdings.map((h) => ({ ...h }));
  const quarantineUntil = { ...state.quarantineUntil };
  const belowExitCount = { ...state.belowExitCount };

  // ── VENTAS (§5) ───────────────────────────────────────────────────────────────────────
  const sells: PicksDecision["sells"] = [];
  const survivors: Holding[] = [];
  for (const h of holdings) {
    const p = signal[h.ticker];
    let reason: SellReason | null = null;

    if (p == null) reason = "fuera_del_universo";                       // §5.3
    else if (disqualified.has(h.ticker)) reason = "descalificador";     // §5.2
    else if (p < exitPctl) {
      belowExitCount[h.ticker] = (belowExitCount[h.ticker] ?? 0) + 1;
      if (belowExitCount[h.ticker] >= EXIT_CONSECUTIVE) reason = "senal_bajo_umbral";  // §5.1
    } else {
      belowExitCount[h.ticker] = 0;
    }

    if (reason) {
      sells.push({ ticker: h.ticker, reason, since: h.since });
      delete belowExitCount[h.ticker];
      if (quarantineMonths > 0) quarantineUntil[h.ticker] = addMonths(date, quarantineMonths);
    } else {
      survivors.push(h);
    }
  }

  // ── COMPRAS (§3-§4) ───────────────────────────────────────────────────────────────────
  const held = new Set(survivors.map((h) => h.ticker));
  // Fechas de decisión que cubren la ventana de persistencia, incluida la de hoy.
  const window = [...history, { date, signal }]
    .filter((h) => daysBetween(h.date, date) <= persistenceDays && h.date <= date);

  const eligible: { ticker: string; pctl: number }[] = [];
  for (const [ticker, p] of Object.entries(signal)) {
    if (p < entryPctl) continue;
    if (held.has(ticker)) continue;
    if (disqualified.has(ticker)) continue;
    if (quarantineUntil[ticker] && date < quarantineUntil[ticker]) continue;
    if (persistenceDays > 0) {
      // Sin al menos tres evaluaciones no hay cómo saber si la señal aguantó: no se compra.
      // Es deliberadamente conservador — prefiere un hueco vacío a comprar un pico de un día.
      if (window.length < 3) continue;
      let sustained = true;
      for (const h of window) {
        const q = h.signal[ticker];
        if (q == null || q < entryPctl) { sustained = false; break; }
      }
      if (!sustained) continue;
    }
    eligible.push({ ticker, pctl: p });
  }

  // Orden DETERMINISTA: percentil descendente y, a igualdad, ticker alfabético. El desempate
  // explícito no es un detalle: midiendo el pilar `health` de la app resultó que 139 nombres
  // compartían el valor del puesto 40, así que "los 40 mejores" lo decidía el orden del
  // array. Un producto que promete publicar cada decisión no puede depender de eso.
  eligible.sort((a, b) => (b.pctl - a.pctl) || a.ticker.localeCompare(b.ticker));

  const slots = Math.max(0, targetPositions - survivors.length);
  const buys = eligible.slice(0, Math.min(buysPerDate, slots));
  const eligibleNotBought = eligible.slice(buys.length);

  for (const b of buys) survivors.push({ ticker: b.ticker, since: date });

  // La cuarentena caducada se limpia: si no, el estado crece sin límite para siempre.
  for (const t of Object.keys(quarantineUntil)) if (date >= quarantineUntil[t]) delete quarantineUntil[t];

  return {
    sells,
    buys,
    eligibleNotBought,
    nextState: { holdings: survivors, quarantineUntil, belowExitCount },
  };
}

/** Estado inicial: cartera vacía, sin cuarentenas. */
export function emptyState(): PicksState {
  return { holdings: [], quarantineUntil: {}, belowExitCount: {} };
}
