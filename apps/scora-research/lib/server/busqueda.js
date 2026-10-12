// Buscador de valores por ticker o por nombre, tolerante a erratas. Lo usan la barra de
// navegación y la portada de /stock a través de /api/search.
//
// POR QUÉ (12-10-2026). El buscador pedía /api/fmp/search, que llamaba a `/stable/search` de
// FMP: ese endpoint NO existe en /stable (allí son search-symbol y search-name), así que
// respondía 404 y el desplegable no salía nunca. Corregir la ruta no bastaba:
//   - la clave de FMP es una para toda la app y se agota (429 «Limit Reach» ese mismo día), y
//     un buscador que pregunta en cada tecla es la forma más rápida de gastarla;
//   - FMP busca por prefijo: «aple», «nvidea» o «mircosoft» no encuentran nada.
//
// CÓMO. Tres fuentes, ninguna de pago y ninguna imprescindible:
//   1. La lista de la SEC (company_tickers_exchange.json): ~10.400 valores de EE. UU. con su
//      bolsa, ORDENADOS POR CAPITALIZACIÓN — ese orden es la popularidad. Se descarga una vez
//      al día y se busca en memoria, con distancia de edición para las erratas.
//   2. Los grandes valores de fuera con su cotización principal (busquedaInternacional.js).
//   3. El buscador de Yahoo, para todo lo demás (otras bolsas, ETFs). Si falla o tarda, se
//      responde con lo local.
// Todo se puntúa con la MISMA función (puntuar), y el orden lo decide la puntuación más un
// pequeño bono por popularidad y por la posición en que Yahoo lo devolvió.
//
// Aquí no hay nada que dependa de Next ni de la sesión: la ruta (app/api/search) pone la
// autenticación y el límite, y los tests (scripts/busqueda.test.mjs) llaman a esto directamente.

import { INTERNACIONALES } from './busquedaInternacional.js';

// ── Normalización ───────────────────────────────────────────────────────────────────────

/** «L'Oréal» → «loreal», «A.P. Møller-Mærsk» → «a p moller maersk», «AT&T» → «att». */
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .replace(/['&]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** El ticker sin separadores: «BRK.B», «brk-b» y «BRKB» son la misma clave. */
export const claveTicker = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Palabras que no distinguen a una empresa de otra. Se quitan para comparar el nombre
// «significativo»: «Apple Inc.» y «apple» son el mismo nombre.
const RELLENO = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'companies', 'ltd', 'limited',
  'plc', 'llc', 'lp', 'l', 'p', 'sa', 's', 'a', 'ag', 'nv', 'n', 'v', 'se', 'spa', 'sab', 'de',
  'cv', 'ab', 'asa', 'as', 'oyj', 'publ', 'holding', 'holdings', 'group', 'groep', 'the',
  'class', 'cl', 'ord', 'shs', 'adr', 'ads', 'sponsored', 'and',
]);

// ── Distancia de edición ────────────────────────────────────────────────────────────────

/**
 * Damerau-Levenshtein restringida (OSA): sustituir, insertar, borrar o cambiar de orden dos
 * letras seguidas cuesta 1 («mircosoft» → «microsoft» = 1). Corta en cuanto la distancia
 * supera `tope`: solo interesa saber si el parecido es suficiente, no cuánto exactamente.
 */
export function distancia(a, b, tope = 2) {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > tope) return tope + 1;
  let antes = null;
  let previa = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const fila = [i];
    let minimo = i;
    for (let j = 1; j <= m; j++) {
      let v = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, antes[j - 2] + 1);
      fila[j] = v;
      if (v < minimo) minimo = v;
    }
    if (minimo > tope) return tope + 1;
    antes = previa;
    previa = fila;
  }
  return previa[m];
}

/** Erratas admitidas según lo largo que sea lo escrito: ninguna hasta 3 letras. */
const erratasAdmitidas = (largo) => (largo <= 3 ? 0 : largo <= 5 ? 1 : 2);

/**
 * Lo escrito puede ser el PRINCIPIO de la palabra («nvide» de «nvidia»): se compara con los
 * prefijos de la palabra de largo parecido y se queda la menor distancia.
 */
