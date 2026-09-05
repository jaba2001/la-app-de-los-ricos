// ─────────────────────────────────────────────────────────────────────────────
// LAS CIFRAS DE LOS VÍDEOS, REPRODUCIBLES
//
// ⚠️ ESTE FICHERO EXISTE POR UN HUECO QUE ENCONTRÓ LA AUDITORÍA, no por el análisis. Tres de
// las cifras que se publicaron en `ANALISIS_VIDEO_IA_2006.md` y `PLAN_CUATRO_VIDEOS.md` —el
// adelanto de diez meses del Case-Shiller, el backlog de Oracle y la serie de capex— salieron
// de invocaciones sueltas de `node -e` y **no dejaron ningún script detrás**. Estaban
// correctamente medidas y eran irreproducibles: si alguien pedía rehacerlas, no podía.
//
// En un repo cuyo criterio es «una cifra que no se reproduce no es evidencia», eso es un
// defecto por sí solo, aunque los números estén bien.
//
// Compara además lo medido con lo que el vídeo afirma, y marca las diferencias.
//
//   node --experimental-strip-types --no-warnings research/verificacion_videos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRED = process.env.FRED_KEY || "89002273b3b4289f0869a5e5318b7277";
const UA = { "User-Agent": "Scora research alealvarado804@gmail.com" };
const DIR = join(AQUI, ".cache", "fredfull");

/**
 * ⚠️ SE PIDE `units=lin` EXPLÍCITAMENTE Y EL FICHERO LO DICE. Este script nació con un bug que
 * el propio script destapó en su primera ejecución: leía `CSUSHPINSA` de la caché compartida
 * creyendo que era el índice Case-Shiller, y resulta que `regimeReal.mjs` lo guardaba ahí con
 * `units=pc1` —variación interanual— para su propio uso. Calcular el interanual de un
 * interanual dio «el crecimiento de la vivienda hizo pico en 2008-03 con +2.464 %», y no falló
 * nada: son números plausibles. Diez scripts comparten ese directorio.
 *
 * Dos defensas: la unidad va en el nombre del fichero, y aquí se comprueba que los valores
 * caigan en el orden de magnitud esperado antes de usarlos.
 */
