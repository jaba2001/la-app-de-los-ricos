// ─────────────────────────────────────────────────────────────────────────────
// LOS HECHOS DE UNA TABLA DE MOVIMIENTOS
//
// Lo que fijan estos tests, y el orden es el de importancia:
//
//   1. Que NO se afirme una concentración sectorial cuando faltan sectores.
//   2. Que una coincidencia numérica entre sectores distintos NO se venda como patrón.
//   3. Que el texto no lleve conectores de causa.
//   4. Que todo número del texto salga de las filas.
//
//   node --experimental-strip-types --no-warnings scripts/narrativa.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { hechosDeCabecera, hechoDeAmplitud, redactar, numerosNoSoportados, UMBRALES_NARRATIVA } from "../lib/narrativa.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

/** La semana real del 2026-08-21 al 31: seis de ocho son software empresarial. */
const GANAN = [
  { ticker: "CRM", pct: 23.12, sector: "Technology" },
  { ticker: "CRWD", pct: 20.34, sector: "Technology" },
  { ticker: "VEEV", pct: 15.24, sector: "Technology" },
  { ticker: "NOW", pct: 15.19, sector: "Technology" },
  { ticker: "SLB", pct: 11.56, sector: "Energy" },
  { ticker: "FTNT", pct: 11.35, sector: "Technology" },
  { ticker: "CDW", pct: 10.97, sector: "Consumer Cyclical" },
  { ticker: "SNPS", pct: 10.49, sector: "Technology" },
];

/** Y las dos eléctricas de California cayendo exactamente lo mismo. */
const PIERDEN = [
  { ticker: "PCG", pct: -24.6, sector: "Utilities" },
  { ticker: "EIX", pct: -24.6, sector: "Utilities" },
  { ticker: "PYPL", pct: -14.44, sector: "Technology" },
  { ticker: "MRVL", pct: -10.71, sector: "Technology" },
  { ticker: "GNRC", pct: -10.0, sector: null },
  { ticker: "CASY", pct: -9.99, sector: "Consumer Cyclical" },
  { ticker: "HWM", pct: -9.84, sector: "Materials" },
  { ticker: "AXON", pct: -9.75, sector: "Industrials" },
];

// ── La concentración sectorial ───────────────────────────────────────────────────────────
{
  const h = hechosDeCabecera(GANAN, "suben");
  const c = h.find((x) => x.tipo === "concentracion");
  ok(c != null, "se detecta la concentración");
  ok(/6 de las 8/.test(c.texto), `«6 de las 8» (${c.texto})`);
  ok(/Technology/.test(c.texto), "con el sector nombrado");
  eq(c.evidencia.sort(), ["CRM", "CRWD", "FTNT", "NOW", "SNPS", "VEEV"], "y la evidencia son los seis tickers");
}

// ── ⚠️ Sin sectores suficientes NO se afirma nada ────────────────────────────────────────
// Es el error de colar un dato ausente como si fuera un hecho. Con la mitad sin sector, una
// «concentración» calculada sobre el resto no describe la cabecera.
{
  const mutilada = GANAN.map((f, i) => (i < 5 ? { ...f, sector: null } : f));
  const h = hechosDeCabecera(mutilada, "suben");
  ok(!h.some((x) => x.tipo === "concentracion"),
    "con 5 de 8 sin sector no se afirma concentración");
  const aviso = h.find((x) => x.tipo === "sin_sector");
  ok(aviso != null, "y se dice cuántos faltan");
  ok(/no se afirma nada sobre concentración/.test(aviso.texto), `explicando por qué (${aviso.texto})`);
}

// ── Con pocos huecos sí se afirma, pero se declaran ──────────────────────────────────────
{
  const h = hechosDeCabecera(PIERDEN, "bajan");
  const aviso = h.find((x) => x.tipo === "sin_sector");
  ok(aviso != null && aviso.evidencia.includes("GNRC"), "GNRC no tiene sector y se dice");
  ok(!/no se afirma nada/.test(aviso.texto), "pero uno de ocho no invalida el resto");
}

