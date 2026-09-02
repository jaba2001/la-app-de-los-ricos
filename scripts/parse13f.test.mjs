// ─────────────────────────────────────────────────────────────────────────────
// EL PARSER DE 13F
//
// Cinco trampas, todas medidas sobre declarantes reales antes de escribir el módulo. Cada test
// dice qué se rompería si se ignorara.
//
//   node --experimental-strip-types --no-warnings scripts/parse13f.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { parse13F, periodoISO, ficheroDeTabla, retrasoDias } from "../lib/parse13f.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

/** Berkshire, SIN espacios de nombres — la forma de tres de cada cuatro declarantes. */
const SIN_NS = `<informationTable>
  <infoTable>
    <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>02005N100</cusip>
    <value>577211815</value>
    <shrsOrPrnAmt><sshPrnamt>12561737</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
  </infoTable>
</informationTable>`;

/** Bridgewater, CON espacios de nombres y con FIGI. */
const CON_NS = `<?xml version="1.0" encoding="utf-8"?>
<ns1:informationTable xmlns:ns1="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <ns1:infoTable>
    <ns1:nameOfIssuer>10X GENOMICS INC</ns1:nameOfIssuer>
    <ns1:titleOfClass>CL A COM</ns1:titleOfClass>
    <ns1:cusip>88025U109</ns1:cusip>
    <ns1:figi>BBG007WX14Y9</ns1:figi>
    <ns1:value>512798</ns1:value>
    <ns1:shrsOrPrnAmt><ns1:sshPrnamt>25000</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>
  </ns1:infoTable>
</ns1:informationTable>`;

// ── TRAMPA 1 · los espacios de nombres ───────────────────────────────────────────────────
// Sin esto, Bridgewater daba 0 posiciones teniendo 997. Y cero se lee como «no tiene nada».
{
  eq(parse13F(SIN_NS).posiciones.length, 1, "sin prefijo se parsea");
  eq(parse13F(CON_NS).posiciones.length, 1, "CON prefijo también — es el fallo que daba 0 de 997");

  const p = parse13F(CON_NS).posiciones[0];
  eq(p.emisor, "10X GENOMICS INC", "y todos los campos salen con prefijo");
  eq(p.cusip, "88025U109", "el CUSIP");
  eq(p.cantidad, 25000, "la cantidad, que está anidada dos niveles");
  eq(p.tipoCantidad, "SH", "y su tipo");
}

// ── TRAMPA 3 · el FIGI existe pero casi nadie lo pone ────────────────────────────────────
// Medido: Bridgewater 100 %, Berkshire 0 %, Renaissance 0 %, Pershing 0 %. Es un identificador
// abierto y perfecto que NO sirve de clave porque no está.
{
  eq(parse13F(CON_NS).posiciones[0].figi, "BBG007WX14Y9", "cuando está, se lee");
  eq(parse13F(SIN_NS).posiciones[0].figi, null, "y cuando no está es null, no se inventa");
  eq(parse13F(SIN_NS).posiciones[0].cusip, "02005N100", "el CUSIP sí está siempre: es la clave");
}

// ── TRAMPA 5 · las opciones NO son acciones ──────────────────────────────────────────────
// «Tiene 5 M$ de NVDA» cuando son puts es exactamente lo contrario de lo que parece.
{
  const conOpciones = SIN_NS.replace("</informationTable>", `
  <infoTable>
    <nameOfIssuer>NVIDIA CORP</nameOfIssuer>
    <cusip>67066G104</cusip>
    <value>5000000</value>
    <shrsOrPrnAmt><sshPrnamt>10000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <putCall>Put</putCall>
  </infoTable>
</informationTable>`);
  const r = parse13F(conOpciones);
  eq(r.posiciones.length, 2, "las dos posiciones se leen");
  eq(r.acciones.length, 1, "pero sólo UNA es acciones");
  eq(r.acciones[0].emisor, "ALLY FINL INC", "el put de NVDA queda fuera");
  eq(r.posiciones.find((p) => p.emisor === "NVIDIA CORP").opcion, "Put", "y se marca como put");
  eq(r.valorTotal, 577211815, "el valor total NO incluye la opción");
}

