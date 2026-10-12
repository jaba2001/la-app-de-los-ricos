// Respaldo de Yahoo para los ETFs que el plan de FMP no cubre (lib/server/providers/yahoo.js).
//   node --experimental-strip-types --no-warnings scripts/yahoo.test.mjs
//
// Lo que importa es la FORMA: el front lee estas respuestas como si fueran de FMP, así que
// cualquier campo con otro nombre o el orden al revés rompería el ETF Lab o el Risk Model sin
// un solo error (datos vacíos que parecen «sin datos»).
import { cotizacionDesdeYahoo, historicoDesdeYahoo, esSimboloFueraDePlan, esLimiteAgotado } from "../lib/server/providers/yahoo.js";

let bad = 0, total = 0;
const check = (l, got, want) => { total++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); } };

const t = (d) => Math.floor(Date.parse(d + "T20:00:00Z") / 1000);
const chart = { chart: { result: [{
  meta: { regularMarketPrice: 210, chartPreviousClose: 200, longName: "SPDR Gold Shares", regularMarketDayHigh: 211, regularMarketDayLow: 205, fiftyTwoWeekHigh: 230, fiftyTwoWeekLow: 170, regularMarketVolume: 1e6, exchangeName: "PCX", regularMarketTime: t("2026-10-09") },
  timestamp: [t("2026-10-07"), t("2026-10-08"), t("2026-10-09")],
  indicators: { quote: [{ open: [198, 201, 204], high: [202, 205, 211], low: [197, 200, 203], close: [200, null, 210], volume: [1, 2, 3] }] },
}] } };

const q = cotizacionDesdeYahoo("GLD", chart);
check("cotización: array con un objeto, como FMP", Array.isArray(q) && q.length, 1);
check("precio y cambio %", [q[0].price, q[0].changePercentage], [210, 5]);
check("campos con los nombres de FMP", ["symbol", "name", "price", "change", "dayHigh", "dayLow", "yearHigh", "yearLow", "volume"].every((k) => k in q[0]), true);

const h = historicoDesdeYahoo("GLD", chart);
check("histórico: la barra más reciente PRIMERO (como FMP)", h.map((b) => b.date), ["2026-10-09", "2026-10-07"]);
check("los huecos de Yahoo (close null) se saltan", h.length, 2);
check("barra con open/high/low/close/volume", Object.keys(h[0]).filter((k) => ["open", "high", "low", "close", "volume", "date"].includes(k)).length, 6);
check("from/to se respetan", historicoDesdeYahoo("GLD", chart, { desde: "2026-10-08" }).map((b) => b.date), ["2026-10-09"]);
check("sin datos → null (y se devuelve el 402 original)", cotizacionDesdeYahoo("X", { chart: { result: [] } }), null);

const cuerpo402 = "Premium Query Parameter: 'Special Endpoint : This value set for 'symbol' is not available under your current subscription please visit our subscription page";
check("402 de símbolo fuera del plan → respaldo", esSimboloFueraDePlan(402, cuerpo402), true);
check("402 de 'limit' (otra cosa) → NO", esSimboloFueraDePlan(402, "Special Parameters : The values for 'limit' must be between 0 and 5 based on your current subscription"), false);
check("404 → NO", esSimboloFueraDePlan(404, cuerpo402), false);
// FMP sin cuota del día (12-10-2026): el cuerpo real.
const cuerpo429 = '{\n  "Error Message": "Limit Reach . Please upgrade your plan or visit our documentation for more details at https://site.financialmodelingprep.com/"\n}';
check("429 «Limit Reach» → respaldo", esLimiteAgotado(429, cuerpo429), true);
check("429 de NUESTRO limitador (otro cuerpo) → NO", esLimiteAgotado(429, '{"error":"Rate limit exceeded"}'), false);
check("200 → NO", esLimiteAgotado(200, cuerpo429), false);

console.log(bad ? `\n✗ yahoo: ${bad} fallo(s) de ${total}` : `\n✓ yahoo: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
