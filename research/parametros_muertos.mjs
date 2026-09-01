// ─────────────────────────────────────────────────────────────────────────────
// PARÁMETROS QUE ENTRAN Y NO SE USAN
//
// ⚠️ EXISTE POR UN FALLO CONCRETO, del tipo que no rompe nada.
//
// El 2026-09-01 se descubrió que `universoEW(eje, excluir)` aceptaba `excluir` y lo usaba en UN
// solo sitio: el texto de un aviso por consola. Nunca filtraba. La referencia «universo
// equiponderado SIN financieros» era, bit a bit, el mismo cálculo que la de CON financieros — y
// daba los cuatro números idénticos al decimal con 56 nombres supuestamente fuera.
//
// Lo grave no es que fallara, porque no fallaba: es lo que CONTESTABA. El script imprimía «la
// diferencia entre las dos, +0pp, es lo que aportaban los financieros a la referencia», y eso se
// leía como una medición. La pregunta de §11 —¿Scora bate al índice por elegir bien, o por no
// tener bancos?— tuvo durante meses una respuesta falsa que parecía medida.
//
// Un parámetro declarado y jamás mencionado en el cuerpo es la firma exacta de ese defecto: la
// función acepta una pregunta y responde otra. Esto los busca.
//
//   node --experimental-strip-types --no-warnings research/parametros_muertos.mjs
//
// NO es un linter. Sólo mira funciones con `function` (declaradas o exportadas), ignora las
// flecha, y no entiende de ámbitos: un parámetro nombrado sólo dentro de una función anidada
// cuenta como usado. Está calibrado para no dar falsos positivos, no para encontrarlo todo.
//
// Sale con código 1 si encuentra alguno, para poder encadenarlo en CI.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["research", "scripts", "lib"];

/**
 * Los que ya se han mirado y se dejan a propósito. Con el motivo, porque una lista de
 * excepciones sin motivos se convierte en el sitio donde se esconden los fallos.
 */
const TOLERADOS = new Map([
  // ["fichero.mjs:nombreFuncion:parametro", "por qué se deja"],
]);

/** Firmas de función, sin usar escapes de barra invertida (el shell se los come al generarlos). */
const RE_FUNC = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+([A-Za-z0-9_$]+)[ \t]*\(([^)]*)\)[ \t]*\{/g;

/** Cuerpo de la función que empieza en la llave `abre`, por conteo de llaves. */
function cuerpoDe(src, abre) {
  let prof = 0;
  for (let i = abre; i < src.length; i++) {
    const c = src[i];
    if (c === "{") prof++;
    else if (c === "}") {
      prof--;
      if (prof === 0) return src.slice(abre + 1, i);
    }
  }
  return null; // llaves desbalanceadas: mejor no decir nada que decir algo falso
}

/**
 * Identificadores mencionados en un trozo de código.
 *
 * Se parte por lo que NO puede formar parte de un nombre. Es tosco a propósito: cuenta también
 * las menciones dentro de comentarios y cadenas, y eso hace que falle hacia el silencio. Un
 * parámetro citado sólo en un comentario se dará por usado y no se avisará — preferible a
 * inundar de falsos positivos, que es lo que mata a un guardián.
 */
function identificadores(txt) {
  return new Set(txt.split(/[^A-Za-z0-9_$]+/));
}

/** Nombres de parámetro simples. El destructuring y el resto se saltan: no se sabe leerlos. */
function nombresDeParametro(params) {
  return params
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("{") && !p.startsWith("[") && !p.startsWith("..."))
    .map((p) => p.split("=")[0].trim())
    .filter((p) => /^[A-Za-z0-9_$]+$/.test(p));
}

const hallazgos = [];
for (const d of DIRS) {
  const dir = join(RAIZ, d);
  let ficheros;
  try { ficheros = readdirSync(dir); } catch { continue; }
  for (const f of ficheros) {
    if (!f.endsWith(".mjs") && !f.endsWith(".ts")) continue;
    const ruta = join(dir, f);
    try { if (!statSync(ruta).isFile()) continue; } catch { continue; }
    const src = readFileSync(ruta, "utf8");

    RE_FUNC.lastIndex = 0;
    let m;
    while ((m = RE_FUNC.exec(src))) {
      const [todo, nombre, params] = m;
      if (!params.trim()) continue;
      const cuerpo = cuerpoDe(src, m.index + todo.length - 1);
      if (cuerpo == null) continue;
      const usados = identificadores(cuerpo);
      for (const p of nombresDeParametro(params)) {
        if (usados.has(p)) continue;
        const clave = `${f}:${nombre}:${p}`;
        if (TOLERADOS.has(clave)) continue;
        hallazgos.push({
          ruta: `${d}/${f}`,
          linea: src.slice(0, m.index + todo.length).split("\n").length,
          nombre, params: params.trim(), p,
        });
      }
    }
  }
}

console.log("\n  PARÁMETROS DECLARADOS Y NUNCA USADOS\n");
if (!hallazgos.length) {
  console.log("  ✅ ninguno.\n");
  process.exit(0);
}
for (const h of hallazgos) {
  console.log(`  ✖ ${h.ruta}:${h.linea}`);
  console.log(`      ${h.nombre}(${h.params})  →  «${h.p}» no aparece en el cuerpo`);
}
console.error(`\n  ⛔ ${hallazgos.length} parámetro(s) que entran y no se usan.`);
console.error(`     Cada uno es una función que acepta una pregunta y responde otra — como`);
console.error(`     universoEW(eje, excluir), que devolvía la referencia CON financieros.`);
console.error(`     Si alguno es intencionado, va a TOLERADOS con su motivo.\n`);
process.exit(1);
