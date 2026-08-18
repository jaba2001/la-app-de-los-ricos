// ─────────────────────────────────────────────────────────────────────────────
// DAILY CLOSE — el estado medido del día, construido desde datos, no desde una opinión.
//
// POR QUÉ ES UNA PLANTILLA Y NO UNA LLAMADA A UN LLM.
// Misma razón que `lib/brief.js`: la promesa de Scora es que su capa de IA no puede
// inventar una cifra, y esa promesa la impone el gate de grounding que vive en
// scora-research. Este cron corre en ic-proxy, así que meter un modelo aquí obligaría a
// duplicar el gate o a emitir números con la marca Scora que nunca pasaron por él.
//
// Un cierre de mercado es material de plantilla puro: dice lo que se midió y lo que eso
// implica. Escribirlo de forma determinista hace que "sin cifras inventadas" sea
// ESTRUCTURAL en vez de comprobado — no hay modelo en el bucle que pueda inventar una.
//
// El diferencial frente a un "recap" al uso no es el adjetivo, es la DISPERSIÓN: cuánto
// del día fue el mercado entero moviéndose a la vez y cuánto fue rotación entre sectores.
// Es la misma pregunta que responde la atribución por acción, a nivel índice.
//
// Puro: sin I/O, sin imports. Probado en scripts/dailyclose.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

const REGIME_WORDS = {
  expansion: "expansion",
  slowdown: "slowdown",
  contraction: "contraction",
  recovery: "recovery",
  stagflation: "stagflation",
  goldilocks: "goldilocks",
  reflation: "reflation",
  neutral: "neutral",
};

