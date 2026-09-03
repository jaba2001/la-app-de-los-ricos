// ─────────────────────────────────────────────────────────────────────────────
// EL PRECIO DE RECOMPRA
//
// Lo que fija este fichero no es la división `importe / acciones` —eso es aritmética— sino:
//
//   1. Que un precio medio IMPOSIBLE no se publique. Muchas empresas cuentan como «adquiridas»
//      las acciones que RETIENEN a sus empleados para pagar impuestos, que no se compran en el
//      mercado. Eso infla el denominador y hace parecer que compraron más barato de lo que
//      pagaron — el sesgo que haría quedar lista a una directiva torpe.
//   2. Que la lectura describa lo que la directiva CREÍA y cómo le ha salido, sin convertirse
//      en un pronóstico sobre la acción.
//   3. Que recomprar CARO se diga tan claro como recomprar barato.
//
//   node --experimental-strip-types --no-warnings scripts/recompras.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { recompra, lecturaRecompra, UMBRALES_RECOMPRA } from "../lib/recompras.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(a != null && Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a}`);

// ── El caso de Berkshire, que es de donde sale la idea ───────────────────────────────────
// 4.500 M$ entre 9,24 M de acciones ≈ 487 $/acción, con la acción hoy a 521.
{
  const r = recompra({ importe: 4.5e9, acciones: 9_240_246, precioActual: 521, precioMin: 455, precioMax: 540 });
  cerca(r.precioMedio, 487, 1.5, "precio medio de recompra ≈ 487 $");
  cerca(r.retornoDesdeRecompra, 521 / 487 - 1, 0.005, "la acción está ~7 % por encima de lo que pagaron");
  ok(r.creible === true, "y el precio medio cae dentro del rango del periodo: creíble");

  const l = lecturaRecompra(r, 521);
  ok(l.clave === "recompro_barato", "la lectura es que compraron por debajo del precio actual");
  ok(/487/.test(l.texto) && /no un pron/i.test(l.texto), "cita el número Y se declara descriptiva, no pronóstico");
  ok(!/comprar|vender|subir[aá]|objetivo/i.test(l.texto), "y no recomienda nada");
}

// ── LO QUE MÁS IMPORTA (1): un precio imposible NO se publica ────────────────────────────
// ⚠️ El caso real: el recuento incluye acciones retenidas a empleados por impuestos, así que
// el denominador se infla y el precio medio sale por debajo de donde la acción llegó a cotizar.
{
  const r = recompra({ importe: 1e9, acciones: 20e6, precioActual: 100, precioMin: 80, precioMax: 120 });
  cerca(r.precioMedio, 50, 1e-9, "el cálculo da 50 $…");
  ok(r.creible === false, "…que es IMPOSIBLE: la acción nunca bajó de 80 en el periodo");
  ok(/retenciones por impuestos/.test(r.motivo), "y el motivo nombra la causa habitual");
  ok(lecturaRecompra(r, 100).clave === "no_creible", "la lectura lo declara no publicable");
  ok(!/recompr[oó] (barato|caro)/.test(lecturaRecompra(r, 100).texto), "y NO da un veredicto sobre la directiva");

  // Por encima del máximo: las dos cifras no son del mismo periodo.
  const alto = recompra({ importe: 1e9, acciones: 5e6, precioActual: 100, precioMin: 80, precioMax: 120 });
  cerca(alto.precioMedio, 200, 1e-9, "200 $ de precio medio");
  ok(alto.creible === false && /mismo periodo/.test(alto.motivo), "por encima del máximo: tampoco es creíble");

  // Justo dentro de la tolerancia SÍ pasa: las compras son intradía y el rango son cierres.
  const borde = recompra({ importe: 1e9, acciones: 1e9 / (80 * (1 - UMBRALES_RECOMPRA.toleranciaRango + 0.001)),
    precioActual: 100, precioMin: 80, precioMax: 120 });
  ok(borde.creible === true, "dentro de la tolerancia del 5 % se acepta: el rango son cierres, las compras intradía");
}

// ── LO QUE MÁS IMPORTA (2): sin rango NO se afirma que sea creíble ───────────────────────
{
  const r = recompra({ importe: 1e9, acciones: 10e6, precioActual: 120 });
  cerca(r.precioMedio, 100, 1e-9, "el precio medio se calcula igual");
  ok(r.creible === null, "pero sin rango con el que comprobar, `creible` es null — NO true");
  ok(r.motivo === null, "y no se inventa un motivo");
  // Aun así se publica la lectura: el número es correcto, sólo no está verificado.
  ok(lecturaRecompra(r, 120)?.clave === "recompro_barato", "la lectura se emite, con el número sin verificar");
}