async function fred(id, { esperado } = {}) {
  const p = join(DIR, id + ".lin.json");
  let o = null;
  if (existsSync(p)) { try { const c = JSON.parse(readFileSync(p, "utf8")); if (c.length) o = c; } catch { /* recarga */ } }
  if (!o) {
    const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json&units=lin`);
    if (!r.ok) return [];
    o = ((await r.json())?.observations ?? []).filter((x) => x.value !== ".").map((x) => ({ date: x.date, v: parseFloat(x.value) }));
    if (o.length) writeFileSync(p, JSON.stringify(o));
  }
  // El control de unidades: si el ultimo valor no cae donde deberia, la serie NO es la que creo.
  if (esperado && o.length) {
    const v = o[o.length - 1].v;
    if (v < esperado[0] || v > esperado[1]) {
      console.error(`\n  ⛔ ${id} vale ${v} y se esperaba entre ${esperado[0]} y ${esperado[1]}: la serie no esta en las unidades que este script asume.\n`);
      process.exit(1);
    }
  }
  return o;
}

const resultados = [];
const comparar = (que, medido, afirmado, coincide, nota = null) => {
  resultados.push({ que, medido, afirmado, coincide, nota });
  console.log(`\n  ${coincide === true ? "COINCIDE" : coincide === false ? "DIFIERE " : "MATIZ   "} · ${que}`);
  console.log(`      medido:   ${medido}`);
  console.log(`      el vídeo: ${afirmado}`);
  if (nota) console.log(`      ⚠️ ${nota}`);
};

console.log(`\n  LAS CIFRAS DE LOS VÍDEOS, REPRODUCIDAS\n`);

// ── 1. La mecánica de 2006: el crecimiento hace pico ANTES que el nivel ──────────────────
{
  const px = await fred("CSUSHPINSA", { esperado: [100, 500] });  // un indice, no un porcentaje
  if (!px.length) { console.error("  ⛔ sin Case-Shiller"); process.exit(1); }
  const idx = new Map(px.map((o, i) => [o.date, i]));
  const yoy = (o) => { const i = idx.get(o.date); return i >= 12 ? (o.v / px[i - 12].v - 1) * 100 : null; };
  const T = px.filter((o) => o.date >= "2003-01-01" && o.date <= "2008-12-01");
  let picoNivel = null, picoCrec = null;
  for (const o of T) {
    const y = yoy(o); if (y == null) continue;
    if (!picoNivel || o.v > picoNivel.v) picoNivel = o;
    if (!picoCrec || y > picoCrec.y) picoCrec = { date: o.date, y };
  }
  const meses = Math.round((new Date(picoNivel.date) - new Date(picoCrec.date)) / (30.44 * 86400000));
  comparar(
    "El crecimiento de la vivienda hizo pico ANTES que el nivel",
    `crecimiento ${picoCrec.date.slice(0, 7)} (${picoCrec.y.toFixed(1)} %) · nivel ${picoNivel.date.slice(0, 7)} (${picoNivel.v.toFixed(1)}) → ${meses} meses de adelanto`,
    "«los precios no cayeron en 2006, estaban en máximos: sólo dejaron de subir tan rápido»",
    meses >= 6);

  // Y la morosidad, que es donde el vídeo SÍ exagera.
  const mor = await fred("DRSFRMACBS", { esperado: [0.5, 15] });  // una tasa en %
  const en = (d) => mor.filter((o) => o.date <= d).at(-1);
  const m06 = en("2006-06-30"), minimo = mor.filter((o) => o.date >= "2003-01-01" && o.date <= "2008-12-01").reduce((a, b) => (b.v < a.v ? b : a));
  comparar(
    "Morosidad hipotecaria en 2006",
    `${m06.v.toFixed(2)} % en ${m06.date.slice(0, 7)}, frente a un mínimo de ${minimo.v.toFixed(2)} % en ${minimo.date.slice(0, 7)}`,
    "«los prestatarios empezaron a fallar en cifras récord»",
    false,
    "Sube, pero sigue en mínimos históricos. Y DRSFRMACBS cubre TODA la hipoteca residencial, no el subprime del que habla: no se refuta ni se confirma su cifra midiendo otra población");
}

// ── 2. El backlog de Oracle ─────────────────────────────────────────────────────────────
{
  const j = await (await fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK0001341439.json", { headers: UA })).json();
  const u = (j.facts?.["us-gaap"]?.RevenueRemainingPerformanceObligation?.units?.USD ?? []).filter((x) => /10-[KQ]/.test(x.form ?? ""));
  const ult = u.slice().sort((a, b) => (a.end < b.end ? -1 : 1)).at(-1);
  const hace = u.filter((x) => x.end <= new Date(new Date(ult.end).setFullYear(new Date(ult.end).getFullYear() - 1)).toISOString().slice(0, 10)).at(-1);
  const g = hace ? (ult.val / hace.val - 1) * 100 : null;
  comparar(
    "Backlog de Oracle (RevenueRemainingPerformanceObligation)",
    `${(ult.val / 1e9).toFixed(0)} B$ a ${ult.end} (${ult.form}), ${g == null ? "—" : (g >= 0 ? "+" : "") + g.toFixed(0) + " % interanual"}`,
    "638 B$, +363 %",
    Math.abs(ult.val / 1e9 - 638) < 15 && g != null && Math.abs(g - 363) < 25);
}

// ── 3. El capex de los cinco grandes ────────────────────────────────────────────────────
{
  const CIK = { MSFT: "0000789019", GOOGL: "0001652044", AMZN: "0001018724", META: "0001326801", ORCL: "0001341439" };
  // ⚠️ El tag con el hecho MÁS RECIENTE, no el primero de la lista. Amazon publica los dos y
  // `PaymentsToAcquirePropertyPlantAndEquipment` murió en 2016: con la regla ingenua su capex
  // salía 5 B$ en vez de 132, y casi publico que el vídeo exageraba cuando el que fallaba era yo.
  const elegir = (g, tags) => {
    let mejor = [], f = "";
    for (const t of tags) {
      const u = g?.[t]?.units?.USD; if (!u) continue;
      const a = u.filter((x) => x.form === "10-K" && x.start && (new Date(x.end) - new Date(x.start)) > 300 * 86400000);
      if (!a.length) continue;
      const z = a.map((x) => x.end).sort().at(-1);
      if (z > f) { f = z; mejor = a; }
    }
    return mejor;
  };
  const R = {};
  for (const [t, c] of Object.entries(CIK)) {
    const j = await (await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c}.json`, { headers: UA })).json();
    const g = j.facts?.["us-gaap"] ?? {};
    for (const x of elegir(g, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"])) {
      const y = x.end.slice(0, 4); (R[y] ??= { cap: 0, ocf: 0, n: new Set() });
      if (!R[y][t + "c"]) { R[y].cap += x.val; R[y][t + "c"] = 1; R[y].n.add(t); }
    }
    for (const x of elegir(g, ["NetCashProvidedByUsedInOperatingActivities"])) {
      const y = x.end.slice(0, 4); (R[y] ??= { cap: 0, ocf: 0, n: new Set() });
      if (!R[y][t + "o"]) { R[y].ocf += x.val; R[y][t + "o"] = 1; }
    }
    await new Promise((x) => setTimeout(x, 140));
  }
  const serie = ["2023", "2024", "2025"].map((y) => (R[y]?.n.size === 5 ? Math.round(R[y].cap / 1e9) : null));
  comparar(
    "Capex de los cinco grandes (2023 / 2024 / 2025)",
    serie.map((x) => x ?? "—").join(" / ") + " B$",
    "150 / 226 / 410 B$",
    serie.every((x, i) => x != null && Math.abs(x - [150, 226, 410][i]) < 40));

  const r25 = R["2025"];
  if (r25?.n.size === 5) {
    const ratio = r25.cap / r25.ocf;
    comparar(
      "«El capex ya supera a toda la caja que ingresan»",
      `capex/flujo operativo = ${ratio.toFixed(2)} en 2025 (${(r25.cap / 1e9).toFixed(0)} frente a ${(r25.ocf / 1e9).toFixed(0)} B$)`,
      "«cada dólar adicional de construcción se financia con deuda»",
      ratio > 1 ? true : false,
      ratio <= 1 ? "Es una afirmación sobre el PLAN de 2026 (725 B$), no un hecho observable en los estados. Plausible: con el flujo operativo creciendo ~20 % anual llegaría a ~690 B$ y ahí sí cruzaría" : null);
  }
}

const ok = resultados.filter((x) => x.coincide === true).length;
const no = resultados.filter((x) => x.coincide === false).length;
console.log(`\n  RESUMEN: ${ok} coinciden · ${no} difieren · ${resultados.length - ok - no} con matiz, de ${resultados.length} comprobaciones\n`);

writeFileSync(join(AQUI, "out", "verificacion_videos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), comprobaciones: resultados,
  nota: "Reproduce las cifras publicadas en ANALISIS_VIDEO_IA_2006.md y PLAN_CUATRO_VIDEOS.md, que hasta la auditoria del 2026-09-03 no tenian script detras: estaban bien medidas y eran irreproducibles.",
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/verificacion_videos.json\n`);
