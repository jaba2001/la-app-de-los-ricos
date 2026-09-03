// ─────────────────────────────────────────────────────────────────────────────
// EL TIPO REAL Y LOS ACTIVOS — fase D
//
// Dos de los cuatro vídeos afirman lo mismo: cuando el tipo de interés REAL baja, el oro sube.
// La lógica es buena —el oro no paga cupón, así que su coste de oportunidad ES el tipo real—
// y por una vez la afirmación se puede medir con precisión.
//
// ⚠️ Y LO QUE HAY QUE DECIR AL PUBLICARLA, PORQUE ES LO QUE LA HACE HONESTA: esto es
// CONTEMPORÁNEO, no predictivo. Compara el cambio del tipo real de un mes con el retorno de
// ESE MISMO mes. No se puede operar salvo que se conozca el movimiento del tipo por adelantado
// — y si se conociera, el oro sería el menor de los negocios posibles.
//
// Sirve para EXPLICAR lo que pasó, que es exactamente lo que un panel debe hacer y lo que
// ninguno de los dos vídeos distingue. Se mide además el poder PREDICTIVO (el cambio de este
// mes contra el retorno del siguiente) precisamente para poder enseñar que no lo tiene.
//
//   node --experimental-strip-types --no-warnings research/tipos_reales.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const FRED = process.env.FRED_KEY || "89002273b3b4289f0869a5e5318b7277";
const DIR = join(AQUI, ".cache", "fredfull");

// Activos que el argumento nombra. BTC entra desde su disponibilidad declarada, no desde lo
// que resulte que haya en la caché — el defecto que ya nos costó un +637 % que era +740 %.
const ACTIVOS = [
  ["GLD", "Oro", "2004-11-18"],
  ["SLV", "Plata", "2006-04-28"],
  ["SPY", "S&P 500", "1993-01-29"],
  ["TLT", "Tesoro largo", "2002-07-30"],
  ["BTC-USD", "Bitcoin", "2018-06-01"],
];

