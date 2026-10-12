// Respaldo de Yahoo para lo que el plan de FMP no cubre: cotización e histórico de ETFs.
//
// POR QUÉ. Verificado contra la API real (18-08 y otra vez el 12-10-2026): el plan de FMP de
// este proyecto responde 402 «Special Endpoint» a /quote y /historical-price-eod de los ETFs
// (GLD, SLV, TLT, XLK…; SPY sí pasa). Eso dejaba sin datos el ETF Lab y el panel de sectores de
// Macro, y el ETF sectorial del Risk Model de cada acción. El cron del cierre diario ya leía los
// ETFs de Yahoo por lo mismo (app/api/cron/daily-close).
//
// Aquí solo se TRADUCE la respuesta de Yahoo a la forma exacta que devuelve FMP, para que el
// front no tenga que saber de dónde vino el dato. La cabecera X-Scora-Source lo dice.

// Yahoo rechaza peticiones sin User-Agent de navegador (igual que en el cron del cierre).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

const fecha = (s) => new Date(s * 1000).toISOString().slice(0, 10);
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** chart de Yahoo → `/stable/quote` de FMP (un array con un objeto). */
export function cotizacionDesdeYahoo(simbolo, json) {
  const r = json?.chart?.result?.[0];
  const m = r?.meta;
  const precio = num(m?.regularMarketPrice);
  if (!m || precio == null) return null;
  const previo = num(m.chartPreviousClose ?? m.previousClose);
  const cambio = previo != null ? precio - previo : null;
  return [{
    symbol: simbolo,
    name: m.longName ?? m.shortName ?? simbolo,
    price: precio,
    changePercentage: cambio != null && previo ? (cambio / previo) * 100 : null,
    change: cambio,
    volume: num(m.regularMarketVolume),
    dayLow: num(m.regularMarketDayLow),
    dayHigh: num(m.regularMarketDayHigh),
    yearHigh: num(m.fiftyTwoWeekHigh),
    yearLow: num(m.fiftyTwoWeekLow),
    marketCap: null,
    exchange: m.exchangeName ?? null,
    previousClose: previo,
    timestamp: num(m.regularMarketTime),
  }];
}

/** chart de Yahoo → `/stable/historical-price-eod/full` de FMP: barras, la MÁS RECIENTE primero. */
export function historicoDesdeYahoo(simbolo, json, { desde = null, hasta = null } = {}) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return null;
  const barras = [];
  for (let i = 0; i < ts.length; i++) {
    const close = num(q.close?.[i]);
    if (close == null) continue; // Yahoo deja huecos (festivos, barra del día sin cerrar)
    const date = fecha(ts[i]);
    if ((desde && date < desde) || (hasta && date > hasta)) continue;
    const open = num(q.open?.[i]);
    barras.push({
      symbol: simbolo, date,
      open, high: num(q.high?.[i]), low: num(q.low?.[i]), close,
      volume: num(q.volume?.[i]),
      change: open != null ? close - open : null,
      changePercent: open ? ((close - open) / open) * 100 : null,
    });
  }
  return barras.reverse();
}

/** ¿El 402 de FMP es el del plan que no cubre este símbolo? (no un 402 de cuota u otro). */
export const esSimboloFueraDePlan = (status, cuerpo) =>
  status === 402 && /symbol/i.test(String(cuerpo)) && /not available under your current subscription/i.test(String(cuerpo));

/**
 * Pide a Yahoo y devuelve `{ status, body }` con la forma de FMP, o null si Yahoo tampoco
 * lo tiene (y entonces se devuelve el 402 original: el front ya sabe tratarlo).
 */
export async function respaldoYahoo(path, params) {
  const simbolo = params.get('symbol');
  if (!simbolo) return null;
  const historico = path === 'historical-price-eod/full';
  const rango = historico ? '5y' : '5d';
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${rango}&interval=1d`;
  try {
    const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const datos = historico
      ? historicoDesdeYahoo(simbolo, json, { desde: params.get('from'), hasta: params.get('to') })
      : cotizacionDesdeYahoo(simbolo, json);
    if (!datos || datos.length === 0) return null;
    return { status: 200, body: JSON.stringify(datos) };
  } catch {
    return null;
  }
}
