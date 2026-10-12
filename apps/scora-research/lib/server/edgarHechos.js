// De los «facts» XBRL de la SEC a trimestres con la forma de FMP. Funciones puras, con prueba
// en scripts/edgarhechos.test.mjs.
//
// POR QUÉ SE REESCRIBIÓ (12-10-2026, recorrido con sesión de la ficha de AAPL):
//   · Los ingresos se tomaban del concepto `Revenues` solo porque EXISTÍA. AAPL lo dejó en 2018
//     y desde entonces reporta `RevenueFromContractWithCustomerExcludingAssessedTax`: cero
//     trimestres de ingresos y «el último año» era 2018. Ahora se unen todos los conceptos de
//     ingresos y, para cada periodo, gana el dato presentado más tarde.
//   · En los 10-Q el flujo de caja viene ACUMULADO en el año (3, 6, 9 meses) y el anual en el
//     10-K. Solo se aceptaban periodos de ~90 días, así que de cada año quedaba el primer
//     trimestre. Ahora los acumulados se convierten en trimestres restando el anterior.
//   · CapEx salía POSITIVO, y toda la app calcula FCF = OCF + CapEx con el convenio de FMP
//     (negativo): el FCF de cada ficha salía inflado en el doble del CapEx.
//   · El balance solo miraba 10-Q: el cierre de ejercicio (10-K) no aparecía nunca.

const DIA = 86400000;
// Lo que no sea una lista cuenta como vacío: la SEC a veces devuelve un objeto en su lugar.
const lista = (x) => (Array.isArray(x) ? x : []);
const dias = (f) => (+new Date(f.end) - +new Date(f.start)) / DIA;

/**
 * Los hechos de un concepto, de la respuesta de companyfacts (`facts["us-gaap"]`). El BPA
 * viene en «USD/shares» y las acciones en «shares», no en «USD». Solo vale una lista no vacía.
 */
export function unidadesDe(gaap, tag) {
  for (const u of ['USD', 'USD/shares', 'shares']) {
    const v = gaap?.[tag]?.units?.[u];
    if (Array.isArray(v) && v.length) return v;
  }
  return [];
}

/** Une varios conceptos (y presentaciones repetidas): por periodo, el presentado más tarde. */
export function unirConceptos(...listas) {
  const porPeriodo = new Map();
  // Lo que no sea una lista se ignora: la SEC a veces devuelve un objeto vacío en su lugar
  // (KO, 12-10-2026) y un concepto raro no puede tumbar los demás.
  for (const l of listas) for (const f of lista(l)) {
    if (f?.end == null || f.val == null) continue;
    const k = `${f.start ?? ""}|${f.end}`;
    const prev = porPeriodo.get(k);
    if (!prev || String(f.filed ?? "") > String(prev.filed ?? "")) porPeriodo.set(k, f);
  }
  return [...porPeriodo.values()];
}

/**
 * Flujos (resultados, caja): un valor por trimestre, indexado por la fecha de cierre.
 * Primero los periodos de un trimestre (70–110 días); los que faltan se sacan de los
 * acumulados del mismo ejercicio (mismo `start`): Q2 = 6m − 3m, Q3 = 9m − 6m, Q4 = 12m − 9m.
 * @returns {Map<string, number>} fecha de cierre → valor del trimestre
 */
export function trimestres(hechos) {
  const out = new Map();
  const conDuracion = lista(hechos).filter((f) => f.start && f.end);
  for (const f of conDuracion) { const d = dias(f); if (d >= 70 && d <= 110) out.set(f.end, f.val); }
  const porInicio = new Map();
  for (const f of conDuracion) {
    const d = dias(f);
    if (d < 70 || d > 400) continue;
    if (!porInicio.has(f.start)) porInicio.set(f.start, []);
    porInicio.get(f.start).push(f);
  }
  for (const grupo of porInicio.values()) {
    grupo.sort((a, b) => +new Date(a.end) - +new Date(b.end));
    for (let i = 1; i < grupo.length; i++) {
      const actual = grupo[i], previo = grupo[i - 1];
      const salto = (+new Date(actual.end) - +new Date(previo.end)) / DIA;
      // Solo restar acumulados CONSECUTIVOS (un trimestre de diferencia); si falta uno en medio,
      // la resta daría medio año y se haría pasar por un trimestre.
      if (salto < 70 || salto > 110 || out.has(actual.end)) continue;
      out.set(actual.end, actual.val - previo.val);
    }
  }
  return out;
}

