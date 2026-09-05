// ─────────────────────────────────────────────────────────────────────────────
// ¿QUÉ PARTE DEL UNIVERSO NO SE PUEDE PUBLICAR TAL CUAL?
//
// Pasa `lib/integridadPrecios.ts` por los miembros actuales del índice y dice cuántos tienen la
// serie rota en la ventana que se va a enseñar. Es la comprobación previa a cualquier tabla
// pública — ganadores, perdedores, cualquier ranking de precios.
//
//   node --experimental-strip-types --no-warnings research/integridad_universo.mjs [--desde AAAA-MM-DD]
//
// El criterio de aceptación se escribió ANTES de correrlo (ROADMAP_CAPACIDADES_SCORA.md, fase 1):
//   · marca MNST y MRNA en la ventana 2026-08-03 → 2026-08-31
//   · NO marca EIX, que cayó −23,1 % de verdad
//   · los marcados son menos del 3 % de los miembros
//
// Sale con código 1 si se incumple el tercero: si marca de más, el umbral está mal y un guardián
// que marca de más se aprende a ignorar.
// ─────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { serieCompleta } from "./prices.mjs";
import { loadSP500Historical, membersAsOf, snapshotDate } from "./universe.mjs";
import { revisarSerie, veredicto, cierresDesalineados } from "../lib/integridadPrecios.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DESDE = arg("--desde", "2026-08-03");
const TOLERANCIA = 0.03;

const tabla = await loadSP500Historical();
const asOf = snapshotDate(tabla);
const universo = membersAsOf(tabla, asOf);

console.log(`\n  INTEGRIDAD DE PRECIOS · ${universo.length} miembros · foto ${asOf} · ventana desde ${DESDE}\n`);

const marcados = [];
const ultimas = [];
let sinSerie = 0, n = 0;

for (const t of universo) {
  process.stdout.write(`  ${++n}/${universo.length}\r`);
  let s = null;
  try { s = await serieCompleta(t); } catch { /* se cuenta abajo */ }
  if (!s?.length) { sinSerie++; continue; }
  ultimas.push({ ticker: t, fecha: s.at(-1).date });

  const avisos = revisarSerie(s);
  const v = veredicto(avisos, DESDE);
  if (v.enVentana.length) {
    marcados.push({ ticker: t, publicable: v.publicable, motivo: v.motivo, avisos: v.enVentana });
  }
}
process.stdout.write("                    \r");

const conSerie = universo.length - sinSerie;
const bloqueados = marcados.filter((m) => !m.publicable);
const conAviso = marcados.filter((m) => m.publicable);

console.log(`  con serie: ${conSerie}   ·   sin serie: ${sinSerie}`);
console.log(`  NO publicables (gravedad alta): ${bloqueados.length}   (${(100 * bloqueados.length / conSerie).toFixed(1)} %)`);
console.log(`  publicables CON aviso:          ${conAviso.length}   (${(100 * conAviso.length / conSerie).toFixed(1)} %)`);

if (bloqueados.length) {
  console.log(`\n  ── NO se publican sin marcar ──`);
  for (const m of bloqueados) console.log(`    ${m.ticker.padEnd(6)} ${m.motivo}`);
}
if (conAviso.length) {
  console.log(`\n  ── se publican, con su aviso ──`);
  for (const m of conAviso.slice(0, 15)) console.log(`    ${m.ticker.padEnd(6)} ${m.motivo}`);
  if (conAviso.length > 15) console.log(`    … y ${conAviso.length - 15} más`);
}

// ── Cierres desalineados ─────────────────────────────────────────────────────────────────
const { referencia, fuera } = cierresDesalineados(ultimas);
console.log(`\n  última sesión de referencia: ${referencia}`);
if (fuera.length) {
  console.log(`  ⚠ ${fuera.length} series NO acaban ahí y no pueden competir en el mismo ranking:`);
  for (const f of fuera.slice(0, 12)) console.log(`    ${f.ticker.padEnd(6)} ${f.fecha}`);
  if (fuera.length > 12) console.log(`    … y ${fuera.length - 12} más`);
}

writeFileSync(join(OUT, "integridad_precios.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  universoAsOf: asOf, desde: DESDE,
  miembros: universo.length, conSerie, sinSerie,
  noPublicables: bloqueados.map((m) => ({ ticker: m.ticker, motivo: m.motivo })),
  conAviso: conAviso.map((m) => ({ ticker: m.ticker, motivo: m.motivo })),
  cierreReferencia: referencia,
  cierresDesalineados: fuera,
}, null, 2) + "\n", "utf8");
console.log(`\n  → research/out/integridad_precios.json`);

// ── El criterio, comprobado ──────────────────────────────────────────────────────────────
const tasa = marcados.length / conSerie;
if (tasa > TOLERANCIA) {
  console.error(`\n  ⛔ marcados el ${(100 * tasa).toFixed(1)} % (tolerancia ${(100 * TOLERANCIA).toFixed(0)} %).`);
  console.error(`     Un guardián que marca de más se aprende a ignorar. Revisa los umbrales antes de seguir.\n`);
  process.exit(1);
}
console.log(`  ✅ marcados el ${(100 * tasa).toFixed(1)} % del universo (tolerancia ${(100 * TOLERANCIA).toFixed(0)} %)\n`);