// ── LO QUE MÁS IMPORTA (3): recomprar CARO se dice igual de claro ───────────────────────
{
  const r = recompra({ importe: 1e9, acciones: 5e6, precioActual: 150, precioMin: 140, precioMax: 220 });
  cerca(r.precioMedio, 200, 1e-9, "pagaron 200 $ de media");
  ok(r.retornoDesdeRecompra < 0, "y la acción está por debajo");
  const l = lecturaRecompra(r, 150);
  ok(l.clave === "recompro_caro", "la lectura es que recompraron caro");
  ok(/destruido valor/.test(l.texto), "y lo dice sin rodeos");
  // ⚠️ El juicio es sobre la ASIGNACIÓN DE CAPITAL, que sí es evaluable, no sobre el precio futuro.
  ok(/asignaci[oó]n de capital/.test(l.texto), "juzga la asignación de capital, que es lo evaluable");
  ok(!/vender|caer[aá]|va a bajar/i.test(l.texto), "y no predice nada sobre la acción");
}

// ── Ausente no es cero, ni Infinity ─────────────────────────────────────────────────────
{
  ok(recompra({}).precioMedio === null, "sin datos, sin precio");
  ok(/sin importe o sin acciones/.test(recompra({}).motivo), "y se dice qué falta");
  ok(recompra({ importe: 1e9 }).precioMedio === null, "sin acciones no hay precio");
  ok(recompra({ acciones: 1e6 }).precioMedio === null, "ni sin importe");
  ok(recompra({ importe: 1e9, acciones: 0 }).precioMedio === null, "cero acciones: null, no Infinity");
  ok(recompra({ importe: 0, acciones: 1e6 }).precioMedio === null, "importe cero: no se recompró nada");
  ok(recompra({ importe: 1e9, acciones: 10e6 }).retornoDesdeRecompra === null, "sin precio actual no hay retorno");
  ok(lecturaRecompra({ precioMedio: null }) === null, "sin precio medio no hay lectura");

  // Diferencias pequeñas no son lectura: es ruido de estimación, no información.
  const casi = recompra({ importe: 1e9, acciones: 10e6, precioActual: 102 });
  ok(lecturaRecompra(casi, 102) === null, "una diferencia del 2 % no genera lectura: es ruido");
}

// ── La intensidad, para poder comparar entre tamaños ────────────────────────────────────
{
  const r = recompra({ importe: 5e9, acciones: 10e6, precioActual: 520 }, 1000e9);
  cerca(r.intensidad, 0.005, 1e-9, "5.000 M sobre un billón de capitalización = 0,5 %");
  ok(recompra({ importe: 5e9, acciones: 10e6 }).intensidad === null, "sin capitalización, null");
  ok(recompra({ importe: 5e9, acciones: 10e6 }, 0).intensidad === null, "capitalización cero: null, no Infinity");
}

// ── UN HECHO VIEJO NO ES UN VALOR RAZONABLE REVELADO ─────────────────────────────────────
// ⚠️ Tercera vez en esta sesion con el mismo patron: el tag responde y dejo de actualizarse.
// Medido sobre 33 nombres del S&P 500, ONCE publicaban un dato anterior a 2024 y dos de 2013.
// Axon comparaba una recompra de 2016 contra el precio de hoy y daba «+2.922 %»: aritmetica
// impecable y, como lectura, una tonteria. Lo que la directiva creia hace nueve años no es lo
// que cree ahora.
{
  const viejo = recompra({ importe: 1e9, acciones: 10e6, precioActual: 300, antiguedadAnos: 9 });
  ok(viejo.rancio, "un hecho de hace nueve años se marca como rancio");
  ok(viejo.precioMedio === 100, "el precio medio se sigue calculando: el dato existe");
  const l = lecturaRecompra(viejo, 300);
  ok(l.clave === "rancio", "pero la lectura NO es «recompro barato» aunque la accion este 3x");
  ok(/dato hist[oó]rico/.test(l.texto), "se declara dato historico");
  ok(!/valor razonable actual|le ha salido bien/.test(l.texto.replace("no como estimación de valor razonable actual", "")),
     "y no se presenta como lo que la directiva cree hoy");

  const reciente = recompra({ importe: 1e9, acciones: 10e6, precioActual: 300, antiguedadAnos: 1 });
  ok(!reciente.rancio, "uno de hace un año no es rancio");
  ok(lecturaRecompra(reciente, 300).clave === "recompro_barato", "y ese si se lee como valor revelado");

  // Justo en el umbral NO es rancio: los cortes son estrictos.
  const justo = recompra({ importe: 1e9, acciones: 10e6, precioActual: 300, antiguedadAnos: UMBRALES_RECOMPRA.antiguedadMaxAnos });
  ok(!justo.rancio, "exactamente en el umbral todavia vale");
  ok(!recompra({ importe: 1e9, acciones: 10e6 }).rancio, "sin antiguedad declarada no se asume rancio");

  // ⚠️ El orden de las comprobaciones importa: un precio IMPOSIBLE manda sobre uno viejo,
  // porque «no me fio del numero» es mas fuerte que «el numero es antiguo».
  const dos = recompra({ importe: 1e9, acciones: 20e6, precioActual: 100, precioMin: 80, precioMax: 120, antiguedadAnos: 9 });
  ok(lecturaRecompra(dos, 100).clave === "no_creible", "si ademas es imposible, gana «no creible»");
}

console.log(pass && !fail ? `\n✓ recompras: ${pass} passed, 0 failed\n` : `\n✖ recompras: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
