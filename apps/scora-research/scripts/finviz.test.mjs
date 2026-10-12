// El parser de Finviz (lib/server/providers/finviz.js) con los dos formatos de su tabla.
//   node --experimental-strip-types --no-warnings scripts/finviz.test.mjs
//
// En 2026 Finviz movió la ficha (quote.ashx → /stock?t=) y cambió el HTML de la tabla: el parser
// devolvía {} sin lanzar nada, y la pestaña Sentiment salía llena de «—» (recorrido con sesión,
// 12-10-2026). Esta prueba fija los dos formatos para que el próximo cambio salte aquí.
import { parseFinvizHtml } from "../lib/server/providers/finviz.js";

let bad = 0, total = 0;
const check = (l, got, want) => { total++; if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); } };

// Formato 2026, copiado de la página real (recortado).
const celda = (l, v) => `<td class="snapshot-td2 cursor-pointer" align="left" data-boxover-html="x"><div class="snapshot-td-label">${l}</div></td><td class="snapshot-td2 max-xl:w-[8%]" align="left" style=""><div class="snapshot-td-content"><b>${v}</b></div></td>`;
const nuevo = `<table class="snapshot-table2"><tr class="table-dark-row">${celda("Inst Own", "68.95%")}${celda("ATR (14)", "6.38")}${celda("Forward P/E", "35.14")}${celda("Rel Volume", "0.37")}${celda("Volatility", "1.67% 1.84%")}${celda("Sales past 3/5Y", "1.81% 8.20%")}${celda("PEG", "2.75")}</tr></table>`;
const d = parseFinvizHtml(nuevo);
check("formato 2026: Inst Own", d.instOwn, 0.6895);
check("formato 2026: ATR (14)", d.atr, 6.38);
check("formato 2026: Forward P/E", d.forwardPe, 35.14);
check("formato 2026: Rel Volume", d.relVolume, 0.37);
check("formato 2026: Volatility, el primero", d.volatility14d, 0.0167);
check("formato 2026: Sales past 3/5Y → el de 3 años", d.salesGrowth3Y, 0.0181);

// Formato anterior: <b>LABEL</b></td><td>VALOR</td>.
const antiguo = `<table><tr><td class="snapshot-td2"><b>Inst Own</b></td><td class="snapshot-td2">61.20%</td><td><b>ATR</b></td><td>4.10</td><td><b>Fwd P/E</b></td><td>28.0</td><td><b>PEG</b></td><td>2.1</td><td><b>Beta</b></td><td>1.10</td><td><b>ROE</b></td><td>150.0%</td></tr></table>`;
const a = parseFinvizHtml(antiguo);
check("formato anterior sigue funcionando: Inst Own", a.instOwn, 0.612);
check("formato anterior: ATR", a.atr, 4.1);
check("formato anterior: Fwd P/E", a.forwardPe, 28);

check("página sin tabla → {} (y el servidor lo avisa en Sentry)", Object.keys(parseFinvizHtml("<html>captcha</html>")).length, 0);

console.log(bad ? `\n✗ finviz: ${bad} fallo(s) de ${total}` : `\n✓ finviz: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
