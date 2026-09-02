// ─────────────────────────────────────────────────────────────────────────────
// GANADORES Y PERDEDORES DEL ÍNDICE
//
// Fase 2 del roadmap de capacidades. Produce el artefacto que consume la página: ganadores y
// perdedores en cuatro ventanas —1 día, 1 semana, 1 mes, YTD— sobre el universo point-in-time.
//
// Dos capas por debajo, y el orden importa:
//
//   · `lib/integridadPrecios.ts` decide si una serie se puede enseñar. **Va primero.** Sin ella
//     este fichero publicaría «Monster Beverage −52,97 %», que es falso y saldría con el logo de
//     la empresa al lado.
//   · `lib/ventanas.ts` decide qué tramo mide cada ventana. Por CALENDARIO, no por número de
//     sesiones — no porque proteja de nada (no protege: se comprobó que parte el mismo artefacto)
//     sino porque el borde es reproducible y se puede publicar.
//
// LO QUE NO SE HACE AQUÍ, a propósito: la narrativa del pie. Se genera sobre las filas YA
// calculadas, nunca al revés, y en otro sitio. Un texto que decida qué filas enseñar sería una
// selección disfrazada de resumen.
//
//   node --max-old-space-size=8192 --experimental-strip-types --no-warnings research/movimientos.mjs [--top 10]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { serieCompleta, returnsSeries } from "./prices.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { revisarSerie, veredicto, cierresDesalineados } from "../lib/integridadPrecios.ts";
import { VENTANAS, tramoDe, retornoEnTramo } from "../lib/ventanas.ts";
import { hechosDeCabecera, hechoDeAmplitud, redactar } from "../lib/narrativa.ts";
import { tickerToCik, sicSector } from "./edgar.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const TOP = Number(arg("--top", "10"));

const tabla = await loadSP500Historical();
const asOf = snapshotDate(tabla);
const universo = membersAsOf(tabla, asOf);

console.log(`\n  GANADORES Y PERDEDORES · ${universo.length} miembros · foto ${asOf}\n`);

// ── 1 · Series, integridad y última sesión ───────────────────────────────────────────────
const filas = [];
const ultimas = [];
let sinSerie = 0, n = 0;

for (const t of universo) {
  process.stdout.write(`  ${++n}/${universo.length}\r`);
  let barras = null, rets = null;
  try {
    barras = await serieCompleta(t);
    rets = await returnsSeries(t);
  } catch { /* se cuenta abajo */ }
  if (!barras?.length || !rets?.length) { sinSerie++; continue; }

  ultimas.push({ ticker: t, fecha: barras.at(-1).date });
  filas.push({ t, barras, rets, fechas: barras.map((b) => b.date) });
}
process.stdout.write("                    \r");

// ⚠️ La fecha de cierre común NO es un detalle. Un ranking que compara «el último día» de nombres
// que cierran en días distintos no compara nada, y el desalineado no se ve en la tabla.
const { referencia, fuera } = cierresDesalineados(ultimas);
if (!referencia) { console.error("  ✖ sin ninguna serie utilizable"); process.exit(1); }
console.log(`  con serie: ${filas.length}   ·   sin serie: ${sinSerie}   ·   cierre de referencia: ${referencia}`);
if (fuera.length) {
  console.log(`  ⚠ ${fuera.length} series no cierran ahí y quedan FUERA del ranking: ${fuera.slice(0, 10).map((f) => `${f.ticker}(${f.fecha})`).join(" ")}`);
}
const alineadas = filas.filter((f) => f.barras.at(-1).date === referencia);

// ── Sectores, para los hechos del pie ────────────────────────────────────────────────────
// ⚠️ El SIC no resuelve a todos —en 3820-3829 conviven Thermo Fisher, KLA y Rockwell— y los que
// falten NO se agrupan en un cajón: `lib/narrativa.ts` los cuenta y, si son muchos, se calla en
// vez de afirmar una concentración sobre media cabecera.
const sectorDe = new Map();
{
  let k = 0;
  for (const f of alineadas) {
    process.stdout.write(`  sectores ${++k}/${alineadas.length}\r`);
    try {
      const cik = await tickerToCik(f.t);
      const s = cik ? await sicSector(cik) : null;
      if (s) sectorDe.set(f.t, s);
    } catch { /* sin sector: se cuenta solo, al no estar en el mapa */ }
  }
  process.stdout.write("                    \r");
  console.log(`  con sector: ${sectorDe.size}/${alineadas.length}`);
}

// ── 2 · Cada ventana ─────────────────────────────────────────────────────────────────────
const resultado = { generatedAt: new Date().toISOString(), universoAsOf: asOf, cierre: referencia, top: TOP, ventanas: {} };

