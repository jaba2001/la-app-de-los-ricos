// ─────────────────────────────────────────────────────────────────────────────
// EL PARSER DE FORM 4
//
// Las cuatro trampas del formato, fijadas con un documento real de Micron (2026-08-28) recortado
// a lo esencial. Cada test dice qué titular se rompería si esa trampa se ignorara.
//
//   node --experimental-strip-types --no-warnings scripts/form4.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { parseForm4, esDecisionDeMercado, decodificar } from "../lib/form4.ts";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)}`);

/** Documento real de Micron, con UNA transacción y UNA tenencia. */
const REAL = `<?xml version="1.0"?>
<ownershipDocument>
  <schemaVersion>X0609</schemaVersion>
  <documentType>4</documentType>
  <periodOfReport>2026-06-26</periodOfReport>
  <issuer>
    <issuerCik>0000723125</issuerCik>
    <issuerName>MICRON TECHNOLOGY INC</issuerName>
    <issuerTradingSymbol>MU</issuerTradingSymbol>
  </issuer>
  <reportingOwner>
    <reportingOwnerId>
      <rptOwnerCik>0001798757</rptOwnerCik>
      <rptOwnerName>Bjorlin Alexis</rptOwnerName>
    </reportingOwnerId>
    <reportingOwnerRelationship>
      <isDirector>true</isDirector>
      <isOfficer>false</isOfficer>
      <isTenPercentOwner>false</isTenPercentOwner>
      <officerTitle></officerTitle>
    </reportingOwnerRelationship>
  </reportingOwner>
  <aff10b5One>false</aff10b5One>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-06-26</value></transactionDate>
      <transactionCoding>
        <transactionFormType>4</transactionFormType>
        <transactionCode>S</transactionCode>
      </transactionCoding>
      <transactionAmounts>
        <transactionShares><value>25.00</value></transactionShares>
        <transactionPricePerShare><value>1132.33</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>235.00</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>I</value></directOrIndirectOwnership>
      </ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeHolding>
      <securityTitle><value>Common Stock</value></securityTitle>
      <postTransactionAmounts>
        <sharesOwnedFollowingTransaction><value>63.00</value></sharesOwnedFollowingTransaction>
      </postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>D</value></directOrIndirectOwnership>
      </ownershipNature>
    </nonDerivativeHolding>
  </nonDerivativeTable>
  <derivativeTable></derivativeTable>
  <footnotes>
    <footnote id="F1">Shares held in a Trust for the benefit of the Reporting Person &amp; her family.</footnote>
  </footnotes>
</ownershipDocument>`;

// ── TRAMPA 1 · una tenencia NO es una operación ──────────────────────────────────────────
// Las dos llevan `sharesOwnedFollowingTransaction`. Contar la tenencia inflaría el recuento y
// crearía operaciones sin precio ni fecha que parecen reales.
{
  const d = parseForm4(REAL);
  ok(d !== null, "el documento se parsea");
  eq(d.operaciones.length, 1, "UNA operación: la tenencia (63 acciones) no cuenta como transacción");
  ok(!d.operaciones.some((o) => o.acciones === 63), "y sus 63 acciones no aparecen como operadas");
}

// ── El ticker viene en el documento ──────────────────────────────────────────────────────
{
  const d = parseForm4(REAL);
  eq(d.ticker, "MU", "el emisor declara su propio ticker: no hay que mapear el CIK");
  eq(d.emisorCik, "0000723125", "y su CIK");
  eq(d.periodo, "2026-06-26", "el periodo del informe");
}

// ── Los campos de la operación ───────────────────────────────────────────────────────────
{
  const o = parseForm4(REAL).operaciones[0];
  eq(o.insider, "Bjorlin Alexis", "quién");
  eq(o.codigo, "S", "código de transacción");
  eq(o.direccion, "D", "dirección: dispuesto");
  eq(o.acciones, 25, "acciones");
  eq(o.precio, 1132.33, "precio");
  ok(Math.abs(o.valor - 28308.25) < 0.01, `valor = acciones × precio (${o.valor})`);
  eq(o.accionesDespues, 235, "acciones tras la operación");
  eq(o.propiedad, "indirecta", "propiedad indirecta (I)");
  eq(o.derivada, false, "no es derivada");
}

