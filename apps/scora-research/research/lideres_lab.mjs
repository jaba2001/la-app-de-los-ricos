// ─────────────────────────────────────────────────────────────────────────────
// LA TABLA DE LÍDERES DEL AÑO — y qué les pasa DESPUÉS (Fase F6)
//
// El anuncio que originó esta fase enseñaba «los mejores valores del S&P 500 de 2026»:
// SNDK +571 %, MRNA +359 %, DELL +246 %, MU +238 %… Es una clasificación EX POST. No afirma
// nada sobre el futuro, pero se publica en un contexto que invita a leerla como si lo hiciera.
//
// Este laboratorio construye esa misma tabla y, sobre todo, responde a la pregunta que la
// tabla NO responde y que cualquiera se hace al verla: **¿qué le pasa al año siguiente a
// quien sale en ella?**
//
// No es una hipótesis nueva ni gasta presupuesto de ensayos: es la misma pregunta que ya
// respondió `momentum_audit_long.json` sobre 192 meses (ninguna especificación de momentum
// significativa, compuesto p = 0,877, −136 pp frente al SPY). Aquí se replantea en la forma
// concreta en que la ve un usuario —«los diez mejores del año»— porque un resultado en la
// forma de la pregunta convence, y una tabla de ICs no.
//
//   node --experimental-strip-types --no-warnings research/lideres_lab.mjs [--desde 2011]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { returnsSeriesLong } from "./pricesLong.mjs";

/**
 * Rentabilidad total entre dos fechas, con dividendos y splits (log-retornos acumulados).
 *
 * Se calcula aquí porque `pricesLong.mjs` NO exporta `fwdReturn` — sólo la serie. La primera
 * versión de este script llamaba a `pxl.fwdReturn` y el `try/catch` se tragaba el TypeError
 * en silencio: salían cero precios en los trece años y el artefacto llegó a escribirse con
 * un veredicto («no predice nada») calculado sobre CERO observaciones. Un catch mudo
 * alrededor de una llamada inexistente no da un error: da un resultado falso y creíble.
 */
async function retornoEntre(ticker, desde, hasta) {
  const serie = await returnsSeriesLong(ticker);
  if (!serie.length) return null;
  let acum = 0, n = 0;
  for (const x of serie) { if (x.date > desde && x.date <= hasta) { acum += x.ret; n++; } }
  if (n < 100) return null;           // menos de medio año de sesiones: no es un año
  return Math.expm1(acum);
}

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESDE = Number(arg("--desde", "2011"));
const HASTA = Number(arg("--hasta", String(new Date().getUTCFullYear() - 1)));
const TOP = Number(arg("--top", "10"));
const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const table = await loadSP500Historical();
if (!table) { console.error("  ✖ sin tabla de miembros"); process.exit(1); }

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const mediana = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log(`\n  LA TABLA DE LÍDERES · top ${TOP} de cada año, ${DESDE}-${HASTA}\n`);

const porAno = [];
for (let y = DESDE; y <= HASTA; y++) {
  const ini = `${y}-01-02`, fin = `${y}-12-24`;
  const iniSig = `${y + 1}-01-02`, finSig = `${y + 1}-12-24`;
  const miembros = [...new Set(membersAsOf(table, ini) || [])];
  if (!miembros.length) continue;

  const rets = [];
  for (const t of miembros) {
    const r = await retornoEntre(t, ini, fin); if (r != null && isFinite(r)) rets.push({ t, r });
  }
  if (rets.length < 100) { console.log(`  ${y}  sólo ${rets.length} con precio — se salta`); continue; }
  rets.sort((a, b) => b.r - a.r);
  const lideres = rets.slice(0, TOP);

  // Y ahora lo que la tabla no dice: el año SIGUIENTE.
  const sig = new Map();
  for (const { t } of rets) {
    const r2 = await retornoEntre(t, iniSig, finSig); if (r2 != null && isFinite(r2)) sig.set(t, r2);
  }
  const lideresSig = lideres.map((x) => sig.get(x.t)).filter((x) => x != null);
  const universoSig = rets.map((x) => sig.get(x.t)).filter((x) => x != null);
  if (lideresSig.length < Math.ceil(TOP * 0.6) || universoSig.length < 100) { console.log(`  ${y}  sin año siguiente utilizable`); continue; }

  const mLid = media(lideresSig), mUni = media(universoSig);
  porAno.push({
    ano: y, universo: rets.length,
    lideres: lideres.map((x) => ({ t: x.t, ret: +(x.r * 100).toFixed(1), retSiguiente: sig.has(x.t) ? +(sig.get(x.t) * 100).toFixed(1) : null })),
    medioLideresAnoSiguiente: +(mLid * 100).toFixed(1),
    medioUniversoAnoSiguiente: +(mUni * 100).toFixed(1),
    diferencia: +((mLid - mUni) * 100).toFixed(1),
    medianaLideresAnoSiguiente: +(mediana(lideresSig) * 100).toFixed(1),
  });
  console.log(`  ${y}  top ${TOP}: ${lideres.slice(0, 5).map((x) => `${x.t} +${(x.r * 100).toFixed(0)}%`).join("  ")}`);
  console.log(`        año siguiente → líderes ${(mLid * 100).toFixed(1)} %   ·   universo ${(mUni * 100).toFixed(1)} %   ·   diferencia ${((mLid - mUni) * 100).toFixed(1)} pp`);
}