async function serieFred(id) {
  const p = join(DIR, id + ".json");
  if (existsSync(p)) { try { const o = JSON.parse(readFileSync(p, "utf8")); if (o.length) return o; } catch { /* recarga */ } }
  const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json`);
  if (!r.ok) return [];
  const obs = ((await r.json())?.observations ?? []).filter((o) => o.value !== ".").map((o) => ({ date: o.date, v: parseFloat(o.value) }));
  if (obs.length) writeFileSync(p, JSON.stringify(obs));
  return obs;
}
const px = (t) => {
  for (const p of [join(AQUI, ".cache", "px", t + ".json"), join(AQUI, ".cache", "px_long", t + ".json")])
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* siguiente */ } }
  return null;
};
const asOf = (a, d, k) => { const h = a.filter((o) => (o.date ?? o.d) <= d); return h.length ? (h[h.length - 1][k] ?? h[h.length - 1].v) : null; };

const corr = (x, y) => {
  const n = x.length; if (n < 24) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return { rho: sxy / Math.sqrt(sxx * syy), beta: sxy / sxx, n };
};

const real = await serieFred("DFII10");
if (!real.length) { console.error("\n  ⛔ sin DFII10\n"); process.exit(1); }
console.log(`\n  EL TIPO REAL Y LOS ACTIVOS · DFII10 desde ${real[0].date}\n`);

const meses = [];
for (let y = 2003; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const d = `${y}-${String(m).padStart(2, "0")}-15`;
  if (d <= "2026-09-01") meses.push(d);
}

const filas = [];
for (const [t, nombre, desde] of ACTIVOS) {
  const S = px(t);
  if (!S) { filas.push({ ticker: t, nombre, estado: "sin serie" }); continue; }
  const X = [], Y = [], Ysig = [];
  for (let i = 1; i < meses.length - 1; i++) {
    if (meses[i] < desde) continue;   // la disponibilidad DECLARADA, no la de la caché
    const r1 = asOf(real, meses[i], "v"), r0 = asOf(real, meses[i - 1], "v");
    const p1 = asOf(S, meses[i], "adj"), p0 = asOf(S, meses[i - 1], "adj"), p2 = asOf(S, meses[i + 1], "adj");
    if (r1 == null || r0 == null || p1 == null || p0 == null) continue;
    X.push(r1 - r0);
    Y.push((p1 / p0 - 1) * 100);                       // CONTEMPORÁNEO
    Ysig.push(p2 != null ? (p2 / p1 - 1) * 100 : null); // el mes SIGUIENTE
  }
  const c = corr(X, Y);
  if (!c) { filas.push({ ticker: t, nombre, estado: `muestra corta (${X.length})` }); continue; }
  // El predictivo se calcula sobre los pares completos, no rellenando huecos.
  const idx = Ysig.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  const pred = corr(idx.map((i) => X[i]), idx.map((i) => Ysig[i]));

  const baja = Y.filter((_, i) => X[i] < 0), sube = Y.filter((_, i) => X[i] > 0);
  const med = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  filas.push({
    ticker: t, nombre, estado: "ok", n: c.n,
    rhoContemporaneo: +c.rho.toFixed(3), betaPorPunto: +c.beta.toFixed(2),
    rhoPredictivo: pred ? +pred.rho.toFixed(3) : null,
    mesesBajando: baja.length, retornoBajando: +med(baja).toFixed(2),
    mesesSubiendo: sube.length, retornoSubiendo: +med(sube).toFixed(2),
    diferencia: +(med(baja) - med(sube)).toFixed(2),
  });
}

console.log(`  activo         n    ρ contemp.   β %/punto   ρ PREDICT.   real ↓    real ↑    dif`);
for (const f of filas) {
  if (f.estado !== "ok") { console.log(`  ${f.nombre.padEnd(14)} ${f.estado}`); continue; }
  console.log(`  ${f.nombre.padEnd(14)}${String(f.n).padStart(4)}   ${String(f.rhoContemporaneo).padStart(9)}   ${String(f.betaPorPunto).padStart(8)}   ` +
    `${String(f.rhoPredictivo ?? "—").padStart(9)}   ${(f.retornoBajando >= 0 ? "+" : "") + f.retornoBajando} %   ` +
    `${(f.retornoSubiendo >= 0 ? "+" : "") + f.retornoSubiendo} %   ${(f.diferencia >= 0 ? "+" : "") + f.diferencia}`);
}

// ⚠️ EL CONTRASTE QUE JUSTIFICA TODO EL FICHERO. Si el predictivo fuera parecido al
// contemporáneo, esto sería una señal. Que no lo sea es el resultado, no un fallo.
const ok = filas.filter((x) => x.estado === "ok" && x.rhoPredictivo != null);
const cont = ok.map((x) => Math.abs(x.rhoContemporaneo)), pre = ok.map((x) => Math.abs(x.rhoPredictivo));
const media = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`\n  |ρ| MEDIO   contemporaneo ${media(cont).toFixed(3)}   ·   PREDICTIVO ${media(pre).toFixed(3)}`);
console.log(`  ⇒ ${media(pre) < media(cont) / 2
  ? "el poder explicativo NO sobrevive a mirar hacia adelante: es contexto, no señal"
  : "OJO: el predictivo se acerca al contemporaneo — merece una hipotesis preespecificada"}`);

writeFileSync(join(AQUI, "out", "tipos_reales.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), serie: "DFII10", desde: real[0].date,
  advertencia: "Las correlaciones contemporaneas comparan el cambio del tipo real de un mes con el retorno de ESE MISMO mes. Explican lo que paso; NO se pueden operar. La columna predictiva esta para poder enseñar que no lo son.",
  rhoMedioContemporaneo: +media(cont).toFixed(3), rhoMedioPredictivo: +media(pre).toFixed(3),
  activos: filas,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/tipos_reales.json\n`);