// ── ⚠️ Una coincidencia entre sectores distintos NO es co-movimiento ─────────────────────
// Con 500 nombres, que dos cualesquiera coincidan al decimal es azar. Venderlo como patrón sería
// exactamente lo que hace la competencia con sus vitrinas de aciertos.
{
  const h = hechosDeCabecera(PIERDEN, "bajan");
  const co = h.filter((x) => x.tipo === "comovimiento");
  ok(co.length === 1, `un solo co-movimiento (salieron ${co.length})`);
  eq(co[0].evidencia.sort(), ["EIX", "PCG"], "las dos eléctricas");
  ok(/Utilities/.test(co[0].texto), "con el sector, que es lo que lo hace algo más que una coincidencia");

  // MRVL −10,71 y GNRC −10,00 difieren 0,71 (menos del umbral) pero son sectores distintos.
  ok(!co.some((x) => x.evidencia.includes("MRVL") && x.evidencia.includes("GNRC")),
    "MRVL y GNRC casi coinciden pero NO son el mismo sector: no se afirma nada");

  // Y dos movimientos pequeños que coinciden tampoco cuentan.
  const pequenos = [
    { ticker: "AA", pct: 0.21, sector: "Technology" },
    { ticker: "BB", pct: 0.22, sector: "Technology" },
  ];
  ok(!hechosDeCabecera(pequenos, "suben").some((x) => x.tipo === "comovimiento"),
    "dos subidas del 0,2 % coincidentes no son un hecho");
}

// ── ⚠️ El co-movimiento NO repite lo que ya dice la concentración ────────────────────────
// Si seis de ocho son tecnología, que dos de ellas se muevan parecido es la misma observación
// contada dos veces. Con la semana real salían TRES frases donde había una idea.
{
  const h = hechosDeCabecera(GANAN, "suben");
  const co = h.filter((x) => x.tipo === "comovimiento");
  ok(!co.some((x) => x.evidencia.includes("VEEV") && x.evidencia.includes("NOW")),
    `VEEV y NOW se mueven igual pero Technology ya está declarada concentrada: no se repite (salieron ${co.length})`);

  // Y en los perdedores, donde Utilities NO domina, el co-movimiento SÍ informa.
  const hp = hechosDeCabecera(PIERDEN, "bajan");
  ok(hp.some((x) => x.tipo === "comovimiento" && x.evidencia.includes("PCG")),
    "PCG y EIX sí se declaran: Utilities son sólo 2 de 8, así que el co-movimiento es información nueva");

  // Una pareja por sector como mucho, aunque haya varias que coincidan.
  const muchas = [
    { ticker: "A", pct: 20.0, sector: "Energy" },
    { ticker: "B", pct: 20.1, sector: "Energy" },
    { ticker: "C", pct: 20.2, sector: "Energy" },
  ];
  ok(hechosDeCabecera(muchas, "suben").filter((x) => x.tipo === "comovimiento").length === 1,
    "tres del mismo sector que coinciden dan UNA frase, no tres");
}

// ── ⚠️ El extremo sólo se dice cuando se despega ─────────────────────────────────────────
// La primera fila ya está en la tabla que el lector tiene delante: repetirla no informa.
{
  // CRWD +5,77 contra TSLA +5,51: no se despega.
  const pegados = [
    { ticker: "CRWD", pct: 5.77, sector: "Technology" },
    { ticker: "TSLA", pct: 5.51, sector: "Consumer Cyclical" },
  ];
  ok(!hechosDeCabecera(pegados, "suben").some((x) => x.tipo === "extremo"),
    "con el primero a 1,05× del segundo no se dice nada: la tabla ya lo enseña");

  // MRNA +156 contra PLTR +51: eso sí es una distancia.
  const despegado = [
    { ticker: "MRNA", pct: 156.0, sector: "Healthcare" },
    { ticker: "PLTR", pct: 51.45, sector: "Technology" },
  ];
  const e = hechosDeCabecera(despegado, "suben").find((x) => x.tipo === "extremo");
  ok(e != null, "con el primero a 3× del segundo sí");
  ok(/se despega/.test(e.texto), `y lo que se dice es la DISTANCIA, no el puesto (${e?.texto})`);
  ok(e.evidencia.length === 2, "con los dos como evidencia, que es lo que se compara");
}

