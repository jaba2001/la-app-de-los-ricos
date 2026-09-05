// ─────────────────────────────────────────────────────────────────────────────
// DISTRIBUCIONES SECTORIALES HISTÓRICAS — la pieza que faltaba para poder VALIDAR el
// score v2 (percentiles sector-relativos) sin hacer trampa.
//
// El problema que resuelve: `factor_dist.json` son los cuantiles de HOY. Usarlos para
// puntuar 2015 sería look-ahead descarado — estaríamos juzgando aquel mercado con los
// múltiplos de éste, y un backtest así diría que v2 es maravilloso por construcción.
// Esto calcula los cuantiles COMO ERAN en cada fecha, usando sólo fundamentales y precios
// disponibles entonces (EDGAR as-of + membresía point-in-time del índice).
//
// Cadencia SEMESTRAL, no mensual, y es una decisión deliberada: son fundamentales
// trimestrales y los cuantiles sectoriales se mueven despacio, así que recalcularlos cada
// mes multiplicaría por 6 el coste de EDGAR para cambiar la cuarta cifra. El consumidor
// coge siempre la tabla más reciente ANTERIOR a su fecha, que es lo que mantiene el
// point-in-time: nunca se usa una distribución que aún no existía.
//
//   node --experimental-strip-types --no-warnings research/factor_dist_history.mjs [--from 2015-01-01] [--cap 400]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf, CURATED } from "./universe.mjs";
import { collectRows, buildDist } from "./factorDistCore.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const FILE = join(OUT, "factor_dist_history.json");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = arg("--from", "2015-01-01");
const CAP = Number(arg("--cap", "400"));
const today = new Date().toISOString().slice(0, 10);

// Fechas semestrales desde FROM hasta hoy.
const fechas = [];
{
  let d = FROM.slice(0, 8) + "01";
  while (d <= today) {
    fechas.push(d);
    const x = new Date(d + "T00:00:00Z");
    x.setUTCMonth(x.getUTCMonth() + 6);
    d = x.toISOString().slice(0, 10);
  }
}

// Reanudable: cada fecha tarda, así que si el proceso se corta no se tira el trabajo hecho.
let historia = {};
if (existsSync(FILE)) {
  try { historia = JSON.parse(readFileSync(FILE, "utf8")).history ?? {}; } catch { historia = {}; }
}

const table = await loadSP500Historical();
const sectorCache = new Map();   // el sector no cambia entre fechas: una sola consulta por nombre
console.log(`\n  FACTOR DIST HISTÓRICO · ${fechas.length} fechas semestrales ${fechas[0]} → ${fechas.at(-1)}\n`);

for (const fecha of fechas) {
  if (historia[fecha]) { console.log(`  ${fecha}  (ya calculada, se reutiliza)`); continue; }
  // Miembros del índice EN ESA FECHA — no los de hoy. Es la mitad del point-in-time.
  let miembros = table ? [...new Set(membersAsOf(table, fecha) || [])] : CURATED;
  // ⚠️ NO truncar: `membersAsOf` devuelve los tickers EN ORDEN ALFABÉTICO, así que un
  // slice(0, N) borraba sistemáticamente de la S a la Z — 99 nombres en 2020, entre ellos
  // UnitedHealth, Visa, Walmart, Exxon, Verizon y Wells Fargo. Un universo truncado por la
  // inicial no es "el S&P 500". Si hace falta limitar por coste, se limita por FRECUENCIA
  // de pertenencia (como los labs de momentum), nunca por orden alfabético.
  if (CAP > 0 && miembros.length > CAP) {
    console.log(`  ⚠ CAP=${CAP} ignorado: truncar por orden alfabético sesgaría el universo. Usando los ${miembros.length} miembros.`);
  }
  const filas = await collectRows(miembros, fecha, sectorCache);
  if (filas.length < 30) { console.log(`  ${fecha}  sólo ${filas.length} nombres → se omite`); continue; }
  const dist = buildDist(filas);
  historia[fecha] = dist;
  const pe = dist.ALL?.pe;
  console.log(`  ${fecha}  ${String(filas.length).padStart(3)} nombres · ${Object.keys(dist).length - 1} sectores · PER mediano del mercado ${pe ? pe.q[4].toFixed(1) : "—"}`);
  writeFileSync(FILE, JSON.stringify({ generatedAt: new Date().toISOString(), from: FROM, cap: CAP, dates: Object.keys(historia).sort(), history: historia }));
}

const fechasOk = Object.keys(historia).sort();
console.log(`\n  ${fechasOk.length} distribuciones históricas · ${fechasOk[0]} → ${fechasOk.at(-1)}`);
console.log(`  → escrito research/out/factor_dist_history.json\n`);
