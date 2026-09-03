// ─────────────────────────────────────────────────────────────────────────────
// LA CONCENTRACIÓN DEL ÍNDICE — fase E
//
// El vídeo 1 dice que diez empresas son el 40 % del S&P 500. Es la afirmación de los cuatro que
// más directamente toca a Scora, porque el objetivo declarado es **batir al índice**: si el
// índice es diez empresas, batirlo es una apuesta sobre esas diez.
//
// ⚠️ LA MEDIDA DIRECTA NO SE PUEDE CONSTRUIR CON DATOS GRATIS, y se comprobó antes de intentarlo:
//
//   · La capitalización se derivaría de acciones × precio. Las acciones salen de
//     `dei:EntityCommonStockSharesOutstanding`, y **CINCO DE LAS QUINCE MAYORES fallan**:
//     Alphabet (GOOGL y GOOG) y Meta no lo etiquetan —son de clase doble y el tag va con
//     dimensiones que `companyfacts` no expone—, Berkshire devuelve un dato de 2011 con 1 M de
//     acciones (el recuento de la clase A) y Visa uno de 2010 con 469 M frente a ~1.900 M reales.
//   · **Y los fallos son silenciosos y plausibles**: Berkshire daría 0 B$ y Visa 178 B$. Una
//     medida de concentración construida así SUBESTIMARÍA el peso del top-10 excluyendo justo a
//     Alphabet, Meta y Berkshire — se equivocaría en la dirección que importa.
//   · Yahoo tampoco publica la capitalización en el endpoint gratuito.
//
// LO QUE SÍ SE PUEDE MEDIR, y es lo que de verdad importa para batir al índice: **la DINÁMICA**.
// `RSP` es el mismo S&P 500 equiponderado. La diferencia entre SPY y RSP no es otra cosa que el
// efecto de la concentración: cuando el ponderado por capitalización bate al equiponderado, es
// que las grandes tiran del índice. No da «el 40 %», da algo más útil — cuánto de lo que hay que
// batir viene del tamaño y no del negocio.
//
//   node --experimental-strip-types --no-warnings research/concentracion.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "Mozilla/5.0 (Scora research)" };