function distanciaPrefijo(token, palabra, tope) {
  let mejor = tope + 1;
  for (let largo = token.length - 1; largo <= token.length + 1; largo++) {
    if (largo < 1 || largo > palabra.length) continue;
    mejor = Math.min(mejor, distancia(token, palabra.slice(0, largo), tope));
  }
  // Palabra más corta que lo escrito («aple» contra «ap»): se compara entera.
  if (palabra.length < token.length - 1) mejor = Math.min(mejor, distancia(token, palabra, tope));
  return mejor;
}

// ── Entradas y consulta ─────────────────────────────────────────────────────────────────

function formaNombre(nombre) {
  const nn = normalizar(nombre);
  const palabras = nn ? nn.split(' ') : [];
  const utiles = palabras.filter((p) => !RELLENO.has(p));
  const sig = (utiles.length ? utiles : palabras).join(' ');
  return { nn, sig, compacto: nn.replace(/ /g, ''), palabras, primera: sig.split(' ')[0] ?? '' };
}

/**
 * Una fila del índice. `rank`: posición por capitalización (0 = la mayor), o null si no se
 * sabe. `fuente`: 'sec' | 'curada' | 'yahoo'.
 */
export function prepararEntrada({ symbol, name, exchange = null, type = 'stock', rank = null, alias = [], fuente }) {
  const clave = claveTicker(symbol);
  const punto = symbol.indexOf('.');
  return {
    symbol, name, exchange, type, rank, fuente, clave,
    base: punto > 0 ? claveTicker(symbol.slice(0, punto)) : clave,
    nombres: [name, ...alias].map(formaNombre),
  };
}

export function prepararConsulta(q) {
  const raw = String(q ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 50);
  const nn = normalizar(raw);
  return {
    raw, nn,
    // Solo cuenta como ticker si podría serlo: sin espacios y corto.
    ticker: /^[A-Za-z0-9.\-]{1,12}$/.test(raw) ? claveTicker(raw) : '',
    compacto: nn.replace(/ /g, ''),
    tokens: nn ? nn.split(' ') : [],
  };
}

// ── Puntuación ──────────────────────────────────────────────────────────────────────────

function puntuarNombre(n, c) {
  // Con una sola letra, «empieza por» casa con miles de nombres: ahí solo cuenta el ticker.
  if (c.nn.length < 2 || !n.nn) return 0;
  if (n.sig === c.nn || n.nn === c.nn) return 960;                       // «apple» = «Apple Inc.»
  if (n.nn.startsWith(c.nn) || n.sig.startsWith(c.nn)) return 880;        // «appl»
  if (c.compacto.length >= 3 && n.compacto.startsWith(c.compacto)) return 840; // «cocacola»
  // Cada palabra escrita tiene que encajar con alguna del nombre, por prefijo o con pocas
  // erratas: «santander» → «Banco Santander», «nvidea» → «NVIDIA», «bank america». Cada
  // errata cuesta 70: «aple» queda por debajo de lo que empieza por «aple», pero el bono de
  // popularidad aún deja a Apple por encima de un valor desconocido que se llame así.
  let coste = 0, empiezaIgual = false;
  for (let i = 0; i < c.tokens.length; i++) {
    const tok = c.tokens[i];
    const tope = erratasAdmitidas(tok.length);
    let mejor = tope + 1, cual = -1;
    for (let j = 0; j < n.palabras.length && mejor > 0; j++) {
      const p = n.palabras[j];
      const d = p.startsWith(tok) ? 0 : tope > 0 ? distanciaPrefijo(tok, p, tope) : tope + 1;
      if (d < mejor) { mejor = d; cual = j; }
    }
    if (mejor > tope) { coste = -1; break; }
    coste += mejor;
    if (i === 0 && n.palabras[cual] === n.primera) empiezaIgual = true;
  }
  if (coste >= 0) return (empiezaIgual ? 880 : 800) - 70 * coste;
  if (c.nn.length >= 3 && n.nn.includes(c.nn)) return 600;                 // «soft» en «microsoft»
  return 0;
}

