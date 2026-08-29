// ─────────────────────────────────────────────────────────────────────────────
// ¿SIGUEN VALIENDO LOS NÚMEROS PUBLICADOS?
//
// ⚠️ EXISTE POR UN FALLO QUE NO ROMPE NADA, que son los peores.
//
// El 2026-08-29 el backtest de la ventana antigua abortó por falta de memoria DESPUÉS de
// construir las 192 fechas del panel — o sea tras la parte cara y justo antes de escribir. El
// panel quedó en disco, el artefacto no, y los números publicados siguieron siendo los de la
// corrida anterior. Ningún error, ningún aviso: sólo un código de salida 134 que nadie mira
// cuando lanza algo de cinco horas y se va. Estuve a punto de dar por buenas cifras de un día
// antes, y lo único que lo delató fue que las dos ventanas daban EXACTAMENTE lo mismo.
//
// Documentar «lánzalo con más memoria» no arregla eso. Esto sí: pregunta si cada artefacto
// sigue saliendo de las entradas que hay ahora, y falla si no.
//
// Se corre antes de citar cualquier cifra, y en CI:
//
//   node --experimental-strip-types --no-warnings research/frescura_artefactos.mjs
//
// Sale con código 1 si algún artefacto está caduco, para poder encadenarlo:
//
//   node research/frescura_artefactos.mjs && echo "los numeros valen"
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical } from "./universe.mjs";
import { huellaEntradas, comprobarHuella, FICHEROS_DE_ENTRADA, fechaDe } from "./huella.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(AQUI, "out");
const DATA = join(AQUI, "data");

/** Los artefactos que sostienen cifras publicadas. Si se publica uno nuevo, va aquí. */
const ARTEFACTOS = [
  ["picks_rules_backtest.json", "backtest 2019-2026"],
  ["picks_rules_backtest_oos.json", "backtest 2011-2018"],
];

const tabla = await loadSP500Historical().catch(() => null);
const ahora = huellaEntradas(tabla?.length ? tabla[tabla.length - 1].date : null);

console.log(`\n  FRESCURA DE ARTEFACTOS · huella actual ${ahora.sha} · reglas v${ahora.versionReglas}\n`);

let caducos = 0;
for (const [fichero, nombre] of ARTEFACTOS) {
  const ruta = join(OUT, fichero);
  if (!existsSync(ruta)) { console.log(`  ⚠ ${nombre.padEnd(20)} NO EXISTE`); caducos++; continue; }
  let j = null;
  try { j = JSON.parse(readFileSync(ruta, "utf8")); } catch { console.log(`  ✖ ${nombre.padEnd(20)} ILEGIBLE`); caducos++; continue; }

  const { vale, motivos } = comprobarHuella(j, ahora);

  // Y una segunda pregunta, más tonta y más útil: ¿es el artefacto MÁS VIEJO que sus entradas?
  // La huella no lo detecta si alguien reescribe un fichero de datos con el mismo contenido,
  // pero tampoco pasa nada en ese caso. Lo que sí importa es el orden: un artefacto anterior a
  // sus entradas se calculó con otra cosa.
  const suFecha = j?.generatedAt ?? null;
  const masNuevas = FICHEROS_DE_ENTRADA
    .map((f) => [f, fechaDe(join(DATA, f))])
    .filter(([, d]) => d && suFecha && d > suFecha)
    .map(([f]) => f);

  if (vale && !masNuevas.length) {
    console.log(`  ✓ ${nombre.padEnd(20)} al día  ·  generado ${String(suFecha).slice(0, 16)}`);
    continue;
  }
  caducos++;
  console.log(`  ✖ ${nombre.padEnd(20)} CADUCO  ·  generado ${String(suFecha).slice(0, 16)}`);
  for (const m of motivos) console.log(`      · ${m}`);
  // Que un fichero sea más nuevo NO es por sí solo prueba de que el artefacto esté mal —la
  // auditoría reescribe sin cambiar nada— así que se dice como pista, no como veredicto.
  if (masNuevas.length && vale) console.log(`      · las entradas se reescribieron después (${masNuevas.join(", ")}), aunque su contenido no cambió`);
}

if (caducos) {
  console.error(`\n  ⛔ ${caducos} de ${ARTEFACTOS.length} artefactos NO se pueden citar: rehazlos antes de publicar ninguna cifra.`);
  console.error(`     node --max-old-space-size=8192 --experimental-strip-types --no-warnings research/picks_rules_backtest.mjs [--long] --rebuild\n`);
  process.exit(1);
}
console.log(`\n  ✅ Los ${ARTEFACTOS.length} artefactos salen de las entradas que hay ahora.\n`);