// ── Y el principal de deuda tampoco es acciones ──────────────────────────────────────────
{
  const conDeuda = SIN_NS.replace("<sshPrnamtType>SH</sshPrnamtType>", "<sshPrnamtType>PRN</sshPrnamtType>");
  eq(parse13F(conDeuda).acciones.length, 0, "una posición PRN (deuda) no cuenta como acciones");
}

// ── TRAMPA 4 · la fecha viene en MM-DD-AAAA ──────────────────────────────────────────────
// Parsearla como ISO da fechas inválidas EN SILENCIO, y se propagan a todo lo que se publique.
{
  eq(periodoISO("06-30-2026"), "2026-06-30", "MM-DD-AAAA se convierte");
  eq(periodoISO("12-31-2025"), "2025-12-31", "y cruza el fin de año");
  eq(periodoISO("2026-06-30"), "2026-06-30", "si ya viene en ISO, se respeta");
  eq(periodoISO("30/06/2026"), null, "un formato desconocido da null, NO una fecha inventada");
  eq(periodoISO(null), null, "y null da null");
  eq(parse13F(SIN_NS, "06-30-2026").periodo, "2026-06-30", "el parser lo aplica");
}

// ── TRAMPA 2 · el fichero de la tabla no se llama igual ──────────────────────────────────
// Reales: 56757.xml, form13fInfoTable.xml, infotable.xml, renaissance13Fq22026_holding.xml.
{
  eq(ficheroDeTabla(["primary_doc.xml", "56757.xml"]), "56757.xml", "Berkshire");
  eq(ficheroDeTabla(["primary_doc.xml", "form13fInfoTable.xml"]), "form13fInfoTable.xml", "BlackRock");
  eq(ficheroDeTabla(["primary_doc.xml", "infotable.xml"]), "infotable.xml", "Bridgewater");
  eq(ficheroDeTabla(["primary_doc.xml", "renaissance13Fq22026_holding.xml"]), "renaissance13Fq22026_holding.xml", "Renaissance");
  eq(ficheroDeTabla(["x-index.html", "primary_doc.xml", "a.xml"]), "a.xml", "el HTML no confunde");
  // Ambiguo o ausente: null, y quien llama lo cuenta. Adivinar sería peor.
  eq(ficheroDeTabla(["primary_doc.xml", "a.xml", "b.xml"]), null, "con dos candidatos no se adivina");
  eq(ficheroDeTabla(["primary_doc.xml"]), null, "sin tabla, null");
  eq(ficheroDeTabla([]), null, "sin ficheros, null");
}

// ── El retraso regulatorio se publica ────────────────────────────────────────────────────
// Una cartera de hace mes y medio presentada sin esa fecha se lee como si fuera de hoy.
{
  eq(retrasoDias("2026-06-30", "2026-08-14"), 45, "Berkshire: 45 días exactos");
  eq(retrasoDias("2026-03-31", "2026-05-15"), 45, "Pershing: los mismos 45");
  eq(retrasoDias(null, "2026-08-14"), null, "sin periodo no se calcula");
  eq(retrasoDias("2026-06-30", null), null, "ni sin presentación");
}

// ── Bordes ───────────────────────────────────────────────────────────────────────────────
{
  const vacio = parse13F("<informationTable></informationTable>");
  eq(vacio.posiciones.length, 0, "una tabla vacía da cero posiciones");
  eq(vacio.valorTotal, 0, "y valor cero");
  eq(parse13F("").posiciones.length, 0, "un texto vacío no revienta");

  const sinValor = SIN_NS.replace("<value>577211815</value>", "<value></value>");
  eq(parse13F(sinValor).posiciones[0].valor, null, "un valor vacío es null, no cero");
  eq(parse13F(sinValor).valorTotal, 0, "y no suma al total");
}

console.log(pass && !fail ? `\n✓ parse13f: ${pass} passed, 0 failed\n` : `\n✖ parse13f: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
