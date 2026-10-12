// Lista las frases que el código manda traducir y aún no tienen traducción, por fichero.
//   node --experimental-strip-types --no-warnings scripts/i18n-pendientes.mjs [prefijo-de-ruta]
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { compilar, tieneTraduccion } from "../lib/i18n/traducir.ts";
import { ES } from "../lib/i18n/es/index.ts";

const D = compilar(ES);
const filtro = process.argv[2] ?? "";
function* ficheros(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "api" && f !== "node_modules") yield* ficheros(p); }
    else if (/\.(tsx|ts)$/.test(f)) yield p;
  }
}
const vistos = new Set();
for (const raiz of ["app", "components", "lib"]) for (const f of ficheros(raiz)) {
  if (f.startsWith("lib/i18n") || !f.startsWith(filtro)) continue;
  const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const out = [];
  const anota = (txt, muestra) => { if (!tieneTraduccion(muestra ?? txt, D) && !vistos.has(txt)) { vistos.add(txt); out.push(txt); } };
  for (const m of src.matchAll(/\b(?:t|tr|trad|traducir)\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g)) anota(m[2].replace(/\\(["'\\])/g, "$1"));
  for (const m of src.matchAll(/\b(?:t|tr|trad|traducir)\(\s*`((?:[^`\\]|\\.)*)`\s*\)/g)) anota(m[1].replace(/\$\{[^}]*\}/g, "{x}"), m[1].replace(/\$\{[^}]*\}/g, "7"));
  for (const m of src.matchAll(/<Trans(?:Servidor)?\s+text=\{?\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) anota(m[2].replace(/\\(["'\\])/g, "$1"));
  for (const m of src.matchAll(/<Trans(?:Servidor)?\s+text=\{\s*`((?:[^`\\]|\\.)*)`\s*\}/g)) anota(m[1].replace(/\$\{[^}]*\}/g, "{x}"), m[1].replace(/\$\{[^}]*\}/g, "7"));
  if (out.length) { console.log(`## ${f} (${out.length})`); for (const x of out) console.log(x); }
}
console.error(`total pendientes: ${vistos.size}`);