/** Ejercicios completos (300–400 días), uno por fecha de cierre. */
export function anuales(hechos) {
  const out = new Map();
  for (const f of lista(hechos)) if (f.start && f.end && dias(f) >= 300 && dias(f) <= 400) out.set(f.end, f.val);
  return out;
}

/** Saldos (balance) de 10-Q Y 10-K, uno por fecha. */
export function saldos(hechos) {
  const out = new Map();
  for (const f of [...lista(hechos)].sort((a, b) => String(a.filed ?? "").localeCompare(String(b.filed ?? "")))) {
    if (f.end && !f.start && (f.form === "10-Q" || f.form === "10-K")) out.set(f.end, f.val);
  }
  return out;
}

const fechasDesc = (m, n) => [...m.keys()].sort().reverse().slice(0, n);
const de = (m, k) => (m.has(k) ? m.get(k) : null);

/**
 * Construye las filas con nombres de FMP. `c` son los facts en crudo por concepto.
 * @returns {{ income, balanceSheet, cashFlow, annualIncome }}
 */
export function construirEstados(c, { nTrimestres = 12 } = {}) {
  const ingresos = unirConceptos(c.revenues, c.revenueContract, c.salesRevenueNet);
  const revQ = trimestres(ingresos), revA = anuales(ingresos);
  const grossQ = trimestres(unirConceptos(c.grossProfit));
  const opQ = trimestres(unirConceptos(c.operatingIncome));
  const netQ = trimestres(unirConceptos(c.netIncome)), netA = anuales(unirConceptos(c.netIncome));
  const ocf = unirConceptos(c.operatingCashFlow), capex = unirConceptos(c.capex);
  const ocfQ = trimestres(ocf), capQ = trimestres(capex);
  const ocfA = anuales(ocf), capA = anuales(capex);
  // El BPA no se puede restar entre acumulados (cambia el nº de acciones): solo el trimestral.
  const epsQ = new Map(lista(c.eps).filter((f) => f.start && f.end && dias(f) >= 70 && dias(f) <= 110).map((f) => [f.end, f.val]));
  // Acciones diluidas medias: un PROMEDIO, no se puede restar entre acumulados. Solo trimestral.
  const accQ = new Map(lista(c.dilutedShares).filter((f) => f.start && f.end && dias(f) >= 70 && dias(f) <= 110).map((f) => [f.end, f.val]));

  const income = fechasDesc(revQ, nTrimestres).map((date) => ({
    date,
    revenue: de(revQ, date),
    grossProfit: de(grossQ, date),
    operatingIncome: de(opQ, date),
    netIncome: de(netQ, date),
    eps: de(epsQ, date),
    weightedAverageShsOutDil: de(accQ, date), // mismo nombre que FMP
  }));

  const activos = saldos(c.assets), caja = saldos(c.cash), patrimonio = saldos(c.equity), pasivos = saldos(c.liabilities);
  const deudaLP = saldos(c.longTermDebtNoncurrent), deudaCP = saldos(c.longTermDebtCurrent), papel = saldos(c.commercialPaper), deuda = saldos(c.longTermDebt);
  const balanceSheet = fechasDesc(activos, nTrimestres).map((date) => {
    // Deuda total = LP + CP + papel comercial cuando la empresa los desglosa; si no, LongTermDebt.
    const desglose = [de(deudaLP, date), de(deudaCP, date), de(papel, date)].filter((v) => v != null);
    return {
      date,
      totalAssets: de(activos, date),
      cashAndCashEquivalents: de(caja, date),
      totalDebt: de(deudaLP, date) != null ? desglose.reduce((s, v) => s + v, 0) : de(deuda, date),
      totalStockholdersEquity: de(patrimonio, date),
      totalLiabilities: de(pasivos, date),
    };
  });

  const cashFlow = fechasDesc(ocfQ, nTrimestres).map((date) => {
    const o = de(ocfQ, date), k = de(capQ, date);
    const capitalExpenditure = k != null ? -Math.abs(k) : null; // convenio de FMP: negativo
    return { date, operatingCashFlow: o, capitalExpenditure, freeCashFlow: o != null && capitalExpenditure != null ? o + capitalExpenditure : null };
  });

  const annualIncome = fechasDesc(revA, 5).map((date) => {
    const o = de(ocfA, date), k = de(capA, date);
    return {
      date, calendarYear: new Date(date).getFullYear(),
      revenue: de(revA, date), netIncome: de(netA, date),
      freeCashFlow: o != null && k != null ? o - Math.abs(k) : null,
    };
  });

  return { income, balanceSheet, cashFlow, annualIncome };
}
