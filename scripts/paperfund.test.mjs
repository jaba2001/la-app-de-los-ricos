// ─────────────────────────────────────────────────────────────────────────────
// GUARDA DEL PAPER FUND · que no se vuelva a medir un tramo que el fondo no vivió
//
// POR QUÉ EXISTE. `paperfund_measure.mjs` publicó durante semanas un exceso de +0,59 pp
// sobre el índice que era ENTERAMENTE un artefacto, por dos defectos que se sumaban:
//
//   1. `monthGrid` hacía `d.setUTCDate(1)`, así que con un inicio el 2026-07-09 la rejilla
//      arrancaba el 2026-07-01: ocho días en los que el fondo NO EXISTÍA.
//   2. `weightsAsOf` empezaba con `let w = rebs[0].weights`, de modo que en ese tramo
//      fantasma devolvía los pesos del primer rebalanceo — una cartera multiactivo que el
//      fondo tuvo UN SOLO DÍA antes de irse a 100 % SPY.
//
//   El resultado: todo el exceso salía de un tramo anterior al nacimiento del fondo, medido
//   con unos pesos que casi nunca tuvo. Con las decisiones tal y como se sellaron, el fondo
//   iba por DETRÁS del índice. Ninguna prueba lo cazó porque no había ninguna.
//
// CÓMO PRUEBA. Extrae las dos funciones del fuente y las EJECUTA. No compara prosa ni
// comentarios: este proyecto ya tuvo guardas que pasaban en verde comparando texto.
// Y termina con un CONTROL POSITIVO que reconstruye la rejilla defectuosa y exige que la
// guarda la rechace — si el control no fallara, la guarda no estaría vigilando nada.
//
//   node --experimental-strip-types --no-warnings scripts/paperfund.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";

const FUENTE = readFileSync(new URL("../research/paperfund_measure.mjs", import.meta.url), "utf8");

let ok = 0, fallos = 0;
const comprobar = (que, cond) => { if (cond) { ok++; } else { fallos++; console.error(`  ✗ ${que}`); } };
const debeLanzar = (que, fn) => {
  try { fn(); fallos++; console.error(`  ✗ ${que} — NO lanzó, y debía`); }
  catch { ok++; }
};

// ── Extracción: sacamos las funciones reales del fuente y las hacemos ejecutables ────────
function extraer(nombre, desde) {
  const i = FUENTE.indexOf(desde);
  if (i < 0) throw new Error(`no encuentro «${desde}» en paperfund_measure.mjs — ¿se renombró ${nombre}?`);
  // Recorta desde el inicio de la declaración hasta que las llaves se equilibran.
  let prof = 0, j = i, visto = false;
  for (; j < FUENTE.length; j++) {
    const c = FUENTE[j];
    if (c === "{") { prof++; visto = true; }
    else if (c === "}") { prof--; if (visto && prof === 0) { j++; break; } }
  }
  return FUENTE.slice(i, j);
}

const src = extraer("gridDeMedicion", "function gridDeMedicion") + "\n" +
            extraer("pesosEn", "const pesosEn =") + ";\n" +
            "return { gridDeMedicion, pesosEn };";
const { gridDeMedicion, pesosEn } = new Function(src)();

// ── El caso real que produjo la cifra falsa ─────────────────────────────────────────────
const REBS = [
  { rebalance_date: "2026-07-09", weights: { SPY: 0.4228, TLT: 0.1477, IEF: 0.1318, DBC: 0.1182, GLD: 0.0977, BIL: 0.0818 } },
  { rebalance_date: "2026-07-10", weights: { SPY: 1 } },
  { rebalance_date: "2026-07-11", weights: { SPY: 1 } },
  { rebalance_date: "2026-08-01", weights: { SPY: 1 } },
  { rebalance_date: "2026-09-01", weights: { SPY: 1 } },
];
const INICIO = REBS[0].rebalance_date, HOY = "2026-09-04";
const grid = gridDeMedicion(REBS, INICIO, HOY);

console.log("\n  GUARDA DEL PAPER FUND\n");

// 1. Lo que rompió: la rejilla no puede empezar antes de que el fondo exista.
comprobar("la rejilla arranca en el inicio real del fondo, no el día 1 del mes", grid[0] === INICIO);
comprobar("ninguna fecha de la rejilla es anterior al inicio", grid.every((d) => d >= INICIO));
comprobar("la rejilla no se sale por el otro lado", grid.every((d) => d <= HOY));
comprobar("la rejilla termina hoy", grid[grid.length - 1] === HOY);

// 2. Los rebalanceos intramensuales tienen que estar, o se mide con pesos que no se tuvieron.
for (const r of REBS) comprobar(`la rejilla contiene el rebalanceo del ${r.rebalance_date}`, grid.includes(r.rebalance_date));

// 3. Orden y unicidad.
comprobar("la rejilla está ordenada", grid.every((d, i) => i === 0 || grid[i - 1] < d));
comprobar("la rejilla no repite fechas", new Set(grid).size === grid.length);

// 4. Los pesos: el fondo estuvo en multiactivo UN día, y en 100 % SPY el resto.
comprobar("el 09-jul rigen los pesos multiactivo", pesosEn(REBS, "2026-07-09").SPY === 0.4228);
comprobar("el 10-jul ya rige 100 % SPY", pesosEn(REBS, "2026-07-10").SPY === 1);
comprobar("a mitad de agosto sigue 100 % SPY", pesosEn(REBS, "2026-08-15").SPY === 1);

// 5. El defecto exacto: pedir pesos ANTES del nacimiento tiene que fallar ruidosamente.
debeLanzar("pedir pesos del 2026-07-01 (antes del inicio) lanza", () => pesosEn(REBS, "2026-07-01"));
debeLanzar("pedir pesos de un año antes lanza", () => pesosEn(REBS, "2025-07-09"));

// ── CONTROL POSITIVO ────────────────────────────────────────────────────────────────────
// Reconstruimos la rejilla DEFECTUOSA (la que se publicó) y exigimos que estas mismas
// comprobaciones la rechacen. Si esto no fallara, la guarda no estaría vigilando nada.
function gridDefectuosa(fromISO, toISO) {
  const out = [];
  const d = new Date(fromISO + "T00:00:00Z"); d.setUTCDate(1);
  const end = new Date(toISO + "T00:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); }
  if (out[out.length - 1] !== toISO) out.push(toISO);
  return out;
}
const mala = gridDefectuosa(INICIO, HOY);
const cazada = mala[0] !== INICIO || mala.some((d) => d < INICIO) || !REBS.every((r) => mala.includes(r.rebalance_date));
comprobar("CONTROL POSITIVO · la guarda caza la rejilla que publicó la cifra falsa", cazada);
comprobar("CONTROL POSITIVO · y la rejilla mala empezaba de verdad el 2026-07-01", mala[0] === "2026-07-01");

// El control positivo del otro defecto: la versión antigua NO lanzaba, devolvía una cartera.
const pesosEnAntiguo = (rebs, date) => { let w = rebs[0].weights; for (const r of rebs) { if (r.rebalance_date <= date) w = r.weights; else break; } return w; };
comprobar("CONTROL POSITIVO · la versión antigua inventaba pesos antes del inicio (por eso el fallo)",
  pesosEnAntiguo(REBS, "2026-07-01").SPY === 0.4228);

console.log(`\n  ${ok} comprobaciones OK${fallos ? ` · ${fallos} FALLOS` : ""}\n`);
process.exit(fallos ? 1 : 0);
