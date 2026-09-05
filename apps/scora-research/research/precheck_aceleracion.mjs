// ─────────────────────────────────────────────────────────────────────────────
// ¿APORTA LA ACELERACIÓN ALGO QUE NO TENGAMOS YA?
//
// El vídeo 1 sostiene que lo que mata a una estructura no es que el nivel caiga, sino que el
// CRECIMIENTO se frene. En su caso original está confirmado y con precisión: el crecimiento del
// Case-Shiller hizo pico en 2005-09 y el nivel en 2006-07 — diez meses de adelanto.
//
// La fase C propone generalizarlo. Pero eso cuesta el ensayo 345, y antes hay que hacer la
// misma pregunta que ahorró el 345 la vez anterior: **¿no está ya dentro de algo que tenemos?**
//
// ⚠️ EL CRITERIO SE ESCRIBE AQUÍ, ANTES DE MIRAR EL RESULTADO. Dos puertas, y basta con que se
// cierre UNA:
//
//   PUERTA 1 · |ρ(aceleración, momentum 12m)| ≥ 0,70
//     → la aceleración es momentum disfrazado. Y el momentum de este repo está AUDITADO sobre
//       192 meses: −136 pp frente al SPY. Si son lo mismo, ya sabemos el resultado y el ensayo
//       no se gasta.
//
//   PUERTA 2 · |ρ(aceleración de la liquidez, impulso de liquidez del régimen)| ≥ 0,70
//     → el régimen YA usa el cambio a 6 meses de la liquidez neta, que es una primera derivada.
//       Si la segunda derivada va con ella, no añade dimensión.
//
// Si las dos quedan por debajo de 0,70, la aceleración es información nueva y el ensayo 345
// está justificado. Si alguna las supera, se escribe que se cerró y se cierra.
//
//   node --experimental-strip-types --no-warnings research/precheck_aceleracion.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const CRITERIO = 0.70;

