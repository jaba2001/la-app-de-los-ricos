// ─────────────────────────────────────────────────────────────────────────────
// INGRESOS POR SEGMENTO
//
// Cada caso viene de un fallo REAL medido contra un 10-K el 2026-09-02. El XBRL de aquí es
// sintético pero reproduce la estructura exacta que produjo cada defecto.
//
//   node --experimental-strip-types --no-warnings scripts/segmentos.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { contextos, hechos, nombreDeMiembro, quitarPadres, desgloseIngresos, EJE_SEGMENTO, EJE_PRODUCTO } from "../lib/segmentos.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

const AÑO = { i: "2025-01-01", f: "2025-12-31" };
const ANTES = { i: "2024-01-01", f: "2024-12-31" };

/** Un contexto: `dims` es una lista de [eje, miembro]. */
const ctxXml = (id, dims, per = AÑO, instante = false) => `
<context id="${id}"><entity><identifier scheme="http://www.sec.gov/CIK">0000001</identifier>${
  dims.length ? `<segment>${dims.map(([a, m]) => `<xbrldi:explicitMember dimension="${a}">${m}</xbrldi:explicitMember>`).join("")}</segment>` : ""
}</entity><period>${instante ? `<instant>${per.f}</instant>` : `<startDate>${per.i}</startDate><endDate>${per.f}</endDate>`}</period></context>`;

const hechoXml = (tag, ctx, v) => `<${tag} contextRef="${ctx}" unitRef="usd" decimals="-6">${v}</${tag}>`;
const REV = "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax";
const REVS = "us-gaap:Revenues";

// ── Lo básico: contextos y hechos ────────────────────────────────────────────────────────
{
  const xml = ctxXml("c1", []) + ctxXml("c2", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("c3", [], AÑO, true);
  const c = contextos(xml);
  eq(c.size, 3, "se leen los tres contextos");
  eq(Object.keys(c.get("c1").dims).length, 0, "el consolidado no tiene dimensiones");
  eq(c.get("c2").dims[EJE_SEGMENTO], "x:AMember", "se lee el eje y su miembro");
  eq(c.get("c3").instante, true, "un contexto de saldo se marca como instante");
  eq(c.get("c1").instante, false, "y uno de periodo, no");
}

// ── El mismo hecho publicado dos veces (Apple con `Service`) ─────────────────────────────
// Un contexto identifica un hecho. Si sale repetido es la misma cifra en dos tablas del informe,
// no dos cifras. Sin deduplicar, el desglose la sumaba dos veces.
{
  const xml = ctxXml("c1", []) + hechoXml(REV, "c1", 100) + hechoXml(REV, "c1", 100);
  eq(hechos(xml, [REV]).length, 1, "el mismo tag y contexto dos veces es UN hecho");
}

// ── Nombres de miembro ───────────────────────────────────────────────────────────────────
eq(nombreDeMiembro("nvda:ComputeAndNetworkingSegmentMember"), "Compute And Networking", "se limpia el prefijo y el sufijo");
eq(nombreDeMiembro("us-gaap:ProductMember"), "Product", "y el sufijo simple");

// ── quitarPadres ─────────────────────────────────────────────────────────────────────────
{
  // El caso de NVIDIA: Data Center 193,7 = Compute 162,4 + Networking 31,4, en el mismo eje.
  const l = [{ valor: 193.7 }, { valor: 162.4 }, { valor: 31.4 }, { valor: 16.0 }];
  eq(quitarPadres(l).length, 3, "se quita el padre y quedan los hijos");
  ok(!quitarPadres(l).some((x) => x.valor === 193.7), "y el que se quita es el padre, no un hijo");

  // ⚠️ El caso de Apple: dos miembros con el MISMO valor. Aceptando subconjuntos de uno solo, cada
  // uno «explicaba» al otro y se borraban los dos. Un padre tiene AL MENOS DOS hijos.
  eq(quitarPadres([{ valor: 50 }, { valor: 50 }, { valor: 30 }]).length, 3,
     "dos valores iguales no se explican mutuamente");

  eq(quitarPadres([{ valor: 10 }, { valor: 20 }]).length, 2, "con menos de tres no se toca nada");
}

// ── El desglose completo ─────────────────────────────────────────────────────────────────
{
  // Caso limpio: total 100, dos segmentos 60 + 40.
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + hechoXml(REV, "t", 100) + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40);
  const d = desgloseIngresos(xml);
  eq(d.total, 100, "el total consolidado");
  eq(d.cuadre, 1, "y las líneas cuadran");
  eq(d.lineas.length, 2, "dos segmentos");
  eq(d.eje, EJE_SEGMENTO, "por el eje de segmentos");
}

// ⚠️ TRES EJERCICIOS EN EL MISMO FICHERO. Un 10-K compara con los dos años anteriores; sin filtrar
// por periodo el total sale por triplicado.
{
  const xml = ctxXml("t", []) + ctxXml("t0", [], ANTES)
    + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + ctxXml("a0", [[EJE_SEGMENTO, "x:AMember"]], ANTES) + ctxXml("b0", [[EJE_SEGMENTO, "x:BMember"]], ANTES)
    + hechoXml(REV, "t", 100) + hechoXml(REV, "t0", 90)
    + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40)
    + hechoXml(REV, "a0", 55) + hechoXml(REV, "b0", 35);
  const d = desgloseIngresos(xml);
  eq(d.periodo.fin, "2025-12-31", "se coge el ejercicio más reciente");
  eq(d.cuadre, 1, "y el anterior NO contamina el cuadre");
  eq(d.lineas.length, 2, "dos líneas, no cuatro");
}

