// ─────────────────────────────────────────────────────────────────────────────
// ¿SON LOS PARÁMETROS ÓPTIMOS EN TODAS PARTES, O SÓLO EN LA MUESTRA COMPLETA?
//
// Medido: las TRES palancas del asignador —umbral del riskOn (50), cadencia (mensual) y ventana
// de la puerta de tendencia (12-1)— son el máximo de su rejilla sobre la muestra completa.
// Ninguna se eligió barriendo, pero que las tres convenciones resulten óptimas a la vez es
// mucha suerte, y eso obliga a preguntar dónde está el máximo **por tramos**.
//
// ═══ POR QUÉ ESTA PREGUNTA ES LA QUE DECIDE ═══
//
// Un parámetro puede ser el máximo de la muestra completa por dos razones opuestas:
//
//   · **Porque el efecto es REAL y estable.** Entonces también será el máximo, o casi, en cada
//     tramo por separado. La estabilidad del argmax es la firma de un efecto de verdad.
//   · **Porque un tramo tira del promedio.** Entonces el argmax bailará entre tramos, y el
//     óptimo global será un artefacto de mezclar épocas distintas.
//
// Las dos producen exactamente el mismo número en la muestra completa. Sólo se distinguen
// partiéndola.
//
// ═══ Y EL TEST QUE DE VERDAD IMPORTA ═══
//
// Más duro que mirar los argmax: **¿qué habrías ELEGIDO calibrando en el tramo 1, y cómo te
// habría ido en el 2?** Eso es el fuera de muestra del PARÁMETRO, no de la estrategia — y es lo
// que un evaluador serio pregunta cuando ve tres convenciones que ganan a la vez.
//
// Si el valor calibrado en el pasado hubiera sido el de producción, la elección está
// justificada por los datos que había. Si hubiera sido otro, entonces el 12-1 y el 50 se
// sostienen sólo por convención — que no es poco, pero no es lo mismo.
//
//   node --experimental-strip-types --no-warnings research/estabilidad_parametros.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { riskOnAsOf, preloadStationary } from "./regimeStationary.mjs";
import { applyDualMomentum } from "./allocate.mjs";
import { sharpe, maxDrawdown } from "../lib/riskMetrics.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const G = JSON.parse(readFileSync(join(AQUI, "out", "growth_series.json"), "utf8"));
if (!/PORCENTAJE/i.test(G.unidades ?? "")) { console.error("\n  ⛔ unidades no declaradas\n"); process.exit(1); }
const fechas = G.fechas;

const ALIAS = { BTCUSD: "BTC-USD" };
const cargar = (t) => {
  const n = ALIAS[t] ?? t;
  for (const p of [join(AQUI, ".cache", "px", n + ".json"), join(AQUI, ".cache", "px_long", n + ".json")])
    if (existsSync(p)) { try { return new Map(JSON.parse(readFileSync(p, "utf8")).map((o) => [o.date, o.adj ?? o.raw])); } catch { /* siguiente */ } }
  return null;
};
const ACTIVOS = ["SPY", "TLT", "IEF", "GLD", "DBC", "BIL", "BTCUSD"];
const PX = {}; for (const a of ACTIVOS) { const m = cargar(a); if (m) PX[a] = m; }
const p = (a, d) => { const m = PX[a]; if (!m) return null;
  for (let i = 0; i < 10; i++) { const k = new Date(new Date(d).getTime() - i * 86400000).toISOString().slice(0, 10); if (m.has(k)) return m.get(k); } return null; };
const menos = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - n); return x.toISOString().slice(0, 10); };

// La cesta se LEE del codigo, no se copia: escribirla de memoria ya salio mal una vez.
const FUENTE = readFileSync(join(AQUI, "allocate.mjs"), "utf8");
const M = FUENTE.match(/const GROWTH_RISKOFF = (\{[^}]*\})/);
if (!M) { console.error("  ⛔ no se encuentra GROWTH_RISKOFF"); process.exit(1); }
const RISKOFF = JSON.parse(M[1].replace(/([A-Z]+):/g, '"$1":').replace(/,\s*\}/, "}"));

const BTC_DESDE = "2018-06-01", COSTE_BPS = 10;
const PROD = { umbral: 50, cada: 1, ventLarga: 12, ventCorta: 1, sleeve: 0.05 };

await preloadStationary();
const riskOn = [];
for (const f of fechas) { const r = await riskOnAsOf(f); riskOn.push(typeof r === "number" ? r : r?.riskOn ?? null); }
console.log(`\n  ESTABILIDAD DE LOS PARÁMETROS · ${fechas.length} meses · cesta leída del código\n`);

