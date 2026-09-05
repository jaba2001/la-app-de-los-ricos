// ─────────────────────────────────────────────────────────────────────────────
// ¿APORTAN LAS CAPAS NUEVAS INFORMACIÓN QUE EL SCORE NO TENGA YA?
//
// Ninguno de los módulos construidos desde los siete vídeos entra en el motor. Eso fue
// deliberado —una capa explicativa no puede sobreajustar— pero deja una pregunta sin contestar,
// y es la que importa: **¿podrían aportar algo, o serían redundantes?**
//
// ⚠️ Y HAY UN MATIZ QUE CONVIENE TENER DELANTE: el motor NO está vacío de estos conceptos. Sus
// `ScoreInputs` ya llevan `fcfYield`, `capexToRevenue`, `fcfGrowthYoy` y `grossProfitability`.
// Parte de la capa de caja ya estaba dentro. Lo que NO tiene es la conversión a caja, las
// banderas rojas, la vida útil implícita ni el precio de recompra.
//
// Se puntúa con `scoreStock()`, que es la ruta EXACTA de producción — no una reimplementación.
//
// ⚠️ EL CRITERIO SE ESCRIBE AQUÍ, ANTES DE MIRAR EL RESULTADO. Para cada medida nueva:
//
//   |ρ| ≥ 0,70 contra el total o contra cualquier pilar   → ya está dentro. No se gasta ensayo.
//   R² conjunto de los cuatro pilares ≥ 0,50              → los pilares juntos ya la explican.
//   Las dos por debajo                                    → es información NUEVA, y entonces
//                                                            merece una hipótesis preespecificada.
//
// Esto NO es un ensayo: no prueba si la medida predice retornos, sólo si es redundante. Es la
// misma comprobación barata que ya ahorró dos ensayos (el 345 dos veces).
//
//   node --experimental-strip-types --no-warnings research/precheck_capas.mjs --n 200
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tickerToCik, fundamentalsAsOf, sicSector } from "./edgar.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { scoreStock } from "./score.mjs";
import { momentum } from "./prices.mjs";
import { diagnosticar, banderas } from "../lib/flujoCaja.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CRITERIO_RHO = 0.70;
const CRITERIO_R2 = 0.50;
const iN = process.argv.indexOf("--n");
const N = iN >= 0 ? Number(process.argv[iN + 1]) : 200;
const ASOF = process.env.CF_ASOF || "2026-06-30";

const px = (t) => {
  for (const p of [join(AQUI, ".cache", "px", t + ".json"), join(AQUI, ".cache", "px_long", t + ".json")])
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* siguiente */ } }
  return null;
};
const precioEn = (s, d) => { const h = s?.filter((o) => o.date <= d) ?? []; return h.length ? (h.at(-1).raw ?? h.at(-1).adj) : null; };

// ⚠️ EL MOMENTUM SE PIDE A PRODUCCIÓN, no se reimplementa. Mi primera versión lo calculaba a
// mano y devolvía `{priceChange1M, priceChange3M, priceChange6M}` — pero `buildInputs` espera
// `{m1, m3, m6}`. No falló nada: simplemente no veía ninguno de los tres y el pilar `momentum`
// salía **constante en 0** para las 250 empresas, lo que a su vez hacía singular la regresión
// del R² y devolvía `null` en las cuatro medidas. Un nombre de campo equivocado tumbó la mitad
// de la prueba en silencio. Es el mismo principio que ya se aplica con `scoreStock`: la ruta de
// producción se usa, no se copia.

// La foto de calidad contable ya calculada: vida útil y precio de recompra.
const CC = JSON.parse(readFileSync(join(AQUI, "out", "calidad_contable.json"), "utf8"));
const porTicker = new Map(CC.filas.filter((x) => x.estado === "ok").map((x) => [x.ticker, x]));

const tabla = await loadSP500Historical();
const universo = [...membersAsOf(tabla, snapshotDate(tabla))].sort().slice(0, N);
console.log(`\n  ¿APORTAN LAS CAPAS NUEVAS ALGO QUE EL SCORE NO TENGA?`);
console.log(`  criterio PREESCRITO: |ρ| ≥ ${CRITERIO_RHO} o R² ≥ ${CRITERIO_R2} → ya está dentro\n`);

const filas = [];
for (const t of universo) {
  try {
    const cik = await tickerToCik(t); if (!cik) continue;
    const f = await fundamentalsAsOf(cik, ASOF); if (!f) continue;
    const sector = await sicSector(cik).catch(() => null);
    const s = px(t), raw = precioEn(s, ASOF);
    if (raw == null) continue;
    // ⚠️ scoreStock() devuelve {inputs, scores, tilt, ic}, NO los pilares en la raiz. La primera
    // version filtraba por "sc.total == null" y descartaba las 30 sin decir por que: cero
    // puntuadas y cuatro «muestra insuficiente», que se leia como un problema de datos cuando
    // era un problema de forma. Un filtro que descarta el 100 % no es un filtro: es un bug.
    const sc = scoreStock(f, raw, await momentum(t, ASOF), sector ?? "", null, null)?.scores;
    if (!sc || sc.total == null) continue;

    const fc = { ...f, sector };
    const d = diagnosticar(fc);
    const bs = banderas(fc, d);
    const cc = porTicker.get(t);

    filas.push({
      ticker: t,
      total: sc.total, value: sc.value, health: sc.health, momentum: sc.momentum, growth: sc.growth,
      // LAS MEDIDAS NUEVAS
      conversion: d.financiera ? null : d.cashConversion,
      banderas: d.financiera ? null : bs.length,
      vidaUtil: cc?.vida?.fuera || cc?.viaDep === "total_contaminado" ? null : (cc?.vida?.corregida ?? null),
      recompra: cc?.recompra?.creible === true ? (cc?.recompra?.retornoPct ?? null) : null,
    });
    await new Promise((x) => setTimeout(x, 110));
  } catch { /* siguiente */ }
}