// ── Concordancia ─────────────────────────────────────────────────────────────────────────
{
  const uno = hechosDeCabecera(PIERDEN, "bajan").find((x) => x.tipo === "sin_sector");
  ok(/no tiene sector/.test(uno.texto), `singular con uno (${uno.texto})`);
  const dos = PIERDEN.map((f, k) => (k < 2 ? { ...f, sector: null } : f));
  const h = hechosDeCabecera(dos, "bajan").find((x) => x.tipo === "sin_sector");
  ok(/no tienen sector/.test(h.texto), `plural con dos (${h.texto})`);
}

// ── La amplitud pone el contexto que falta en diez filas ─────────────────────────────────
{
  const universo = [...Array(400)].map((_, i) => ({ ticker: `T${i}`, pct: i < 320 ? 1 : -1 }));
  const a = hechoDeAmplitud(universo);
  ok(a != null && /320 de 400/.test(a.texto), `cuenta el universo entero (${a?.texto})`);
  ok(/80 %/.test(a.texto), "con su porcentaje");
  eq(hechoDeAmplitud([{ ticker: "A", pct: 1 }]), null, "con menos de 20 nombres no se afirma amplitud");
}

// ── ⚠️ El texto NO insinúa causas ────────────────────────────────────────────────────────
{
  const texto = redactar([...hechosDeCabecera(GANAN, "suben"), hechoDeAmplitud(
    [...Array(100)].map((_, i) => ({ ticker: `T${i}`, pct: i < 60 ? 1 : -1 })),
  )].filter(Boolean));
  for (const prohibido of ["porque", "debido a", "impulsad", "gracias a", "ante el", "tras el"]) {
    ok(!texto.toLowerCase().includes(prohibido), `el texto no dice «${prohibido}» (${texto.slice(0, 80)}…)`);
  }
  for (const futuro of ["podría", "se espera", "apunta a", "seguirá"]) {
    ok(!texto.toLowerCase().includes(futuro), `ni «${futuro}»`);
  }
  ok(texto.endsWith("."), "y acaba en punto");
}

// ── Todo número del texto sale de las filas ──────────────────────────────────────────────
{
  const texto = redactar(hechosDeCabecera(GANAN, "suben"));
  eq(numerosNoSoportados(texto, GANAN), [], `ningún número inventado (${texto})`);

  // Y el guardián detecta uno que no está — es para cuando encima haya un modelo.
  const conInvento = texto + " El sector subió un 42,7 % en el mes.";
  ok(numerosNoSoportados(conInvento, GANAN).includes("42.7"),
    "un número que no está en las filas se detecta");
}

// ── Bordes ───────────────────────────────────────────────────────────────────────────────
{
  eq(hechosDeCabecera([], "suben"), [], "sin filas no hay hechos");
  eq(redactar([]), "", "sin hechos no hay texto");
  const uno = hechosDeCabecera([{ ticker: "A", pct: 30, sector: "Technology" }], "suben");
  ok(!uno.some((x) => x.tipo === "concentracion"), "una sola fila no es una concentración");
  ok(uno.some((x) => x.tipo === "extremo"), "pero sí es el extremo");
}

// ── Los umbrales están declarados ────────────────────────────────────────────────────────
ok(UMBRALES_NARRATIVA.minConcentracion >= 3,
  `hacen falta al menos 3 del mismo sector (${UMBRALES_NARRATIVA.minConcentracion}): con 2 de 8 no hay patrón`);
ok(UMBRALES_NARRATIVA.minMovimiento >= 1,
  "y los movimientos pequeños no generan hechos");

console.log(pass && !fail ? `\n✓ narrativa: ${pass} passed, 0 failed\n` : `\n✖ narrativa: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
