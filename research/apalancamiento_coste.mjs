// ─────────────────────────────────────────────────────────────────────────────
// ¿A QUÉ COSTE DE FINANCIACIÓN DEJA DE MERECER LA PENA?
//
// El backtest del apalancamiento financió a la letra a 3 meses. **Ningún minorista paga eso**,
// así que la cifra de 1.927 % es la cota superior, no lo que obtendría alguien. La pregunta
// útil no es «¿bate al índice?» sino **«¿hasta qué tipo sigue batiéndolo?»** — porque eso decide
// si la idea es un producto o un gráfico bonito.
//
// Se prueban tres cosas que el roadmap necesita saber ANTES de elegir instrumento:
//   1. El punto de equilibrio: el diferencial sobre la letra al que B y C dejan de batir.
//   2. Qué pasa con los tipos REALES de cada vía (margen minorista, IBKR, box spread).
//   3. Si B (fijo) o C (volatilidad objetivo) aguanta mejor el coste — que no es obvio.
//
// ⚠️ Y UNA COMPARACIÓN QUE EL PRIMER SCRIPT HACÍA MAL: B empieza en el mes 60, así que su
// Sharpe de 1,159 NO es comparable con el 1,01 del periodo completo. Aquí los dos se miden
// sobre EL MISMO tramo.
//
//   node --experimental-strip-types --no-warnings research/apalancamiento_coste.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sharpe, maxDrawdown, annualVol } from "../lib/riskMetrics.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(AQUI, "out", "growth_series.json"), "utf8"));
if (!/PORCENTAJE/i.test(G.unidades ?? "")) { console.error("\n  ⛔ unidades no declaradas\n"); process.exit(1); }
const fechas = G.fechas;
const dec = (a) => a.map((x) => x / 100);
const scora = dec(G.estrategias.growth.rets), spy = dec(G.estrategias.spy.rets);

const rfPath = join(AQUI, ".cache", "fredfull", "TB3MS.json");
const rf = existsSync(rfPath) ? JSON.parse(readFileSync(rfPath, "utf8")) : null;
const rfEn = (d) => { if (!rf) return 0; const h = rf.filter((o) => o.date <= d); return h.length ? h.at(-1).v / 100 : 0; };

const total = (r) => (r.reduce((a, b) => a * (1 + b), 1) - 1) * 100;
/** `spread` = puntos porcentuales ANUALES sobre la letra que cobra el prestamista. */
const apalancar = (r, L, spread, off = 0) => r.map((x, i) => {
  const l = typeof L === "number" ? L : L[i + off];
  const coste = (rfEn(fechas[i + off]) + spread / 100) / 12;
  return l * x - (l - 1) * coste;
});

const CORTE = 60;
const scoraB = scora.slice(CORTE), spyB = spy.slice(CORTE);
const LB = annualVol(spy.slice(0, CORTE)) / annualVol(scora.slice(0, CORTE));

const OBJ = annualVol(spy), TOPE = 2.0;
const Lserie = scora.map((_, i) => {
  if (i < 36) return 1;
  const v = annualVol(scora.slice(i - 36, i));
  return v <= 0 ? 1 : Math.min(TOPE, OBJ / v);
});

console.log(`\n  ¿HASTA QUÉ COSTE DE FINANCIACIÓN SIGUE BATIENDO AL ÍNDICE?`);
console.log(`  ${fechas[0]} → ${fechas.at(-1)} · B fijo a ${LB.toFixed(2)}x · C objetivo ${(OBJ * 100).toFixed(1)} % con tope ${TOPE}x\n`);

// ── 1 · La comparación JUSTA: los dos sobre el MISMO tramo ──────────────────────────────
console.log(`  ⚠️ B y C sobre EL MISMO tramo (desde ${fechas[CORTE]}), que es como se comparan de verdad:`);
const cSameB = apalancar(scoraB, Lserie, 0, CORTE);
for (const [n, r] of [["B fijo", apalancar(scoraB, LB, 0)], ["C vol objetivo", cSameB], ["SPY", spyB], ["Scora sin apalancar", scoraB]])
  console.log(`     ${n.padEnd(22)}${(total(r).toFixed(1) + " %").padStart(10)}   Sharpe ${sharpe(r).toFixed(3)}   caída ${(maxDrawdown(r) * 100).toFixed(1)} %`);

