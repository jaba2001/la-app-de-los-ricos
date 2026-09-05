// ─────────────────────────────────────────────────────────────────────────────
// ¿PARA CUÁNTAS EMPRESAS SE PUEDE DIBUJAR EL FLUJO, Y CON CUÁNTO DETALLE?
//
// Fase 4 del roadmap. Mide la cobertura REAL —con el extractor, no con las etiquetas crudas de
// `companyfacts`— y produce el artefacto que consume la página.
//
// ⚠️ LA MEDICIÓN ANTERIOR ERA SOBRE OTRA COSA. En `PLAN_CAPACIDADES_SCORA.md` medí 93 % / 48 % / 24 %
// mirando qué ETIQUETAS existen en `companyfacts`. Eso no es lo mismo que lo que el extractor
// produce: el TTM se alinea, se rellenan huecos y se descartan periodos inconsistentes. Al
// probarlo salió que `NVDA` tiene el desglose de costes completo y `AMC` no lo tiene — **al revés
// de lo que sugerían las etiquetas**. Esto vuelve a medir sobre lo que de verdad se puede dibujar.
//
//   node --max-old-space-size=8192 --experimental-strip-types --no-warnings research/sankey_universo.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { fundamentalsAsOf, tickerToCik } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { construirSankey, etiquetaDe } from "../lib/sankey.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const HOY = new Date().toISOString().slice(0, 10);

const tabla = await loadSP500Historical();
const asOf = snapshotDate(tabla);
const universo = membersAsOf(tabla, asOf);

console.log(`\n  FLUJO «CÓMO GANA DINERO X» · ${universo.length} miembros · fundamentales a ${HOY}\n`);

const porNivel = { completo: 0, minimo: 0, sin_datos: 0 };
let sinFundamentales = 0, descuadran = 0, pierden = 0;
const diagramas = [];
const malCuadre = [];
let n = 0;

for (const t of universo) {
  process.stdout.write(`  ${++n}/${universo.length}\r`);
  let f = null;
  try {
    const cik = await tickerToCik(t);
    if (cik) f = await fundamentalsAsOf(cik, HOY);
  } catch { /* se cuenta abajo */ }
  if (!f) { sinFundamentales++; continue; }

  const s = construirSankey(f);
  if (!s) { sinFundamentales++; continue; }

  porNivel[s.nivel]++;
  if (s.pierde) pierden++;
  if (!s.cuadre.ok) { descuadran++; malCuadre.push({ ticker: t, pct: s.cuadre.pct, nivel: s.nivel }); }

  diagramas.push({
    ticker: t, nivel: s.nivel, ingresos: s.ingresos, pierde: s.pierde,
    cuadre: s.cuadre, faltan: s.faltan, etiqueta: etiquetaDe(s),
    entradas: s.entradas, salidas: s.salidas,
  });
}
process.stdout.write("                    \r");

const con = diagramas.length;
console.log(`  con fundamentales: ${con}   ·   sin ellos: ${sinFundamentales}\n`);
console.log(`  ── COBERTURA REAL, medida con el extractor ──`);
console.log(`  completo (ingresos, coste, I+D, SG&A, resultado): ${porNivel.completo}/${con}  ${(100 * porNivel.completo / con).toFixed(0)} %`);
console.log(`  mínimo   (se dibuja, con menos detalle):          ${porNivel.minimo}/${con}  ${(100 * porNivel.minimo / con).toFixed(0)} %`);
console.log(`  sin datos (no se dibuja, y se dice):             ${porNivel.sin_datos}/${con}  ${(100 * porNivel.sin_datos / con).toFixed(0)} %`);
console.log(`\n  dibujables en total: ${porNivel.completo + porNivel.minimo}/${con}  ${(100 * (porNivel.completo + porNivel.minimo) / con).toFixed(0)} %`);
console.log(`  «cómo PIERDE dinero» (resultado neto negativo):   ${pierden}`);

// ⚠️ POR NIVEL, no agregado. Un `sin_datos` deja el 100 % sin desglosar POR DEFINICIÓN —no tiene
// salidas—, así que meterlo en la media da un 38 % que mezcla peras con manzanas. Lo que informa
// es cuánto hueco tienen los diagramas que SÍ se dibujan: 10,7 % en los completos, 38,4 % en los
// mínimos. Publicar la media habría dado una cifra que no describe a ninguno de los dos.
console.log(`\n  ── CUÁNTO QUEDA SIN DESGLOSAR (el diagrama siempre cierra: el hueco se dibuja) ──`);
for (const nivel of ["completo", "minimo", "sin_datos"]) {
  const g = diagramas.filter((d) => d.nivel === nivel);
  const mal = g.filter((d) => !d.cuadre.ok);
  const nota = nivel === "sin_datos" ? "   (por definición: no hay salidas que desglosar)" : "";
  console.log(`  ${nivel.padEnd(10)} ${String(g.length).padStart(3)} diagramas · con más del 2 % sin desglosar: ${String(mal.length).padStart(3)}  ${(100 * mal.length / (g.length || 1)).toFixed(1)} %${nota}`);
}
if (malCuadre.length) {
  for (const m of malCuadre.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 10)) {
    console.log(`    ${m.ticker.padEnd(6)} ${m.pct > 0 ? "+" : ""}${m.pct} %  (nivel ${m.nivel})`);
  }
  if (malCuadre.length > 10) console.log(`    … y ${malCuadre.length - 10} más`);
}

// Un ejemplo de cada tipo, para poder mirarlo a ojo.
const ejemplo = (pred, titulo) => {
  const d = diagramas.find(pred);
  if (!d) return;
  console.log(`\n  ── ${titulo}: ${d.ticker} ──`);
  console.log(`     ${d.etiqueta}`);
  const m = (x) => (Math.abs(x) >= 1e9 ? `${(x / 1e9).toFixed(1)} MM` : `${(x / 1e6).toFixed(0)} M`);
  for (const e of d.entradas) console.log(`     ← ${e.nombre.padEnd(34)} ${m(e.valor).padStart(10)}`);
  for (const s of d.salidas) console.log(`     → ${s.nombre.padEnd(34)} ${m(s.valor).padStart(10)}${s.clase === "perdida" ? "  (pérdida)" : ""}`);
  console.log(`       cuadre: ${d.cuadre.pct} %`);
};
ejemplo((d) => d.ticker === "NVDA", "Completo");
ejemplo((d) => d.pierde && d.nivel !== "sin_datos", "Cómo PIERDE dinero");
ejemplo((d) => d.nivel === "minimo" && !d.pierde, "Mínimo");

writeFileSync(join(OUT, "sankey_universo.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), universoAsOf: asOf, asOf: HOY,
  miembros: universo.length, conFundamentales: con, sinFundamentales,
  porNivel, dibujables: porNivel.completo + porNivel.minimo, pierden,
  descuadran: malCuadre,
  diagramas,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/sankey_universo.json\n`);
