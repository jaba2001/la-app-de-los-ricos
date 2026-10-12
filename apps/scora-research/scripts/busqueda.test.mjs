// Buscador de valores (lib/server/busqueda.js): que encuentre lo que la gente escribe.
//   node --experimental-strip-types --no-warnings scripts/busqueda.test.mjs
//
// Sin red: una lista de la SEC en miniatura con el formato real (company_tickers_exchange.json,
// ordenada por capitalización) y respuestas de Yahoo copiadas de la API el 12-10-2026. Lo que
// importa es el ORDEN: que lo que se busca salga primero, también con erratas.
import {
  normalizar, claveTicker, distancia, prepararConsulta, puntuar, prepararEntrada, nombreLegible,
  indiceDesdeSEC, entradasDesdeYahoo, buscar, INDICE_INTERNACIONAL, tickerExacto,
  buscarEnYahoo, _reiniciarYahoo,
} from "../lib/server/busqueda.js";
import { INTERNACIONALES } from "../lib/server/busquedaInternacional.js";

let bad = 0, total = 0;
const check = (l, got, want) => { total++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); } };

// ── Piezas ──────────────────────────────────────────────────────────────────────────────
check("normalizar: tildes, apóstrofos, &", [normalizar("L'Oréal"), normalizar("A.P. Møller-Mærsk"), normalizar("AT&T Inc.")], ["loreal", "a p moller maersk", "att inc"]);
check("claveTicker: punto, guion y mayúsculas dan igual", [claveTicker("brk.b"), claveTicker("BRK-B")], ["BRKB", "BRKB"]);
check("tickerExacto: BRK.B = brk-b, pero NGL ≠ NG.L", [tickerExacto("brk-b") === tickerExacto("BRK.B"), tickerExacto("NGL") === tickerExacto("NG.L")], [true, false]);
check("distancia: transposición cuesta 1", distancia("mircosoft", "microsoft"), 1);
check("distancia: inserción cuesta 1", distancia("aple", "apple"), 1);
check("distancia: corta al pasar el tope", distancia("abcdef", "uvwxyz", 2), 3);
check("consulta con espacios no es ticker", prepararConsulta("coca cola").ticker, "");
check("consulta: recorta y quita control", prepararConsulta("  aapl\u0007 ").raw, "aapl");
check("nombreLegible: mayúsculas de la SEC", [nombreLegible("MICROSOFT CORP"), nombreLegible("BANK OF AMERICA CORP /DE/"), nombreLegible("AT&T INC."), nombreLegible("Apple Inc.")],
  ["Microsoft Corp", "Bank of America Corp", "AT&T Inc.", "Apple Inc."]);

const apple = prepararEntrada({ symbol: "AAPL", name: "Apple Inc.", rank: 1, fuente: "sec" });
check("ticker exacto > nombre exacto > prefijo", [puntuar(apple, prepararConsulta("aapl")), puntuar(apple, prepararConsulta("apple")), puntuar(apple, prepararConsulta("appl"))], [1000, 960, 880]);
check("errata: puntúa, pero por debajo de un prefijo", puntuar(apple, prepararConsulta("aple")) > 0 && puntuar(apple, prepararConsulta("aple")) < 880, true);
check("sin parecido: 0", puntuar(apple, prepararConsulta("zzzz")), 0);
check("una letra no busca por nombre («i» de «Inc.»)", puntuar(apple, prepararConsulta("i")), 0);
check("pero sí por principio de ticker", puntuar(apple, prepararConsulta("a")) > 0, true);

