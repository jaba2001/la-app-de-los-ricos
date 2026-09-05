// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA SOBERANA Y DE DIVISA — fase 4 del plan de las tres capas
//
// Los dos vídeos de bonos sostienen su tesis sobre CUATRO cifras concretas. Esas cifras se
// pueden comprobar una a una, y eso es lo que hace este script. Lo que NO se construye es la
// narrativa que las envuelve —«la factura está por llegar», «Japón va diez años por delante»—
// porque son afirmaciones sin falsar y con calendario implícito.
//
// ⚠️ LA DISTINCIÓN QUE ORDENA TODO EL FICHERO: un HECHO verificable se publica con su fuente
// y su fecha. Un PRONÓSTICO no se publica, aunque el hecho que lo sostiene sea cierto. Que la
// deuda haya crecido no dice cuándo pasará nada, y decir que sí lo dice es lo que separa a un
// panel de datos de un canal de miedo.
//
// Y por eso este módulo es EXPLICATIVO: cero entradas al asignador, cero entradas al score.
//
//   node --experimental-strip-types --no-warnings research/soberano.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { percentil } from "../lib/tipos.ts";

// La clave sale SOLO del entorno. Estaba embebida como respaldo, lo que la dejaba en el
// codigo y en el historial de git de un repo compartido. Es gratuita y de bajo impacto,
// pero un respaldo silencioso tambien significa que el script parece funcionar cuando el
// entorno esta mal puesto — y entonces se descubre en produccion, no aqui.
const FRED = process.env.FRED_KEY;
if (!FRED) throw new Error("Falta FRED_KEY. Consiguela gratis en https://fred.stlouisfed.org/docs/api/api_key.html y exportala antes de ejecutar.");
const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = join(AQUI, ".cache", "fredfull");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

// Mismo contrato de cobertura que la capa de tipos: cada serie declara lo que tiene que traer.
// Sin esto, una serie truncada devuelve un percentil sobre tres años y nadie se entera.
const SERIES = {
  DTWEXBGS:        { que: "Indice del dolar (amplio)", desde: "2006-01-02", min: 5000 },
  IRLTLT01JPM156N: { que: "Tipo largo de Japon", desde: "1989-01-01", min: 400 },
  GFDEBTN:         { que: "Deuda federal total", desde: "1966-01-01", min: 230 },
  A091RC1Q027SBEA: { que: "Intereses pagados por el Gobierno federal", desde: "1947-01-01", min: 300 },
  FDEFX:           { que: "Gasto federal en defensa", desde: "1947-01-01", min: 300 },
  CPIAUCSL:        { que: "IPC", desde: "1947-01-01", min: 900 },
  GDP:             { que: "PIB nominal", desde: "1947-01-01", min: 300 },
};

