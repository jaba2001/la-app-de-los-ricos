// ─────────────────────────────────────────────────────────────────────────────
// ¿ENTRA MÁS FÁCIL QUIEN PUBLICA MENOS DATOS?
//
// `percentilesDe` promedia SÓLO las métricas presentes: quien tiene tres promedia tres, quien
// tiene cinco promedia cinco. Parece neutral y no lo es.
//
// La media de k percentiles independientes tiene media 0,5 y desviación 1/√(12k). Con k=3 son
// 0,167; con k=5, 0,129. Superar el percentil 80 exige alejarse 0,30 de la media: eso son 1,80
// desviaciones con tres métricas y 2,32 con cinco. Bajo independencia, **un nombre con tres
// métricas tiene unas 3,6 veces más probabilidad de entrar que uno con cinco**, sin ser mejor
// negocio. Sólo por medirse peor.
//
// Las métricas están correlacionadas, así que el efecto real será menor que el teórico. Por eso
// esto se MIDE sobre el panel de verdad en vez de deducirse.
//
// ✅ MEDIDO EL 2026-09-01, Y LA TEORÍA NO SE CUMPLE. Sobre 8 fechas repartidas de 2019-2026:
//
//     métricas   nombres   señal media   superan p80    tasa
//        3          327       0,4754          32       9,8 %
//        4        1.209       0,4627          98       8,1 %
//        5        1.409       0,5290         138       9,8 %
//
// **1,0×, no 3,6×.** Las cinco métricas de calidad están tan correlacionadas —quien tiene buena
// rentabilidad bruta suele tener buen ROIC y buen margen— que promediar tres tiene casi la misma
// varianza que promediar cinco. El mecanismo existe pero el efecto se lo come la correlación.
//
// CONSECUENCIA, y es la que importa: la baja cobertura de `icov` (41 %) NO está inflando la
// entrada de quien publica menos datos. Era la sospecha razonable y es falsa. Retirar `icov` del
// ensemble por ese motivo no tendría justificación — haría falta otro.
//
// Este fichero se queda como guardián: si alguien cambia `MIN_METRICAS`, los pesos o el juego de
// métricas, la correlación que hoy tapa el efecto podría dejar de taparlo.
//
//   node --experimental-strip-types --no-warnings research/sesgo_por_cobertura.mjs [--long]
//
// No toca red: usa el panel ya calculado y la caché de EDGAR.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectRows } from "./factorDistCore.mjs";
import { metricasDe, METRICAS_CALIDAD, MIN_METRICAS } from "./picksSignal.mjs";
import { pct } from "./momentumSignals.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const LONG = process.argv.includes("--long");
const VENTANA = LONG ? "2011-2018" : "2019-2026";

const crudo = JSON.parse(readFileSync(join(AQUI, "out", `picks_signal_panel_${VENTANA}.json`), "utf8"));
const PANEL = crudo.panel ?? crudo.fechas ?? crudo;
const fechas = Object.keys(PANEL).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();

// Se toman unas pocas fechas repartidas: recalcular las métricas crudas de 182 fechas sería caro
// y la pregunta no necesita todas — es sobre la forma de la distribución, no sobre una fecha.
const MUESTRA = 8;
const paso = Math.max(1, Math.floor(fechas.length / MUESTRA));
const elegidas = fechas.filter((_, i) => i % paso === 0).slice(0, MUESTRA);

const ENTRY = 0.80;
const acum = new Map();   // nº de métricas → { n, sobreEntrada, sumaSenal }

console.log(`\n  ¿ENTRA MÁS FÁCIL QUIEN PUBLICA MENOS? · ${VENTANA} · ${elegidas.length} fechas\n`);

for (const fecha of elegidas) {
  const tickers = Object.keys(PANEL[fecha]);
  const filas = (await collectRows(tickers, fecha, new Map(), false, null)).map(metricasDe);
  const maps = METRICAS_CALIDAD.map((k) => pct(filas, k));

  for (const r of filas) {
    let suma = 0, n = 0;
    for (const m of maps) { const p = m.get(r.t); if (p != null) { suma += p; n++; } }
    if (n < MIN_METRICAS) continue;
    const senal = suma / n;
    if (!acum.has(n)) acum.set(n, { n: 0, sobre: 0, suma: 0 });
    const a = acum.get(n);
    a.n++; a.suma += senal;
    if (senal >= ENTRY) a.sobre++;
  }
  process.stdout.write(`  ${fecha}\r`);
}
process.stdout.write("                    \r");

console.log(`  métricas   nombres   señal media   superan p${ENTRY * 100}   tasa`);
const filas = [...acum.entries()].sort((a, b) => a[0] - b[0]);
for (const [k, a] of filas) {
  const tasa = (100 * a.sobre) / a.n;
  console.log(`  ${String(k).padStart(5)}      ${String(a.n).padStart(6)}      ${(a.suma / a.n).toFixed(4)}       ${String(a.sobre).padStart(6)}   ${tasa.toFixed(1).padStart(5)} %`);
}

const con3 = acum.get(3), con5 = acum.get(5);
if (con3?.n && con5?.n) {
  const t3 = con3.sobre / con3.n, t5 = con5.sobre / con5.n;
  console.log(`\n  Un nombre con 3 métricas entra ${(t3 / (t5 || 1e-9)).toFixed(1)}× más a menudo que uno con 5.`);
  console.log(`  (la teoría, bajo independencia, decía ~3,6× — la diferencia es la correlación entre métricas)`);
  console.log(`\n  Y las señales medias son ${(con3.suma / con3.n).toFixed(4)} y ${(con5.suma / con5.n).toFixed(4)}: parecidas, como tiene`);
  console.log(`  que ser. El sesgo NO está en el centro de la distribución sino en su ANCHURA, y por eso`);
  console.log(`  no se ve mirando medias — sólo mirando la cola, que es justo de donde se compra.\n`);
}