async function serie(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=25y&interval=1d`, { headers: UA });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const t = res?.timestamp ?? [], c = res?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const out = [];
  for (let i = 0; i < t.length; i++) if (c[i] != null) out.push({ date: new Date(t[i] * 1000).toISOString().slice(0, 10), p: c[i] });
  return out.length ? out : null;
}

const [spy, rsp] = await Promise.all([serie("SPY"), serie("RSP")]);
if (!spy || !rsp) { console.error("\n  ⛔ sin series\n"); process.exit(1); }

// Solape exacto: comparar tramos distintos es comparar epocas del mercado.
const m = new Map(rsp.map((o) => [o.date, o.p]));
const par = spy.filter((o) => m.has(o.date));
if (par.length < 500) { console.error(`\n  ⛔ solape corto (${par.length})\n`); process.exit(1); }

console.log(`\n  LA CONCENTRACIÓN DEL ÍNDICE · SPY frente a RSP (el mismo índice, equiponderado)`);
console.log(`  ${par.length} sesiones · ${par[0].date} → ${par.at(-1).date}\n`);

// El cociente acumulado: por encima de 1, el tamaño está aportando.
const base = { spy: par[0].p, rsp: m.get(par[0].date) };
const ratio = par.map((o) => ({ date: o.date, r: (o.p / base.spy) / (m.get(o.date) / base.rsp) }));

const anual = (a, b, anos) => (Math.pow(b / a, 1 / anos) - 1) * 100;
const anos = (new Date(par.at(-1).date) - new Date(par[0].date)) / (365.25 * 86400000);
const rSpy = anual(base.spy, par.at(-1).p, anos), rRsp = anual(base.rsp, m.get(par.at(-1).date), anos);

console.log(`  DESDE ${par[0].date.slice(0, 4)}, ANUALIZADO`);
console.log(`    S&P 500 ponderado por capitalización (SPY)   ${rSpy.toFixed(2)} %`);
console.log(`    El MISMO índice equiponderado (RSP)          ${rRsp.toFixed(2)} %`);
console.log(`    diferencia atribuible al tamaño             ${(rSpy - rRsp >= 0 ? "+" : "") + (rSpy - rRsp).toFixed(2)} pp/año`);

// Por décadas, porque el fenómeno no es constante y presentarlo como tal engañaría.
console.log(`\n  POR TRAMOS (la concentración NO es un estado, es un ciclo):`);
const tramos = [["2003-2009", "2003-01-01", "2009-12-31"], ["2010-2014", "2010-01-01", "2014-12-31"],
  ["2015-2019", "2015-01-01", "2019-12-31"], ["2020-2026", "2020-01-01", "2026-12-31"]];
const porTramo = [];
for (const [nombre, d0, d1] of tramos) {
  const t = par.filter((o) => o.date >= d0 && o.date <= d1);
  if (t.length < 200) continue;
  const y = (new Date(t.at(-1).date) - new Date(t[0].date)) / (365.25 * 86400000);
  const a = anual(t[0].p, t.at(-1).p, y), b = anual(m.get(t[0].date), m.get(t.at(-1).date), y);
  porTramo.push({ tramo: nombre, spy: +a.toFixed(2), rsp: +b.toFixed(2), diferencia: +(a - b).toFixed(2) });
  console.log(`    ${nombre}   SPY ${a.toFixed(1).padStart(6)} %   RSP ${b.toFixed(1).padStart(6)} %   ${(a - b >= 0 ? "+" : "") + (a - b).toFixed(2)} pp/año`);
}

// ¿Dónde estamos hoy? El percentil del cociente sobre su propia historia.
const ult = ratio.at(-1).r;
const hist = ratio.map((o) => o.r);
const pct = (100 * hist.filter((x) => x < ult).length) / hist.length;
// Y la velocidad, que es lo que el vídeo 1 enseña bien: el nivel importa menos que el cambio.
const hace1a = ratio.filter((o) => o.date <= new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)).at(-1);
const impulso = hace1a ? (ult / hace1a.r - 1) * 100 : null;

console.log(`\n  DÓNDE ESTAMOS`);
console.log(`    cociente SPY/RSP acumulado   ${ult.toFixed(3)}   percentil ${pct.toFixed(0)} de su historia`);
console.log(`    cambio en 12 meses           ${impulso == null ? "—" : (impulso >= 0 ? "+" : "") + impulso.toFixed(1) + " %"}`);
console.log(`    ⇒ ${impulso == null ? "—" : impulso > 2 ? "la concentración está AUMENTANDO: el índice depende cada vez más de sus mayores"
  : impulso < -2 ? "la concentración está BAJANDO: el índice se ensancha" : "la concentración está estable"}`);

// ⚠️ EL NIVEL Y LA VELOCIDAD PUEDEN DISCREPAR, y aquí discrepan. El cociente está en el
// percentil 98 de su historia —extremo— y su cambio a doce meses es pequeño. Es exactamente la
// lección del vídeo 1 aplicada a sí misma: el nivel dice «esto no ha estado nunca tan alto» y la
// velocidad dice «pero ya no acelera». Publicar sólo una de las dos sería elegir la que gusta.
if (impulso != null && pct > 90 && Math.abs(impulso) <= 2) {
  console.log(`\n  ⚠️ EL NIVEL Y LA VELOCIDAD DISCREPAN, y las dos se publican:`);
  console.log(`     el nivel está en el percentil ${pct.toFixed(0)} —nunca ha estado mucho más alto— y su`);
  console.log(`     cambio a doce meses (${(impulso >= 0 ? "+" : "") + impulso.toFixed(1)} %) ya no acelera. Es la propia tesis del vídeo 1`);
  console.log(`     aplicada a sí misma. Quedarse con una de las dos sería elegir la que gusta.`);
}

// Y lo que esto significa para el objetivo declarado de batir al indice.
const ultimo = porTramo.at(-1);
if (ultimo) {
  console.log(`\n  QUÉ SIGNIFICA PARA BATIR AL ÍNDICE`);
  console.log(`     En ${ultimo.tramo} el índice ha rendido ${ultimo.diferencia >= 0 ? "+" : ""}${ultimo.diferencia} pp/año MÁS que su`);
  console.log(`     versión equiponderada. Esa diferencia no viene de mejores negocios: viene del TAMAÑO.`);
  console.log(`     Batir al índice en este tramo ha exigido tener las mayores, no las mejores — y eso`);
  console.log(`     se ha revertido dos veces antes, en 2003-2009 y 2010-2014, seis años cada vez.`);
}

console.log(`\n  ⚠️ LO QUE ESTO NO DICE. No da «diez empresas son el 40 %»: esa cifra necesita`);
console.log(`     capitalizaciones, y cinco de las quince mayores no se pueden calcular con datos`);
console.log(`     gratis (Alphabet, Meta y Berkshire no etiquetan sus acciones en circulación de`);
console.log(`     forma utilizable). Lo que da es la DINÁMICA, que para batir al índice es lo que`);
console.log(`     cuenta: cuánto de lo que hay que batir viene del tamaño y no del negocio.\n`);

writeFileSync(join(AQUI, "out", "concentracion.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), sesiones: par.length, desde: par[0].date, hasta: par.at(-1).date,
  anualizado: { spy: +rSpy.toFixed(2), rsp: +rRsp.toFixed(2), diferencia: +(rSpy - rRsp).toFixed(2) },
  porTramo, cociente: +ult.toFixed(4), percentil: +pct.toFixed(1),
  impulso12m: impulso == null ? null : +impulso.toFixed(2),
  limitacion: "Mide la DINAMICA de la concentracion (ponderado por capitalizacion frente a equiponderado), no el peso del top-10. Ese peso necesita capitalizaciones y CINCO de las quince mayores no se pueden calcular con datos gratis: Alphabet, GOOG y Meta no etiquetan EntityCommonStockSharesOutstanding, Berkshire devuelve un dato de 2011 con el recuento de la clase A, y Visa uno de 2010. Los fallos son silenciosos y plausibles, que es lo que los hace peligrosos.",
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/concentracion.json\n`);
