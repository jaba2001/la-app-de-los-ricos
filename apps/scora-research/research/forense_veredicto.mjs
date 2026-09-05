// ─────────────────────────────────────────────────────────────────────────────
// VEREDICTO COMBINADO DEL VETO FORENSE (Fase F3)
//
// `forense_lab.mjs` mide UNA ventana. Pero dos de las tres hipótesis pre-registradas en
// PLAN_SCORA_FORENSE.md §3 son afirmaciones sobre LAS DOS A LA VEZ, y ninguna se puede
// evaluar desde dentro de una sola ejecución:
//
//   · HF1 exige literalmente «con el MISMO SIGNO en las dos ventanas». Un efecto que cambia
//     de signo entre 2011-2018 y 2019-2026 no es un efecto débil: es ruido con suerte.
//   · HF3 se lee mejor junto: que la dirección temida aparezca en las dos ventanas dice más
//     que cualquiera de los dos p-valores por separado.
//
// Este script junta los dos artefactos y aplica los criterios TAL Y COMO SE ESCRIBIERON,
// sin reinterpretarlos a la vista del resultado.
//
//   node --experimental-strip-types --no-warnings research/forense_veredicto.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const ruta = (f) => join(OUT, f);
const falta = ["forense_lab.json", "forense_lab_oos.json"].filter((f) => !existsSync(ruta(f)));
if (falta.length) {
  console.error(`\n  ✖ faltan ${falta.join(" y ")}. Ejecuta antes:`);
  console.error("      node --experimental-strip-types --no-warnings research/forense_lab.mjs");
  console.error("      node --experimental-strip-types --no-warnings research/forense_lab.mjs --long\n");
  process.exit(1);
}
const rec = JSON.parse(readFileSync(ruta("forense_lab.json"), "utf8"));      // 2019-2026
const ant = JSON.parse(readFileSync(ruta("forense_lab_oos.json"), "utf8"));  // 2011-2018

const f = (x, d = 2) => (x == null ? "—" : x.toFixed(d));
console.log(`\n  VETO FORENSE · veredicto sobre LAS DOS ventanas\n`);
console.log(`  ${"".padEnd(38)}${"2019-2026".padStart(14)}${"2011-2018".padStart(14)}`);
console.log(`  ${"─".repeat(66)}`);

// ── HF1 ───────────────────────────────────────────────────────────────────────────────────
const s1 = rec.HF1.spread, s2 = ant.HF1.spread;
console.log(`  HF1 · spread entre quintiles (pp)     ${f(s1).padStart(14)}${f(s2).padStart(14)}`);
console.log(`  HF1 · t                               ${f(rec.HF1.t).padStart(14)}${f(ant.HF1.t).padStart(14)}`);
console.log(`  HF1 · MDE (pp)                        ${f(rec.HF1.mde, 1).padStart(14)}${f(ant.HF1.mde, 1).padStart(14)}`);
console.log(`  HF1 · observaciones nombre-fecha      ${String(rec.HF1.nObs).padStart(14)}${String(ant.HF1.nObs).padStart(14)}`);

const mismoSigno = s1 != null && s2 != null && Math.sign(s1) === Math.sign(s2);
const ambosSuperanMDE = Math.abs(s1) > rec.HF1.mde && Math.abs(s2) > ant.HF1.mde;
const hf1Pasa = mismoSigno && ambosSuperanMDE && s1 > 0;
console.log(`\n  HF1 exigía: mismo signo en las dos ventanas Y efecto por encima del MDE.`);
console.log(`    · mismo signo:            ${mismoSigno ? "sí" : `**NO** (${s1 > 0 ? "+" : "−"} vs ${s2 > 0 ? "+" : "−"})`}`);
console.log(`    · por encima del MDE:     ${ambosSuperanMDE ? "sí en las dos" : "no"}`);
console.log(`    → HF1 ${hf1Pasa ? "PASA" : "**FALLA**"}`);

