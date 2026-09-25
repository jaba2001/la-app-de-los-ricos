// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA DE TIPOS — fase 2 del plan de las tres capas
//
// Aplica `lib/tipos.ts` a las series reales de FRED y produce el artefacto: la curva, su
// forma, el reparto nominal/real y el diferencial de crédito con su percentil histórico.
//
// ⚠️ Y HACE LO QUE NADIE HACÍA: comprueba la COBERTURA de cada serie antes de usarla. Este
// repo ya se comió una serie muerta que contestaba (FMP devolviendo 402 en ETFs con el cron
// en verde) y una truncada que parecía completa (BAMLH0A0HYM2, 786 obs desde 2023 usadas
// como si fueran 41 años). Una serie que responde no es una serie que sirve.
//
//   node --experimental-strip-types --no-warnings research/tipos.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { forma, descomponer, credito, liston, percentil, avisoConTasaBase, BASE_AVISO, UMBRALES_TIPOS } from "../lib/tipos.ts";

// La clave sale SOLO del entorno. Estaba embebida como respaldo, lo que la dejaba en el
// codigo y en el historial de git de un repo compartido. Es gratuita y de bajo impacto,
// pero un respaldo silencioso tambien significa que el script parece funcionar cuando el
// entorno esta mal puesto — y entonces se descubre en produccion, no aqui.
const FRED = process.env.FRED_KEY;
if (!FRED) throw new Error("Falta FRED_KEY. Consiguela gratis en https://fred.stlouisfed.org/docs/api/api_key.html y exportala antes de ejecutar.");
const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = join(AQUI, ".cache", "fredfull");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const HASTA = process.env.TIPOS_ASOF || new Date().toISOString().slice(0, 10);

// Lo que CADA serie tiene que traer para poder usarse. El inicio esperado no es decoración:
// es el contrato. Si FRED deja de servir la historia —como ya hizo con las de ICE BofA— esto
// falla en vez de calcular un percentil sobre tres años y llamarlo cuarenta.
const SERIES = {
  DGS3MO: { que: "Tesoro 3 meses", desde: "1982-01-04", min: 9000 },
  DGS2:   { que: "Tesoro 2 años", desde: "1976-06-01", min: 11000 },
  DGS10:  { que: "Tesoro 10 años", desde: "1962-01-02", min: 15000 },
  DGS30:  { que: "Tesoro 30 años", desde: "1977-02-15", min: 11000 },
  DFII10: { que: "Tesoro 10 años REAL (TIPS)", desde: "2003-01-02", min: 5000 },
  T5YIFR: { que: "Inflación esperada 5a dentro de 5a", desde: "2003-01-02", min: 5000 },
  BAA10Y: { que: "Diferencial de crédito Baa − Tesoro 10a", desde: "1986-01-02", min: 9000 },
  // ⚠️ Esta NO la usa este panel: la vigila. STLFSI4 es lo ÚNICO que sostiene el estrés de
  // crédito del régimen histórico desde que las cuatro series de ICE BofA se quedaron sin
  // historia (785 obs desde 2023-07 las cuatro). Si esta se trunca igual, el CSC de veinte
  // años de backtest se queda sin ninguna serie con historia — y no fallaría nada: seguiría
  // devolviendo un número. Que reviente aquí es justamente el punto.
  STLFSI4: { que: "Índice de estrés financiero (sostiene el CSC histórico)", desde: "1993-12-31", min: 1500 },
};