// ── TRAMPA: el cargo vacío no se inventa ─────────────────────────────────────────────────
{
  const o = parseForm4(REAL).operaciones[0];
  eq(o.cargo, null, "`officerTitle` vacío queda en null, no en cadena vacía ni inventado");
  eq(o.esDirector, true, "es consejera");
  eq(o.esDirectivo, false, "y NO es directiva — el titular no puede decir «la CEO vendió»");
}

// ── TRAMPA 3 · el plan 10b5-1 ────────────────────────────────────────────────────────────
// Es lo que separa «vendió al ver la caída» de «se ejecutó un plan firmado en marzo». El propio
// titular de Insider Tracker sobre Micron lo delata: «the sale was locked in months before».
{
  const d = parseForm4(REAL);
  eq(d.operaciones[0].plan10b51, false, "el documento declara que NO es un plan preprogramado");
  ok(esDecisionDeMercado(d.operaciones[0]), "una venta sin plan SÍ es una decisión de mercado");

  const conPlan = parseForm4(REAL.replace("<aff10b5One>false", "<aff10b5One>true"));
  eq(conPlan.operaciones[0].plan10b51, true, "y cuando lo es, se lee");
  ok(!esDecisionDeMercado(conPlan.operaciones[0]),
    "una venta CON plan NO es decisión de mercado, aunque el código siga siendo S");

  const sinCampo = parseForm4(REAL.replace(/<aff10b5One>false<\/aff10b5One>/, ""));
  eq(sinCampo.operaciones[0].plan10b51, null,
    "si el documento no lo declara, es null — no se da por falso, que sería lo favorable");
}

// ── TRAMPA 2 · el código no es opcional ──────────────────────────────────────────────────
// «Vendió 37 M$» cuando el código es `M` (ejercicio de opciones) o `F` (retención para impuestos)
// es el error que se ve en la competencia.
{
  for (const [cod, esDecision] of [["P", true], ["S", true], ["A", false], ["M", false], ["F", false], ["G", false]]) {
    const d = parseForm4(REAL.replace("<transactionCode>S<", `<transactionCode>${cod}<`));
    eq(d.operaciones[0].codigo, cod, `el código ${cod} se conserva tal cual`);
    eq(esDecisionDeMercado(d.operaciones[0]), esDecision,
      `${cod} ${esDecision ? "SÍ" : "NO"} es una decisión de mercado`);
  }
}

// ── Las derivadas se distinguen ──────────────────────────────────────────────────────────
{
  const conOpciones = REAL.replace("<derivativeTable></derivativeTable>", `<derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Stock Option (right to buy)</value></securityTitle>
      <transactionDate><value>2026-06-26</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>`);
  const d = parseForm4(conOpciones);
  eq(d.operaciones.length, 2, "la derivada también es una operación");
  const der = d.operaciones.find((o) => o.derivada);
  ok(der != null, "y se marca como derivada");
  eq(der.titulo, "Stock Option (right to buy)", "con su título");
  eq(der.valor, null, "sin precio no se inventa un valor");
}

// ── Entidades XML ────────────────────────────────────────────────────────────────────────
{
  eq(decodificar("Moelis &amp; Co"), "Moelis & Co", "las entidades se decodifican");
  const d = parseForm4(REAL);
  ok(d.notas[0]?.includes("Person & her family"), `la nota al pie llega decodificada (${d.notas[0]?.slice(0, 40)})`);
}

// ── Bordes ───────────────────────────────────────────────────────────────────────────────
{
  eq(parseForm4(""), null, "un texto vacío no es un Form 4");
  eq(parseForm4("<html>no soy xml</html>"), null, "ni un HTML cualquiera");
  const vacio = parseForm4("<ownershipDocument><documentType>4</documentType></ownershipDocument>");
  ok(vacio !== null && vacio.operaciones.length === 0, "un documento sin operaciones da lista vacía, no revienta");
}

console.log(pass && !fail ? `\n✓ form4: ${pass} passed, 0 failed\n` : `\n✖ form4: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
