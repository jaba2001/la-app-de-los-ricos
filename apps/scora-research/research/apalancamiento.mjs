// ─────────────────────────────────────────────────────────────────────────────
// LA VÍA QUE NO HEMOS PROBADO: CONVERTIR LA VENTAJA DE RIESGO EN VENTAJA DE RETORNO
//
// Alejandro insiste, y tiene razón en algo: 343 ensayos no prueban que sea imposible. Prueban
// que no lo hemos encontrado POR DONDE HEMOS BUSCADO — y hemos buscado casi siempre en el mismo
// sitio: mejores señales de SELECCIÓN. El IC es 0,007 y Brinson dice 96/4. Ahí no está.
//
// Pero hay una vía elemental que este repo NO ha probado, y que no es un truco:
//
//   **Un Sharpe superior significa, literalmente, más retorno por unidad de riesgo. Si igualas
//   el riesgo, el retorno superior aparece solo.**
//
// Scora hace 652,6 % con una caída máxima del −16,2 %. El S&P hace 668,4 % con un −50,7 %.
// Scora no pierde por ser peor: pierde por llevar MENOS RIESGO. Igualar la volatilidad no es
// hacer trampa, es la definición de para qué sirve el ratio de Sharpe.
//
// ⚠️ Y NO ES GRATIS, POR ESO SE MIDE EN VEZ DE AFIRMARSE:
//   · El apalancamiento tiene un COSTE de financiación. Aquí se cobra la letra a 3 meses real.
//   · Multiplica la caída máxima por el mismo factor. Un −16 % al 1,8x es un −29 %.
//   · Y multiplica los huecos: un mercado que abre un 20 % abajo no te deja deshacer.
//
// Se prueban tres formas, de la más ingenua a la más honesta, y la diferencia entre ellas ES
// el resultado:
//   A. Apalancamiento FIJO al factor que iguala la volatilidad ex-post. Mira el futuro: es la
//      cota superior, no una estrategia.
//   B. Apalancamiento fijo elegido con los primeros 5 años y aplicado al resto. Sin mirar.
//   C. Apalancamiento por volatilidad OBJETIVO, recalculado cada mes con datos pasados.
//
//   node --experimental-strip-types --no-warnings research/apalancamiento.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sharpe, maxDrawdown, annualVol } from "../lib/riskMetrics.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(AQUI, "out", "growth_series.json"), "utf8"));
const fechas = G.fechas;
const est = G.estrategias;
// ⚠️ EL ARTEFACTO DECLARA SUS UNIDADES Y HAY QUE LEERLAS. `growth_series.json` guarda
// «retornos MENSUALES en PORCENTAJE», y mi primera version los componia como decimales: salio
// un total de 1,04e+77 % y una volatilidad del 1.076 %. Cifras tan absurdas que se ven, pero el
// mismo error con numeros plausibles pasa desapercibido — como paso con CSUSHPINSA en pc1.
if (!/PORCENTAJE/i.test(G.unidades ?? "")) {
  console.error(`
  ⛔ el artefacto no declara retornos en porcentaje: unidades = ${G.unidades}
`);
  process.exit(1);
}
const aDecimal = (a) => a.map((x) => x / 100);
const scora = aDecimal(est.growth?.rets ?? []), spy = aDecimal(est.spy?.rets ?? []);
if (!Array.isArray(scora) || !Array.isArray(spy)) { console.error("\n  ⛔ sin series\n"); process.exit(1); }

// El coste de financiación: la letra a 3 meses REAL, no cero. Apalancarse cuesta.
const rfPath = join(AQUI, ".cache", "fredfull", "TB3MS.json");
let rf = null;
if (existsSync(rfPath)) { try { rf = JSON.parse(readFileSync(rfPath, "utf8")); } catch { /* sin rf */ } }
const rfEn = (d) => { if (!rf) return 0; const h = rf.filter((o) => o.date <= d); return h.length ? h.at(-1).v / 100 / 12 : 0; };

