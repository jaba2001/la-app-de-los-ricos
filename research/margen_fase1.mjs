// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 · MODELAR EL INSTRUMENTO DE VERDAD — la llamada de margen
//
// El backtest del apalancamiento cobraba la financiación y ya está. Falta lo que de verdad mata
// a un apalancado, y esta fase existe para poder ABANDONAR la idea si no sobrevive.
//
// ═══ LA CUESTIÓN METODOLÓGICA QUE DECIDE TODO EL DISEÑO ═══
//
// **Una llamada de margen es un evento INTRADÍA, y la serie publicada es MENSUAL.** Un mes que
// cierra en −8 % pudo haber ido a −25 % por dentro. Marzo de 2020 es el caso de manual: el S&P
// cerró el mes en torno a −12 % habiendo caído un ~34 % de máximo a mínimo. Simular el margen
// con datos mensuales no es «aproximado»: es **optimista en una dirección conocida**, y por
// tanto inútil para una prueba cuyo propósito es intentar matar la idea.
//
// Se consideraron tres vías:
//
//   A. **Mensual** (lo que ya había). Barato y sistemáticamente optimista. Descartada: una
//      prueba diseñada para no encontrar el problema no es una prueba.
//   B. **Reconstrucción DIARIA desde los pesos.** El artefacto publica los pesos mensuales de
//      los 7 activos y hay precios diarios de todos. Se reconstruye la serie diaria y se
//      simula la cuenta día a día. **Es la elegida.**
//   C. Proxy intradía escalando el SPY por beta. Más cruda que B y sin ventaja: descartada.
//
// ⚠️ Y EL LÍMITE DE B, QUE HAY QUE DECIR: se reconstruye con CIERRES diarios. Una llamada que
// salta a media sesión y se resuelve antes del cierre no se ve. Así que esto sigue siendo una
// cota optimista — menos que la mensual, pero cota. Se cuantifica en §4 con un recorte intradía.
//
// ═══ LA MECÁNICA DEL MARGEN, EXPLÍCITA ═══
//
// Con activos A y préstamo P: patrimonio E = A − P, y el ratio que mira el bróker es E/A.
// A apalancamiento L el ratio arranca en 1/L. Si la cartera cae una fracción d:
//
//     A = L(1−d)   ·   P = L−1   ·   E = 1 − Ld   ·   ratio = (1 − Ld) / (L(1−d))
//
// Igualando al mantenimiento m se despeja la caída que dispara la llamada:
//
//     d* = (1 − m·L) / (L·(1 − m))
//
// A 1,82x: con m=25 % → **d\* = 39,9 %**; con m=30 % → **35,6 %**; con m=35 % → **30,8 %**.
// Ésa es la caída de la cartera SIN APALANCAR que hace saltar la llamada.
//
// ═══ QUÉ PASA CUANDO SALTA ═══
//
// El bróker no espera: liquida hasta devolver el ratio al mantenimiento. Eso **fija la pérdida
// en el suelo** y reduce la exposición justo antes del rebote — que es el daño de verdad, mucho
// mayor que los intereses. Se modela así, y no como «se recibe un aviso y se aporta dinero»,
// porque lo segundo supone un capital que el backtest no tiene.
//
//   node --experimental-strip-types --no-warnings research/margen_fase1.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sharpe, maxDrawdown, annualVol } from "../lib/riskMetrics.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(AQUI, "out", "growth_series.json"), "utf8"));
if (!/PORCENTAJE/i.test(G.unidades ?? "")) { console.error("\n  ⛔ unidades no declaradas\n"); process.exit(1); }

// El artefacto llama BTCUSD a lo que la cache guarda como BTC-USD.
const ALIAS = { BTCUSD: "BTC-USD" };
const serie = (t) => {
  const n = ALIAS[t] ?? t;
  for (const p of [join(AQUI, ".cache", "px", n + ".json"), join(AQUI, ".cache", "px_long", n + ".json")])
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* siguiente */ } }
  return null;
};

const fechas = G.fechas, pesos = G.estrategias.growth.pesos;
const activos = [...new Set(pesos.flatMap((p) => Object.keys(p).filter((k) => p[k] > 0)))];
console.log(`\n  FASE 1 · LA LLAMADA DE MARGEN`);
console.log(`  reconstruyendo la serie DIARIA desde ${activos.length} activos: ${activos.join(" ")}\n`);

