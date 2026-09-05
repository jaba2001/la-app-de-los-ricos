// ─────────────────────────────────────────────────────────────────────────────
// ¿ESTE FONDO DE ORO SE COMPORTA COMO SI TUVIERA METAL?
//
// La única idea del vídeo de Japón que es comprobable y no alarmista. Él dice «el oro no está
// listo» porque hay más reclamaciones en papel que metal en cámaras. Eso no se puede falsar.
// Lo que SÍ se puede es lo concreto: **este fondo se comporta como metal asignado y este otro no.**
//
// ⚠️ DOS PREMISAS DEL PLAN QUE LA MEDICIÓN TUMBÓ:
//   1. «Se resuelve con los N-PORT, la maquinaria del mapa CUSIP». FALSO: los ETF de oro NO
//      presentan N-PORT. Son fideicomisos de materias primas y presentan 10-K y 10-Q, porque
//      no están registrados bajo la Ley de Sociedades de Inversión de 1940. Verificado contra
//      EDGAR para los siete.
//   2. «El XBRL dirá las onzas». FALSO: en los datos de GLD no hay ni un tag de onzas, metal
//      ni custodia asignada. Sólo `CustodyFees`, que dice que hay algo custodiado pero no qué.
//
// LO QUE SÍ SE PUEDE MEDIR, y con control positivo: si dos vehículos tienen metal ASIGNADO,
// sus retornos sólo pueden diferir en la comisión. Uno que replique con futuros o permutas
// arrastra el coste de renovar los contratos, y eso se acumula y se VE.
//
//   diferencia observada ≈ diferencia de comisiones  → se comporta como metal asignado
//   diferencia observada ≫ diferencia de comisiones  → hace otra cosa
//
// DGL es el CONTROL POSITIVO: replica con futuros y está declarado. Si el test no lo caza, el
// test no vale. SLV es el control negativo: es plata, tiene que divergir del todo.
//
// ⚠️ Y EL LÍMITE, QUE HAY QUE DECIR AL PUBLICAR: esto mide COMPORTAMIENTO, no existencia. Un
// fondo puede comportarse como metal asignado y no tenerlo. Lo que este test descarta es lo
// contrario: si NO se comporta como metal, no lo tiene.
//
//   node --experimental-strip-types --no-warnings research/oro_respaldo.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const UA = { "User-Agent": "Mozilla/5.0 (Scora research)" };

// Comisión anual PUBLICADA por cada emisor. No es una estimación: es el dato del folleto, y
// es lo que hace falsable el test — sin él «divergen un poco» no significa nada.
const FONDOS = {
  // ── SUJETOS: los que declaran metal asignado
  GLD:  { nombre: "SPDR Gold Shares", comision: 0.40, cik: "0001222333", declara: "metal asignado", control: null },
  IAU:  { nombre: "iShares Gold Trust", comision: 0.25, cik: "0001278680", declara: "metal asignado", control: null },
  SGOL: { nombre: "abrdn Physical Gold", comision: 0.17, cik: "0001450923", declara: "metal asignado", control: null },
  GLDM: { nombre: "SPDR Gold MiniShares", comision: 0.10, cik: "0001618181", declara: "metal asignado", control: null },
  OUNZ: { nombre: "VanEck Merk Gold", comision: 0.25, cik: "0001546652", declara: "metal asignado, entregable", control: null },
  PHYS: { nombre: "Sprott Physical Gold", comision: 0.41, cik: "0001477049", declara: "metal asignado (40-F)", control: null },
  BAR:  { nombre: "GraniteShares Gold", comision: 0.17, cik: null, declara: "metal asignado", control: null },
  AAAU: { nombre: "Goldman Sachs Physical Gold", comision: 0.18, cik: null, declara: "metal asignado", control: null },

  // ── CONTROLES POSITIVOS: tienen que salir marcados o el test no vale.
  // DGP es el mas importante de los tres: NO es un fondo, es una NOTA no garantizada del
  // emisor. Es literalmente el «papel sin metal detras» del que habla el video, y cotiza
  // junto a los demas como si fuera oro.
  DGP:  { nombre: "DB Gold Double Long ETN", comision: 0.75, cik: null, declara: "NOTA 2x no garantizada - control", control: "positivo" },
  DBP:  { nombre: "Invesco DB Precious Metals", comision: 0.75, cik: null, declara: "FUTUROS - control", control: "positivo" },
  SLV:  { nombre: "iShares Silver Trust", comision: 0.50, cik: "0001330568", declara: "PLATA - control", control: "positivo" },

  // ⚠️ DGL, el control que el plan proponia, esta MUERTO: 1.254 timestamps y solo 385 cierres,
  // el ultimo el 16-03-2023. Es un muñon congelado — la tercera forma de serie muerta. Se deja
  // porque su ventana viva sigue sirviendo, y porque descubrirlo es parte del resultado.
  DGL:  { nombre: "Invesco DB Gold (LIQUIDADO 2023)", comision: 0.75, cik: null, declara: "FUTUROS, liquidado - control", control: "positivo" },
};
const REF = "GLD";                 // referencia: el mayor y el más antiguo
const UMBRAL_EXCESO = 1.0;         // pp/año de desviación inexplicada que se considera "hace otra cosa"

async function serie(sym) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) return null;
  const res = (await r.json())?.chart?.result?.[0];
  const t = res?.timestamp ?? [];
  const c = res?.indicators?.adjclose?.[0]?.adjclose ?? res?.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  for (let i = 0; i < t.length; i++) if (c[i] != null) out.push({ date: new Date(t[i] * 1000).toISOString().slice(0, 10), p: c[i] });
  return out.length ? out : null;
}

