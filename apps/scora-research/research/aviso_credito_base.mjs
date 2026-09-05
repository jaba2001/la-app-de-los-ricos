// ─────────────────────────────────────────────────────────────────────────────
// ¿VALE ALGO EL AVISO DE ENSANCHAMIENTO, O SÓLO ACERTÓ EN 2008?
//
// El aviso de `lib/tipos.ts` se encendió el 15-08-2007, 397 días antes de Lehman. Eso es una
// ANÉCDOTA hasta que se sepa cuántas veces se enciende sin que pase nada después.
//
// ⚠️ Lo que mide este script es la TASA BASE. Un aviso que se enciende cada tres meses acierta
// todas las crisis y no sirve para nada. La pregunta correcta no es «¿avisó?» sino «¿qué pasó
// después de las veces que avisó, comparado con lo que pasa normalmente?».
//
// Sin condicionar = lo que hace el S&P 500 en un mes cualquiera. Condicionado = lo que hace
// después de un aviso. Si los dos números se parecen, el aviso no informa.
//
//   node --experimental-strip-types --no-warnings research/aviso_credito_base.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { credito } from "../lib/tipos.ts";

const AQUI = dirname(fileURLToPath(import.meta.url));
const baa = JSON.parse(readFileSync(join(AQUI, ".cache", "fredfull", "BAA10Y.json"), "utf8"));
const spy = JSON.parse(readFileSync(join(AQUI, ".cache", "px", "SPY.json"), "utf8"));
const px = (d) => { const h = spy.filter((o) => o.date <= d); return h.length ? h[h.length - 1].adj : null; };

const meses = [];
for (let y = 1993; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const d = `${y}-${String(m).padStart(2, "0")}-15`;
  if (d > "2026-09-01") continue;
  meses.push(d);
}

// Retorno y peor caída de los 12 meses SIGUIENTES a cada mes.
const fwd = (d) => {
  const p0 = px(d); if (p0 == null) return null;
  const hasta = new Date(new Date(d).setUTCFullYear(new Date(d).getUTCFullYear() + 1)).toISOString().slice(0, 10);
  const tramo = spy.filter((o) => o.date > d && o.date <= hasta);
  if (tramo.length < 200) return null;   // año incompleto: no se usa
  const p1 = tramo[tramo.length - 1].adj;
  let pico = p0, dd = 0;
  for (const o of tramo) { if (o.adj > pico) pico = o.adj; const c = (o.adj / pico - 1) * 100; if (c < dd) dd = c; }
  return { ret: (p1 / p0 - 1) * 100, dd };
};

const filas = meses.map((d) => {
  const c = credito(baa, d);
  return { fecha: d, aviso: !!c?.ensanchando, valor: c?.valor ?? null, delta: c?.delta ?? null, f: fwd(d) };
}).filter((x) => x.f != null);

const con = filas.filter((x) => x.aviso), sin = filas.filter((x) => !x.aviso);
const med = (a, k) => a.reduce((s, v) => s + v.f[k], 0) / a.length;
const pct = (a, k, u) => (100 * a.filter((v) => v.f[k] < u).length) / a.length;

console.log(`\n  LA TASA BASE DEL AVISO DE ENSANCHAMIENTO · ${filas.length} meses con año completo por delante\n`);
console.log(`                              meses    S&P +12m   peor caída   % con caída >15 %`);
console.log(`  con aviso encendido        ${String(con.length).padStart(5)}    ${med(con, "ret").toFixed(1).padStart(7)} %   ${med(con, "dd").toFixed(1).padStart(7)} %   ${pct(con, "dd", -15).toFixed(0).padStart(6)} %`);
console.log(`  sin aviso                  ${String(sin.length).padStart(5)}    ${med(sin, "ret").toFixed(1).padStart(7)} %   ${med(sin, "dd").toFixed(1).padStart(7)} %   ${pct(sin, "dd", -15).toFixed(0).padStart(6)} %`);
console.log(`  frecuencia del aviso       ${(100 * con.length / filas.length).toFixed(0)} % de los meses`);

// Episodios: meses de aviso consecutivos agrupados, para ver si son crisis distintas o una sola.
const eps = [];
for (const f of filas) {
  if (!f.aviso) continue;
  const ult = eps[eps.length - 1];
  if (ult && (new Date(f.fecha) - new Date(ult.fin)) <= 70 * 86400000) { ult.fin = f.fecha; ult.n++; }
  else eps.push({ inicio: f.fecha, fin: f.fecha, n: 1 });
}
console.log(`\n  ${eps.length} EPISODIOS distintos en 33 años (avisos separados por más de dos meses):`);
for (const e of eps) {
  const f = filas.find((x) => x.fecha === e.inicio);
  console.log(`    ${e.inicio.slice(0, 7)} → ${e.fin.slice(0, 7)}  (${String(e.n).padStart(2)} meses)   S&P los 12m siguientes: ${f.f.ret >= 0 ? "+" : ""}${f.f.ret.toFixed(1)} %   peor caída ${f.f.dd.toFixed(1)} %`);
}