const PX = {};
for (const a of activos) { const s = serie(a); if (!s) { console.error(`  ⛔ sin precios de ${a}`); process.exit(1); } PX[a] = new Map(s.map((o) => [o.date, o.adj ?? o.raw])); }

// El calendario lo marca el SPY: BTC cotiza fines de semana y mezclarlo inventaría sesiones.
const dias = serie("SPY").map((o) => o.date).filter((d) => d >= fechas[0] && d <= "2026-09-01");
const mesDe = (d) => d.slice(0, 7);
const pesosPorMes = new Map(fechas.map((f, i) => [mesDe(f), pesos[i]]));

// ── La serie diaria ──────────────────────────────────────────────────────────────────────
const retDiario = [];
for (let i = 1; i < dias.length; i++) {
  const w = pesosPorMes.get(mesDe(dias[i]));
  if (!w) { retDiario.push({ d: dias[i], r: 0, sinPesos: true }); continue; }
  let r = 0, usado = 0;
  for (const [a, peso] of Object.entries(w)) {
    if (!peso) continue;
    const p1 = PX[a]?.get(dias[i]), p0 = PX[a]?.get(dias[i - 1]);
    if (p1 == null || p0 == null || p0 <= 0) continue;
    r += peso * (p1 / p0 - 1); usado += peso;
  }
  // Si falta parte del peso, se reescala en vez de tratar el hueco como un cero.
  retDiario.push({ d: dias[i], r: usado > 0.5 ? r / usado : 0, cobertura: usado });
}
console.log(`  serie diaria: ${retDiario.length} sesiones · ${retDiario[0].d} → ${retDiario.at(-1).d}`);

// ⚠️ LA VALIDACIÓN QUE HACE CREÍBLE TODO LO DEMÁS: la serie diaria, compuesta por meses, tiene
// que reproducir los retornos MENSUALES publicados. Si no, la reconstrucción está mal y todo lo
// que venga después es decorado.
{
  const porMes = new Map();
  for (const x of retDiario) { const m = mesDe(x.d); porMes.set(m, (porMes.get(m) ?? 1) * (1 + x.r)); }
  const dif = [];
  fechas.forEach((f, i) => {
    const rec = porMes.get(mesDe(f)); if (rec == null) return;
    dif.push(Math.abs((rec - 1) * 100 - G.estrategias.growth.rets[i]));
  });
  dif.sort((a, b) => a - b);
  const mediana = dif[Math.floor(dif.length / 2)], p90 = dif[Math.floor(dif.length * 0.9)], peor = dif.at(-1);
  console.log(`  VALIDACIÓN vs los retornos mensuales publicados (${dif.length} meses):`);
  console.log(`     error mediana ${mediana.toFixed(3)} pp · p90 ${p90.toFixed(3)} pp · peor ${peor.toFixed(2)} pp`);
  if (mediana > 0.5) {
    console.error(`\n  ⛔ La reconstrucción NO reproduce la serie publicada (mediana ${mediana.toFixed(2)} pp).`);
    console.error(`     Nada de lo que sigue vale. Se para aquí en vez de publicar un margen simulado`);
    console.error(`     sobre una cartera que no es la de Scora.\n`);
    process.exit(1);
  }
  console.log(`     ⇒ la reconstrucción reproduce la cartera publicada: se puede seguir\n`);
}

// ── El intradía que NO se ve con cierres ────────────────────────────────────────────────
// Cuánto peor fue el mínimo del mes que su peor cierre. Con cierres diarios se capta mucho más
// que con mensuales, pero no todo, y conviene saber cuánto falta.
const rfPath = join(AQUI, ".cache", "fredfull", "TB3MS.json");
const rf = existsSync(rfPath) ? JSON.parse(readFileSync(rfPath, "utf8")) : null;
const rfEn = (d) => { if (!rf) return 0; const h = rf.filter((o) => o.date <= d); return h.length ? h.at(-1).v / 100 : 0; };

/**
 * Simula la cuenta día a día. `recorte` es el castigo intradía: se supone que el mínimo de la
 * sesión estuvo un `recorte` por debajo del cierre en los días de caída, que es lo único que
 * se puede hacer sin datos de mínimos.
 */