// ── 2 · El punto de equilibrio ───────────────────────────────────────────────────────────
console.log(`\n  EL PUNTO DE EQUILIBRIO (diferencial anual sobre la letra al que deja de batir):`);
const equilibrio = (r0, L, ref, off) => {
  let lo = 0, hi = 40;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (total(apalancar(r0, L, m, off)) > total(ref)) lo = m; else hi = m;
  }
  return lo;
};
const eqB = equilibrio(scoraB, LB, spyB, CORTE);
const eqC = equilibrio(scora, Lserie, spy, 0);
console.log(`     B fijo ${LB.toFixed(2)}x            hasta +${eqB.toFixed(1)} pp sobre la letra`);
console.log(`     C volatilidad objetivo     hasta +${eqC.toFixed(1)} pp sobre la letra`);

// ── 3 · Lo que cuesta cada vía DE VERDAD ────────────────────────────────────────────────
// Diferenciales típicos y públicos sobre el tipo de referencia. No son cotizaciones: son el
// orden de magnitud que hay que verificar con el bróker antes de decidir nada.
const VIAS = [
  ["Box spread (opciones SPX)", 0.3, "financiación sintética; requiere permiso de opciones y entenderlo"],
  ["Bróker de bajo coste (tramo alto)", 1.0, "el diferencial baja con el saldo; a saldos pequeños es mayor"],
  ["Bróker de bajo coste (tramo bajo)", 2.5, "lo que paga una cuenta pequeña de verdad"],
  ["Bróker minorista tradicional", 6.0, "el rango habitual va del 8 % al 12 % nominal"],
  ["ETF apalancado 2x", 1.0, "NO APLICA a una cartera propia: sólo existe sobre índices, y con decaimiento diario"],
];
console.log(`\n  QUÉ SOBREVIVE A CADA VÍA (órdenes de magnitud, a verificar con el bróker):`);
console.log(`     vía                                  spread   B          C`);
const filas = [];
for (const [nombre, sp, nota] of VIAS) {
  const tb = total(apalancar(scoraB, LB, sp, CORTE)), tc = total(apalancar(scora, Lserie, sp, 0));
  const bateB = tb > total(spyB), bateC = tc > total(spy);
  filas.push({ via: nombre, spreadPp: sp, totalB: +tb.toFixed(1), totalC: +tc.toFixed(1), bateB, bateC, nota });
  console.log(`     ${nombre.padEnd(36)}+${String(sp).padStart(4)}   ${(bateB ? "BATE" : "no").padEnd(6)}  ${bateC ? "BATE" : "no"}`);
}
console.log(`\n     referencia: SPY ${total(spy).toFixed(1)} % (completo) · ${total(spyB).toFixed(1)} % (desde ${fechas[CORTE]})`);

console.log(`\n  ⚠️ EL ETF APALANCADO NO ES UNA OPCIÓN, y conviene decirlo aquí: sólo existe sobre`);
console.log(`     índices. No hay ningún instrumento que apalanque LA CARTERA DE SCORA. Si se usa`);
console.log(`     un 2x del S&P, ya no se está apalancando Scora: se está comprando otra cosa.`);

writeFileSync(join(AQUI, "out", "apalancamiento_coste.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), factorB: +LB.toFixed(3), volObjetivo: +OBJ.toFixed(4), tope: TOPE,
  equilibrioB_pp: +eqB.toFixed(2), equilibrioC_pp: +eqC.toFixed(2), vias: filas,
  spyTotal: +total(spy).toFixed(1), spyTotalDesdeCorte: +total(spyB).toFixed(1),
  nota: "Los diferenciales son ordenes de magnitud publicos, no cotizaciones. El ETF apalancado NO aplica a una cartera propia: solo existe sobre indices.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/apalancamiento_coste.json\n`);
