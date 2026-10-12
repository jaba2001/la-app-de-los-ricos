// De los facts XBRL de la SEC a trimestres (lib/server/edgarHechos.js) y su mezcla con FMP
// (lib/trimestres.ts).
//   node --experimental-strip-types --no-warnings scripts/edgarhechos.test.mjs
//
// Cada bloque es un fallo que se vio en la ficha de AAPL el 12-10-2026 (ver la cabecera del
// módulo): ingresos de 2018, flujo de caja con un trimestre por año, CapEx con el signo al
// revés y el cierre de ejercicio ausente del balance.
import { unirConceptos, trimestres, anuales, saldos, construirEstados } from "../lib/server/edgarHechos.js";
import { completarConEdgar } from "../lib/trimestres.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const f = (start, end, val, form = "10-Q", filed = end) => ({ start, end, val, form, filed });

// ── Ingresos: el concepto viejo no gana por existir ─────────────────────────────────────
{
  const viejo = [f("2017-10-01", "2017-12-30", 88), f("2017-10-01", "2018-09-29", 265, "10-K")];
  const nuevo = [f("2025-12-28", "2026-03-28", 111), f("2026-03-29", "2026-06-27", 109)];
  const u = unirConceptos(viejo, nuevo);
  check("se unen los dos conceptos", u.length, 4);
  check("y aparecen los trimestres recientes", [...trimestres(u).keys()].sort().slice(-2), ["2026-03-28", "2026-06-27"]);
  // Mismo periodo presentado dos veces (el 10-K repite el año anterior): gana el último.
  const rep = unirConceptos([f("2025-01-01", "2025-03-31", 10, "10-Q", "2025-05-01")], [f("2025-01-01", "2025-03-31", 12, "10-K", "2026-02-01")]);
  check("periodo repetido → el presentado más tarde", rep.map((x) => x.val), [12]);
}

// ── Acumulados del año → trimestres ─────────────────────────────────────────────────────
{
  // Un ejercicio con 3m, 6m, 9m y 12m (como el flujo de caja de un 10-Q + 10-K).
  const h = [f("2024-10-01", "2024-12-31", 30), f("2024-10-01", "2025-03-31", 50),
             f("2024-10-01", "2025-06-30", 75), f("2024-10-01", "2025-09-30", 110, "10-K")];
  const t = trimestres(h);
  check("Q1 = 3m", t.get("2024-12-31"), 30);
  check("Q2 = 6m − 3m", t.get("2025-03-31"), 20);
  check("Q3 = 9m − 6m", t.get("2025-06-30"), 25);
  check("Q4 = 12m − 9m", t.get("2025-09-30"), 35);
  check("el anual se lee aparte", anuales(h).get("2025-09-30"), 110);
  // Si falta el 6m, el 9m − 3m sería MEDIO AÑO: no se resta.
  const hueco = trimestres([f("2024-10-01", "2024-12-31", 30), f("2024-10-01", "2025-06-30", 75)]);
  check("acumulados no consecutivos → no se inventa un trimestre", hueco.has("2025-06-30"), false);
  // Un trimestre publicado directamente (3 meses) gana a uno derivado.
  const directo = trimestres([...h, f("2025-01-01", "2025-03-31", 21)]);
  check("el dato trimestral directo manda", directo.get("2025-03-31"), 21);
}

// ── Balance: 10-Q y 10-K ────────────────────────────────────────────────────────────────
{
  const s = saldos([{ end: "2025-06-30", val: 1, form: "10-Q", filed: "2025-08-01" }, { end: "2025-09-30", val: 2, form: "10-K", filed: "2025-11-01" }]);
  check("el cierre de ejercicio (10-K) está en el balance", [...s.keys()], ["2025-06-30", "2025-09-30"]);
}

// ── Estados con la forma de FMP ─────────────────────────────────────────────────────────
{
  const e = construirEstados({
    revenueContract: [f("2025-01-01", "2025-03-31", 100), f("2025-04-01", "2025-06-30", 110)],
    operatingCashFlow: [f("2025-01-01", "2025-03-31", 40), f("2025-01-01", "2025-06-30", 90)],
    capex: [f("2025-01-01", "2025-03-31", 5), f("2025-01-01", "2025-06-30", 12)],
    assets: [{ end: "2025-06-30", val: 500, form: "10-Q" }],
    longTermDebtNoncurrent: [{ end: "2025-06-30", val: 80, form: "10-Q" }],
    longTermDebtCurrent: [{ end: "2025-06-30", val: 10, form: "10-Q" }],
    commercialPaper: [{ end: "2025-06-30", val: 5, form: "10-Q" }],
  });
  check("ingresos más reciente primero", e.income.map((r) => r.revenue), [110, 100]);
  check("CapEx NEGATIVO (convenio de FMP: FCF = OCF + CapEx)", e.cashFlow.map((r) => r.capitalExpenditure), [-7, -5]);
  check("FCF del trimestre derivado", e.cashFlow[0].freeCashFlow, 50 - 7);
  check("deuda total = LP + CP + papel comercial", e.balanceSheet[0].totalDebt, 95);
}

// ── FMP (5 trimestres) + EDGAR (los anteriores) ─────────────────────────────────────────
{
  const fmp = [{ date: "2026-06-27", revenue: 1 }, { date: "2026-03-28", revenue: 2 }, { date: "2025-06-28", revenue: 5 }];
  const edgar = [{ date: "2026-06-27", revenue: 9 }, { date: "2025-06-30", revenue: 9 }, { date: "2025-03-29", revenue: 6 }, { date: "2024-12-28", revenue: 7 }];
  const m = completarConEdgar(fmp, edgar);
  check("FMP primero, intacto", m.slice(0, 3).map((r) => r.revenue), [1, 2, 5]);
  check("de EDGAR solo lo anterior (el mismo cierre con 2 días de diferencia NO se repite)", m.slice(3).map((r) => r.date), ["2025-03-29", "2024-12-28"]);
  check("sin FMP, EDGAR entero", completarConEdgar([], edgar).length, 4);
}

console.log(bad ? `\n✗ edgarhechos: ${bad} fallo(s) de ${total}` : `\n✓ edgarhechos: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