// ── Lista de la SEC ─────────────────────────────────────────────────────────────────────
// Cada valor en su posición REAL en la lista del 12-10-2026 (el orden es la popularidad), y el
// resto relleno: con todos en el top-20 la popularidad no se parecería a la de verdad.
const REALES = [
  [0, 1045810, "NVIDIA CORP", "NVDA", "Nasdaq"],
  [1, 320193, "Apple Inc.", "AAPL", "Nasdaq"],
  [2, 1652044, "Alphabet Inc.", "GOOGL", "Nasdaq"],
  [3, 789019, "MICROSOFT CORP", "MSFT", "Nasdaq"],
  [4, 1018724, "AMAZON COM INC", "AMZN", "Nasdaq"],
  [7, 1318605, "Tesla, Inc.", "TSLA", "Nasdaq"],
  [9, 1067983, "BERKSHIRE HATHAWAY INC", "BRK-B", "NYSE"],
  [12, 19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"],
  [29, 70858, "BANK OF AMERICA CORP /DE/", "BAC", "NYSE"],
  [30, 21344, "COCA COLA CO", "KO", "NYSE"],
  [72, 891478, "Banco Santander, S.A.", "SAN", "NYSE"],
  [118, 1262039, "Fortinet, Inc.", "FTNT", "Nasdaq"],
  [339, 37996, "FORD MOTOR CO", "F", "NYSE"],
  [1624, 1418121, "Apple Hospitality REIT, Inc.", "APLE", "NYSE"],
  [7031, 1504461, "NGL Energy Partners LP", "NGL", "NYSE"],
  [7333, 2102713, "Kensington Capital Acquisition Corp. VI", "KCAC-UN", "NYSE"], // unidades
  [7472, 1652044, "Alphabet Inc.", "GOOG", "Nasdaq"],                             // la SEC la deja aquí
  [7490, 70858, "BANK OF AMERICA CORP /DE/", "BAC-PK", "NYSE"],                   // preferente
  [8189, 19617, "JPMORGAN CHASE & CO", "AMJB", "NYSE"],                           // ETN bajo el CIK de JPM
  [8860, 1459334, "Santander Bank Polska SA/ADR", "BKZHF", "OTC"],
  [8900, 1000001, "EBR Systems, Inc.", "NONE.", null],                            // sin bolsa
  [8950, 1000003, "Forward Industries Inc", "FORD", "Nasdaq"],                    // hipotético: ticker = nombre de otra
];
const data = Array.from({ length: 9000 }, (_, i) => [5_000_000 + i, `Filler ${i} Corp`, `ZQ${i}`, "NYSE"]);
for (const [pos, ...fila] of REALES) data[pos] = fila;
const SEC = { fields: ["cik", "name", "ticker", "exchange"], data };
const sec = indiceDesdeSEC(SEC);
const simbolos = new Set(sec.map((e) => e.symbol));
check("SEC: fuera preferentes, unidades y sin bolsa", ["BAC-PK", "KCAC-UN", "NONE."].map((s) => simbolos.has(s)), [false, false, false]);
check("SEC: GOOG hereda el puesto de GOOGL", sec.find((e) => e.symbol === "GOOG").rank, 2);
check("SEC: AMJB NO hereda el de JPMorgan", sec.find((e) => e.symbol === "AMJB").rank, 8189);
check("SEC: «/ADR» fuera del nombre", sec.find((e) => e.symbol === "BKZHF").name, "Santander Bank Polska SA");
check("SEC: formato desconocido → vacío, no error", indiceDesdeSEC({ fields: ["x"], data: [[1]] }), []);

// ── Yahoo ───────────────────────────────────────────────────────────────────────────────
const yq = (symbol, longname, exchange, quoteType = "EQUITY", score = 20005) => ({ symbol, longname, exchange, quoteType, score });
const Y = {
  ford: [yq("F", "Ford Motor Company", "NYQ", "EQUITY", 120000), yq("F-PB", "Ford Motor Company 6.20% Notes", "NYQ"), yq("FMC1.F", "Ford Motor Company", "FRA"), yq("F.TO", "FORD CDR (CAD HEDGED)", "TOR", "ETF"), yq("BZ=F", "Brent Crude", "NYM", "FUTURE")],
  inditex: [yq("ZARA.NE", "Industria de Diseño Textil, S.A.", "NEO", "EQUITY", 20300), yq("IXD1.DE", "Industria de Diseño Textil, S.A.", "GER", "EQUITY", 20100), yq("4ITX.TI", "INDITEX", "TLO")],
  nestle: [yq("NSRGY", "Nestlé S.A.", "OID", "EQUITY", 20710), yq("NESN.SW", "Nestlé S.A.", "EBS", "EQUITY", 20596), yq("NSRGF", "Nestlé S.A.", "OID", "EQUITY", 20015)],
  google: [yq("GOOG", "Alphabet Inc.", "NMS", "EQUITY", 97229), yq("DEPW", "Google DeepMind AI Lab Economy ETF", "PCX", "ETF", 20035)],
  aple: [yq("APLE", "Apple Hospitality REIT, Inc.", "NYQ", "EQUITY", 10234000), yq("APLE.TO", "Harvest Apple Enhanced High Income Shares ETF", "TOR", "ETF", 20005), yq("6570.TWO", "Aplex Technology Inc.", "TWO", "EQUITY", 20005)],
  qqq: [yq("QQQ", "Invesco QQQ Trust", "NGM", "ETF", 400000)],
  opciones: [yq("APLE261120C00012500", "APLE Nov 2026 12.500 call", "OPR", "OPTION")],
};
const { entradas: yFord, deuda } = entradasDesdeYahoo(Y.ford);
check("Yahoo: fuera futuros, CDRs y bolsas regionales alemanas", yFord.map((e) => e.symbol), ["F"]);
check("Yahoo: las notas de deuda se marcan para quitarlas también de la SEC", [...deuda], ["F-PB"]);
check("Yahoo: opciones fuera", entradasDesdeYahoo(Y.opciones).entradas.length, 0);
check("Yahoo: respuesta rota → nada", entradasDesdeYahoo(null).entradas, []);

// ── Lo que tiene que salir primero ──────────────────────────────────────────────────────
const primeros = (q, n = 1, yahoo = []) => buscar(prepararConsulta(q), { sec, yahoo, limite: 8 }).slice(0, n).map((r) => r.symbol);
check("«apple» → AAPL", primeros("apple"), ["AAPL"]);
check("«AAPL» → AAPL", primeros("AAPL"), ["AAPL"]);
check("«aapl» en minúsculas → AAPL", primeros("aapl"), ["AAPL"]);
check("«aple» (ticker exacto de otra) → APLE y luego Apple", primeros("aple", 2, Y.aple), ["APLE", "AAPL"]);
check("«nvidea» → NVDA", primeros("nvidea"), ["NVDA"]);
check("«mircosoft» → MSFT", primeros("mircosoft"), ["MSFT"]);
check("«amazn» → AMZN", primeros("amazn"), ["AMZN"]);
check("«tesal» → TSLA", primeros("tesal"), ["TSLA"]);
check("«brk.b» → BRK-B", primeros("brk.b"), ["BRK-B"]);
check("«berkshire» → BRK-B", primeros("berkshire"), ["BRK-B"]);
check("«coca cola» y «cocacola» → KO", [primeros("coca cola")[0], primeros("cocacola")[0]], ["KO", "KO"]);
check("«jpmorgan» y «jp morgan» → JPM", [primeros("jpmorgan")[0], primeros("jp morgan")[0]], ["JPM", "JPM"]);
check("«bank of america» → BAC", primeros("bank of america"), ["BAC"]);
check("«google» → Alphabet (alias)", primeros("google", 1, Y.google), ["GOOG"]);
check("«ford» → F primero y sin las notas de deuda", [primeros("ford", 1, Y.ford)[0], primeros("ford", 8, Y.ford).includes("F-PB")], ["F", false]);
check("«f» → F", primeros("f"), ["F"]);
// Un ticker exacto de una empresa diminuta no gana al nombre exacto de una grande (revisión 12-10).
check("«ford» → Ford Motor antes que el ticker FORD", primeros("ford", 2, Y.ford), ["F", "FORD"]);
check("«ford» sin Yahoo, igual", primeros("ford", 2), ["F", "FORD"]);
check("«FORD» → también F primero (la empresa pesa más que el ticker)", primeros("FORD", 1), ["F"]);
check("«NGL» → NGL Energy, no National Grid (NG.L)", primeros("NGL"), ["NGL"]);
check("«ng.l» → NG.L", primeros("ng.l"), ["NG.L"]);
check("«brkb» (sin separador) → BRK-B", primeros("brkb"), ["BRK-B"]);
check("«santander» → SAN.MC y luego el ADR, antes que el OTC polaco", primeros("santander", 3), ["SAN.MC", "SAN", "BKZHF"]);
check("«inditex» → ITX.MC, sin sus cotizaciones secundarias", primeros("inditex", 8, Y.inditex), ["ITX.MC"]);
check("«zara» → ITX.MC (alias)", primeros("zara"), ["ITX.MC"]);
check("«nestle» → NESN.SW, sin los duplicados OTC", primeros("nestle", 8, Y.nestle), ["NESN.SW"]);
check("«lvmh» → MC.PA", primeros("lvmh"), ["MC.PA"]);
check("«telefonica» → TEF.MC", primeros("telefonica"), ["TEF.MC"]);
check("«san.mc» → SAN.MC", primeros("san.mc"), ["SAN.MC"]);
check("«roche» → ROP.SW", primeros("roche"), ["ROP.SW"]);
check("«qqq» → QQQ (ETF que solo conoce Yahoo)", buscar(prepararConsulta("qqq"), { sec, yahoo: Y.qqq })[0], { symbol: "QQQ", name: "Invesco QQQ Trust", exchange: "NASDAQ", type: "etf" });
check("el nombre de Yahoo sustituye al de la SEC", buscar(prepararConsulta("ford"), { sec, yahoo: Y.ford })[0].name, "Ford Motor Company");
check("sin la SEC (caída) sigue respondiendo con lo curado", buscar(prepararConsulta("iberdrola"), { sec: [] }).map((r) => r.symbol), ["IBE.MC"]);
check("vacío → nada", buscar(prepararConsulta("   "), { sec }), []);
check("límite", buscar(prepararConsulta("a"), { sec, limite: 3 }).length <= 3, true);
check("forma de cada resultado", Object.keys(buscar(prepararConsulta("apple"), { sec })[0]), ["symbol", "name", "exchange", "type"]);

// ── Cortacircuitos de Yahoo ─────────────────────────────────────────────────────────────
{
  let llamadas = 0;
  const cae = async () => { llamadas++; throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); };
  const aviso = console.warn; console.warn = () => {};
  _reiniciarYahoo();
  check("Yahoo cae → []", await buscarEnYahoo("abc", { fetchImpl: cae }), []);
  check("y durante la pausa ni se le pregunta", [await buscarEnYahoo("abd", { fetchImpl: cae }), llamadas], [[], 1]);
  _reiniciarYahoo();
  const http500 = async () => { llamadas++; return new Response("x", { status: 500 }); };
  await buscarEnYahoo("abe", { fetchImpl: http500 });
  await buscarEnYahoo("abf", { fetchImpl: http500 });
  check("un 500 también lo para", llamadas, 2);
  _reiniciarYahoo();
  const bien = async () => { llamadas++; return Response.json({ quotes: [{ symbol: "F" }] }); };
  await buscarEnYahoo("ford", { fetchImpl: bien });
  check("lo que responde se guarda (la segunda no sale a la red)", [await buscarEnYahoo("ford", { fetchImpl: bien }), llamadas], [[{ symbol: "F" }], 3]);
  _reiniciarYahoo();
  console.warn = aviso;
}

