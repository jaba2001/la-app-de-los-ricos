// ─────────────────────────────────────────────────────────────────────────────
// EL DIAGRAMA DE «CÓMO GANA DINERO X»
//
// Lo que estos tests fijan, por orden de importancia:
//
//   1. Que CUADRE. Un Sankey que escala las barras para que encajen queda bonito y miente.
//   2. Que un bloque que falta se DIGA, no se rellene.
//   3. Que el mismo componente sirva para «cómo pierde dinero» (resultado neto negativo).
//
//   node --experimental-strip-types --no-warnings scripts/sankey.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { construirSankey, etiquetaDe, TOLERANCIA_CUADRE } from "../lib/sankey.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

/** NVIDIA real, del extractor (TTM a 2026-08-31), en miles de millones para leerlo. */
const NVDA = { revTTM: 253.491, costTTM: 65.539, gpTTM: 187.952, sgaTTM: 4.838, rndTTM: 20.829, oiTTM: 162.285, niTTM: 159.613 };

// ── 1 · El diagrama CUADRA ───────────────────────────────────────────────────────────────
{
  const s = construirSankey(NVDA);
  ok(s !== null, "se construye");
  eq(s.nivel, "completo", "con todos los campos, el nivel es completo");
  const suma = s.salidas.reduce((a, x) => a + x.valor, 0);
  ok(Math.abs(suma - s.ingresos) < 0.001,
    `las salidas suman los ingresos (${suma.toFixed(3)} vs ${s.ingresos})`);
  ok(s.cuadre.ok, `y el cuadre lo confirma (residuo ${s.cuadre.residuo.toFixed(4)}, ${s.cuadre.pct} %)`);
}

// ── 2 · La cadena contable es la que dice ────────────────────────────────────────────────
{
  const s = construirSankey(NVDA);
  const v = (n) => s.salidas.find((x) => x.nombre === n)?.valor;
  ok(Math.abs(v("Coste de ingresos") - 65.539) < 1e-9, "el coste es el declarado");
  ok(Math.abs(v("I+D") - 20.829) < 1e-9, "I+D");
  ok(Math.abs(v("Gastos generales y de venta") - 4.838) < 1e-9, "SG&A");
  // Impuestos y otros = resultado de explotación − resultado neto.
  ok(Math.abs(v("Impuestos, financieros y otros") - (162.285 - 159.613)) < 1e-9,
    "impuestos y otros se DERIVA de explotación menos neto, no se inventa");
  ok(Math.abs(v("Beneficio neto") - 159.613) < 1e-9, "el beneficio neto es el declarado");
}

// ── 3 · Lo que no se puede atribuir se DIBUJA, no se reparte ─────────────────────────────
// Es la trampa central de un Sankey: si los datos no articulan hay tres salidas —escalar las
// barras (miente), dejar el diagrama abierto (no se ve el hueco) o dibujar el hueco con su
// nombre—. Sólo la tercera es honesta.
{
  // Coste inconsistente con el margen bruto: quedan 25,5 sin atribuir.
  const roto = { ...NVDA, costTTM: 40 };
  const s = construirSankey(roto);

  const suma = s.salidas.reduce((a, x) => a + x.valor, 0);
  ok(Math.abs(suma - s.ingresos) < 1e-9,
    `el diagrama SIEMPRE cierra: las salidas suman los ingresos (${suma.toFixed(3)} vs ${s.ingresos})`);

  const hueco = s.salidas.find((x) => x.nombre === "No desglosado");
  ok(hueco != null, "porque el hueco se dibuja como bloque propio");
  ok(Math.abs(hueco.valor - 25.539) < 0.001, `con su tamaño real (${hueco?.valor.toFixed(3)}), no repartido`);

  ok(!s.cuadre.ok, `y \`cuadre.ok\` avisa de que el hueco es grande (${s.cuadre.pct} %)`);
  ok(/sin desglosar/.test(etiquetaDe(s)), `la etiqueta lo dice en texto (${etiquetaDe(s)})`);

  // Lo importante: NO se ha tocado ningún valor declarado para hacerlo encajar.
  ok(s.salidas.find((x) => x.nombre === "Coste de ingresos").valor === 40,
    "el coste se publica tal cual, sin escalar");
  ok(Math.abs(s.salidas.find((x) => x.nombre === "Beneficio neto").valor - NVDA.niTTM) < 1e-9,
    "y el resultado neto tampoco se toca");
}

// ── 3bis · Un diagrama que cierra puede no informar de nada ──────────────────────────────
// `CNC` deja el 91 % de sus ingresos sin desglosar. El diagrama es correcto —cierra— y no dice
// nada. Por eso `cuadre.ok` existe aparte de que las barras sumen.
{
  const casiVacio = { revTTM: 100, costTTM: null, gpTTM: null, oiTTM: null, niTTM: 9 };
  const s = construirSankey(casiVacio);
  const suma = s.salidas.reduce((a, x) => a + x.valor, 0);
  ok(Math.abs(suma - 100) < 1e-9, "cierra");
  const hueco = s.salidas.find((x) => x.nombre === "No desglosado");
  ok(hueco != null && Math.abs(hueco.valor - 91) < 1e-9, "con 91 sin desglosar");
  ok(!s.cuadre.ok, "y se marca como poco informativo");
}

