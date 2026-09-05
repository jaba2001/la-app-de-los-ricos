// Tests de las piezas del roadmap (F4 monitor de mercado · F5 dividendos).
//   node --experimental-strip-types --no-warnings scripts/roadmap.test.mjs
import { marketMomentum, marketMomentumLine } from "../lib/marketMomentum.ts";
import { dividendGrades, dividendGradeFrom } from "../lib/dividends.ts";
import { stockPickingRegime, GATE_CORR_LOW, GATE_CORR_HIGH } from "../lib/microScore.ts";
import { buildConsensus } from "../lib/consensus.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };

// ── F4 · Market Momentum ─────────────────────────────────────────────────────
{
  ok(marketMomentum({}) === null, "monitor: sin señales suficientes devuelve null (no inventa un número)");
  ok(marketMomentum({ breadth200: 60, breadth50: 60 }) === null, "monitor: con 2 señales tampoco (mínimo 3)");

  const fuerte = marketMomentum({ breadth200: 78, breadth50: 80, breadthMom: 72, breadth1m: 70, riskOn: 75, impliedCorr: 18, hyOas: 300 });
  ok(fuerte && fuerte.score >= 70, `monitor: un entorno amplio puntúa alto (${fuerte?.score})`);
  ok(fuerte.state === "THRUST" || fuerte.state === "TRENDING", "monitor: y lo etiqueta como constructivo");
  ok(fuerte.signals.length === 7, "monitor: cuenta las señales presentes");
  ok(fuerte.signals.every((s) => typeof s.raw === "number"), "monitor: cada señal conserva su valor CRUDO, no sólo el normalizado");

  const debil = marketMomentum({ breadth200: 22, breadth50: 20, breadthMom: 30, breadth1m: 25, riskOn: 20, impliedCorr: 55, hyOas: 750 });
  ok(debil && debil.score <= 30, `monitor: un entorno de estrés puntúa bajo (${debil?.score})`);
  ok(debil.state === "STRESSED", "monitor: y lo etiqueta como estresado");

  // La divergencia es el aviso clásico: índice arriba, participación estrecha.
  const div = marketMomentum({ breadth200: 38, breadth50: 45, breadthMom: 40, riskOn: 60, spyVs200: 5 });
  ok(div?.divergence === true, "monitor: detecta la divergencia índice-arriba / amplitud-floja");
  ok(div?.state === "DETERIORATING", "monitor: la divergencia manda sobre el nivel del score");

  // Señales invertidas: más correlación y más diferencial de crédito = peor entorno.
  const buenCredito = marketMomentum({ breadth200: 50, breadth50: 50, breadthMom: 50, hyOas: 300 });
  const malCredito = marketMomentum({ breadth200: 50, breadth50: 50, breadthMom: 50, hyOas: 800 });
  ok(buenCredito.score > malCredito.score, "monitor: un diferencial de crédito alto BAJA la nota");
  const pocaCorr = marketMomentum({ breadth200: 50, breadth50: 50, breadthMom: 50, impliedCorr: 15 });
  const muchaCorr = marketMomentum({ breadth200: 50, breadth50: 50, breadthMom: 50, impliedCorr: 60 });
  ok(pocaCorr.score > muchaCorr.score, "monitor: una correlación alta BAJA la nota");
  ok(marketMomentumLine(null).length > 0, "monitor: la frase resumen degrada sin datos");
}

// ── El gate continuo (lo único que replicó fuera de muestra) ─────────────────
{
  ok(stockPickingRegime(10).gate === 1, "gate: por debajo del umbral bajo, exposición completa");
  ok(stockPickingRegime(50).gate === 0, "gate: por encima del umbral alto, exposición nula");
  const medio = stockPickingRegime(30).gate;
  ok(medio > 0.4 && medio < 0.6, `gate: a mitad de camino, exposición intermedia (${medio}) — CONTINUO, no a saltos`);
  ok(stockPickingRegime(25).gate > stockPickingRegime(35).gate, "gate: monotónico — más correlación, menos exposición");
  // El contrato de las etiquetas no se movió al hacerlo continuo (los golden lo fijan).
  ok(stockPickingRegime(GATE_CORR_LOW).regime === "mixed", "gate: el borde inferior sigue siendo 'mixed'");
  ok(stockPickingRegime(GATE_CORR_HIGH).regime === "mixed", "gate: el borde superior sigue siendo 'mixed'");
  ok(stockPickingRegime(null).gate === 0.5, "gate: sin lectura de correlación, exposición neutra");
}

