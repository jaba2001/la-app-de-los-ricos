// ─────────────────────────────────────────────────────────────────────────────
// LABORATORIO DE ARTICULACIÓN CONTABLE (Fase F1)
//
// Aplica las cuatro identidades de `lib/articulacion.ts` al universo real y publica el
// resultado en `research/out/articulacion_lab.json`.
//
// QUÉ RESPONDE, y es lo único que pretende: ¿cuántos nombres tienen unas cifras que ATAN
// entre sí? No dice nada sobre rentabilidad. Un nombre que no articula no es una mala
// empresa; es una empresa cuyos ratios no nos podemos creer.
//
// El entregable NO es el porcentaje: es la lista de excepciones CON SU MOTIVO. Un contador
// de fallos sin explicación es ruido, y ya produjo una vez 27 falsas alarmas por comparar el
// patrimonio sin sumar los minoritarios.
//
//   node --experimental-strip-types --no-warnings research/articulacion_lab.mjs [--asof 2026-08-01] [--max N]
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadSP500Historical, membersAsOf } from "./universe.mjs";
import { tickerToCik, fundamentalsAsOf, fundamentalsPrevYear, sicSector } from "./edgar.mjs";
import { articularFundamentales, TOLERANCIA } from "../lib/articulacion.ts";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ASOF = arg("--asof", new Date().toISOString().slice(0, 10));
const MAX = Number(arg("--max", "0")) || Infinity;

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const table = await loadSP500Historical();
if (!table) { console.error("sin tabla de miembros — no se mide sobre un universo inventado"); process.exit(1); }
const miembros = [...new Set(membersAsOf(table, ASOF) || [])].slice(0, MAX);
console.log(`\n  Articulación contable · ${ASOF} · ${miembros.length} miembros del índice\n`);

const IDS = ["balance", "caja", "patrimonio", "margen"];
const total = { comprobables: {}, pasan: {} };
for (const id of IDS) { total.comprobables[id] = 0; total.pasan[id] = 0; }
const porSector = {};
const excepciones = [];
const confianzas = { alta: 0, media: 0, baja: 0 };
let sinCik = 0, sinFundamentales = 0, n = 0;

for (const t of miembros) {
  let cik = null;
  try { cik = await tickerToCik(t); } catch { /* red */ }
  if (!cik) { sinCik++; continue; }
  let f = null, fPrev = null;
  try { f = await fundamentalsAsOf(cik, ASOF); fPrev = await fundamentalsPrevYear(cik, ASOF); } catch { /* saltar */ }
  if (!f) { sinFundamentales++; continue; }
  n++;

  const r = articularFundamentales(f, fPrev);
  confianzas[r.confianza]++;
  const sector = (await sicSector(cik)) || "sin sector";
  if (!porSector[sector]) porSector[sector] = { n: 0, baja: 0, fallos: {} };
  porSector[sector].n++;
  if (r.confianza === "baja") porSector[sector].baja++;

  for (const c of r.comprobaciones) {
    if (c.ok === null) continue;
    total.comprobables[c.id]++;
    if (c.ok) total.pasan[c.id]++;
    else {
      porSector[sector].fallos[c.id] = (porSector[sector].fallos[c.id] ?? 0) + 1;
      excepciones.push({
        ticker: t, sector, comprobacion: c.id,
        desvioPct: +(c.desvio * 100).toFixed(1),
        izq: c.izq, der: c.der, motivo: c.motivo,
        moneda: f.currency, periodicidad: f.periodicidad, taxonomia: f.taxonomia,
      });
    }
  }
  if (n % 100 === 0) process.stdout.write(`    ${n} nombres…\n`);
}

// ── Informe ───────────────────────────────────────────────────────────────────────────────
console.log(`\n  ${n} nombres con fundamentales   (${sinCik} sin CIK · ${sinFundamentales} sin datos)\n`);
console.log("  identidad        comprobables      pasan        tolerancia");
for (const id of IDS) {
  const c = total.comprobables[id], p = total.pasan[id];
  const pct = c ? (100 * p / c).toFixed(1) : "—";
  console.log(`  ${id.padEnd(14)} ${String(c).padStart(5)}/${n}      ${String(p).padStart(5)}  ${String(pct).padStart(5)} %      ${(TOLERANCIA[id] * 100).toFixed(0)} %`);
}
console.log(`\n  confianza:  alta ${confianzas.alta}   ·   media ${confianzas.media}   ·   baja ${confianzas.baja}`);

console.log(`\n  Peores desviaciones del BALANCE (la única identidad exacta):`);
const balMal = excepciones.filter((e) => e.comprobacion === "balance").sort((a, b) => b.desvioPct - a.desvioPct);
for (const e of balMal.slice(0, 12)) {
  console.log(`    ${e.ticker.padEnd(6)} ${String(e.sector).slice(0, 20).padEnd(21)} ${String(e.desvioPct).padStart(6)} %   activo ${(e.izq / 1e9).toFixed(1)}B  vs  P+PN+min ${(e.der / 1e9).toFixed(1)}B`);
}
if (!balMal.length) console.log("    ninguna ✓");

console.log(`\n  Fallos por sector (proporción con confianza baja):`);
for (const [s, v] of Object.entries(porSector).sort((a, b) => b[1].n - a[1].n)) {
  const det = Object.entries(v.fallos).map(([k, c]) => `${k}:${c}`).join(" ") || "—";
  console.log(`    ${s.slice(0, 24).padEnd(25)} ${String(v.n).padStart(3)}   baja ${String(v.baja).padStart(3)} (${String(Math.round(100 * v.baja / v.n)).padStart(3)} %)   ${det}`);
}

const artefacto = {
  generatedAt: new Date().toISOString(),
  asOf: ASOF,
  universo: miembros.length,
  medidos: n,
  sinCik, sinFundamentales,
  tolerancias: TOLERANCIA,
  identidades: Object.fromEntries(IDS.map((id) => [id, {
    comprobables: total.comprobables[id],
    pasan: total.pasan[id],
    pctPasan: total.comprobables[id] ? +(100 * total.pasan[id] / total.comprobables[id]).toFixed(1) : null,
  }])),
  confianza: confianzas,
  porSector,
  excepciones: excepciones.sort((a, b) => b.desvioPct - a.desvioPct),
  nota: "Control de calidad del DATO, no una señal. Un nombre que no articula no es una mala empresa: es una empresa cuyos ratios no son fiables.",
};
const ruta = join(OUT, "articulacion_lab.json");
writeFileSync(ruta, JSON.stringify(artefacto, null, 1));
console.log(`\n  → ${ruta}   (${excepciones.length} excepciones registradas con su motivo)\n`);