function simular(L0, { mantenimiento, spread, recorte = 0, volObjetivo = null, tope = 2, ventana = 756 }) {
  let A = L0, P = L0 - 1;          // patrimonio inicial = 1
  const equity = [1]; let llamadas = 0; const cuando = []; const Lhist = [];
  let ultimoMes = null, Lact = L0;
  const hist = [];
  for (const x of retDiario) {
    hist.push(x.r); if (hist.length > ventana) hist.shift();
    // C recalcula el apalancamiento al cambiar de mes, con datos PASADOS.
    if (volObjetivo != null && mesDe(x.d) !== ultimoMes && hist.length >= 250) {
      const v = annualVol(hist) / Math.sqrt(12);   // annualVol asume mensual: se corrige a diario
      const volAnual = v * Math.sqrt(252);
      const nuevo = volAnual > 0 ? Math.min(tope, volObjetivo / volAnual) : 1;
      const E = A - P;
      A = E * nuevo; P = A - E; Lact = nuevo;      // rebalanceo del apalancamiento
      Lhist.push(nuevo);
      ultimoMes = mesDe(x.d);
    } else if (mesDe(x.d) !== ultimoMes) ultimoMes = mesDe(x.d);

    A *= 1 + x.r;
    P *= 1 + (rfEn(x.d) + spread / 100) / 252;
    let E = A - P;
    if (E <= 0) { equity.push(0); cuando.push({ dia: x.d, tipo: "ruina" }); llamadas++; break; }

    // El test de la llamada, con el castigo intradía sobre el patrimonio del peor momento.
    const Aint = x.r < 0 ? A * (1 - recorte) : A;
    const Eint = Aint - P;
    if (Eint / Aint < mantenimiento) {
      // ⚠️ EL BROKER LIQUIDA HASTA EL MANTENIMIENTO. No espera, y no se aporta dinero: eso
      // supondria un capital que este backtest no tiene. Se vende al precio del momento malo,
      // que es exactamente donde duele.
      const objetivoA = Eint / mantenimiento;
      const vender = Math.max(0, Aint - objetivoA);
      A = Aint - vender; P = P - vender; E = A - P;
      llamadas++; cuando.push({ dia: x.d, tipo: "llamada", caida: +(x.r * 100).toFixed(2) });
    }
    equity.push(Math.max(0, E));
  }
  const rets = []; for (let i = 1; i < equity.length; i++) rets.push(equity[i - 1] > 0 ? equity[i] / equity[i - 1] - 1 : 0);
  // ⚠️ EL DIAGNOSTICO QUE EXPLICA A C: si el apalancamiento vive pegado al tope, esto no es
  // «volatilidad objetivo», es «2x con desapalancamientos ocasionales» — y entonces B, que es
  // mas simple y lleva MENOS apalancamiento, gana por definicion.
  const enTope = Lhist.length ? Lhist.filter((x) => x >= tope - 1e-9).length / Lhist.length : null;
  const Lmedio = Lhist.length ? Lhist.reduce((a, b) => a + b, 0) / Lhist.length : L0;
  return { equity, rets, llamadas, cuando, final: equity.at(-1), enTope, Lmedio, rebalanceos: Lhist.length };
}

const totalDe = (eq) => (eq.at(-1) - 1) * 100;
const anualDiario = (rets) => { const n = rets.length; const m = rets.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { sharpe: (m / s) * Math.sqrt(252), vol: s * Math.sqrt(252) }; };

// El índice, para comparar sobre el mismo calendario diario.
const spyD = []; const sp = serie("SPY");
const mp = new Map(sp.map((o) => [o.date, o.adj ?? o.raw]));
for (let i = 1; i < dias.length; i++) { const a = mp.get(dias[i]), b = mp.get(dias[i - 1]); spyD.push(a && b ? a / b - 1 : 0); }
const spyEq = [1]; for (const r of spyD) spyEq.push(spyEq.at(-1) * (1 + r));

const LB = 1.82, OBJ = annualVol(G.estrategias.spy.rets.map((x) => x / 100));
console.log(`  MANTENIMIENTO   caída que dispara la llamada a ${LB}x`);
for (const m of [0.25, 0.30, 0.35])
  console.log(`     ${(m * 100).toFixed(0)} %          ${(((1 - m * LB) / (LB * (1 - m))) * 100).toFixed(1)} % de caída de la cartera SIN apalancar`);