console.log(`\n  ¿SE COMPORTA COMO METAL ASIGNADO?  ·  referencia ${REF}\n`);
const S = {};
for (const k of Object.keys(FONDOS)) { S[k] = await serie(k); await new Promise((r) => setTimeout(r, 150)); }

const ref = S[REF];
if (!ref) { console.error("  ⛔ sin serie de referencia"); process.exit(1); }

const filas = [];
for (const [t, meta] of Object.entries(FONDOS)) {
  const s = S[t];
  if (!s) { filas.push({ ticker: t, ...meta, estado: "sin serie" }); continue; }
  // Solapamiento exacto de fechas: comparar tramos distintos es comparar épocas del oro.
  const m = new Map(ref.map((o) => [o.date, o.p]));
  const par = s.filter((o) => m.has(o.date));
  // 250 dias = un año de cotizacion. Basta para ver el arrastre de renovar futuros, que es de
  // 1-3 pp/año. El minimo en 400 dejaba fuera al control positivo, y sin control el test no
  // publica — que es exactamente lo que paso en la primera pasada, y funciono como debia.
  if (par.length < 250) { filas.push({ ticker: t, ...meta, estado: `solape corto (${par.length} dias)` }); continue; }

  const p0 = par[0].p, p1 = par[par.length - 1].p;
  const r0 = m.get(par[0].date), r1 = m.get(par[par.length - 1].date);
  const anos = (new Date(par[par.length - 1].date) - new Date(par[0].date)) / (365.25 * 86400000);
  const anual = (x1, x0) => (Math.pow(x1 / x0, 1 / anos) - 1) * 100;
  const rf = anual(p1, p0), rr = anual(r1, r0);
  const dif = rf - rr;                                    // lo que se observa
  const esperado = FONDOS[REF].comision - meta.comision;  // lo que explicaría la comisión
  const exceso = dif - esperado;                          // lo que NO explica la comisión

  // Correlación diaria: un vehículo de metal asignado se mueve casi exactamente igual.
  const rets = (a) => a.slice(1).map((o, i) => o.p / a[i].p - 1);
  const A = rets(par), B = rets(par.map((o) => ({ p: m.get(o.date) })));
  const n = A.length;
  const ma = A.reduce((x, y) => x + y, 0) / n, mb = B.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = A[i] - ma, db = B[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  const rho = sab / Math.sqrt(saa * sbb);

  const comoMetal = Math.abs(exceso) <= UMBRAL_EXCESO && rho > 0.97;
  filas.push({ ticker: t, ...meta, estado: "ok", dias: par.length, anos: +anos.toFixed(2),
    retornoAnual: +rf.toFixed(2), retornoRef: +rr.toFixed(2), diferencia: +dif.toFixed(2),
    esperadoPorComision: +esperado.toFixed(2), excesoInexplicado: +exceso.toFixed(2),
    correlacionDiaria: +rho.toFixed(4), comoMetal });
}

console.log(`  fondo  comision  ret/ano   dif vs ${REF}   explicado   INEXPLICADO   rho diaria   veredicto`);
for (const f of filas) {
  if (f.estado !== "ok") { console.log(`  ${f.ticker.padEnd(6)} ${f.estado}`); continue; }
  const sig = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
  console.log(`  ${f.ticker.padEnd(6)} ${(f.comision + " %").padStart(7)}  ${(f.retornoAnual + " %").padStart(8)}  ${sig(f.diferencia).padStart(7)}`
    + `${sig(f.esperadoPorComision).padStart(12)}${sig(f.excesoInexplicado).padStart(14)}`
    + `${f.correlacionDiaria.toFixed(3).padStart(12)}   ${f.comoMetal ? "como metal" : "HACE OTRA COSA"}`);
}

// ── LOS CONTROLES MANDAN. Si un vehiculo declarado de futuros o una nota sin garantia pasa
// como metal, el test no distingue nada y no se publica ningun veredicto.
const controles = filas.filter((f) => f.control === "positivo");
console.log(`\n  CONTROLES POSITIVOS (tienen que salir marcados):`);
let fallan = 0;
for (const c of controles) {
  if (c.estado !== "ok") { console.log(`    ${c.ticker.padEnd(6)} ${c.estado} - no evaluable`); fallan++; continue; }
  const cazado = c.comoMetal === false;
  if (!cazado) fallan++;
  console.log(`    ${c.ticker.padEnd(6)} ${cazado ? "OK cazado " : "FALLO     "}  ${c.declara}`);
}
const testValido = fallan === 0 && controles.length >= 3;
if (!testValido) { console.error(`\n  ⛔ ${fallan} control(es) no pasan: NO se publica ningun veredicto.\n`); process.exitCode = 1; }
else console.log(`\n  Los ${controles.length} controles se cazan: el test distingue, y los veredictos de arriba valen.`);

console.log(`\n  ⚠️ ESTO MIDE COMPORTAMIENTO, NO EXISTENCIA. Un fondo puede comportarse como metal`);
console.log(`     asignado sin tenerlo. Lo que el test descarta es lo contrario: el que NO se`);
console.log(`     comporta como metal, no lo tiene. Y ninguno de los siete presenta N-PORT:`);
console.log(`     son fideicomisos de materias primas (10-K), no fondos de la Ley de 1940.`);

writeFileSync(join(AQUI, "out", "oro_respaldo.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), referencia: REF, umbralExceso: UMBRAL_EXCESO,
  controlesPasan: testValido, fondos: filas,
  limitacion: "Mide comportamiento consistente con metal asignado, no su existencia. Ningun ETF de oro presenta N-PORT: son fideicomisos de materias primas que presentan 10-K.",
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/oro_respaldo.json\n`);
