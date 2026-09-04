// ─────────────────────────────────────────────────────────────────────────────
// UNA CUARTA VÍA PARA EL RESULTADO DE EXPLOTACIÓN: `Ingresos − CostesYGastos`
//
// DE DÓNDE SALE. 148 de 502 miembros del índice (29,5 %) no llegan al mínimo de 3 de 5
// métricas, y a 117 de ellos les falta `oiTTM`, del que cuelgan cuatro de las cinco. Las vías
// ya estudiadas se agotaron:
//
//   · `pretax + intereses`      RECHAZADA por el criterio preescrito: desvío mediano 7,6 % y
//                               36,1 pp de dispersión entre sectores. El sesgo depende del
//                               sector, así que no se puede corregir.
//   · `bruto − gastos opex`     ACEPTADA e IMPLEMENTADA, pero rescata poco: los que no
//                               etiquetan `OperatingIncomeLoss` tampoco etiquetan
//                               `OperatingExpenses`. Comprobado en JNJ, XOM, IBM, CVX, PFE,
//                               LLY, MRK, COP, AXP, ADM, ADP y BMY: los doce dan `null`.
//
// LA OBSERVACIÓN QUE ABRE ESTA CUARTA. Mirando qué etiquetan de verdad en los ficheros
// cacheados, **XOM publica `CostsAndExpenses`** — el total de la sección de explotación. Con
// eso, `Ingresos − CostesYGastos` ES el resultado de explotación, y —esto es lo que la
// distingue de la vía pretax— **se queda dentro de la sección de explotación**, así que no
// arrastra ingresos financieros ni impuestos. Es la misma familia aritmética que la vía ya
// aceptada, no una aproximación de otra magnitud.
//
// (Contraejemplo, para no sobrevender: IBM sólo etiqueta
// `DisposalGroupIncludingDiscontinuedOperationOperatingIncomeLoss`, que es de operaciones
// discontinuadas y no sirve. Y JNJ sí tiene `OperatingIncomeLoss`, pero es el que murió en
// 2015: ahí el problema es de FRESCURA, no de ausencia, y se trata aparte.)
//
// EL CRITERIO, ESCRITO ANTES DE MIRAR — el mismo que rechazó la vía pretax, sin cambiar un
// número, porque cambiar el listón después de ver el resultado es la forma más fácil de
// aprobar lo que uno quiere aprobar:
//
//     se acepta si el desvío mediano absoluto es < 5 %
//     Y la diferencia entre el desvío mediano del mejor y del peor sector es < 5 pp
//
// «No se puede» sigue siendo un desenlace válido.
//
//   node --experimental-strip-types --no-warnings research/ebit_costes_gastos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const ASOF = "2026-06-30";

const CRITERIO = { medianaAbsMax: 5, dispersionSectorialMax: 5, escritoAntesDeMirar: true };