const n = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const one = (v) => (v == null ? null : Math.round(v * 10) / 10);
const signed = (v, dp = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(dp)}%`;

/** Desviación típica poblacional. Con menos de 2 observaciones no hay dispersión. */
function stdev(xs) {
  if (!Array.isArray(xs) || xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/**
 * ¿El día fue "beta" (todo junto) o "rotación" (unos suben, otros bajan)?
 *
 * Se decide con dos hechos medidos, no con una impresión: la dispersión entre sectores y
 * cuántos acabaron del mismo lado. Un día de −2% con los 11 sectores en rojo es una cosa;
 * un −2% con 5 verdes es otra completamente distinta, y esa diferencia es lo que decide si
 * seleccionar acciones tenía sentido hoy.
 */
export function classifyBreadth(sectorReturns) {
  const rs = (sectorReturns || []).map((s) => n(s.changePct)).filter((v) => v != null);
  if (rs.length < 3) return null;
  const up = rs.filter((v) => v > 0).length;
  const disp = stdev(rs);
  const agreement = Math.max(up, rs.length - up) / rs.length;   // 0.5 = partido · 1 = unánime
  // Umbrales de oficio sobre retornos diarios de ETFs sectoriales: por debajo de 0.5 pp de
  // dispersión el día es prácticamente un solo factor moviéndose.
  const kind = agreement >= 0.9 && disp < 0.5 ? "beta"
    : disp >= 1.0 ? "rotation"
    : agreement >= 0.8 ? "broad"
    : "mixed";
  return { up, down: rs.length - up, total: rs.length, dispersion: disp, agreement, kind };
}

/** Sectores ordenados por retorno, con los extremos separados. */
export function rankSectorDay(sectorReturns) {
  const rows = (sectorReturns || [])
    .map((s) => ({ etf: s.etf, name: s.name || s.etf, changePct: n(s.changePct) }))
    .filter((s) => s.etf && s.changePct != null)
    .sort((a, b) => b.changePct - a.changePct);
  return { rows, leaders: rows.slice(0, 3), laggards: rows.slice(-3).reverse() };
}

/** ¿Cambió el régimen respecto al snapshot anterior? */
export function regimeShift(macro, prevMacro) {
  const curr = macro ? String(macro.regime_id || "").toLowerCase() || null : null;
  const prev = prevMacro ? String(prevMacro.regime_id || "").toLowerCase() || null : null;
  return {
    id: curr,
    previousId: prev,
    changed: !!(curr && prev && curr !== prev),
    confirmed: String((macro && macro.regime_confirmation) || "").toLowerCase() === "confirmed",
  };
}

/**
 * Construye el informe de cierre.
 *
 * @param {object} args
 * @param {object|null} args.macro      fila macro_state más reciente
 * @param {object|null} args.prevMacro  la anterior (para detectar cambio de régimen)
 * @param {{changePct:number|null}|null} args.spy
 * @param {Array<{etf:string,name?:string,changePct:number|null}>} args.sectors
 * @param {string} args.date            día ISO del cierre
 * @returns {object} informe serializable (va tal cual a sl_daily_close.payload)
 */
export function buildDailyClose({ macro, prevMacro, spy, sectors, date }) {
  const regime = regimeShift(macro, prevMacro);
  const breadth = classifyBreadth(sectors);
  const ranked = rankSectorDay(sectors);
  const spyRet = spy ? n(spy.changePct) : null;

  const vix = macro ? n(macro.vix) : null;
  const riskOn = macro ? one(n(macro.risk_on)) : null;
  const hy = macro ? n(macro.hy_oas) : null;
  const dgs10 = macro ? n(macro.dgs10) : null;

  const headline = [];
  if (spyRet != null) {
    headline.push(`The S&P 500 closed ${signed(spyRet)}.`);
  }
  // La lectura que da valor: qué TIPO de día fue, derivada de la dispersión medida.
  if (breadth) {
    if (breadth.kind === "beta") {
      headline.push(`It moved as one block — ${breadth.up} of ${breadth.total} sectors ${breadth.up >= breadth.down ? "up" : "down"}, with almost no dispersion between them. Selection had little to work with today.`);
    } else if (breadth.kind === "rotation") {
      headline.push(`Underneath it was rotation, not direction: ${breadth.up} sectors up and ${breadth.down} down, with ${breadth.dispersion.toFixed(2)} points of dispersion between them.`);
    } else if (breadth.kind === "broad") {
      headline.push(`The move was broad — ${Math.max(breadth.up, breadth.down)} of ${breadth.total} sectors on the same side.`);
    } else {
      headline.push(`Sectors were split ${breadth.up}–${breadth.down}, with ${breadth.dispersion.toFixed(2)} points of dispersion.`);
    }
  }
  if (ranked.leaders.length && ranked.laggards.length) {
    const L = ranked.leaders[0], T = ranked.laggards[0];
    headline.push(`${L.name} led at ${signed(L.changePct)}; ${T.name} lagged at ${signed(T.changePct)}.`);
  }
  if (regime.changed) {
    headline.push(`The macro regime moved from ${REGIME_WORDS[regime.previousId] || regime.previousId} to ${REGIME_WORDS[regime.id] || regime.id}${regime.confirmed ? " (confirmed)" : " (not yet confirmed)"}.`);
  } else if (regime.id) {
    headline.push(`The regime still reads ${REGIME_WORDS[regime.id] || regime.id}${regime.confirmed ? ", confirmed" : ", unconfirmed"}.`);
  }

  const context = [];
  if (vix != null) {
    // El adjetivo se deriva del número; una plantilla fija diría "volatilidad contenida"
    // con el VIX en 35, que sería una afirmación falsa en la voz de Scora.
    const word = vix < 16 ? "subdued" : vix < 22 ? "unremarkable" : vix < 30 ? "elevated" : "stressed";
    context.push(`Volatility ${word} at ${vix.toFixed(1)}.`);
  }
  if (hy != null) context.push(`High-yield spreads ${Math.round(hy)} bp.`);
  if (dgs10 != null) context.push(`Ten-year at ${dgs10.toFixed(2)}%.`);
  if (riskOn != null) context.push(`Risk gauge ${riskOn}/100.`);

  return {
    date,
    generatedAt: new Date().toISOString(),
    regime,
    market: { spyChangePct: spyRet, vix, hyOas: hy, dgs10, riskOn },
    breadth,
    sectors: ranked.rows,
    leaders: ranked.leaders,
    laggards: ranked.laggards,
    headline: headline.join(" "),
    context: context.join(" "),
    // Lo que NO se sabe se dice, en vez de rellenarse.
    gaps: [
      macro ? null : "no macro snapshot",
      spyRet == null ? "no index quote" : null,
      breadth ? null : "not enough sector quotes",
    ].filter(Boolean),
  };
}

/**
 * Extrae el % del día de una respuesta de la API chart de Yahoo.
 *
 * POR QUÉ YAHOO Y NO FMP. Verificado contra la API real el 18-08-2026: el plan de FMP de
 * este proyecto **no cubre ETFs** en `/stable/quote` ni en `/stable/historical-price-eod`
 * — XLK, XLF, GLD y QQQ devuelven HTTP 402 (SPY y las acciones sí pasan). Un informe de
 * cierre sin los 11 sectoriales se queda justo sin la parte que lo diferencia, así que la
 * fuente tiene que ser una que los tenga. `lib/macro.js` ya usa este mismo endpoint para
 * ^COR3M, así que no se añade dependencia nueva: es gratis y sin clave.
 *
 * Se usa `regularMarketPrice / chartPreviousClose`, que es como Yahoo calcula su propio
 * cambio diario. Puede diferir unas centésimas del que publique otra fuente según el
 * tratamiento de dividendos y la hora de corte — lo que importa aquí es que los DOCE
 * símbolos salgan del mismo sitio: la dispersión entre sectores compara unos con otros, y
 * mezclar proveedores metería un sesgo sistemático entre el índice y sus componentes.
 *
 * @returns {{pct: number, asOf: string|null}|null} null si la respuesta no sirve.
 */
export function parseYahooQuote(json) {
  const r = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  const m = r && r.meta ? r.meta : null;
  if (!m) return null;
  const px = Number(m.regularMarketPrice);
  const prev = Number(m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose);
  if (!Number.isFinite(px) || !Number.isFinite(prev) || px <= 0 || prev <= 0) return null;
  const t = Number(m.regularMarketTime);
  return {
    pct: (px / prev - 1) * 100,
    // Fecha del dato, para poder detectar un informe construido sobre precios rancios
    // (un festivo, o un cron que se dispara cuando el mercado no ha abierto).
    asOf: Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString().slice(0, 10) : null,
  };
}

/** Los 11 SPDR sectoriales — universo fijo, gratis y sin datos de usuario. */
export const SECTOR_UNIVERSE = [
  { etf: "XLK", name: "Technology" },
  { etf: "XLC", name: "Communication" },
  { etf: "XLY", name: "Consumer Discretionary" },
  { etf: "XLF", name: "Financials" },
  { etf: "XLI", name: "Industrials" },
  { etf: "XLE", name: "Energy" },
  { etf: "XLB", name: "Materials" },
  { etf: "XLV", name: "Health Care" },
  { etf: "XLP", name: "Consumer Staples" },
  { etf: "XLU", name: "Utilities" },
  { etf: "XLRE", name: "Real Estate" },
];