console.log(`  puntuadas ${filas.length} de ${universo.length}\n`);

const corr = (x, y) => {
  const n = x.length; if (n < 30) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
};

/**
 * R² de una regresión de `y` sobre los pilares. Cuánto de la medida nueva explican juntos.
 *
 * ⚠️ SÓLO ENTRAN LOS PILARES QUE VARÍAN, y esto no es una precaución teórica. En la primera
 * corrida el pilar `momentum` salía **constante en 0** para todo el universo, así que su columna
 * era proporcional a la del intercepto, la matriz era singular y la función devolvía `null` —
 * en las cuatro medidas. El criterio del R² no llegó a ejecutarse NUNCA y la salida decía
 * «información NUEVA» con la mitad de la prueba sin correr. Un `null` silencioso vale menos que
 * un error: éste se leía como un resultado.
 */
function r2Pilares(rows, campo) {
  const d = rows.filter((r) => r[campo] != null && Number.isFinite(r[campo]));
  if (d.length < 40) return null;
  const varia = (p) => { const v = d.map((r) => r[p]); const m = v.reduce((a, b) => a + b, 0) / v.length; return v.some((x) => Math.abs(x - m) > 1e-9); };
  const usados = ["value", "health", "momentum", "growth"].filter(varia);
  if (!usados.length) return null;
  const X = d.map((r) => [1, ...usados.map((p) => r[p])]);
  const y = d.map((r) => r[campo]);
  const k = usados.length + 1;
  const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const b = Array.from({ length: k }, (_, i) => X.reduce((s, row, n) => s + row[i] * y[n], 0));
  // Gauss con pivoteo
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < k; r++) { if (r === c) continue; const fct = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= fct * M[c][j]; }
  }
  const beta = M.map((row, i) => row[k] / row[i]);
  const my = y.reduce((a, x) => a + x, 0) / y.length;
  let sse = 0, sst = 0;
  for (let i = 0; i < y.length; i++) {
    const yh = X[i].reduce((s, v, j) => s + v * beta[j], 0);
    sse += (y[i] - yh) ** 2; sst += (y[i] - my) ** 2;
  }
  return { r2: 1 - sse / sst, n: d.length, pilares: usados };
}

const MEDIDAS = [
  ["conversion", "Conversión a caja (CFO/beneficio)"],
  ["banderas", "Nº de banderas rojas de caja"],
  ["vidaUtil", "Vida útil implícita"],
  ["recompra", "Retorno desde el precio de recompra"],
];
const PILARES = ["total", "value", "health", "momentum", "growth"];

console.log(`  medida                              n     ρ máx contra un pilar        R² de los 4 juntos`);
const resultados = [];
for (const [campo, nombre] of MEDIDAS) {
  const d = filas.filter((r) => r[campo] != null && Number.isFinite(r[campo]));
  if (d.length < 30) { console.log(`  ${nombre.padEnd(36)}${String(d.length).padStart(4)}   muestra insuficiente`); continue; }
  const rhos = {};
  for (const p of PILARES) { const c = corr(d.map((r) => r[campo]), d.map((r) => r[p])); if (c != null) rhos[p] = c; }
  const mejor = Object.entries(rhos).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  const r2 = r2Pilares(filas, campo);
  const dentro = (mejor && Math.abs(mejor[1]) >= CRITERIO_RHO) || (r2 && r2.r2 >= CRITERIO_R2);
  resultados.push({ campo, nombre, n: d.length, rhos: Object.fromEntries(Object.entries(rhos).map(([k, v]) => [k, +v.toFixed(3)])), mejorPilar: mejor?.[0], mejorRho: mejor ? +mejor[1].toFixed(3) : null, r2: r2 ? +r2.r2.toFixed(3) : null, pilaresUsados: r2?.pilares ?? null, yaDentro: dentro });
  console.log(`  ${nombre.padEnd(36)}${String(d.length).padStart(4)}   ${(mejor ? `${mejor[1] >= 0 ? "+" : ""}${mejor[1].toFixed(3)} (${mejor[0]})` : "—").padEnd(22)}  ${r2 ? r2.r2.toFixed(3)+" ("+r2.pilares.length+" pilares)" : "—"}   ${dentro ? "⇒ YA ESTÁ DENTRO" : "⇒ información NUEVA"}`);
}

const nuevas = resultados.filter((r) => !r.yaDentro);
console.log(`\n  ⇒ ${nuevas.length} de ${resultados.length} medidas son información que el score NO tiene:`);
for (const r of nuevas) console.log(`     · ${r.nombre}  (ρ máx ${r.mejorRho} contra ${r.mejorPilar}, R² ${r.r2})`);
console.log(`\n  ⚠️ Esto NO dice que sirvan. Dice que son distintas de lo que ya hay, que es la condición`);
console.log(`     NECESARIA para que merezca la pena gastar un ensayo — no la suficiente. El aviso de`);
console.log(`     crédito también era información nueva y resultó indistinguible del azar (p = 0,146).\n`);

writeFileSync(join(AQUI, "out", "precheck_capas.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: ASOF, puntuadas: filas.length,
  criterioRho: CRITERIO_RHO, criterioR2: CRITERIO_R2, resultados,
  nota: "El motor ya lleva fcfYield, capexToRevenue, fcfGrowthYoy y grossProfitability en sus ScoreInputs: parte de la capa de caja ya estaba dentro. Esto mide si las medidas NUEVAS son redundantes con el score de produccion, no si predicen retornos.",
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/precheck_capas.json\n`);