const total = (r) => (r.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
const resumen = (r, nombre) => ({ nombre, total: +total(r).toFixed(1), cagr: +(((Math.pow(1 + total(r) / 100, 12 / r.length) - 1) * 100)).toFixed(2),
  sharpe: +sharpe(r).toFixed(3), vol: +annualVol(r).toFixed(3), maxDD: +(maxDrawdown(r) * 100).toFixed(1) });   // maxDrawdown devuelve FRACCION

/** Aplica apalancamiento `L` (constante o serie) cobrando la financiación del exceso. */
const apalancar = (r, L) => r.map((x, i) => {
  const l = typeof L === "number" ? L : L[i];
  return l * x - (l - 1) * rfEn(fechas[i]);
});

console.log(`\n  ¿SE PUEDE BATIR AL ÍNDICE IGUALANDO EL RIESGO?`);
console.log(`  ${scora.length} meses · ${fechas[0]} → ${fechas.at(-1)} · financiación al tipo real de la letra a 3 meses\n`);

const base = [resumen(scora, "Scora (como está)"), resumen(spy, "S&P 500 (SPY)")];

// ── A · El factor que iguala la volatilidad EX-POST. Cota superior, no estrategia ────────
const volS = annualVol(scora), volM = annualVol(spy);
const Lex = volM / volS;
const A = apalancar(scora, Lex);

// ── B · Elegido con los PRIMEROS 5 años, aplicado al resto. Sin mirar el futuro ──────────
const corte = 60;
const Lin = annualVol(spy.slice(0, corte)) / annualVol(scora.slice(0, corte));
const B = apalancar(scora.slice(corte), Lin);
const spyB = spy.slice(corte);

// ── C · Volatilidad objetivo, recalculada cada mes con los 36 anteriores ─────────────────
const OBJ = volM;               // objetivo = la volatilidad del indice, declarada
const TOPE = 2.0;               // tope de apalancamiento, declarado antes
const Lserie = scora.map((_, i) => {
  if (i < 36) return 1;
  const v = annualVol(scora.slice(i - 36, i));
  return v <= 0 ? 1 : Math.min(TOPE, OBJ / v);
});
const C = apalancar(scora, Lserie);

const filas = [...base,
  resumen(A, `A · fijo ${Lex.toFixed(2)}x (ex-post, MIRA EL FUTURO)`),
  resumen(B, `B · fijo ${Lin.toFixed(2)}x elegido con 5 años`),
  resumen(C, `C · volatilidad objetivo, tope ${TOPE}x`)];

console.log(`  estrategia                              total      CAGR    Sharpe    vol     caída máx`);
for (const f of filas)
  console.log(`  ${f.nombre.padEnd(38)}${(f.total + " %").padStart(9)}  ${(f.cagr + " %").padStart(7)}   ${String(f.sharpe).padStart(6)}  ${(f.vol * 100).toFixed(1).padStart(5)} %  ${(f.maxDD + " %").padStart(8)}`);

// La comparación honesta de B es contra el SPY DE SU MISMO TRAMO, no contra el total.
console.log(`\n  ⚠️ B empieza en ${fechas[corte]}, así que su comparación es contra el SPY de ESE tramo:`);
console.log(`     B ${total(B).toFixed(1)} %   ·   SPY del mismo tramo ${total(spyB).toFixed(1)} %   ⇒ ${total(B) > total(spyB) ? "BATE" : "no bate"}`);

const veredicto = {
  A: { bate: total(A) > total(spy), nota: "MIRA EL FUTURO: es la cota superior de lo que el Sharpe permite, no una estrategia" },
  B: { bate: total(B) > total(spyB), nota: "sin mirar el futuro: el factor sale de los primeros 5 años" },
  C: { bate: total(C) > total(spy), nota: "volatilidad objetivo con ventana movil, tope declarado" },
};
console.log(`\n  VEREDICTO`);
for (const [k, v] of Object.entries(veredicto)) console.log(`    ${k}: ${v.bate ? "BATE al índice" : "no bate"}   — ${v.nota}`);

console.log(`\n  ⚠️ Y LO QUE CUESTA, que es la mitad de la respuesta:`);
const cAB = filas.find((f) => f.nombre.startsWith("C ·"));
console.log(`     la caída máxima de Scora pasa de ${base[0].maxDD} % a ${cAB.maxDD} % en el escenario C.`);
console.log(`     Apalancarse NO crea retorno: convierte la ventaja de RIESGO en ventaja de RETORNO,`);
console.log(`     y el precio es exactamente el riesgo que se dejó de llevar. Quien no aguantaba un`);
console.log(`     -50 % del índice tampoco aguanta esto — es OTRO producto, para otra persona.`);
console.log(`     Además: los huecos no se pueden deshacer, y la financiación aquí es la letra a 3`);
console.log(`     meses, que es el suelo optimista de lo que un minorista paga de verdad.\n`);

writeFileSync(join(AQUI, "out", "apalancamiento.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: scora.length, desde: fechas[0], hasta: fechas.at(-1),
  factorExPost: +Lex.toFixed(3), factorInSample5a: +Lin.toFixed(3), volObjetivo: +OBJ.toFixed(3), tope: TOPE,
  filas, veredicto,
  limitacion: "El apalancamiento no crea retorno: convierte ventaja de riesgo en ventaja de retorno. Multiplica la caida maxima por el mismo factor y no protege de los huecos. La financiacion usada es la letra a 3 meses real, que es el suelo de lo que paga un minorista.",
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/apalancamiento.json\n`);
