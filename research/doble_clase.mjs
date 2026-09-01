// ─────────────────────────────────────────────────────────────────────────────
// LA MISMA EMPRESA DOS VECES EN LA CARTERA
//
// ⚠️ ENCONTRADO EL 2026-09-01, y estaba en producción.
//
// El backtest tiene a GOOG y GOOGL **a la vez** desde el 2021-10-01 hasta el cierre de la
// ventana: casi cinco años con dos posiciones en Alphabet. En una cartera de 40 nombres eso es
// un 5 % en una sola empresa donde el diseño implica 2,5 %, y en ningún sitio se declara.
//
// No es un fallo de datos: los dos tickers existen, cotizan y puntúan. Es que la regla cuenta
// POSICIONES y el diseño quiere decir EMPRESAS. Nadie eligió doblar Alphabet.
//
// Cuánto vale, medido quitando uno de los dos del universo: la ventana reciente pasa de
// +216,6 % a +209,8 %, y la ventaja contra el universo equiponderado de +44,3 pp a +37,5 pp.
// Es decir, unos SIETE PUNTOS del margen publicado venían de tener Alphabet dos veces.
//
// El universo trae tres casos de doble clase viva —GOOG+GOOGL las 182 fechas, UA+UAA en 84,
// DISCA+DISCK+WBD en 79— y diecisiete parejas más que son renombres y nunca coexisten (FB→META,
// COG→CTRA, ANTM→ELV…), ésas bien tratadas.
//
// ESTO SÓLO MIDE Y AVISA. Deduplicar cambia qué se compra, o sea la estrategia, y eso exige una
// `PICKS_RULES_VERSION` nueva y un criterio escrito antes. No lo decide quien escribe el código.
//
//   node --experimental-strip-types --no-warnings research/doble_clase.mjs [--long]
//
// Sale con código 1 si la cartera llegó a tener dos clases de la misma empresa a la vez.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik } from "./edgar.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const LONG = process.argv.includes("--long");
const RUTA = join(OUT, `picks_rules_backtest${LONG ? "_oos" : ""}.json`);

if (!existsSync(RUTA)) {
  console.error(`\n  ⚠ falta ${RUTA} — corre antes el backtest.\n`);
  process.exit(1);
}
const art = JSON.parse(readFileSync(RUTA, "utf8"));
const ops = art.operaciones ?? [];
if (!ops.length) { console.error("\n  ⚠ el artefacto no trae operaciones.\n"); process.exit(1); }

// Emisor de cada ticker. Un fallo de resolución NO se convierte en «no es duplicado»: se cuenta
// aparte, porque dar por bueno lo que no se ha podido comprobar es el error de esta semana.
const porCik = new Map();
const sinResolver = [];
for (const t of [...new Set(ops.map((o) => o.t))].sort()) {
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* se cuenta abajo */ }
  if (!cik) { sinResolver.push(t); continue; }
  if (!porCik.has(cik)) porCik.set(cik, []);
  porCik.get(cik).push(t);
}

const solapan = [];
for (const [cik, tickers] of porCik) {
  if (tickers.length < 2) continue;
  for (let i = 0; i < tickers.length; i++) {
    for (let k = i + 1; k < tickers.length; k++) {
      for (const a of ops.filter((o) => o.t === tickers[i])) {
        for (const b of ops.filter((o) => o.t === tickers[k])) {
          if (a.desde < b.hasta && b.desde < a.hasta) {
            const desde = a.desde > b.desde ? a.desde : b.desde;
            const hasta = a.hasta < b.hasta ? a.hasta : b.hasta;
            solapan.push({ cik, a: tickers[i], b: tickers[k], desde, hasta, retA: a.retorno, retB: b.retorno });
          }
        }
      }
    }
  }
}

console.log(`\n  LA MISMA EMPRESA DOS VECES · ${art.window ?? (LONG ? "2011-2018" : "2019-2026")}\n`);
console.log(`  ${ops.length} posiciones · ${porCik.size} emisores distintos${sinResolver.length ? ` · ${sinResolver.length} tickers sin CIK (${sinResolver.slice(0, 8).join(" ")})` : ""}`);

if (!solapan.length) {
  console.log(`\n  ✅ ninguna pareja de la misma empresa se tuvo a la vez.\n`);
  process.exit(0);
}

console.log(`\n  ⛔ ${solapan.length} solape(s): dos clases del mismo emisor en cartera al mismo tiempo\n`);
for (const s of solapan) {
  const dias = Math.round((Date.parse(s.hasta) - Date.parse(s.desde)) / 86400000);
  console.log(`    ${s.a} + ${s.b}  (CIK ${s.cik})   ${s.desde} → ${s.hasta}   ${dias} días juntas   retornos ${s.retA} % y ${s.retB} %`);
}
console.error(`
  Cada solape es una empresa con DOBLE peso en una cartera que promete 40 posiciones
  diversificadas. Deduplicar cambia qué se compra —es estrategia, no un arreglo— y exige
  \`PICKS_RULES_VERSION\` nueva con su criterio escrito antes. Ver PLAN_FALLOS_PENDIENTES.md §1.
`);
process.exit(1);