// ── HF3 ───────────────────────────────────────────────────────────────────────────────────
const d1 = rec.HF3.diferencia * 100, d2 = ant.HF3.diferencia * 100;
const m1 = rec.HF3.mde * 100, m2 = ant.HF3.mde * 100;
console.log(`\n  HF3 · veto sobre ganadores − resto (pp)${f(d1, 1).padStart(13)}${f(d2, 1).padStart(14)}`);
console.log(`  HF3 · MDE (pp)                        ${f(m1, 1).padStart(14)}${f(m2, 1).padStart(14)}`);
console.log(`  HF3 · % del MDE consumido             ${(String(Math.round(100 * d1 / m1)) + " %").padStart(14)}${(String(Math.round(100 * d2 / m2)) + " %").padStart(14)}`);
console.log(`  HF3 · veto a ganadores ÷ veto al resto ${(f(rec.HF3.tasaTop / rec.HF3.tasaResto, 1) + "×").padStart(13)}${(f(ant.HF3.tasaTop / ant.HF3.tasaResto, 1) + "×").padStart(14)}`);
const hf3Limpio = d1 <= 0 && d2 <= 0;
const hf3Falla = d1 > m1 || d2 > m2;
console.log(`\n  HF3 exigía: el veto NO puede castigar a los ganadores por encima del MDE.`);
console.log(`    · supera el MDE:         ${hf3Falla ? "**SÍ — falla**" : "no"}`);
console.log(`    · dirección limpia:      ${hf3Limpio ? "sí" : "**NO** — castiga a los ganadores en las DOS ventanas"}`);
console.log(`    → HF3 ${hf3Falla ? "**FALLA**" : "pasa el listón, pero no está limpio"}`);

// ── Veredicto ─────────────────────────────────────────────────────────────────────────────
const construir = hf1Pasa && hf3Limpio && !hf3Falla;
console.log(`\n  ${"═".repeat(66)}`);
if (construir) {
  console.log(`  ✓ SE CONSTRUYE el veto: HF1 replica con el mismo signo y HF3 está limpio.`);
} else {
  console.log(`  ✖ NO SE CONSTRUYE EL VETO FORENSE.\n`);
  if (!mismoSigno) {
    console.log(`  El motivo principal es el más limpio que se podía pedir: HF1 se preespecificó`);
    console.log(`  exigiendo el MISMO SIGNO en las dos ventanas, y los signos son OPUESTOS`);
    console.log(`  (${f(s1)} pp frente a ${f(s2)} pp). Un efecto que cambia de signo entre dos`);
    console.log(`  periodos de ocho años no es un efecto débil: es ruido.`);
  }
  if (!hf3Limpio) {
    console.log(`\n  Y HF3, que manda sobre las demás, apunta en la dirección temida en LAS DOS:`);
    console.log(`  el veto marca a los ganadores ${f(rec.HF3.tasaTop / rec.HF3.tasaResto, 1)}× y ${f(ant.HF3.tasaTop / ant.HF3.tasaResto, 1)}× más que al resto. Pasa el`);
    console.log(`  listón sólo por falta de potencia —consume el ${Math.round(100 * d1 / m1)} % y el ${Math.round(100 * d2 / m2)} % del MDE—, no por`);
    console.log(`  estar limpio. NVDA aparece marcada por devengos en las dos ventanas, en 2017 y`);
    console.log(`  en 2022, justo antes de sus dos mejores años.`);
  }
  console.log(`\n  Es el resultado que el plan (§3) preveía como posible, y terminar aquí cuesta`);
  console.log(`  mucho menos que construirlo mal. Los modelos quedan calculados y publicados`);
  console.log(`  como capa EXPLICATIVA; \`PicksInput.disqualified\` sigue vacío en producción.`);
}

const veredicto = {
  generatedAt: new Date().toISOString(),
  ventanas: { reciente: "2019-2026", antigua: "2011-2018" },
  HF1: { spread: { reciente: s1, antigua: s2 }, t: { reciente: rec.HF1.t, antigua: ant.HF1.t },
         mde: { reciente: rec.HF1.mde, antigua: ant.HF1.mde }, mismoSigno, ambosSuperanMDE, pasa: hf1Pasa },
  HF3: { diferenciaPp: { reciente: d1, antigua: d2 }, mdePp: { reciente: m1, antigua: m2 },
         ratioVetoGanadores: { reciente: rec.HF3.tasaTop / rec.HF3.tasaResto, antigua: ant.HF3.tasaTop / ant.HF3.tasaResto },
         limpio: hf3Limpio, falla: hf3Falla },
  HF2: { nota: "sin potencia — 49 y 54 posiciones en quince años; se reporta como comprobación, no como evidencia",
         marcadosEnTop40Pct: { reciente: rec.HF2.pct, antigua: ant.HF2.pct } },
  cobertura: { reciente: rec.cobertura, antigua: ant.cobertura },
  construir,
  motivo: construir ? "HF1 replica con el mismo signo y HF3 está limpio"
    : !mismoSigno ? "HF1 cambia de SIGNO entre ventanas (criterio preespecificado incumplido) y HF3 apunta a los ganadores en las dos"
    : "HF3 apunta en la dirección temida",
  consecuencia: "El veto NO se enchufa a PicksInput.disqualified. Los modelos forenses se calculan y publican como capa explicativa.",
};
writeFileSync(ruta("forense_veredicto.json"), JSON.stringify(veredicto, null, 1));
console.log(`\n  → ${ruta("forense_veredicto.json")}\n`);
process.exit(0);