function correr(cfg, desde = 0, hasta = fechas.length - 1) {
  const c = { ...PROD, ...cfg };
  const rets = []; let antes = null, w = null;
  for (let i = desde; i < hasta; i++) {
    if ((i - desde) % c.cada === 0 || w == null) {
      const ro = riskOn[i];
      if (ro == null || ro < c.umbral) w = { ...RISKOFF };
      else {
        let btc = 0;
        if (fechas[i] >= BTC_DESDE && c.sleeve > 0) {
          const p0 = p("BTCUSD", fechas[i]), pL = p("BTCUSD", menos(fechas[i], c.ventLarga));
          if (p0 && pL && p0 / pL - 1 > 0) btc = c.sleeve;
        }
        w = { SPY: 1 - btc, TLT: 0, IEF: 0, GLD: 0, DBC: 0, BIL: 0, BTCUSD: btc };
      }
      const mom = {};
      for (const a of ACTIVOS) {
        const pL = p(a, menos(fechas[i], c.ventLarga)), pC = p(a, menos(fechas[i], c.ventCorta));
        mom[a] = pL && pC ? (pC / pL - 1) * 100 : null;
      }
      w = applyDualMomentum(w, mom).weights;
    }
    let rot = 0; if (antes) for (const a of ACTIVOS) rot += Math.abs((w[a] ?? 0) - (antes[a] ?? 0));
    let r = 0, usado = 0;
    for (const a of ACTIVOS) {
      const peso = w[a] ?? 0; if (!peso) continue;
      const p1 = p(a, fechas[i + 1]), p0 = p(a, fechas[i]);
      if (p1 == null || p0 == null || p0 <= 0) continue;
      r += peso * (p1 / p0 - 1); usado += peso;
    }
    rets.push(usado > 0.5 ? r / usado - rot * (COSTE_BPS / 10000) : 0);
    antes = { ...w };
  }
  return { total: (rets.reduce((a, b) => a * (1 + b), 1) - 1) * 100, sharpe: sharpe(rets), maxDD: maxDrawdown(rets) * 100, n: rets.length };
}

// Validación con los valores de producción, antes de nada.
{
  const b = correr({});
  const pub = G.estrategias.growth.rets.map((x) => x / 100);
  const pT = (pub.reduce((a, x) => a * (1 + x), 1) - 1) * 100, pD = maxDrawdown(pub) * 100;
  console.log(`  VALIDACIÓN · total ${b.total.toFixed(1)} % vs ${pT.toFixed(1)} %  ·  caída ${b.maxDD.toFixed(1)} % vs ${pD.toFixed(1)} %`);
  if (Math.abs(b.total - pT) / Math.abs(pT) > 0.25 || Math.abs(b.maxDD - pD) > 8) { console.error(`\n  ⛔ no reproduce la estrategia publicada\n`); process.exit(1); }
  console.log(`     ⇒ reproduce la publicada\n`);
}

// ── Las rejillas, las MISMAS de los análisis anteriores. No se amplían ──────────────────
const REJILLAS = {
  umbral: { valores: [30, 35, 40, 45, 50, 55, 60, 65, 70], prod: 50, cfg: (v) => ({ umbral: v }) },
  cadencia: { valores: [1, 2, 3, 6, 12], prod: 1, cfg: (v) => ({ cada: v }) },
  ventana: { valores: [3, 6, 9, 12, 18, 24], prod: 12, cfg: (v) => ({ ventLarga: v }) },
};
const idx = (d) => fechas.findIndex((f) => f >= d);
const BLOQUES = [["2007-2013", idx("2007-01-01"), idx("2014-01-01")], ["2014-2020", idx("2014-01-01"), idx("2021-01-01")], ["2021-2026", idx("2021-01-01"), fechas.length - 1]];

console.log(`  ¿DÓNDE ESTÁ EL MÁXIMO EN CADA TRAMO? (por Sharpe)\n`);
const estabilidad = {};
for (const [palanca, R] of Object.entries(REJILLAS)) {
  const fila = { palanca, produccion: R.prod, porBloque: [] };
  console.log(`  ${palanca.toUpperCase()} · producción = ${R.prod}`);
  for (const [nombre, a, b] of BLOQUES) {
    const res = R.valores.map((v) => ({ v, ...correr(R.cfg(v), a, b) }));
    const mejorS = res.reduce((x, y) => (y.sharpe > x.sharpe ? y : x));
    const prod = res.find((x) => x.v === R.prod);
    const rank = res.slice().sort((x, y) => y.sharpe - x.sharpe).findIndex((x) => x.v === R.prod) + 1;
    fila.porBloque.push({ bloque: nombre, argmax: mejorS.v, produccionRank: rank, de: res.length, sharpeProd: +prod.sharpe.toFixed(3), sharpeMejor: +mejorS.sharpe.toFixed(3) });
    console.log(`     ${nombre}   máximo en ${String(mejorS.v).padStart(3)}   ·   producción queda ${rank}.º de ${res.length}   (Sharpe ${prod.sharpe.toFixed(3)} vs ${mejorS.sharpe.toFixed(3)})`);
  }
  const argmaxes = fila.porBloque.map((x) => x.argmax);
  fila.estable = new Set(argmaxes).size === 1;
  fila.produccionSiempreTop2 = fila.porBloque.every((x) => x.produccionRank <= 2);
  console.log(`     ⇒ argmax por tramo: ${argmaxes.join(" · ")}  ${fila.estable ? "ESTABLE" : "BAILA"}   ·   producción siempre en el top-2: ${fila.produccionSiempreTop2 ? "sí" : "NO"}\n`);
  estabilidad[palanca] = fila;
}