async function serie(id) {
  const p = join(DIR, id + ".json");
  if (existsSync(p)) { try { const o = JSON.parse(readFileSync(p, "utf8")); if (o.length) return o; } catch { /* recarga */ } }
  const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED}&file_type=json`);
  if (!r.ok) return [];
  const j = await r.json();
  const obs = (j?.observations ?? []).filter((o) => o.value !== "." && o.value !== "").map((o) => ({ date: o.date, v: parseFloat(o.value) }));
  if (obs.length) writeFileSync(p, JSON.stringify(obs));
  return obs;
}

console.log(`\n  LA CAPA DE TIPOS · datos a ${HASTA}\n`);

const S = {}, fallos = [];
for (const [id, c] of Object.entries(SERIES)) {
  const o = await serie(id);
  S[id] = o;
  const d0 = o[0]?.date ?? null;
  // Se tolera que EMPIECE antes de lo esperado (FRED a veces extiende hacia atrás); lo que
  // no se tolera es que empiece DESPUÉS, que es la forma que tuvo el truncamiento real.
  const tarde = d0 == null || d0 > c.desde;
  const corta = o.length < c.min;
  const estado = tarde || corta ? "⛔" : "ok";
  if (tarde || corta) fallos.push(`${id}: ${o.length} obs desde ${d0 ?? "—"} (contrato: ≥${c.min} desde ${c.desde})`);
  console.log(`  ${estado} ${id.padEnd(8)} ${String(o.length).padStart(6)} obs · ${(d0 ?? "—").padEnd(12)} ${c.que}`);
}

if (fallos.length) {
  console.error(`\n  ⛔ ${fallos.length} serie(s) NO cumplen su contrato de cobertura:`);
  fallos.forEach((f) => console.error(`     · ${f}`));
  console.error(`\n  No se publica un percentil sobre una serie truncada. Eso ya pasó con BAMLH0A0HYM2.\n`);
  process.exit(1);
}

const ult = (id) => { const h = S[id].filter((o) => o.date <= HASTA); return h.length ? h[h.length - 1].v : null; };
const curva = { m3: ult("DGS3MO"), a2: ult("DGS2"), a10: ult("DGS10"), a30: ult("DGS30") };
const fm = forma(curva);
const desc = descomponer(curva.a10, ult("DFII10"), ult("T5YIFR"));
const cr = credito(S.BAA10Y, HASTA);

console.log(`\n  LA CURVA`);
for (const [k, v] of Object.entries(curva)) console.log(`    ${k.padEnd(5)} ${v == null ? "  —" : v.toFixed(2).padStart(6)} %`);
console.log(`    forma: ${fm?.forma ?? "—"}   10a-2a ${fm?.t10y2?.toFixed(2) ?? "—"}   10a-3m ${fm?.t10y3m?.toFixed(2) ?? "—"}`);

if (desc) {
  console.log(`\n  NOMINAL = REAL + INFLACIÓN ESPERADA`);
  console.log(`    nominal 10a      ${desc.nominal.toFixed(2)} %`);
  console.log(`    real 10a (TIPS)  ${desc.real.toFixed(2)} %`);
  console.log(`    breakeven        ${desc.breakeven.toFixed(2)} %   (implícito en los dos anteriores)`);
  console.log(`    5a dentro de 5a  ${desc.expectativa5a5 == null ? "—" : desc.expectativa5a5.toFixed(2) + " %"}   (otro horizonte: NO se promedia con el anterior)`);
}

if (cr) {
  console.log(`\n  EL DIFERENCIAL DE CRÉDITO (BAA10Y)`);
  console.log(`    valor            ${cr.valor.toFixed(2)} pp  a ${cr.fecha}`);
  console.log(`    percentil        ${cr.percentil == null ? "— (" + cr.motivoPercentil + ")" : cr.percentil.toFixed(0) + " %  de " + S.BAA10Y.length + " obs desde " + S.BAA10Y[0].date}`);
  console.log(`    hace 90 días     ${cr.hace90d == null ? "—" : cr.hace90d.toFixed(2)} pp   delta ${cr.delta == null ? "—" : (cr.delta > 0 ? "+" : "") + cr.delta.toFixed(2)}`);
  console.log(`    ensanchándose    ${cr.ensanchando ? "SÍ" : "no"}   (corte declarado: ${UMBRALES_TIPOS.ensancheMinimo} pp en ${UMBRALES_TIPOS.ventanaEnsanche} días)`);
  // ⚠️ El booleano NUNCA sale solo: medido sobre 22 episodios, p = 0,146. Es contexto.
  console.log(`
    ${avisoConTasaBase(cr.ensanchando)}`);
}

const frase = liston(curva.a10, ult("DFII10"));
if (frase) console.log(`\n  ${frase}`);

// El percentil de la propia pendiente: contexto para no leer "invertida" como algo inaudito.
const pend = S.DGS10.filter((o) => o.date <= HASTA).map((o) => o.v);
const p2 = S.DGS2.length ? percentil(curva.a10, pend) : { pct: null };

writeFileSync(join(AQUI, "out", "tipos.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), asOf: HASTA, umbrales: UMBRALES_TIPOS,
  cobertura: Object.fromEntries(Object.entries(SERIES).map(([id, c]) => [id, { obs: S[id].length, desde: S[id][0]?.date ?? null, ...c }])),
  curva, forma: fm, descomposicion: desc, credito: cr,
  avisoTexto: cr ? avisoConTasaBase(cr.ensanchando) : null, tasaBaseAviso: BASE_AVISO,
  percentilNominal10a: p2.pct == null ? null : +p2.pct.toFixed(1), liston: frase,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/tipos.json\n`);
