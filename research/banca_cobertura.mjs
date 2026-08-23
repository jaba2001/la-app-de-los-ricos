// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA DE MÉTRICAS BANCARIAS (Fase F4, paso 1 — medir antes de construir)
//
// Scora Picks no puede comprar bancos. No es un fallo de cobertura: es que se les aplica el
// modelo de otra industria. Un banco no presenta balance clasificado —no tiene "activo
// corriente" ni "coste de ventas"— porque su negocio no funciona así. Medido: de 79 nombres
// financieros, el 73 % no tiene activo corriente, el 82 % no tiene margen bruto y el 92 % no
// admite Beneish. Y §2ter de SCORA_PICKS_REGLAS.md ya recogía que 0 de 18 bancos llegan a
// puntuar.
//
// La pregunta que responde este script, y NADA más: ¿existen en XBRL los datos para un juego
// de métricas propio de banca? Si no existen, se sabe en un día y sin haber construido nada.
//
//   node --experimental-strip-types --no-warnings research/banca_cobertura.mjs [--asof …]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

/**
 * Las métricas con las que se juzga de verdad a un banco, y los tags que las sostienen.
 * Cada entrada lista alternativas: basta una.
 */
const METRICAS = {
  "Cartera de crédito": ["FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss",
                         "LoansAndLeasesReceivableNetReportedAmount", "NotesReceivableNet",
                         "FinancingReceivableBeforeAllowanceForCreditLossNoncurrent"],
  "Provisión acumulada": ["FinancingReceivableAllowanceForCreditLosses",
                          "FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest",
                          "LoansAndLeasesReceivableAllowance"],
  "Dotación del periodo": ["ProvisionForLoanLeaseAndOtherLosses", "ProvisionForLoanAndLeaseLosses",
                           "ProvisionForCreditLossesExpenseReversal", "CreditLossExpenseReversal"],
  "Morosos": ["FinancingReceivableRecordedInvestmentNonaccrualStatus",
              "FinancingReceivableNonaccrualNoAllowance", "FinancingReceivableRecordedInvestment90DaysPastDueStillAccruing"],
  "Margen de intereses": ["InterestIncomeExpenseNet", "InterestIncomeExpenseAfterProvisionForLoanLoss"],
  "Ingresos por intereses": ["InterestAndDividendIncomeOperating", "InterestIncomeOperating"],
  "Gastos por intereses": ["InterestExpense", "InterestExpenseDeposits"],
  "Comisiones": ["NoninterestIncome", "FeesAndCommissions"],
  "Gastos de explotación": ["NoninterestExpense", "OtherNoninterestExpense"],
  "Depósitos": ["Deposits", "InterestBearingDepositLiabilities"],
  "Capital nivel 1 (%)": ["TierOneRiskBasedCapitalToRiskWeightedAssets",
                          "TierOneLeverageCapitalToAverageAssets"],
  "Capital CET1 (%)": ["CommonEquityTierOneCapitalToRiskWeightedAssets",
                       "CommonEquityTier1CapitalToRiskWeightedAssets"],
  // Aseguradoras
  "Primas devengadas": ["PremiumsEarnedNet", "PremiumsWritten", "PremiumsEarnedNetPropertyAndCasualty"],
  "Siniestralidad": ["PolicyholderBenefitsAndClaimsIncurredNet", "LiabilityForClaimsAndClaimsAdjustmentExpense",
                     "IncurredClaimsPropertyCasualtyAndLiability"],
  "Gastos de adquisición": ["DeferredPolicyAcquisitionCostAmortizationExpense", "DeferredPolicyAcquisitionCosts"],
};

/** SIC → subsector financiero. Distinguirlos importa: un banco y una aseguradora no comparten
 *  ni una sola de las métricas que los explican. */
function subsector(sic) {
  if (sic == null) return null;
  if (sic >= 6020 && sic <= 6036) return "Banca comercial";
  if (sic >= 6035 && sic <= 6099) return "Banca / ahorro";
  if (sic >= 6199 && sic <= 6299) return "Mercados de capitales";
  if (sic >= 6300 && sic <= 6411) return "Seguros";
  if (sic >= 6500 && sic <= 6599) return "Inmobiliario";
  if (sic >= 6000 && sic <= 6199) return "Banca / otros";
  if (sic >= 6700 && sic <= 6799) return "Holdings / fondos";
  return null;
}