// ── F5 · Dividend Grades ─────────────────────────────────────────────────────
{
  ok(dividendGrades({}).paysDividend === false, "dividendos: sin dividendo no se inventan notas");
  ok(dividendGrades({}).grades.length === 0, "dividendos: y no devuelve grados");

  // Un dividendo sano: payout contenido, cubierto por caja, balance cómodo, subiendo.
  const sano = dividendGrades({
    dividendYield: 2.4, payoutRatio: 0.35, fcfPayoutRatio: 0.4, interestCoverage: 15,
    netDebtEbitda: 1, dpsHistory: [2.2, 2.0, 1.85, 1.7, 1.55, 1.4], epsGrowth: 8,
  });
  const seg = sano.grades.find((g) => g.key === "safety");
  ok(sano.paysDividend, "dividendos: reconoce que paga");
  ok(seg.score >= 70, `dividendos: un payout cubierto saca buena nota de seguridad (${seg.score})`);
  ok(sano.warnings.length === 0, "dividendos: sin avisos cuando no hay nada que avisar");
  ok(sano.grades.find((g) => g.key === "growth").score >= 60, "dividendos: un DPS creciente puntúa en crecimiento");
  ok(sano.grades.find((g) => g.key === "consistency").score >= 60, "dividendos: sin recortes, consistencia alta");

  // La trampa clásica: rentabilidad enorme que el mercado ya está descontando.
  const trampa = dividendGrades({ dividendYield: 13, payoutRatio: 1.4, fcfPayoutRatio: 1.6, interestCoverage: 1.2, netDebtEbitda: 6 });
  ok(trampa.grades.find((g) => g.key === "safety").score < 35, "dividendos: un payout no cubierto hunde la seguridad");
  ok(trampa.warnings.length >= 2, "dividendos: y salta con varios avisos explícitos");
  ok(trampa.warnings.some((w) => w.includes("free cash flow")), "dividendos: avisa de que no lo cubre la caja");
  // Una rentabilidad del 13% NO puede puntuar mejor que una del 4%: eso es la trampa.
  const normal = dividendGrades({ dividendYield: 4 });
  ok(normal.grades.find((g) => g.key === "yield").score > trampa.grades.find((g) => g.key === "yield").score,
    "dividendos: un 13% puntúa PEOR que un 4% — la rentabilidad extrema es un aviso, no un premio");

  // Un recorte pasado pesa, porque es el mejor predictor de otro.
  const conRecorte = dividendGrades({ dividendYield: 3, dpsHistory: [1.0, 1.0, 1.5, 1.5, 1.4] });
  const sinRecorte = dividendGrades({ dividendYield: 3, dpsHistory: [1.5, 1.4, 1.3, 1.2, 1.1] });
  ok(conRecorte.grades.find((g) => g.key === "consistency").score < sinRecorte.grades.find((g) => g.key === "consistency").score,
    "dividendos: un recorte pasado penaliza la consistencia");
  ok(conRecorte.grades.find((g) => g.key === "consistency").reasons.some((r) => r.includes("cut")),
    "dividendos: y lo dice con palabras, no sólo con la nota");

  ok(dividendGradeFrom(96) === "A+" && dividendGradeFrom(0) === "F", "dividendos: los cortes de letra funcionan");
  ok(sano.grades.every((g) => g.reasons.length > 0), "dividendos: TODA nota viene con su motivo");
}

// ── F3 · Consenso triple ─────────────────────────────────────────────────────
{
  ok(buildConsensus({}).agreement === "insufficient", "consenso: con menos de dos opiniones no se pronuncia");
  ok(buildConsensus({ scoraTotal: 70 }).agreement === "insufficient", "consenso: una sola opinión no es un consenso");

  const alineado = buildConsensus({
    scoraTotal: 75, scoraRating: "BUY",
    street: { strongBuy: 8, buy: 6, hold: 2, sell: 0, strongSell: 0 },
    priceTarget: 130, price: 100,
  });
  ok(alineado.agreement === "aligned", "consenso: tres visiones alcistas = alineado");
  ok(alineado.views.length === 3, "consenso: devuelve las tres visiones");
  ok(alineado.note.includes("edge"), "consenso: avisa de que el acuerdo no suele ser donde está la ventaja");

  const enfrentado = buildConsensus({
    scoraTotal: 78, scoraRating: "BUY",
    street: { strongBuy: 0, buy: 1, hold: 3, sell: 5, strongSell: 3 },
    priceTarget: 92, price: 100,
  });
  ok(enfrentado.agreement === "conflicted", "consenso: Scora alcista contra la calle bajista = conflicto");
  ok(!enfrentado.note.toLowerCase().includes("opportunity"), "consenso: NO vende la discrepancia como oportunidad");
  ok(enfrentado.note.includes("does not make it the right one"), "consenso: dice explícitamente que Scora puede ser el equivocado");

  const objetivo = buildConsensus({ scoraTotal: 50, priceTarget: 150, price: 100 });
  ok(objetivo.views.find((v) => v.key === "target").value === "+50%", "consenso: calcula bien el recorrido al objetivo");
  ok(objetivo.views.find((v) => v.key === "target").stance === "bullish", "consenso: +50% de recorrido es alcista");
  const cero = buildConsensus({ scoraTotal: 50, street: { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 } });
  ok(cero.agreement === "insufficient", "consenso: un recuento de analistas vacío no cuenta como opinión");
}

console.log(`\n${fail === 0 ? "✓" : "✗"} roadmap (F3+F4+F5): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