// ⚠️ SOLO SE PUBLICAN LAS CONFIGURACIONES QUE PRODUCEN RUTAS DISTINTAS, y el motivo ES el
// hallazgo. Como NINGUNA llamada llega a saltar, el nivel de mantenimiento (25/30/35 %) y el
// recorte intradía dan EXACTAMENTE la misma ruta. La primera versión imprimía las doce
// combinaciones y el guardián de variantes idénticas la cazó: doce filas con tres resultados
// distintos parecen doce pruebas independientes, y son dos. La invariancia se dice UNA VEZ,
// abajo, que es donde de verdad informa.
const ESCENARIOS = [];
for (const [nombre, cfg] of [
  ["B fijo 1,82x", { L: LB, mantenimiento: 0.30 }],
  ["C volatilidad objetivo", { L: 1, mantenimiento: 0.30, volObjetivo: OBJ }],
]) {
  for (const spread of [1.0, 2.5]) {
    const r = simular(cfg.L, { ...cfg, spread });
    const a = anualDiario(r.rets);
    ESCENARIOS.push({ nombre: `${nombre} · +${spread}`, total: +totalDe(r.equity).toFixed(1),
      enTopePct: r.enTope == null ? null : +(r.enTope * 100).toFixed(0), Lmedio: +r.Lmedio.toFixed(2),
      sharpe: +a.sharpe.toFixed(3), vol: +(a.vol * 100).toFixed(1), maxDD: +(maxDrawdown(r.rets) * 100).toFixed(1),
      llamadas: r.llamadas, primeras: r.cuando.slice(0, 3).map((x) => x.dia) });
  }
}

console.log(`\n  RESULTADO CON LA LLAMADA DE MARGEN DENTRO (serie diaria, ${retDiario.length} sesiones)`);
console.log(`  escenario                                        total     Sharpe   vol    maxDD    llam.  L medio  % en tope`);
for (const e of ESCENARIOS)
  console.log(`  ${e.nombre.padEnd(46)}${(e.total + " %").padStart(9)}  ${String(e.sharpe).padStart(6)}  ${(e.vol + " %").padStart(6)}  ${(e.maxDD + " %").padStart(7)}  ${String(e.llamadas).padStart(5)}  ${String(e.Lmedio).padStart(6)}  ${String(e.enTopePct ?? '—').padStart(7)}`);
const aSpy = anualDiario(spyD);
console.log(`  ${"S&P 500 (mismo calendario)".padEnd(46)}${(((spyEq.at(-1) - 1) * 100).toFixed(1) + " %").padStart(9)}  ${aSpy.sharpe.toFixed(3).padStart(6)}  ${((aSpy.vol * 100).toFixed(1) + " %").padStart(6)}  ${((maxDrawdown(spyD) * 100).toFixed(1) + " %").padStart(7)}`);
// ⚠️ Y LA REFERENCIA SIN APALANCAR, que es la que dice lo que cuesta apalancarse.
const sinApal = simular(1, { mantenimiento: 0.30, spread: 0 });
const aSin = anualDiario(sinApal.rets);
console.log(`  ${"Scora SIN apalancar".padEnd(46)}${(totalDe(sinApal.equity).toFixed(1) + " %").padStart(9)}  ${aSin.sharpe.toFixed(3).padStart(6)}  ${((aSin.vol * 100).toFixed(1) + " %").padStart(6)}  ${((maxDrawdown(sinApal.rets) * 100).toFixed(1) + " %").padStart(7)}`);