// ⚠️ UN SALDO NO ES UN PERIODO. Mezclar `instant` con `duration` suma un balance a una cuenta de
// resultados.
{
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + ctxXml("s", [[EJE_SEGMENTO, "x:AMember"]], AÑO, true)
    + hechoXml(REV, "t", 100) + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40) + hechoXml(REV, "s", 999);
  eq(desgloseIngresos(xml).cuadre, 1, "el contexto de saldo se ignora");
}

// ⚠️ DOS EJES ES UNA CASILLA DE TABLA CRUZADA, no un segmento.
{
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + ctxXml("x", [[EJE_SEGMENTO, "x:AMember"], ["srt:StatementGeographicalAxis", "country:US"]])
    + hechoXml(REV, "t", 100) + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40) + hechoXml(REV, "x", 25);
  eq(desgloseIngresos(xml).cuadre, 1, "el cruce segmento × geografía no entra");
}

// ⚠️ …PERO `ConsolidationItemsAxis=OperatingSegments` ES UN CALIFICADOR, no un cruce. Descartarlo
// tiraba los segmentos de verdad de Apple y dejaba sólo las líneas de producto.
{
  const CAL = "us-gaap:ConsolidationItemsAxis", OP = "us-gaap:OperatingSegmentsMember";
  const xml = ctxXml("t", [])
    + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"], [CAL, OP]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"], [CAL, OP]])
    + hechoXml(REV, "t", 100) + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40);
  const d = desgloseIngresos(xml);
  eq(d.cuadre, 1, "con el calificador se lee igual");
  eq(d.lineas.length, 2, "y salen los dos segmentos");
}

// ⚠️ EL TOTAL Y EL DESGLOSE PUEDEN USAR ETIQUETAS DISTINTAS. Aptiv declara el total con
// `RevenueFromContractWithCustomer…` y los segmentos con `Revenues` (69 hechos frente a 9).
{
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + hechoXml(REV, "t", 100) + hechoXml(REVS, "a", 60) + hechoXml(REVS, "b", 40);
  const d = desgloseIngresos(xml);
  eq(d.cuadre, 1, "el total en una etiqueta y las líneas en otra");
  eq(d.tag, REVS, "y se dice con cuál se leyeron las líneas");
}

// ⚠️ …PERO CADA CANDIDATO USA UNA SOLA ETIQUETA. Juntarlas todas en un conjunto hacía que un
// combo recogiera el mismo segmento por dos etiquetas y lo sumara dos veces: la cobertura medida
// BAJÓ de 38 % a 33 % con ese fallo.
{
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b", [[EJE_SEGMENTO, "x:BMember"]])
    + ctxXml("a2", [[EJE_SEGMENTO, "x:AMember"]]) + ctxXml("b2", [[EJE_SEGMENTO, "x:BMember"]])
    + hechoXml(REV, "t", 100)
    + hechoXml(REV, "a", 60) + hechoXml(REV, "b", 40)
    + hechoXml(REVS, "a2", 60) + hechoXml(REVS, "b2", 40);
  const d = desgloseIngresos(xml);
  eq(d.cuadre, 1, "las dos etiquetas describen lo mismo: NO se suman");
  eq(d.lineas.length, 2, "dos líneas, no cuatro");
}

// ⚠️ Y EL NIVEL: padre e hijos conviven en el mismo eje (NVIDIA).
{
  const xml = ctxXml("t", [])
    + ctxXml("dc", [[EJE_PRODUCTO, "x:DataCenterMember"]])
    + ctxXml("co", [[EJE_PRODUCTO, "x:ComputeMember"]]) + ctxXml("ne", [[EJE_PRODUCTO, "x:NetworkingMember"]])
    + ctxXml("ga", [[EJE_PRODUCTO, "x:GamingMember"]])
    + hechoXml(REV, "t", 210)
    + hechoXml(REV, "dc", 194) + hechoXml(REV, "co", 162) + hechoXml(REV, "ne", 32) + hechoXml(REV, "ga", 16);
  const d = desgloseIngresos(xml);
  eq(d.cuadre, 1, "quitando el padre, cuadra");
  eq(d.nivelesMezclados, true, "y se dice que hubo que quitarlo");
  ok(!d.lineas.some((l) => l.nombre === "Data Center"), "el padre no sale en las líneas");
}

// ── Lo que no se puede leer se dice, no se rellena ───────────────────────────────────────
{
  const d = desgloseIngresos(ctxXml("t", []) + hechoXml(REV, "t", 100));
  eq(d.lineas.length, 0, "un total sin líneas no inventa un desglose");
  ok(!!d.motivo, "y explica por qué");
  eq(d.total, 100, "pero conserva el total, que sí es cierto");
}
{
  const d = desgloseIngresos("<xml/>");
  eq(d.total, null, "sin nada, nada");
  ok(!!d.motivo, "con su motivo");
}
// Un solo miembro no es un desglose: es el total con otra etiqueta.
{
  const xml = ctxXml("t", []) + ctxXml("a", [[EJE_SEGMENTO, "x:AMember"]])
    + hechoXml(REV, "t", 100) + hechoXml(REV, "a", 100);
  eq(desgloseIngresos(xml).lineas.length, 0, "una sola línea no es un desglose");
}

console.log(pass && !fail ? `\n✓ segmentos: ${pass} passed, 0 failed\n` : `\n✖ segmentos: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