const empresas = [];
for (const f of readdirSync(DIR).filter((x) => /^CIK\d+\.json$/.test(x))) {
  const cik = f.slice(3, -5);
  const sf = join(DIR, `sub${cik}.json`);
  if (!existsSync(sf)) continue;
  let sic = null, nombre = cik;
  try { const s = JSON.parse(readFileSync(sf, "utf8")); sic = s?.sic ? Number(s.sic) : null; nombre = s?.name ?? cik; } catch { continue; }
  const sub = subsector(sic);
  if (!sub) continue;
  let g = null;
  try { g = JSON.parse(readFileSync(join(DIR, f), "utf8"))?.facts?.["us-gaap"]; } catch { continue; }
  if (!g) continue;

  // ¿El tag existe Y sigue vivo? Un tag abandonado en 2013 no sirve para puntuar hoy — es la
  // misma lección del ancla de antigüedad en `edgar.mjs`.
  const tiene = {};
  for (const [m, tags] of Object.entries(METRICAS)) {
    let ultimo = null;
    for (const t of tags) {
      const arr = g[t]?.units?.USD ?? g[t]?.units?.pure;
      if (!Array.isArray(arr)) continue;
      const ends = arr.filter((x) => x.filed <= ASOF).map((x) => x.end).sort();
      const u = ends[ends.length - 1];
      if (u && (!ultimo || u > ultimo)) ultimo = u;
    }
    tiene[m] = ultimo;
  }
  empresas.push({ cik, nombre, sic, sub, tiene });
}

const HACE2A = new Date(Date.parse(ASOF) - 730 * 86400000).toISOString().slice(0, 10);
const vivo = (u) => !!u && u >= HACE2A;

const subs = [...new Set(empresas.map((e) => e.sub))];
console.log(`\n  Cobertura de métricas bancarias · ${ASOF} · ${empresas.length} financieras en caché`);
console.log(`  (se cuenta sólo lo que sigue VIVO: último dato posterior a ${HACE2A})\n`);

const porSub = {};
for (const s of subs) porSub[s] = empresas.filter((e) => e.sub === s).length;
console.log("  " + "métrica".padEnd(24) + subs.map((s) => s.slice(0, 13).padStart(14)).join(""));
console.log("  " + "".padEnd(24) + subs.map((s) => `n=${porSub[s]}`.padStart(14)).join(""));
const tabla = {};
for (const m of Object.keys(METRICAS)) {
  const fila = {};
  const celdas = subs.map((s) => {
    const de = empresas.filter((e) => e.sub === s);
    const c = de.filter((e) => vivo(e.tiene[m])).length;
    fila[s] = { con: c, de: de.length, pct: de.length ? +(100 * c / de.length).toFixed(0) : null };
    return `${c}/${de.length} ${String(fila[s].pct ?? "—").padStart(3)}%`.padStart(14);
  });
  tabla[m] = fila;
  console.log("  " + m.padEnd(24) + celdas.join(""));
}

// ── Veredicto por modelo: un modelo sólo existe si están TODAS sus entradas ────────────────
const MODELOS = {
  "Calidad del crédito": ["Cartera de crédito", "Provisión acumulada", "Dotación del periodo"],
  "Rentabilidad bancaria": ["Margen de intereses", "Comisiones", "Gastos de explotación"],
  "Ratio de eficiencia": ["Margen de intereses", "Comisiones", "Gastos de explotación"],
  "Solvencia regulatoria": ["Capital nivel 1 (%)"],
  "Seguros · siniestralidad": ["Primas devengadas", "Siniestralidad"],
};
console.log(`\n  Modelos completos (todas sus entradas vivas):\n`);
console.log("  " + "modelo".padEnd(28) + subs.map((s) => s.slice(0, 13).padStart(14)).join(""));
const veredicto = {};
for (const [mod, req] of Object.entries(MODELOS)) {
  const fila = {};
  const celdas = subs.map((s) => {
    const de = empresas.filter((e) => e.sub === s);
    const c = de.filter((e) => req.every((m) => vivo(e.tiene[m]))).length;
    fila[s] = { con: c, de: de.length, pct: de.length ? +(100 * c / de.length).toFixed(0) : null };
    return `${c}/${de.length} ${String(fila[s].pct ?? "—").padStart(3)}%`.padStart(14);
  });
  veredicto[mod] = fila;
  console.log("  " + mod.padEnd(28) + celdas.join(""));
}

const ruta = join(OUT, "banca_cobertura.json");
writeFileSync(ruta, JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: ASOF, vivoDesde: HACE2A,
  empresas: empresas.length, porSubsector: porSub, metricas: tabla, modelos: veredicto,
  nota: "Sólo cobertura de datos. No mide ninguna capacidad predictiva y no autoriza a construir nada por sí solo.",
}, null, 1));
console.log(`\n  → ${ruta}\n`);