/** Cuánto se parece una entrada a lo escrito. 0 = nada. */
export function puntuar(e, c) {
  let s = 0;
  if (c.ticker) {
    if (e.clave === c.ticker) s = 1000;                                     // AAPL, brk.b → BRK-B
    else if (e.base === c.ticker) s = 940;                                  // MC → MC.PA
    else if (e.clave.startsWith(c.ticker)) s = 860 - Math.min(80, (e.clave.length - c.ticker.length) * 20);
  }
  for (const n of e.nombres) s = Math.max(s, puntuarNombre(n, c));
  return s;
}

/**
 * Bono por capitalización: hasta 160 puntos para la primera, ~80 en el puesto 100 y casi nada
 * al final de la lista. Decide entre parecidos igual de buenos («ford»: Ford Motor antes que
 * Fortinet) sin pasar por encima de un parecido claramente mejor.
 */
export const bonoPopularidad = (rank) =>
  rank == null ? 0 : Math.max(0, 160 * (1 - Math.log10(rank + 1) / 4.1));

/**
 * Bono por lo que dice Yahoo. Cada resultado trae un `score` de popularidad: ~20.000 es el
 * suelo (nadie lo busca) y lo conocido va muy por encima (AAPL ~180.000, APLE ~10 millones
 * buscando «aple»). Sin `score` (si Yahoo cambiara el formato) se usa la posición.
 */
const BONO_POSICION_YAHOO = [50, 35, 25, 18, 12, 8, 5, 3, 2, 1];
export function bonoYahoo(score, posicion) {
  if (!Number.isFinite(score)) return BONO_POSICION_YAHOO[posicion] ?? 0;
  return Math.min(50, Math.max(0, 12 * Math.log10(Math.max(1, score - 20000))));
}

// Los valores de la lista curada son grandes por construcción: cuentan como un top-60 de EE. UU.
const RANK_CURADA = 60;
// Lo que solo conoce Yahoo no tiene capitalización: se trata como poco conocido. Y lo OTC
// (ADRs sin patrocinar, duplicados de valores extranjeros) baja un poco: casi nunca es lo
// que se busca, y FMP lo cubre peor.
const SIN_POPULARIDAD = -30;
const PENALIZACION_OTC = -40;

// Nombres comerciales que no aparecen en el nombre legal.
const ALIAS_EEUU = {
  GOOGL: ['google'], GOOG: ['google'], META: ['facebook', 'instagram', 'whatsapp'],
  DIS: ['disney'], TSM: ['tsmc'],
};

// ── Fuentes ─────────────────────────────────────────────────────────────────────────────

const SIMBOLO_VALIDO = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/; // el mismo que acepta /api/fmp para ?symbol=
// Preferentes, unidades, warrants y derechos: no son la acción («BAC-PK», «KCAC-UN»).
const NO_ES_LA_ACCION = /-(P[A-Z]?|U|UN|W|WS|WT|R|RT)$/;

const BOLSAS_SEC = { Nasdaq: 'NASDAQ', NYSE: 'NYSE', OTC: 'OTC', CBOE: 'Cboe', TXSE: 'TXSE' };

