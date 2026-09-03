// ─────────────────────────────────────────────────────────────────────────────
// CALIDAD DE LA CAJA — fase 1 del plan de las tres capas
//
// Aplica `lib/flujoCaja.ts` al universo y produce el artefacto: diagnóstico, banderas rojas y
// cuadre del destino de la caja para cada nombre.
//
// ⚠️ **LA CIFRA QUE HAY QUE MIRAR NO ES CUÁNTAS BANDERAS SALEN, SINO CUÁNTAS SON CREÍBLES.** Un
// detector que marca al 60 % del índice no está detectando nada: está describiendo el mercado. Si
// la tasa sale muy alta, el umbral está mal, no las empresas.
//
//   node --experimental-strip-types --no-warnings research/calidad_caja.mjs --n 60
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { diagnosticar, banderas, puente, destino, esFinanciera, UMBRALES } from "../lib/flujoCaja.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const iN = process.argv.indexOf("--n");
const N = iN >= 0 ? Number(process.argv[iN + 1]) : 60;
if (!Number.isInteger(N) || N < 1) { console.error("\n  ⛔ --n tiene que ser un entero >= 1\n"); process.exit(2); }
const ASOF = process.env.CF_ASOF || "2026-06-30";

const tabla = await loadSP500Historical();
const universo = [...membersAsOf(tabla, snapshotDate(tabla))].sort().slice(0, N);
console.log(`\n  CALIDAD DE LA CAJA · ${universo.length} nombres · datos a ${ASOF}\n`);

const filas = [];
for (const t of universo) {
  try {
    const cik = await tickerToCik(t);
    if (!cik) { filas.push({ ticker: t, estado: "sin CIK" }); continue; }
    const f = await fundamentalsAsOf(cik, ASOF);
    if (!f) { filas.push({ ticker: t, estado: "sin fundamentales" }); continue; }
    const sector = await sicSector(cik).catch(() => null);
    const fc = { ...f, sector };
    const d = diagnosticar(fc), b = banderas(fc, d), p = puente(f), s = destino(f);
    filas.push({
      ticker: t, estado: "ok", financiera: d.financiera, sector,
      diagnostico: {
        cashConversion: d.cashConversion == null ? null : +d.cashConversion.toFixed(3),
        margenCFO: d.margenCFO == null ? null : +d.margenCFO.toFixed(4),
        fcf: d.fcf, margenFCF: d.margenFCF == null ? null : +d.margenFCF.toFixed(4),
        capexSobreVentas: d.capexSobreVentas == null ? null : +d.capexSobreVentas.toFixed(4),
        crecimientoCFO: d.crecimientoCFO == null ? null : +d.crecimientoCFO.toFixed(4),
      },
      banderas: b,
      puente: p ? { pasos: p.pasos.length, sinExplicar: p.sinExplicar, suficiente: p.suficiente } : null,
      destino: s ? { cuadra: s.cuadra, residuo: s.residuo } : null,
    });
  } catch (e) { filas.push({ ticker: t, estado: "error", motivo: e.message }); }
}

const ok = filas.filter((x) => x.estado === "ok");
const fin = ok.filter((x) => x.financiera);
const conB = ok.filter((x) => x.banderas.length > 0);
const cuadran = ok.filter((x) => x.destino?.cuadra);
const puenteOk = ok.filter((x) => x.puente?.suficiente);

const pc = (n, d = ok.length) => `${n}/${d}  ${d ? (100 * n / d).toFixed(0) : 0} %`;
console.log(`  leidos                      ${pc(ok.length, filas.length)}`);
console.log(`  financieras (sin FCF)       ${pc(fin.length)}`);
console.log(`  el destino de la caja CUADRA ${pc(cuadran.length)}   <- criterio de publicacion`);
console.log(`  el puente es suficiente     ${pc(puenteOk.length)}`);
console.log(`  con al menos una bandera    ${pc(conB.length)}`);

const porClave = {};
for (const x of ok) for (const b of x.banderas) (porClave[b.clave] ??= []).push(x.ticker);
console.log(`\n  BANDERAS POR TIPO:`);
for (const [k, v] of Object.entries(porClave).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${k.padEnd(32)} ${String(v.length).padStart(3)}  ${v.slice(0, 8).join(" ")}${v.length > 8 ? " …" : ""}`);
}
if (!Object.keys(porClave).length) console.log(`    ninguna`);

// ⚠️ El listón de cordura: si mas de un tercio del indice esta marcado, el umbral describe el
// mercado en vez de senalar excepciones, y hay que revisarlo antes de publicar nada.
const tasa = ok.length ? conB.length / ok.length : 0;
if (tasa > 0.35) {
  console.log(`\n  ⚠️ ${(100 * tasa).toFixed(0)} % del universo marcado. Eso no es deteccion, es descripcion:`);
  console.log(`     revisa los umbrales de UMBRALES antes de publicar esto.`);
}

writeFileSync(join(OUT, "calidad_caja.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: ASOF, umbrales: UMBRALES,
  resumen: { leidos: ok.length, deCuantos: filas.length, financieras: fin.length,
    destinoCuadra: cuadran.length, puenteSuficiente: puenteOk.length, conBandera: conB.length,
    tasaBanderas: +tasa.toFixed(3) },
  porClave: Object.fromEntries(Object.entries(porClave).map(([k, v]) => [k, v.length])),
  filas,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/calidad_caja.json\n`);