// ── 4 · Lo que falta se dice con nombre ──────────────────────────────────────────────────
{
  // AMC real: sólo ingresos, resultado de explotación y neto.
  const AMC = { revTTM: 5.2306, costTTM: null, gpTTM: null, sgaTTM: null, rndTTM: null, oiTTM: 0.2283, niTTM: -0.5541 };
  const s = construirSankey(AMC);
  ok(s.faltan.includes("coste de ingresos"), "dice que falta el coste");
  ok(s.faltan.includes("I+D"), "y I+D");
  ok(s.faltan.includes("gastos generales y de venta"), "y SG&A");
  ok(!s.faltan.includes("resultado neto"), "pero NO dice que falte el neto, que sí está");
  ok(s.nivel !== "completo", "así que el nivel no es completo");
  ok(/no publica el desglose de costes/.test(etiquetaDe(s)), `y la etiqueta lo explica (${etiquetaDe(s)})`);
}

// ── 5 · «Cómo PIERDE dinero»: el mismo componente ────────────────────────────────────────
{
  const AMC = { revTTM: 5.2306, costTTM: 1.5, gpTTM: 3.7306, sgaTTM: 1.1, rndTTM: 0, oiTTM: 0.2283, niTTM: -0.5541 };
  const s = construirSankey(AMC);
  ok(s.pierde, "un resultado neto negativo marca el diagrama como pérdida");
  const neto = s.salidas.find((x) => x.clase === "perdida");
  ok(neto != null && neto.nombre === "Pérdida neta", "y la barra se llama pérdida, no beneficio");
  ok(neto.valor < 0, "con su signo");
  const suma = s.salidas.reduce((a, x) => a + x.valor, 0);
  ok(Math.abs(suma - s.ingresos) < 0.001, "y el diagrama sigue cuadrando con resultado negativo");
}

// ── 6 · El desglose de ingresos, cuando existe ───────────────────────────────────────────
{
  // AMC publica admisiones, comida y bebida, y otros — las tres barras del ejemplo de Moby.
  const lineas = [
    { nombre: "Admisiones", valor: 2.6 },
    { nombre: "Comida y bebida", valor: 1.6 },
    { nombre: "Otros del cine", valor: 0.319 },
  ];
  const s = construirSankey({ revTTM: 5.2306, costTTM: 1.5, gpTTM: 3.7306, niTTM: -0.5541, oiTTM: 0.2283 }, lineas);
  ok(s.entradas.length === 4, `tres líneas más el resto (${s.entradas.map((e) => e.nombre).join(", ")})`);
  const resto = s.entradas.find((e) => e.nombre === "Otros ingresos");
  ok(resto != null, "la parte no desglosada se dibuja como «otros ingresos»");
  ok(Math.abs(resto.valor - (5.2306 - 4.519)) < 1e-9, "con su valor real, sin escalar las líneas");
  const suma = s.entradas.reduce((a, e) => a + e.valor, 0);
  ok(Math.abs(suma - s.ingresos) < 1e-9, "y las entradas suman los ingresos exactamente");
  ok(!s.faltan.includes("desglose de ingresos por línea de negocio"), "ya no falta el desglose");
}

// ── 7 · Sin desglose, una sola barra, y se dice ──────────────────────────────────────────
{
  const s = construirSankey(NVDA);
  eq(s.entradas.length, 1, "sin líneas, una sola entrada");
  eq(s.entradas[0].nombre, "Ingresos totales", "llamada por su nombre");
  ok(s.faltan.includes("desglose de ingresos por línea de negocio"),
    "y se declara que falta — no se finge que la empresa sólo tiene un negocio");
  ok(/sin desglose/.test(etiquetaDe(s)), `la etiqueta también (${etiquetaDe(s)})`);
}

// ── 8 · Una sola línea de ingreso NO es un desglose ──────────────────────────────────────
{
  const s = construirSankey(NVDA, [{ nombre: "Data Center", valor: 200 }]);
  eq(s.entradas.length, 1, "con una sola línea se ignora el «desglose»");
  eq(s.entradas[0].nombre, "Ingresos totales", "y se dibuja el total");
}

// ── 9 · Bordes ───────────────────────────────────────────────────────────────────────────
{
  eq(construirSankey({}), null, "sin ingresos no hay diagrama");
  eq(construirSankey({ revTTM: 0 }), null, "ni con ingresos cero");
  eq(construirSankey({ revTTM: null }), null, "ni con ingresos nulos");
  const solo = construirSankey({ revTTM: 100 });
  ok(solo !== null && solo.nivel === "sin_datos", "sólo con ingresos, el nivel es sin_datos");
  ok(/no publica lo suficiente/.test(etiquetaDe(solo)), `y se dice (${etiquetaDe(solo)})`);
}

// ── 10 · La tolerancia está declarada y es estrecha ──────────────────────────────────────
ok(TOLERANCIA_CUADRE > 0 && TOLERANCIA_CUADRE <= 0.05,
  `la tolerancia de cuadre (${TOLERANCIA_CUADRE}) es estrecha: un 2 % de descuadre ya es mucho en un estado financiero`);

console.log(pass && !fail ? `\n✓ sankey: ${pass} passed, 0 failed\n` : `\n✖ sankey: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