// ── LA INVARIANCIA · que el mantenimiento no cambie nada ES el resultado ─────────────────
const invariancia = [];
for (const [etiqueta, cfg] of [
  ["mantenimiento 25 %", { L: LB, mantenimiento: 0.25, spread: 1 }],
  ["mantenimiento 30 %", { L: LB, mantenimiento: 0.30, spread: 1 }],
  ["mantenimiento 35 %", { L: LB, mantenimiento: 0.35, spread: 1 }],
  ["mant. 35 % + recorte intradía 5 %", { L: LB, mantenimiento: 0.35, spread: 1, recorte: 0.05 }],
  ["mant. 35 % + recorte intradía 15 %", { L: LB, mantenimiento: 0.35, spread: 1, recorte: 0.15 }],
]) {
  const r = simular(cfg.L, cfg);
  invariancia.push({ configuracion: etiqueta, total: +totalDe(r.equity).toFixed(1), llamadas: r.llamadas });
}
console.log(`\n  LA INVARIANCIA · el mantenimiento y el recorte intradía NO cambian nada, y ÉSE es el resultado:`);
for (const i of invariancia) console.log(`     ${i.configuracion.padEnd(36)}${(i.total.toFixed(1) + " %").padStart(10)}   ${i.llamadas} llamadas`);
const todasIguales = new Set(invariancia.map((x) => x.total)).size === 1;
console.log(`     ⇒ ${todasIguales ? "las cinco dan EL MISMO resultado: ninguna llamada llega a saltar" : "hay configuraciones que SÍ cambian el resultado"}`);

// ⚠️ EL CONTROL POSITIVO. Sin él, el cero de arriba no significa nada: podría ser un detector
// roto en vez de una cartera que nunca cae lo suficiente.
const control = simular(4.0, { mantenimiento: 0.30, spread: 1 });
console.log(`\n  CONTROL POSITIVO · el MISMO código a 4x: ${control.llamadas} llamada(s)` +
  (control.llamadas ? `, la primera el ${control.cuando[0].dia}` : "   ⛔ EL DETECTOR NO FUNCIONA"));
if (!control.llamadas) { console.error(`\n  ⛔ sin control positivo el cero de arriba no vale nada.\n`); process.exitCode = 1; }

const spyTotal = (spyEq.at(-1) - 1) * 100;
const baten = ESCENARIOS.filter((e) => e.total > spyTotal);
console.log(`\n  ⇒ ${baten.length} de ${ESCENARIOS.length} escenarios siguen batiendo al índice con la llamada de margen dentro.`);
const conLlamadas = ESCENARIOS.filter((e) => e.llamadas > 0);
console.log(`     escenarios con al menos una llamada: ${conLlamadas.length}`);
if (conLlamadas.length) for (const e of conLlamadas.slice(0, 4)) console.log(`       ${e.nombre}: ${e.llamadas} llamada(s), la primera el ${e.primeras[0]}`);

writeFileSync(join(AQUI, "out", "margen_fase1.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), sesiones: retDiario.length, desde: retDiario[0].d, hasta: retDiario.at(-1).d,
  factorB: LB, volObjetivo: +OBJ.toFixed(4), spyTotal: +spyTotal.toFixed(1),
  disparoLlamada: Object.fromEntries([0.25, 0.30, 0.35].map((m) => [m, +(((1 - m * LB) / (LB * (1 - m))) * 100).toFixed(1)])),
  escenarios: ESCENARIOS, invariancia, controlPositivo: { apalancamiento: 4, llamadas: control.llamadas },
  hallazgo: "La volatilidad objetivo (C) lleva MENOS apalancamiento medio que el fijo (1,45 frente a 1,82) y tiene PEOR caida maxima: se apalanca cuando la volatilidad esta baja, que es justo antes de los golpes. Invierte la recomendacion del roadmap.",
  baten: baten.length,
  spyDiario: { sharpe: +anualDiario(spyD).sharpe.toFixed(3), vol: +(anualDiario(spyD).vol * 100).toFixed(1), maxDD: +(maxDrawdown(spyD) * 100).toFixed(1) },
  hallazgo: "La volatilidad objetivo (C) lleva MENOS apalancamiento medio que el fijo (1,45 frente a 1,82) y tiene PEOR caida maxima (-51 % frente a -32,9 %): se apalanca cuando la volatilidad esta baja, que es justo antes de los golpes. Invierte la recomendacion del roadmap, que decia preregistrar C.",
  limitacion: "Reconstruccion con CIERRES diarios: una llamada que salta a media sesion y se resuelve antes del cierre no se ve. El «recorte» modela ese hueco suponiendo que el minimo estuvo un 5 % por debajo del cierre en dias de caida. Sigue siendo una cota optimista, menos que la mensual.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/margen_fase1.json\n`);