/** «MICROSOFT CORP» → «Microsoft Corp». Solo toca los nombres que vienen enteros en mayúsculas. */
export function nombreLegible(nombre) {
  const limpio = String(nombre ?? '').replace(/\s*\/[A-Z]{0,3}\/?\s*$/, '').trim(); // «/DE/», «CORP/»
  if (/[a-z]/.test(limpio)) return limpio;
  const MINUSCULAS = new Set(['OF', 'AND', 'THE', 'FOR', 'IN', 'ON', 'AT', 'DE', 'DEL', 'LA']);
  const SIGLAS_NO = new Set(['INC', 'CO', 'COM', 'LTD', 'PLC', 'NEW', 'ONE', 'TWO', 'CAP', 'ENERGY', 'GROUP']);
  return limpio.split(/\s+/).map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w.toLowerCase();
    // Palabras cortas o con símbolos suelen ser siglas: «IBM», «AT&T», «3M».
    if ((w.length <= 3 && !SIGLAS_NO.has(w.replace(/[^A-Z]/g, ''))) || /[^A-Z.,]/.test(w)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}

/**
 * Puesto por capitalización de una línea. Las otras clases de la misma acción heredan el de la
 * principal: GOOG va con GOOGL y no en el puesto 7.000 donde la deja la SEC. Pero solo si el
 * ticker se le parece — bajo el CIK de JPMorgan cuelgan ETNs como AMJB, que no son JPMorgan.
 */
function rankDeLinea(symbol, posPropia, posPrincipal, tickerPrincipal) {
  const raiz = (t) => t.split('-')[0].slice(0, 3);
  return raiz(tickerPrincipal) === raiz(symbol) ? posPrincipal : posPropia;
}

/** company_tickers_exchange.json → entradas, con la popularidad de rankDeLinea. */
export function indiceDesdeSEC(json) {
  const f = json?.fields ?? [];
  const iCik = f.indexOf('cik'), iNom = f.indexOf('name'), iTic = f.indexOf('ticker'), iBol = f.indexOf('exchange');
  if ([iCik, iNom, iTic, iBol].includes(-1) || !Array.isArray(json?.data)) return [];
  const primeraPos = new Map();
  json.data.forEach((r, i) => { if (!primeraPos.has(r[iCik])) primeraPos.set(r[iCik], i); });
  const out = [];
  json.data.forEach((r, i) => {
    const symbol = String(r[iTic] ?? '').toUpperCase();
    if (!r[iBol] || !SIMBOLO_VALIDO.test(symbol) || NO_ES_LA_ACCION.test(symbol)) return;
    const posPrincipal = primeraPos.get(r[iCik]);
    out.push(prepararEntrada({
      symbol, name: nombreLegible(r[iNom]), exchange: BOLSAS_SEC[r[iBol]] ?? String(r[iBol]),
      rank: rankDeLinea(symbol, i, posPrincipal, String(json.data[posPrincipal][iTic] ?? '').toUpperCase()),
      fuente: 'sec', alias: ALIAS_EEUU[symbol] ?? [],
    }));
  });
  return out;
}

const BOLSA_POR_SUFIJO = {
  MC: 'BME', PA: 'Paris', DE: 'XETRA', AS: 'Amsterdam', BR: 'Brussels', MI: 'Milan', L: 'LSE',
  SW: 'SIX', CO: 'Copenhagen', ST: 'Stockholm', OL: 'Oslo', HE: 'Helsinki', LS: 'Lisbon',
  T: 'Tokyo', HK: 'HKEX', TO: 'TSX', AX: 'ASX', VI: 'Vienna', IR: 'Dublin',
};

export const INDICE_INTERNACIONAL = INTERNACIONALES.map(([symbol, name, ...alias]) =>
  prepararEntrada({
    symbol, name, alias, rank: RANK_CURADA, fuente: 'curada',
    exchange: BOLSA_POR_SUFIJO[symbol.split('.').pop()] ?? null,
  }));

const BOLSAS_YAHOO = {
  NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ', NYQ: 'NYSE', ASE: 'NYSE American',
  PCX: 'NYSE Arca', BTS: 'Cboe', PNK: 'OTC', OQX: 'OTC', OQB: 'OTC', OID: 'OTC', OEM: 'OTC',
  MCE: 'BME', PAR: 'Paris', GER: 'XETRA', AMS: 'Amsterdam', BRU: 'Brussels', MIL: 'Milan',
  LSE: 'LSE', EBS: 'SIX', CPH: 'Copenhagen', STO: 'Stockholm', OSL: 'Oslo', HEL: 'Helsinki',
  LIS: 'Lisbon', JPX: 'Tokyo', HKG: 'HKEX', TOR: 'TSX', VAN: 'TSXV', ASX: 'ASX', VIE: 'Vienna',
  ISE: 'Dublin', NSI: 'NSE', BSE: 'BSE', KSC: 'KRX', TAI: 'TWSE', SAO: 'B3', MEX: 'BMV',
};
// Bolsas regionales alemanas, TLX italiana y CDRs canadienses: repiten valores cuya
// cotización principal está en otra parte (IXD1.F, 4ITX.TI y ZARA.NE para Inditex).
const SUFIJOS_SECUNDARIOS = new Set(['F', 'MU', 'HM', 'DU', 'BE', 'SG', 'HA', 'TI', 'NE']);
const TIPOS_YAHOO = { EQUITY: 'stock', ETF: 'etf' };

// Bonos y notas que cotizan como acciones («AT&T Inc. 5.35% GLB NTS», «Ford 6.20% Notes»).
const ES_DEUDA = /\d%|\bnotes?\b|\bnts\b|\bdebentures?\b|\bdepositary shares?\b/i;

/**
 * quotes del buscador de Yahoo → `{ entradas, deuda }`. Fuera futuros, opciones, fondos,
 * índices y cotizaciones secundarias. `deuda` son los símbolos que Yahoo describe como bonos:
 * la SEC los lista a nombre de la empresa (TBB = «AT&T Inc.») y hay que quitarlos también de ahí.
 */
export function entradasDesdeYahoo(quotes) {
  const entradas = [], deuda = new Set();
  (Array.isArray(quotes) ? quotes : []).forEach((q, posicion) => {
    const symbol = String(q?.symbol ?? '').toUpperCase();
    const type = TIPOS_YAHOO[q?.quoteType];
    const nombre = String(q?.longname || q?.shortname || '').trim();
    if (ES_DEUDA.test(nombre)) { deuda.add(symbol); return; }
    if (!type || !nombre || !SIMBOLO_VALIDO.test(symbol) || NO_ES_LA_ACCION.test(symbol)) return;
    const sufijo = symbol.includes('.') ? symbol.split('.').pop() : '';
    if (SUFIJOS_SECUNDARIOS.has(sufijo) || /\bCDR\b/.test(nombre)) return;
    const e = prepararEntrada({
      symbol, name: nombre, type, fuente: 'yahoo',
      exchange: BOLSAS_YAHOO[q.exchange] ?? (q.exchDisp ? String(q.exchDisp).slice(0, 14) : null),
    });
    e.bonoYahoo = bonoYahoo(q.score, posicion);
    entradas.push(e);
  });
  return { entradas, deuda };
}

// ── Combinar ────────────────────────────────────────────────────────────────────────────

/**
 * Junta las tres fuentes, puntúa y devuelve las `limite` mejores como
 * `{ symbol, name, exchange, type }`.
 */
export function buscar(c, { sec = [], internacionales = INDICE_INTERNACIONAL, yahoo = [], limite = 8 } = {}) {
  if (!c.nn && !c.ticker) return [];
  const { entradas: deYahoo, deuda } = entradasDesdeYahoo(yahoo);
  const candidatos = new Map(); // símbolo → { e, puntos }
  const proponer = (e, extra = 0, minimo = 0) => {
    if (deuda.has(e.symbol)) return;
    const base = Math.max(puntuar(e, c), minimo);
    if (base <= 0) return;
    const popularidad = e.fuente === 'yahoo' ? SIN_POPULARIDAD : bonoPopularidad(e.rank);
    const puntos = base + popularidad + (e.exchange === 'OTC' ? PENALIZACION_OTC : 0) + extra;
    const ya = candidatos.get(e.symbol);
    if (!ya || puntos > ya.puntos) candidatos.set(e.symbol, { e, puntos });
  };
  for (const e of sec) proponer(e);
  for (const e of internacionales) proponer(e);

  // Lo que devuelve Yahoo suma su bono (bonoYahoo). Si el valor ya está (SEC o curado), se
  // le suma a ese — y se adopta el nombre y el tipo de Yahoo, que son mejores que los de la
  // SEC («NVIDIA Corporation», «ETF» en SPY). Lo que solo conoce Yahoo entra con un mínimo:
  // si Yahoo lo da por bueno es que algo se parece, aunque no sea por el nombre («inditex»).
  const porSimbolo = new Map(sec.map((e) => [e.symbol, e]));
  for (const e of internacionales) porSimbolo.set(e.symbol, e);
  for (const y of deYahoo) {
    const conocida = porSimbolo.get(y.symbol);
    if (conocida) {
      const mezcla = {
        ...conocida,
        name: conocida.fuente === 'sec' ? y.name : conocida.name,
        type: y.type === 'etf' ? 'etf' : conocida.type,
        nombres: [...conocida.nombres, ...y.nombres],
      };
      proponer(mezcla, y.bonoYahoo, 500);
    } else {
      proponer(y, y.bonoYahoo, 500);
    }
  }

  const ordenados = [...candidatos.values()].sort((a, b) => b.puntos - a.puntos || a.e.symbol.localeCompare(b.e.symbol));
  // Con un acierto claro arriba, lo que queda muy por debajo es ruido de las erratas
  // («inditex» acababa en fondos «Index»). Mientras se escribe a medias, todo puntúa parecido
  // y el corte no quita nada.
  const corte = (ordenados[0]?.puntos ?? 0) - 300;

  // Un valor que solo conoce Yahoo y se llama igual que otro ya elegido es una cotización
  // secundaria del mismo (NSRGY/NSRGF de Nestlé junto a NESN.SW): fuera.
  const out = [], nombresVistos = new Set();
  for (const { e, puntos } of ordenados) {
    if (puntos < corte) break;
    const sig = e.nombres[0]?.sig;
    if (e.fuente === 'yahoo' && sig && nombresVistos.has(sig)) continue;
    for (const n of e.nombres) if (n.sig) nombresVistos.add(n.sig);
    out.push({ symbol: e.symbol, name: e.name, exchange: e.exchange, type: e.type });
    if (out.length >= limite) break;
  }
  return out;
}

// ── Descargas (con caché en memoria) ────────────────────────────────────────────────────

const URL_SEC = 'https://www.sec.gov/files/company_tickers_exchange.json';
const UA_SEC = 'ScoraMVP alealvarado804@gmail.com'; // la SEC exige un contacto en el User-Agent (igual que edgar.js)
const UA_YAHOO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

let _sec = null, _secHasta = 0, _secCargando = null;

/**
 * El índice de la SEC, o null si no se ha podido bajar. Una vez cargado no se espera nunca a
 * la red: al caducar (24 h) se sigue usando el viejo mientras se descarga el nuevo. Si la SEC
 * falla, se reintenta a los 5 minutos — no en cada pulsación.
 */
export async function indiceSEC() {
  const ahora = Date.now();
  if (ahora < _secHasta) return _sec;
  if (!_secCargando) {
    _secCargando = (async () => {
      try {
        const r = await fetch(URL_SEC, { headers: { 'User-Agent': UA_SEC }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const indice = indiceDesdeSEC(await r.json());
        if (!indice.length) throw new Error('lista vacía o con otro formato');
        _sec = indice;
        _secHasta = Date.now() + 24 * 3600_000;
      } catch (e) {
        console.warn(`busqueda: lista de la SEC no disponible (${e?.message || e}) — se sigue sin ella`);
        _secHasta = Date.now() + 5 * 60_000;
      } finally {
        _secCargando = null;
      }
      return _sec;
    })();
  }
  return _sec ?? _secCargando;
}

const _yahoo = new Map(); // consulta → { hasta, quotes }
const YAHOO_TTL = 6 * 3600_000;
const YAHOO_MAX = 500;

/** quotes de Yahoo para la consulta, o [] si falla o tarda más de 2,5 s. */
export async function buscarEnYahoo(q) {
  const clave = q.toLowerCase();
  const hit = _yahoo.get(clave);
  if (hit && hit.hasta > Date.now()) return hit.quotes;
  try {
    const u = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`;
    const r = await fetch(u, { headers: { 'User-Agent': UA_YAHOO, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    const j = await r.json();
    const quotes = Array.isArray(j?.quotes) ? j.quotes : [];
    // Caché acotada: al llenarse sale la entrada más antigua (un Map recorre en orden de inserción).
    if (_yahoo.size >= YAHOO_MAX) _yahoo.delete(_yahoo.keys().next().value);
    _yahoo.set(clave, { hasta: Date.now() + YAHOO_TTL, quotes });
    return quotes;
  } catch {
    return [];
  }
}
