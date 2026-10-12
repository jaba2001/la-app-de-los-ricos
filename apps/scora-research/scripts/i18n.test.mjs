// Idiomas (lib/i18n): el motor de traducción y que el diccionario cubra la app.
//   node --experimental-strip-types --no-warnings scripts/i18n.test.mjs
//
// Lo que se fija:
//   · frases exactas, plantillas con datos, espacios y lo que no está en el diccionario;
//   · que cada entrada lleve en español las MISMAS {marcas} que en inglés (si se pierde una,
//     el dato desaparece de la frase sin que nadie lo note);
//   · COBERTURA: cada t("…") y <Trans text="…"> del código tiene su traducción. Un texto nuevo
//     sin traducir rompe esta prueba, no aparece en inglés en mitad de la app en español.
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { compilar, traducir, trocear, idiomaDeNavegador, tieneTraduccion } from "../lib/i18n/traducir.ts";
import { ES } from "../lib/i18n/es/index.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

// ── El motor ──────────────────────────────────────────────────────────────────────────
{
  const d = compilar({
    "Sign out": "Cerrar sesión",
    "You hold {n} names": "Tienes {n} nombres",
    "{a} of {b} AI analyses left today": "Te quedan {a} de {b} análisis de IA hoy",
    "Only {n} observations.": "Solo {n} observaciones.",
    "{n} observations.": "{n} observaciones.",
    "Regresses <b>your portfolio</b> returns": "Regresa los retornos de <b>tu cartera</b>",
    "{x}": "nunca",
  });
  check("exacta", traducir("Sign out", "es", d), "Cerrar sesión");
  check("en inglés no se toca", traducir("Sign out", "en", d), "Sign out");
  check("plantilla con un dato", traducir("You hold 5 names", "es", d), "Tienes 5 nombres");
  check("plantilla con dos datos", traducir("3 of 5 AI analyses left today", "es", d), "Te quedan 3 de 5 análisis de IA hoy");
  check("la plantilla más concreta gana", traducir("Only 12 observations.", "es", d), "Solo 12 observaciones.");
  check("y la general sigue funcionando", traducir("9,000 observations.", "es", d), "9,000 observaciones.");
  check("espacios de los bordes se conservan", traducir("  Sign out ", "es", d), "  Cerrar sesión ");
  check("lo que no está sale en inglés", traducir("Unknown text", "es", d), "Unknown text");
  check("una plantilla que es solo marcas no traduce todo", traducir("anything", "es", d), "anything");
  check("vacío", traducir("", "es", d), "");
  const d2 = compilar({ "The real yield has fallen {a} points. {b}": "La rentabilidad real ha bajado {a} puntos. {b}", "It is context, not a signal.": "Es contexto, no una señal." });
  check("los trozos de una plantilla también se traducen", traducir("The real yield has fallen 0.27 points. It is context, not a signal.", "es", d2), "La rentabilidad real ha bajado 0.27 puntos. Es contexto, no una señal.");
  check("y si un trozo no se conoce, queda como está", traducir("The real yield has fallen 0.27 points. Unknown.", "es", d2), "La rentabilidad real ha bajado 0.27 puntos. Unknown.");
  check("con formato", traducir("Regresses <b>your portfolio</b> returns", "es", d), "Regresa los retornos de <b>tu cartera</b>");
  check("trocear", trocear("Regresa <b>tu cartera</b> hoy"), [{ etiqueta: null, texto: "Regresa " }, { etiqueta: "b", texto: "tu cartera" }, { etiqueta: null, texto: " hoy" }]);
  check("idioma del navegador: español", idiomaDeNavegador("es-ES,es;q=0.9,en;q=0.8"), "es");
  check("idioma del navegador: otro → inglés", idiomaDeNavegador("fr-FR,fr;q=0.9"), "en");
  check("idioma del navegador: el primero que sepamos", idiomaDeNavegador("fr-FR,es;q=0.8"), "es");
  check("sin encabezado → inglés", idiomaDeNavegador(null), "en");
}

// ── El diccionario ────────────────────────────────────────────────────────────────────
const marcas = (s) => [...s.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]).sort().join(",");
const etiquetas = (s) => [...s.matchAll(/<([a-z][a-z0-9]*)>/g)].map((m) => m[1]).sort().join(",");
let malas = 0;
for (const [en, es] of Object.entries(ES)) {
  if (!es || !es.trim()) { malas++; console.log(`FAIL  traducción vacía: «${en}»`); }
  else if (marcas(en) !== marcas(es)) { malas++; console.log(`FAIL  {marcas} distintas: «${en}» → «${es}»`); }
  else if (etiquetas(en) !== etiquetas(es)) { malas++; console.log(`FAIL  <etiquetas> distintas: «${en}» → «${es}»`); }
}
total++; if (malas) bad++;

// ── Cobertura: lo que el código manda traducir está en el diccionario ─────────────────
const D = compilar(ES);
function* ficheros(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "api" && f !== "node_modules") yield* ficheros(p); }
    else if (/\.(tsx|ts)$/.test(f)) yield p;
  }
}
const sinTraducir = [];
for (const raiz of ["app", "components", "lib"]) {
  for (const f of ficheros(raiz)) {
    if (f.startsWith("lib/i18n")) continue;
    // Sin comentarios: los ejemplos de la documentación no son texto de la app.
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // t("…") y t('…')
    for (const m of src.matchAll(/\bt\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g)) {
      const txt = m[2].replace(/\\(["'\\])/g, "$1");
      if (!tieneTraduccion(txt, D)) sinTraducir.push(`${f}: «${txt}»`);
    }
    // t(`… ${x} …`): se prueba con un dato cualquiera en cada hueco
    for (const m of src.matchAll(/\bt\(\s*`((?:[^`\\]|\\.)*)`\s*\)/g)) {
      const muestra = m[1].replace(/\$\{[^}]*\}/g, "7");
      if (!tieneTraduccion(muestra, D)) sinTraducir.push(`${f}: «${m[1]}»`);
    }
    // <Trans text="…" />, <Trans text={"…"} /> y <Trans text={`… ${x} …`} />
    for (const m of src.matchAll(/<Trans(?:Servidor)?\s+text=\{?\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
      const txt = m[2].replace(/\\(["'\\])/g, "$1");
      if (!tieneTraduccion(txt, D)) sinTraducir.push(`${f}: <Trans> «${txt}»`);
    }
    for (const m of src.matchAll(/<Trans(?:Servidor)?\s+text=\{\s*`((?:[^`\\]|\\.)*)`\s*\}/g)) {
      const muestra = m[1].replace(/\$\{[^}]*\}/g, "7");
      if (!tieneTraduccion(muestra, D)) sinTraducir.push(`${f}: <Trans> «${m[1]}»`);
    }
  }
}
total++;
if (sinTraducir.length) { bad++; console.log(`FAIL  ${sinTraducir.length} texto(s) sin traducción al español:`); for (const x of sinTraducir.slice(0, 40)) console.log("      " + x); }

console.log(bad ? `\n✗ i18n: ${bad} fallo(s) de ${total} · ${Object.keys(ES).length} entradas` : `\n✓ i18n: ${total} comprobaciones OK · ${Object.keys(ES).length} entradas`);
process.exit(bad ? 1 : 0);