const resumen = {};
const dif = med(con, "dd") - med(sin, "dd");
console.log(`\n  DIFERENCIA en la peor caída del año siguiente: ${dif.toFixed(1)} pp`);
console.log(`  ⇒ ${Math.abs(dif) < 3 ? "el aviso NO distingue: la caída posterior se parece a la de un mes cualquiera"
  : dif < 0 ? "tras el aviso, la caída del año siguiente es sistemáticamente peor" : "tras el aviso la caída es MENOR: el aviso llega tarde"}\n`);

// ⚠️ 393 MESES NO SON 393 OBSERVACIONES. Las ventanas de 12 meses de meses consecutivos se
// solapan casi por completo: dos avisos seguidos comparten once doceavos de su futuro. La
// unidad independiente son los EPISODIOS, y son 22 en 33 años. Con esa n, la pregunta no es
// si la diferencia existe sino si se distingue del azar.
//
// Test de permutación: se sortean 22 meses al azar 20.000 veces y se mira cuántas veces el
// azar produce una caída media igual o peor que la de los episodios reales.
{
  const inicios = eps.map((e) => filas.find((x) => x.fecha === e.inicio)).filter(Boolean);
  const obs = inicios.reduce((s, v) => s + v.f.dd, 0) / inicios.length;
  const universo = filas.map((x) => x.f.dd);
  // ⚠️ SEMILLA FIJA, y no es un detalle. Con `Math.random()` el p-valor se movia en cada
  // corrida (0,1489 → 0,1488) y el artefacto cambiaba en git cada vez que se ejecutaba. Un
  // numero que se cita en un commit y no se puede reproducir exactamente no es evidencia:
  // es una cifra que salio una vez. Mulberry32 con semilla declarada lo hace determinista.
  let semilla = 20260903;
  const azar = () => {
    semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let peores = 0;
  const N = 20000, k = inicios.length;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += universo[(azar() * universo.length) | 0];
    if (s / k <= obs) peores++;
  }
  const p = peores / N;
  console.log(`
  AL NIVEL DE EPISODIO (la unidad independiente):`);
  console.log(`    episodios                      ${k}`);
  console.log(`    peor caída media tras un aviso ${obs.toFixed(1)} %`);
  console.log(`    media de un mes cualquiera     ${(universo.reduce((a, b) => a + b, 0) / universo.length).toFixed(1)} %`);
  console.log(`    p (permutación, ${N.toLocaleString("es")} sorteos)  ${p.toFixed(3)}`);
  console.log(`    ⇒ ${p < 0.05 ? "se distingue del azar" : "NO se distingue del azar: con 22 episodios no da"}`);
  resumen.episodioTest = { n: k, caidaMedia: +obs.toFixed(2), p: +p.toFixed(4), significativo: p < 0.05 };

  // Y el modo de fallo que se ve a simple vista: avisos que llegan DESPUÉS del golpe.
  const tarde = inicios.filter((x) => x.f.ret > 20);
  console.log(`
    avisos seguidos de un año MUY bueno (>+20 %): ${tarde.length} de ${k}`);
  console.log(`    ${tarde.map((x) => x.fecha.slice(0, 7)).join(" · ")}`);
  console.log(`    marzo de 2020 es el caso de manual: el aviso se enciende EN el suelo, no antes.`);
  resumen.falsasAlarmas = tarde.map((x) => x.fecha.slice(0, 7));
}

writeFileSync(join(AQUI, "out", "aviso_credito_base.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), meses: filas.length,
  conAviso: { n: con.length, ret12m: +med(con, "ret").toFixed(2), peorCaida: +med(con, "dd").toFixed(2), pctCaidaMayor15: +pct(con, "dd", -15).toFixed(1) },
  sinAviso: { n: sin.length, ret12m: +med(sin, "ret").toFixed(2), peorCaida: +med(sin, "dd").toFixed(2), pctCaidaMayor15: +pct(sin, "dd", -15).toFixed(1) },
  frecuencia: +(100 * con.length / filas.length).toFixed(1), diferenciaCaida: +dif.toFixed(2), episodios: eps, ...resumen,
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/aviso_credito_base.json\n`);
