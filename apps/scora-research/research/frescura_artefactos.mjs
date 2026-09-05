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
const ahora = huellaEntradas(tabla?.length ? tabla[tabla.length - 1] : null);

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

  // ⚠️ EL VEREDICTO LO DA LA HUELLA, NO EL RELOJ. Esto estaba escrito arriba —«se dice como
  // pista, no como veredicto»— y el código hacía lo contrario: con la huella BUENA y un mtime
  // más nuevo, contaba caduco y salía con 1.
  //
  // En CI eso no es un matiz, es un fallo estructural: `fechaDe` devuelve el mtime, y en un
  // clon limpio TODOS los ficheros llevan la hora del checkout, siempre posterior al
  // `generatedAt` del artefacto. Es decir, esta comprobación no podía pasar nunca en CI —
  // tumbaba el workflow entero por un dato que el propio mensaje reconocía irrelevante
  // («aunque su contenido no cambió»). Se descubrió al reparar el YAML que llevaba cinco días
  // impidiendo que el CI llegara siquiera a ejecutar este paso.
  if (vale) {
    console.log(`  ✓ ${nombre.padEnd(20)} al día  ·  generado ${String(suFecha).slice(0, 16)}`);
    // La pista sigue publicándose: puede delatar una reescritura que la huella no cubra.
    if (masNuevas.length) console.log(`      · pista: las entradas se reescribieron después (${masNuevas.join(", ")}), pero la huella coincide, así que el artefacto SÍ sale de estas entradas`);
    continue;
  }
  caducos++;
  console.log(`  ✖ ${nombre.padEnd(20)} CADUCO  ·  generado ${String(suFecha).slice(0, 16)}`);
  for (const m of motivos) console.log(`      · ${m}`);
  if (masNuevas.length) console.log(`      · además, las entradas se reescribieron después (${masNuevas.join(", ")})`);
}

if (caducos) {
  console.error(`\n  ⛔ ${caducos} de ${ARTEFACTOS.length} artefactos NO se pueden citar: rehazlos antes de publicar ninguna cifra.`);
  console.error(`     node --max-old-space-size=8192 --experimental-strip-types --no-warnings research/picks_rules_backtest.mjs [--long] --rebuild\n`);
  process.exit(1);
}
console.log(`\n  ✅ Los ${ARTEFACTOS.length} artefactos salen de las entradas que hay ahora.\n`);