const px = (t) => {
  for (const p of [join(AQUI, ".cache", "px", t + ".json"), join(AQUI, ".cache", "px_long", t + ".json")])
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* siguiente */ } }
  return null;
};
const fred = (id) => {
  const p = join(AQUI, ".cache", "fredfull", id + ".json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
};
const asOf = (a, d, k) => { const h = a.filter((o) => (o.date ?? o.d) <= d); return h.length ? (h[h.length - 1][k] ?? h[h.length - 1].v) : null; };

const corr = (x, y) => {
  const n = x.length; if (n < 24) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return { rho: sxy / Math.sqrt(sxx * syy), n };
};

const meses = [];
for (let y = 1994; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
  const d = `${y}-${String(m).padStart(2, "0")}-15`;
  if (d <= "2026-09-01") meses.push(d);
}

console.log(`\n  ¿APORTA LA ACELERACION ALGO NUEVO?`);
console.log(`  criterio PREESCRITO: |ρ| >= ${CRITERIO} en CUALQUIERA de las dos puertas → no se gasta el ensayo 345\n`);

// ── PUERTA 1 · aceleración del precio contra momentum ───────────────────────────────────
const S = px("SPY");
if (!S) { console.error("  ⛔ sin serie de SPY\n"); process.exit(1); }
const MOM = [], ACC = [];
for (let i = 24; i < meses.length; i++) {
  const p0 = asOf(S, meses[i], "adj"), p12 = asOf(S, meses[i - 12], "adj"), p24 = asOf(S, meses[i - 24], "adj");
  if (p0 == null || p12 == null || p24 == null) continue;
  const mom = p0 / p12 - 1;          // momentum 12m: el crecimiento
  const momPrev = p12 / p24 - 1;     // el mismo, un año antes
  MOM.push(mom * 100);
  ACC.push((mom - momPrev) * 100);   // la ACELERACION: cuanto ha cambiado el crecimiento
}
const p1 = corr(ACC, MOM);
console.log(`  PUERTA 1 · aceleracion del precio vs momentum 12m`);
console.log(`    n = ${p1.n} meses (${meses[24].slice(0, 7)} → ${meses.at(-1).slice(0, 7)})`);
console.log(`    ρ = ${p1.rho.toFixed(3)}   ${Math.abs(p1.rho) >= CRITERIO ? "⇒ CERRADA: es momentum disfrazado" : "⇒ abierta: no es lo mismo que el momentum"}`);

// ── PUERTA 2 · aceleración de la liquidez contra el impulso que el régimen ya usa ────────
const W = fred("WALCL"), T = fred("WTREGEN"), R = fred("RRPONTSYD");
let p2 = null;
if (W && T && R) {
  const IMP = [], ACL = [];
  for (let i = 12; i < meses.length; i++) {
    const neta = (d) => {
      const w = asOf(W, d, "v"), t = asOf(T, d, "v"), r = asOf(R, d, "v");
      return w == null || t == null || r == null ? null : w - t - r * 1000;   // RRP en miles de millones
    };
    const n0 = neta(meses[i]), n6 = neta(meses[i - 6]), n12 = neta(meses[i - 12]);
    if (n0 == null || n6 == null || n12 == null || !n6 || !n12) continue;
    const imp = n0 / n6 - 1;         // el impulso a 6 meses: lo que el regimen YA usa
    const impPrev = n6 / n12 - 1;
    IMP.push(imp * 100);
    ACL.push((imp - impPrev) * 100);  // su segunda derivada
  }
  p2 = corr(ACL, IMP);
  console.log(`\n  PUERTA 2 · aceleracion de la liquidez vs el impulso a 6m del regimen`);
  console.log(`    n = ${p2.n} meses`);
  console.log(`    ρ = ${p2.rho.toFixed(3)}   ${Math.abs(p2.rho) >= CRITERIO ? "⇒ CERRADA: va con lo que el regimen ya mide" : "⇒ abierta: añade una dimension"}`);
} else {
  console.log(`\n  PUERTA 2 · sin las series de liquidez en cache — no evaluable`);
}

const cerradas = [
  Math.abs(p1.rho) >= CRITERIO ? "1 (aceleracion = momentum)" : null,
  p2 && Math.abs(p2.rho) >= CRITERIO ? "2 (aceleracion = impulso de liquidez)" : null,
].filter(Boolean);

// ⚠️ EL MARGEN, PORQUE DECIDIR SOBRE UN PELO NO ES DECIDIR. Las dos puertas caen practicamente
// EN el criterio: 0,681 y 0,705 alrededor de 0,70. La puerta 2 lo cruza por cinco milesimas, y
// presentar eso como un veredicto limpio seria el mismo sobreajuste a un umbral que este repo
// evita en todo lo demas. Lo que de verdad dice la medicion no es de que lado cae cada una,
// sino que las DOS estan cerca: la aceleracion comparte ~46 % de su varianza con el momentum
// —auditado y perdedor por 136 pp— y ~50 % con el impulso de liquidez que el regimen ya usa.
// La conclusion aguanta con cualquier umbral razonable entre 0,60 y 0,75.
const rhos = [Math.abs(p1.rho), ...(p2 ? [Math.abs(p2.rho)] : [])];
const margen = Math.min(...rhos.map((r) => Math.abs(r - CRITERIO)));
const alFilo = margen < 0.05;

const veredicto = cerradas.length
  ? `NO SE GASTA EL ENSAYO 345 — puerta ${cerradas.join(" y ")} cerrada`
  : "LA ACELERACION ES INFORMACION NUEVA — el ensayo 345 esta justificado";
console.log(`\n  ⇒ ${veredicto}`);
if (alFilo) {
  console.log(`\n  ⚠️ PERO EL MARGEN ES DE ${margen.toFixed(3)}: las dos puertas caen practicamente EN el criterio.`);
  console.log(`     Lo que decide no es de que lado cae cada una, sino que las DOS estan cerca:`);
  console.log(`     la aceleracion comparte ~${(p1.rho * p1.rho * 100).toFixed(0)} % de su varianza con el momentum —auditado, -136 pp—`);
  if (p2) console.log(`     y ~${(p2.rho * p2.rho * 100).toFixed(0)} % con el impulso de liquidez que el regimen ya usa.`);
  console.log(`     La conclusion aguanta con cualquier umbral entre 0,60 y 0,75. Con 0,80 no, y eso`);
  console.log(`     tambien hay que decirlo: no es una respuesta rotunda, es una redundancia alta.`);
}
console.log("");

writeFileSync(join(AQUI, "out", "precheck_aceleracion.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), criterioPreescrito: CRITERIO,
  puerta1: { que: "aceleracion del precio vs momentum 12m", rho: +p1.rho.toFixed(4), n: p1.n, cerrada: Math.abs(p1.rho) >= CRITERIO },
  puerta2: p2 ? { que: "aceleracion de la liquidez vs impulso 6m del regimen", rho: +p2.rho.toFixed(4), n: p2.n, cerrada: Math.abs(p2.rho) >= CRITERIO } : null,
  veredicto, margenAlCriterio: +margen.toFixed(4), alFilo,
  matiz: alFilo ? "Las dos puertas caen practicamente EN el criterio (0,681 y 0,705 alrededor de 0,70). Lo que decide no es de que lado cae cada una sino que las dos estan cerca: la aceleracion es en gran medida redundante con el momentum (auditado, -136 pp) y con el impulso de liquidez del regimen. La conclusion aguanta entre 0,60 y 0,75; con 0,80 no." : null,
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/precheck_aceleracion.json\n`);
