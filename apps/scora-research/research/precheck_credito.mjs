// ─────────────────────────────────────────────────────────────────────────────
// ¿APORTA BAA10Y ALGO SOBRE LO QUE STLFSI4 YA MIDE?
//
// La fase 3 del plan propone meter el diferencial de crédito como cuarto componente del
// régimen. Antes de gastar el ensayo 345 —y ya van 344— hay que comprobar si la señal no
// está YA dentro: `STLFSI4` incorpora diferenciales de crédito entre sus componentes.
//
// ⚠️ EL CRITERIO SE ESCRIBE AQUÍ, ANTES DE MIRAR EL RESULTADO. Es media hora de trabajo que
// puede ahorrar un ensayo entero, y sólo vale si la regla no se ajusta a lo que salga.
//
//   ρ(percentiles) ≥ 0,70  → la señal ya está dentro. NO se gasta el ensayo. Se escribe y se cierra.
//   ρ(percentiles) < 0,70  → hay información incremental. El ensayo 345 está justificado.
//
// Se correlacionan los PERCENTILES, no los niveles, porque es lo que entraría de verdad en el
// composite (así lo hace regimeStationary.mjs) y porque los niveles de dos series con unidades
// distintas correlacionan por su tendencia común, que no es lo que se pregunta.
//
//   node --experimental-strip-types --no-warnings research/precheck_credito.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = join(AQUI, ".cache", "fredfull");
const CRITERIO = 0.70;
const LOOKBACK = 60;   // meses de ventana para el percentil — el mismo que regimeStationary

const carga = (id) => JSON.parse(readFileSync(join(DIR, id + ".json"), "utf8"));
const asOf = (o, d) => { let i = -1; for (let lo = 0, hi = o.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (o[m].date <= d) { i = m; lo = m + 1; } else hi = m - 1; } return i < 0 ? null : o[i].v; };

const baa = carga("BAA10Y"), stl = carga("STLFSI4");
console.log(`\n  ¿APORTA BAA10Y SOBRE STLFSI4?\n`);
console.log(`  BAA10Y   ${String(baa.length).padStart(6)} obs · ${baa[0].date} → ${baa.at(-1).date}`);
console.log(`  STLFSI4  ${String(stl.length).padStart(6)} obs · ${stl[0].date} → ${stl.at(-1).date}`);
console.log(`  criterio PREESCRITO: ρ ≥ ${CRITERIO} → la señal ya está dentro, no se gasta el ensayo 345\n`);

// Rejilla mensual desde que las DOS tienen historia, más la ventana del percentil.
const inicio = new Date(Math.max(new Date(baa[0].date), new Date(stl[0].date)));
inicio.setUTCMonth(inicio.getUTCMonth() + LOOKBACK);
const fechas = [];
for (let d = new Date(inicio); d <= new Date(stl.at(-1).date); d.setUTCMonth(d.getUTCMonth() + 1))
  fechas.push(d.toISOString().slice(0, 10));

// Percentil de cada serie contra su propia ventana móvil de 60 meses — igual que el régimen.
const pct = (serie, fecha, i) => {
  const v = asOf(serie, fecha); if (v == null) return null;
  const ventana = fechas.slice(Math.max(0, i - LOOKBACK), i + 1).map((f) => asOf(serie, f)).filter((x) => x != null);
  if (ventana.length < 24) return null;
  return (100 * ventana.filter((x) => x < v).length) / ventana.length;
};

const A = [], B = [], filas = [];
fechas.forEach((f, i) => {
  const a = pct(baa, f, i), b = pct(stl, f, i);
  if (a != null && b != null) { A.push(a); B.push(b); filas.push({ fecha: f, baaPct: +a.toFixed(1), stlPct: +b.toFixed(1), baa: asOf(baa, f), stl: asOf(stl, f) }); }
});

const corr = (x, y) => {
  const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};

const r = corr(A, B);
// Spearman: por si la relación es monótona pero no lineal, que en percentiles es lo esperable.
const rank = (v) => { const s = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); s.forEach(([, i], k) => { r[i] = k; }); return r; };
const rs = corr(rank(A), rank(B));

console.log(`  meses comparables    ${A.length}   (${filas[0].fecha} → ${filas.at(-1).fecha})`);
console.log(`  ρ Pearson            ${r.toFixed(3)}`);
console.log(`  ρ Spearman           ${rs.toFixed(3)}`);
console.log(`  R² (varianza compartida) ${(r * r * 100).toFixed(0)} %`);

// Dónde MÁS discrepan: si BAA10Y aporta algo, tiene que ser en momentos identificables.
const dis = filas.map((f) => ({ ...f, gap: Math.abs(f.baaPct - f.stlPct) })).sort((a, b) => b.gap - a.gap);
console.log(`\n  LOS 6 MESES DONDE MÁS DISCREPAN (es donde estaría la información incremental):`);
for (const d of dis.slice(0, 6))
  console.log(`    ${d.fecha}   BAA10Y pct ${String(d.baaPct).padStart(5)}   STLFSI4 pct ${String(d.stlPct).padStart(5)}   gap ${d.gap.toFixed(0)}`);

const veredicto = Math.abs(rs) >= CRITERIO ? "LA SEÑAL YA ESTÁ DENTRO — no se gasta el ensayo 345"
                                          : "HAY INFORMACIÓN INCREMENTAL — el ensayo 345 está justificado";
console.log(`\n  ⇒ ${veredicto}\n`);

writeFileSync(join(AQUI, "out", "precheck_credito.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), criterioPreescrito: CRITERIO, lookbackMeses: LOOKBACK,
  meses: A.length, desde: filas[0].fecha, hasta: filas.at(-1).fecha,
  pearson: +r.toFixed(4), spearman: +rs.toFixed(4), r2: +(r * r).toFixed(4),
  veredicto, mayoresDiscrepancias: dis.slice(0, 12).map(({ gap, ...f }) => ({ ...f, gap: +gap.toFixed(1) })),
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/precheck_credito.json\n`);