const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Lee los facts cacheados en disco. Sin red: si no está cacheado, ese nombre no entra. */
function factsDe(cik) {
  const f = join(AQUI, ".cache", `CIK${cik}.json`);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

/**
 * Último valor ANUAL de un tag, con su cierre. Se exige `form` 10-K y unidad USD.
 * ⚠️ Se queda con el hecho de cierre MÁS RECIENTE, no con el primero que aparezca: elegir por
 * orden de lista es el defecto que dio a Amazon 5 B$ de inversión en vez de 132.
 */
function ultimoAnual(facts, tag) {
  const u = facts?.facts?.["us-gaap"]?.[tag]?.units?.USD;
  if (!Array.isArray(u)) return null;
  let mejor = null;
  for (const o of u) {
    if (o.form !== "10-K" || !o.end || !o.start) continue;
    const dias = (new Date(o.end) - new Date(o.start)) / 86400000;
    if (dias < 300 || dias > 400) continue;         // sólo ejercicios completos
    if (o.end > ASOF) continue;                      // point-in-time
    if (!mejor || o.end > mejor.end) mejor = { val: o.val, end: o.end };
  }
  return mejor;
}

const REV = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"];

const tabla = await loadSP500Historical();
const miembros = [...new Set(membersAsOf(tabla, ASOF) || [])];
console.log(`\n  VÍA «INGRESOS − COSTES Y GASTOS» · ${ASOF} · ${miembros.length} miembros`);
console.log(`  criterio escrito ANTES: desvío mediano < ${CRITERIO.medianaAbsMax} % y dispersión sectorial < ${CRITERIO.dispersionSectorialMax} pp\n`);

const validacion = [], rescatables = [];
for (const t of miembros) {
  try {
    const cik = await tickerToCik(t); if (!cik) continue;
    const facts = factsDe(cik); if (!facts) continue;
    const cye = ultimoAnual(facts, "CostsAndExpenses"); if (!cye) continue;
    let rev = null;
    for (const r of REV) { const v = ultimoAnual(facts, r); if (v && (!rev || v.end > rev.end)) rev = v; }
    if (!rev || rev.end !== cye.end) continue;             // mismos cierres o no se usa
    const reconstruido = rev.val - cye.val;
    const oi = ultimoAnual(facts, "OperatingIncomeLoss");
    const sector = (await sicSector(cik)) || "(sin sector)";

    if (oi && oi.end === cye.end && Math.abs(oi.val) > 1e6) {
      // Publica las dos cosas: sirve para VALIDAR el desvío.
      validacion.push({ t, sector, real: oi.val, reconstruido, desvio: (reconstruido - oi.val) / Math.abs(oi.val) * 100 });
    } else {
      // No publica OI utilizable: es candidato a RESCATE.
      const f = await fundamentalsAsOf(cik, ASOF);
      if (f && f.oiTTM == null) rescatables.push({ t, sector, reconstruido, cierre: cye.end });
    }
  } catch { /* saltar */ }
}

// ── Validación del desvío ───────────────────────────────────────────────────────────────
const desvios = validacion.map((v) => Math.abs(v.desvio));
const medAbs = mediana(desvios);
const porSector = {};
for (const v of validacion) { (porSector[v.sector] ??= []).push(Math.abs(v.desvio)); }
const medSector = Object.entries(porSector).filter(([, a]) => a.length >= 3)
  .map(([s, a]) => ({ sector: s, n: a.length, mediana: +mediana(a).toFixed(1) })).sort((a, b) => a.mediana - b.mediana);
const dispersion = medSector.length ? +(medSector.at(-1).mediana - medSector[0].mediana).toFixed(1) : null;

console.log(`  VALIDACIÓN · ${validacion.length} empresas publican AMBAS cosas`);
console.log(`     desvío mediano absoluto: ${medAbs?.toFixed(1) ?? "—"} %   (listón: < ${CRITERIO.medianaAbsMax} %)`);
console.log(`     dentro del ±5 %: ${desvios.filter((d) => d <= 5).length} de ${desvios.length}  (${(desvios.filter((d) => d <= 5).length / desvios.length * 100).toFixed(0)} %)`);
console.log(`     dispersión sectorial: ${dispersion ?? "—"} pp   (listón: < ${CRITERIO.dispersionSectorialMax} pp)`);
if (medSector.length) {
  console.log(`\n     por sector (n≥3):`);
  for (const s of medSector) console.log(`       ${s.sector.padEnd(26)}${String(s.n).padStart(4)}${(s.mediana + " %").padStart(9)}`);
}

const pasa = medAbs != null && medAbs < CRITERIO.medianaAbsMax && dispersion != null && dispersion < CRITERIO.dispersionSectorialMax;
console.log(`\n  ⇒ ${pasa ? "PASA el criterio" : "NO PASA el criterio"}`);
console.log(`  ⇒ RESCATARÍA ${rescatables.length} nombres que hoy no tienen resultado de explotación`);
if (rescatables.length) console.log(`     ${rescatables.slice(0, 16).map((r) => r.t).join(" ")}${rescatables.length > 16 ? " …" : ""}`);
if (!pasa) console.log(`\n  ⚠️ No pasa: NO se implementa como sustituto silencioso. El hueco de cobertura conocido`);
if (!pasa) console.log(`     es preferible a una cobertura sesgada, que es la conclusión que ya cerró la vía pretax.`);

writeFileSync(join(OUT, "ebit_costes_gastos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), fuente: "research/ebit_costes_gastos.mjs", asOf: ASOF,
  criterio: CRITERIO, veredicto: pasa ? "PASA" : "NO PASA",
  validacion: { n: validacion.length, medianaAbs: medAbs != null ? +medAbs.toFixed(1) : null,
    dentroDel5: desvios.filter((d) => d <= 5).length, dispersionSectorial: dispersion, porSector: medSector },
  rescataria: rescatables.length, rescatables: rescatables.map((r) => ({ t: r.t, sector: r.sector, cierre: r.cierre })),
  nota: "Cuarta via. Se distingue de la via pretax RECHAZADA en que se queda DENTRO de la seccion de explotacion: no arrastra ingresos financieros ni impuestos. El criterio es el mismo que rechazo aquella, sin cambiar un numero.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/ebit_costes_gastos.json\n`);