// ── EL TEST DURO · ¿qué habrías elegido con el pasado, y cómo fue después? ───────────────
console.log(`  EL TEST DURO · calibrar en un tramo y aplicar al SIGUIENTE\n`);
const oos = [];
for (const [palanca, R] of Object.entries(REJILLAS)) {
  for (let k = 0; k < BLOQUES.length - 1; k++) {
    const [nA, a0, a1] = BLOQUES[k], [nB, b0, b1] = BLOQUES[k + 1];
    const enA = R.valores.map((v) => ({ v, ...correr(R.cfg(v), a0, a1) }));
    const elegido = enA.reduce((x, y) => (y.sharpe > x.sharpe ? y : x)).v;
    const conElegido = correr(R.cfg(elegido), b0, b1);
    const conProd = correr(R.cfg(R.prod), b0, b1);
    const acierta = elegido === R.prod;
    const mejorQueProd = conElegido.sharpe > conProd.sharpe;
    oos.push({ palanca, calibradoEn: nA, aplicadoA: nB, elegido, produccion: R.prod, coincide: acierta,
      sharpeElegido: +conElegido.sharpe.toFixed(3), sharpeProduccion: +conProd.sharpe.toFixed(3), elegidoGana: mejorQueProd });
    console.log(`  ${palanca.padEnd(10)} calibrado en ${nA} → elige ${String(elegido).padStart(3)}${acierta ? " (= producción)" : ` (producción es ${R.prod})`}`);
    console.log(`             aplicado a ${nB}: Sharpe ${conElegido.sharpe.toFixed(3)} con el elegido vs ${conProd.sharpe.toFixed(3)} con producción   ⇒ ${mejorQueProd ? "el calibrado GANA" : "producción gana o empata"}`);
  }
}

// ── El veredicto ────────────────────────────────────────────────────────────────────────
const estables = Object.values(estabilidad).filter((x) => x.estable).length;
const top2 = Object.values(estabilidad).filter((x) => x.produccionSiempreTop2).length;
const coinciden = oos.filter((x) => x.coincide).length;
const calibradoGana = oos.filter((x) => x.elegidoGana).length;
console.log(`\n  ⇒ VEREDICTO`);
console.log(`     palancas con argmax ESTABLE entre tramos:      ${estables} de 3`);
console.log(`     palancas con producción siempre en el top-2:   ${top2} de 3`);
console.log(`     veces que el calibrado coincide con producción: ${coinciden} de ${oos.length}`);
console.log(`     veces que el calibrado BATE a producción fuera: ${calibradoGana} de ${oos.length}`);
console.log(`\n     ${top2 === 3
  ? "Producción está entre los dos mejores en TODOS los tramos: la coincidencia con el óptimo global no es un accidente de mezclar épocas."
  : "Producción NO está siempre en el top-2: su optimalidad global viene en parte de mezclar tramos distintos."}`);
console.log(`     ${calibradoGana === 0
  ? "Y calibrar sobre el pasado NUNCA habría batido a la convención: elegir por datos no habría ayudado."
  : `Y calibrar sobre el pasado habría batido a producción ${calibradoGana} de ${oos.length} veces: hay margen que la convención deja.`}`);

writeFileSync(join(AQUI, "out", "estabilidad_parametros.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), bloques: BLOQUES.map(([n]) => n), estabilidad, fueraDeMuestra: oos,
  resumen: { argmaxEstables: estables, produccionTop2: top2, calibradoCoincide: coinciden, calibradoGana, de: oos.length },
  nota: "No busca el mejor parametro. Pregunta si la optimalidad de los valores de produccion sobrevive al partir la muestra, y si calibrar sobre el pasado habria elegido otra cosa.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/estabilidad_parametros.json\n`);