for (const v of VENTANAS) {
  const medidas = [];
  let tramoComun = null;

  for (const f of alineadas) {
    const tramo = tramoDe(f.fechas, v.id, referencia);
    if (!tramo) continue;
    // Se guarda el tramo de la primera para publicarlo: todas comparten calendario, pero si
    // alguna difiere hay que verlo.
    if (!tramoComun) tramoComun = tramo;
    const r = retornoEnTramo(f.rets, tramo.base, tramo.hasta);
    if (!r) continue;

    // La integridad se evalúa SOBRE LA VENTANA QUE SE PUBLICA, no sobre la serie entera: un
    // artefacto de 2019 no debe impedir enseñar el ranking de esta semana.
    const av = veredicto(revisarSerie(f.barras), tramo.base);

    medidas.push({
      ticker: f.t,
      pct: Number(r.pct.toFixed(2)),
      sesiones: r.sesiones,
      huecos: r.huecos,
      base: tramo.base,
      hasta: tramo.hasta,
      publicable: av.publicable,
      aviso: av.motivo,
    });
  }

  medidas.sort((a, b) => b.pct - a.pct);
  // Los NO publicables salen de la tabla y se listan aparte. No se esconden: se dicen.
  const limpias = medidas.filter((m) => m.publicable);
  const retiradas = medidas.filter((m) => !m.publicable);

  resultado.ventanas[v.id] = {
    nombre: v.nombre,
    tramo: tramoComun,
    medidos: medidas.length,
    ganadores: limpias.slice(0, TOP),
    perdedores: limpias.slice(-TOP).reverse(),
    retiradosPorIntegridad: retiradas.map((m) => ({ ticker: m.ticker, pct: m.pct, motivo: m.aviso })),
  };

  // ── Los hechos del pie ────────────────────────────────────────────────────────────────
  // Se calculan DESPUÉS del ranking y sobre las filas ya publicadas. El resumen no elige qué
  // enseñar: describe lo que ya se enseña. Al revés sería una selección disfrazada de resumen.
  const conSector = (fs) => fs.map((x) => ({ ticker: x.ticker, pct: x.pct, sector: sectorDe.get(x.ticker) ?? null }));
  const hechos = [
    hechoDeAmplitud(conSector(limpias)),
    ...hechosDeCabecera(conSector(resultado.ventanas[v.id].ganadores), "suben"),
    ...hechosDeCabecera(conSector(resultado.ventanas[v.id].perdedores), "bajan"),
  ].filter(Boolean);
  resultado.ventanas[v.id].hechos = hechos;
  resultado.ventanas[v.id].resumen = redactar(hechos);

  const g = resultado.ventanas[v.id].ganadores, p = resultado.ventanas[v.id].perdedores;
  console.log(`\n  ── ${v.nombre}  (desde el cierre del ${tramoComun?.base} hasta ${tramoComun?.hasta}, ${medidas.length} nombres) ──`);
  console.log(`     ganan:   ${g.slice(0, 5).map((x) => `${x.ticker} ${x.pct >= 0 ? "+" : ""}${x.pct}%${x.aviso ? " ⚠" : ""}`).join("  ")}`);
  console.log(`     pierden: ${p.slice(0, 5).map((x) => `${x.ticker} ${x.pct}%${x.aviso ? " ⚠" : ""}`).join("  ")}`);
  // El campo es `aviso`, no `motivo`: la primera versión imprimía «MNST (undefined)» — el dato
  // estaba bien en el artefacto y sólo mentía la consola, que es como se cuelan estas cosas.
  if (retiradas.length) console.log(`     retirados por integridad: ${retiradas.map((m) => `${m.ticker} (${m.aviso})`).join(" · ")}`);
  if (resultado.ventanas[v.id].resumen) console.log(`     · ${resultado.ventanas[v.id].resumen}`);
}

writeFileSync(join(OUT, "movimientos.json"), JSON.stringify(resultado, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/movimientos.json\n`);

// ── 3 · Las invariantes, comprobadas antes de dar esto por bueno ─────────────────────────
let mal = 0;
for (const [id, v] of Object.entries(resultado.ventanas)) {
  const todas = [...v.ganadores, ...v.perdedores];
  if (todas.some((x) => x.hasta !== referencia)) { console.error(`  ✖ ${id}: alguna fila no acaba en el cierre de referencia`); mal++; }
  if (todas.some((x) => !x.publicable)) { console.error(`  ✖ ${id}: una fila no publicable llegó a la tabla`); mal++; }
  if (v.ganadores.length && v.perdedores.length && v.ganadores[0].pct < v.perdedores[0].pct) { console.error(`  ✖ ${id}: el orden está invertido`); mal++; }
}
if (mal) process.exit(1);
console.log(`  ✅ las ${Object.keys(resultado.ventanas).length} ventanas cierran en ${referencia}, sin filas no publicables y bien ordenadas.\n`);