async function serie(id) {
  const p = join(DIR, id + ".json");
  if (existsSync(p)) { try { const o = JSON.parse(readFileSync(p, "utf8")); if (o.length) return o; } catch { /* recarga */ } }
  const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json`);
  if (!r.ok) return [];
  const j = await r.json();
  const obs = (j?.observations ?? []).filter((o) => o.value !== "." && o.value !== "").map((o) => ({ date: o.date, v: parseFloat(o.value) }));
  if (obs.length) writeFileSync(p, JSON.stringify(obs));
  await new Promise((x) => setTimeout(x, 120));
  return obs;
}

console.log(`\n  LA CAPA SOBERANA · las cifras de los videos, comprobadas una a una\n`);
const S = {}, fallos = [];
for (const [id, c] of Object.entries(SERIES)) {
  const o = await serie(id); S[id] = o;
  const d0 = o[0]?.date ?? null;
  const mal = d0 == null || d0 > c.desde || o.length < c.min;
  if (mal) fallos.push(`${id}: ${o.length} obs desde ${d0 ?? "—"} (contrato: >=${c.min} desde ${c.desde})`);
  console.log(`  ${mal ? "⛔" : "ok"} ${id.padEnd(18)} ${String(o.length).padStart(6)} obs · ${(d0 ?? "—").padEnd(12)} ${c.que}`);
}
if (fallos.length) {
  console.error(`\n  ⛔ ${fallos.length} serie(s) no cumplen su contrato:`);
  fallos.forEach((f) => console.error(`     · ${f}`));
  process.exit(1);
}

const ult = (id) => S[id].at(-1);
const enFecha = (id, d) => { const h = S[id].filter((o) => o.date <= d); return h.length ? h.at(-1) : null; };
const afirmaciones = [];
const comprobar = (afirma, cierto, evidencia, matiz = null) => {
  afirmaciones.push({ afirma, cierto, evidencia, matiz });
  console.log(`\n  ${cierto === true ? "CIERTO " : cierto === false ? "FALSO  " : "MATIZ  "} · ${afirma}`);
  console.log(`           ${evidencia}`);
  if (matiz) console.log(`           ⚠️ ${matiz}`);
};

// ── 1. «El dolar ha perdido el 87 % de su poder adquisitivo desde 1971» ──────────────────
{
  const a = enFecha("CPIAUCSL", "1971-08-15"), b = ult("CPIAUCSL");
  const perdida = (1 - a.v / b.v) * 100;
  comprobar(
    "El dolar ha perdido el 87 % de su poder adquisitivo desde 1971",
    Math.abs(perdida - 87) < 3 ? true : null,
    `IPC ${a.v.toFixed(1)} (${a.date}) → ${b.v.toFixed(1)} (${b.date}): perdida del ${perdida.toFixed(1)} %`,
    perdida >= 87 ? null : `la cifra del video se queda corta o larga segun el mes que se tome como origen`);
}

// ── 2. «Los intereses de la deuda ya superan el gasto militar» ───────────────────────────
{
  const i = ult("A091RC1Q027SBEA"), d = enFecha("FDEFX", i.date);
  const ratio = i.v / d.v;
  comprobar(
    "Los intereses de la deuda superan al gasto en defensa",
    ratio > 1,
    `intereses ${(i.v / 1000).toFixed(2)} B$ frente a defensa ${(d.v / 1000).toFixed(2)} B$ (${i.date}): ratio ${ratio.toFixed(2)}x`,
    "ambas cifras son tasas anualizadas de las cuentas nacionales, no ejecucion presupuestaria");
}

// ── 3. «La deuda esta fuera de control» — el hecho es la deuda/PIB, el pronostico no se da ─
{
  const d = ult("GFDEBTN"), g = enFecha("GDP", d.date);
  const ratio = (d.v / 1000) / g.v * 100;
  const hace10 = enFecha("GFDEBTN", new Date(new Date(d.date).setFullYear(new Date(d.date).getFullYear() - 10)).toISOString().slice(0, 10));
  const g10 = enFecha("GDP", hace10.date);
  comprobar(
    "La deuda federal sobre PIB esta en maximos",
    null,
    `deuda/PIB ${ratio.toFixed(0)} % (${d.date}), frente al ${((hace10.v / 1000) / g10.v * 100).toFixed(0)} % de hace diez años`,
    "es un HECHO verificable. Que eso implique una crisis, y menos aun cuando, NO se publica: es el pronostico que los videos venden y que no se puede falsar");
}

// ── 4. «El bono japones a 30 años en maximos historicos» ─────────────────────────────────
{
  const j = ult("IRLTLT01JPM156N");
  const hist = S.IRLTLT01JPM156N.map((o) => o.v);
  const p = percentil(j.v, hist);
  const max = Math.max(...hist);
  // ⚠️ AQUI NO SE ESTA MIDIENDO LO QUE EL VIDEO AFIRMA, Y HAY QUE DECIRLO. El video habla del
  // JGB a 30 AÑOS; `IRLTLT01JPM156N` es el tipo a 10 años. Son instrumentos distintos con
  // historias distintas: el 30 años japones no existe hasta 1999, asi que su «maximo
  // historico» es un liston mucho mas bajo y la afirmacion PUEDE ser cierta ahi. Dar por
  // refutada una cifra midiendo otra serie es el mismo error que este repo ya cometio al
  // comparar una referencia «sin financieros» que si los llevaba.
  comprobar(
    "El tipo largo japones esta en maximos historicos [medido sobre el 10 años, NO el 30 del video]",
    null,   // NO se marca como falsa: no se refuta una afirmacion midiendo otro instrumento
    `${j.v.toFixed(2)} % (${j.date}) = percentil ${p.pct?.toFixed(0)} de ${hist.length} obs desde 1989. Maximo de la serie: ${max.toFixed(2)} %`,
    "NO refuta al video: el habla del JGB a 30 años, que no cotiza hasta 1999 y cuyo maximo historico es " +
    "un liston mucho mas bajo. Lo que si queda medido es que el tipo LARGO japones, con historia " +
    "completa desde 1989, no esta cerca de sus maximos: entonces pagaba " + max.toFixed(2) + " %");
}

// ── El dolar, como CONTEXTO. Sin lectura direccional: es la unidad de medida, no una apuesta.
const dxy = ult("DTWEXBGS");
const pdxy = percentil(dxy.v, S.DTWEXBGS.map((o) => o.v));
console.log(`\n  EL DOLAR (contexto, no señal)`);
console.log(`    indice amplio    ${dxy.v.toFixed(2)}  a ${dxy.date}   percentil ${pdxy.pct?.toFixed(0) ?? "—"} de ${S.DTWEXBGS.length} obs desde 2006`);
console.log(`    ⚠️ Se publica como unidad de medida de todo lo demas, NO como una posicion.`);

const ciertas = afirmaciones.filter((a) => a.cierto === true).length;
const falsas = afirmaciones.filter((a) => a.cierto === false).length;
console.log(`\n  RESUMEN: ${ciertas} ciertas · ${falsas} falsas · ${afirmaciones.length - ciertas - falsas} con matiz, de ${afirmaciones.length} afirmaciones comprobadas`);
console.log(`  NO se construye: la espiral de deuda como señal, el calendario de la crisis, ni «Japon va por delante».\n`);

writeFileSync(join(AQUI, "out", "soberano.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  cobertura: Object.fromEntries(Object.entries(SERIES).map(([id, c]) => [id, { obs: S[id].length, desde: S[id][0]?.date ?? null, ...c }])),
  afirmaciones,
  dolar: { valor: dxy.v, fecha: dxy.date, percentil: pdxy.pct == null ? null : +pdxy.pct.toFixed(1), obs: S.DTWEXBGS.length },
  noSeConstruye: ["la espiral de deuda como señal", "el calendario de la crisis", "«Japon va diez años por delante»", "«el oro no esta listo»"],
}, null, 2) + "\n", "utf8");
console.log(`  → research/out/soberano.json\n`);