// ── La lista curada ─────────────────────────────────────────────────────────────────────
const SIMBOLO_FMP = /^[A-Z0-9.\-]{1,15}$/; // lo que acepta /api/fmp en ?symbol=
check("curada: todos los símbolos pasan el filtro de /api/fmp", INTERNACIONALES.filter(([s]) => !SIMBOLO_FMP.test(s)).map(([s]) => s), []);
check("curada: sin repetidos", INTERNACIONALES.length, new Set(INTERNACIONALES.map(([s]) => s)).size);
check("curada: cada valor tiene bolsa", INDICE_INTERNACIONAL.filter((e) => !e.exchange).map((e) => e.symbol), []);

// ── Velocidad: ~10.000 valores, como la lista real ─────────────────────────────────────
const grande = { fields: SEC.fields, data: Array.from({ length: 10000 }, (_, i) => [i, `Company ${i} Holdings Inc`, `T${i}`, "NYSE"]) };
const idx = indiceDesdeSEC(grande);
const t0 = performance.now();
for (const q of ["apple", "nvidea", "company 9999", "zzzz"]) buscar(prepararConsulta(q), { sec: idx });
const ms = (performance.now() - t0) / 4;
check(`una búsqueda sobre 10.000 valores tarda < 100 ms (${ms.toFixed(1)} ms)`, ms < 100, true);

console.log(`\nbusqueda: ${total - bad}/${total} OK`);
if (bad) process.exit(1);