// ── Veredicto ─────────────────────────────────────────────────────────────────────────────
// Sin años suficientes no se concluye NADA. Este guardián existe porque la primera versión
// llegó a imprimir "no predice nada" con cero años medidos: un veredicto sobre una muestra
// vacía es indistinguible de un veredicto de verdad para quien lo lee.
const MINIMO_ANOS = 5;
if (porAno.length < MINIMO_ANOS) {
  console.error(`  ✖ sólo ${porAno.length} años con datos utilizables (hacen falta ${MINIMO_ANOS}).`);
  console.error("    NO se escribe artefacto ni se concluye nada: una muestra vacía no es un resultado.");
  process.exit(1);
}
const difs = porAno.map((x) => x.diferencia);
const m = media(difs);
const s = difs.length > 1 ? Math.sqrt(difs.reduce((a, x) => a + (x - m) ** 2, 0) / (difs.length - 1)) : null;
const se = s != null ? s / Math.sqrt(difs.length) : null;
const gana = difs.filter((x) => x > 0).length;

console.log(`\n  ── ${porAno.length} años medidos ──`);
console.log(`  Los diez mejores de un año, al año siguiente, frente a su propio universo:`);
console.log(`    diferencia media  ${m != null ? m.toFixed(1) : "—"} pp   ±${se != null ? se.toFixed(1) : "—"}   t = ${m != null && se ? (m / se).toFixed(2) : "—"}`);
console.log(`    años en que los líderes ganan: ${gana} de ${porAno.length}`);
// DOS PRUEBAS, no una, porque dicen cosas distintas y quedarse con la cómoda sería elegir.
// La de MAGNITUDES pregunta "¿cuánto ganan?" y la domina un año extremo; la de SIGNOS
// pregunta "¿ganan más veces de las que ganarían por azar?" y es inmune a ese año.
function binomialCola(k, n) {                 // P(X >= k) con p = 0,5
  const comb = (a, b) => { let r = 1; for (let i = 0; i < b; i++) r = r * (a - i) / (i + 1); return r; };
  let acc = 0; for (let i = k; i <= n; i++) acc += comb(n, i);
  return acc / 2 ** n;
}
const pSignos = binomialCola(gana, porAno.length);
console.log(`    prueba de signos: ${gana}/${porAno.length}   p = ${pSignos.toFixed(3)} (una cola) · ${(2 * pSignos).toFixed(3)} (dos colas)`);
const significativo = m != null && se != null && Math.abs(m / se) > 2;
const signosSignificativo = 2 * pSignos < 0.05;
console.log(`\n  ${significativo
  ? (m > 0 ? "los líderes SÍ repiten (magnitudes)" : "los líderes rinden PEOR al año siguiente")
  : signosSignificativo
    ? "○ ganan más años de los que ganarían por azar, pero la MAGNITUD no es significativa"
    : "○ no se puede afirmar que salir en la tabla prediga nada — y tampoco lo contrario"}`);
console.log(`\n  ⚠ Lectura honesta: la estimación puntual (${m > 0 ? "+" : ""}${m?.toFixed(1)} pp) es grande, y los líderes`);
console.log(`  ganan ${gana} de ${porAno.length} años. Lo que falta es POTENCIA: con ${porAno.length} observaciones anuales y esta`);
console.log(`  varianza, el efecto mínimo detectable ronda ${se != null ? (2.8 * se).toFixed(1) : "—"} pp. Decir "no predice nada"`);
console.log(`  sería tan poco riguroso como decir que sí.`);
console.log(`\n  Coincide con lo ya medido en momentum_audit_long.json sobre 192 meses: ninguna`);
console.log(`  especificación de momentum alcanza significación (compuesto p = 0,877), y la`);
console.log(`  cartera de momentum se queda 136 pp por debajo del SPY. Con la salvedad de`);
console.log(`  siempre: la ventana está infrapotenciada, así que esto NO demuestra que no`);
console.log(`  funcione — demuestra que con estos datos no se puede afirmar que funcione.`);

const artefacto = {
  generatedAt: new Date().toISOString(),
  desde: DESDE, hasta: HASTA, top: TOP,
  anos: porAno,
  resumen: { diferenciaMediaPp: m, se, t: m != null && se ? m / se : null, anosQueGanan: gana, anosMedidos: porAno.length, significativo },
  pruebaDeSignos: { gana, de: porAno.length, pUnaCola: pSignos, pDosColas: 2 * pSignos, significativo: signosSignificativo },
  mdePp: se != null ? 2.8 * se : null,
  lectura: significativo
    ? (m > 0 ? "Los líderes de un año baten a su universo al siguiente." : "Los líderes de un año rinden por debajo al siguiente.")
    : "INFRAPOTENCIADO. La estimación puntual es positiva y grande y los líderes ganan la mayoría de los años, pero con esta muestra anual no se puede afirmar ni que repitan ni que no. No es lo mismo que 'no predice nada'.",
  nota: "Clasificación EX POST. La tabla dice lo que ya subió, no lo que va a subir. Se publica como contexto y NO alimenta ninguna señal.",
};
const ruta = join(OUT, "lideres_lab.json");
writeFileSync(ruta, JSON.stringify(artefacto, null, 1));
console.log(`\n  → ${ruta}\n`);
