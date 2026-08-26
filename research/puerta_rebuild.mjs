// ─────────────────────────────────────────────────────────────────────────────
// LA PUERTA DEL REBUILD (§10.7 de PLAN_SCORA_FORENSE.md)
//
// El `--rebuild` del backtest NO puede correr mientras quede un ticker PUBLICADO sin veredicto
// firme en la auditoría de símbolos reutilizados. Rebuildear antes no da un resultado peor: da
// uno contaminado justo en los nombres que el rebuild existe para añadir, y contaminado en
// silencio, porque una serie heredada por otro instrumento no tiene huecos ni errores.
//
// ⚠️ POR QUÉ ESTO ES UN GUION Y NO UNA COMPROBACIÓN A MANO.
//
// Comprobar la puerta y luego rebuildear son dos actos separados por horas, y en medio el
// conjunto publicado PUEDE CRECER: `publicar_resolucion.mjs` publica lo que haya en
// `data/cik_revisados.json`, y ese fichero lo escribe `revisar_cik.mjs --proponer`, que el
// 2026-08-25 estaba programado para correr en otra sesión al cabo de unas horas. Una foto
// tomada antes de que exista el riesgo no cubre el riesgo. Así que la puerta se evalúa en el
// MISMO comando que abre el rebuild:
//
//   node research/puerta_rebuild.mjs && node research/picks_rules_backtest.mjs --rebuild
//
// Si la puerta está cerrada, sale con código 1 y el rebuild no llega a arrancar.
//
// ⚠️ Y SE COMPRUEBA POR PERTENENCIA, NO POR AUSENCIA. La versión que llevaba yo a mano miraba
// «¿está este publicado en la lista de `noComprobados`?», y eso absuelve por accidente a un
// ticker que la auditoría no haya mirado NUNCA: no está en `noComprobados` porque no está en
// ninguna parte. Aquí se exige lo contrario — que cada publicado APAREZCA con veredicto firme
// en la evidencia—, que es lo mismo pero fallando en cerrado.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from "fs";
import { loadSP500Historical } from "./universe.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (...p) => { const r = join(AQUI, ...p); return existsSync(r) ? JSON.parse(readFileSync(r, "utf8")) : null; };

const hist = leer("data", "cik_historicos.json");
const bloq = leer("data", "simbolos_reutilizados.json");
const evid = leer("out", "simbolos_reutilizados.json");

const morir = (m) => { console.error(`\n  ⛔ PUERTA CERRADA — ${m}\n`); process.exit(1); };

if (!hist?.mapa) morir("falta research/data/cik_historicos.json: no se sabe qué tickers están publicados.");
if (!bloq) morir("falta research/data/simbolos_reutilizados.json: no hay lista de bloqueo, así que los símbolos heredados entrarían con precios ajenos.");
if (!evid?.detalle) morir("falta research/out/simbolos_reutilizados.json: sin evidencia no se puede saber a quién se ha mirado.");

// El sello tiene que coincidir: una evidencia de otra versión de reglas no acredita nada.
if ((evid.versionReglas ?? 0) !== (bloq.versionReglas ?? -1)) {
  morir(`la evidencia va por las reglas v${evid.versionReglas ?? "sin sello"} y el mapa por la v${bloq.versionReglas} — no se puede acreditar cobertura con evidencia de otra versión.`);
}

// ⚠️ LOS MIEMBROS ACTUALES ESTÁN EXENTOS, Y HAY QUE DECIRLO EN VOZ ALTA.
//
// La auditoría sólo mira los tickers que SALIERON del índice, por una razón que es suya y es
// correcta: «un miembro actual tiene, por definición, una serie que llega a hoy y no puede
// estar suplantado». Así que exigirle veredicto a un miembro vivo es exigir algo que nunca va
// a existir, y la puerta no abriría jamás.
//
// Pero la exención se calcula, no se asume: se sacan de la MISMA tabla de miembros que usa la
// auditoría, y se imprimen con nombre y apellidos. Dejarlos pasar «porque no aparecen en la
// evidencia» sería volver a absolver por ausencia, que es justo lo que este guion evita.
//
// Que haya vivos en un fichero llamado «cik_historicos» no es un error: ese mapa es el relleno
// para lo que el mapa vivo de la SEC NO cubre, y no lo cubre todo. `BF.B` está ahí porque la
// SEC lo escribe `BF-B` —punto contra guion— y `VMRK` porque entró en el índice el 2026-08-24
// y el mapa de la SEC aún no lo lista.
const tabla = await loadSP500Historical();
if (!tabla?.length) morir("no se puede cargar la tabla de miembros: sin ella no se sabe quién está exento por seguir en el índice.");
const vivos = new Set(tabla[tabla.length - 1].tickers);

// «truncar» es firme: la auditoria MIRO la serie y decidio que lo real acaba en tal fecha.
// Es una respuesta, no una duda — y la mas util de las cuatro, porque conserva los anos buenos.
const FIRME = new Set(["ok", "reutilizado", "sin datos", "truncar"]);
const veredicto = new Map(evid.detalle.map((f) => [f.ticker, f.veredicto]));
const publicados = Object.keys(hist.mapa);
const exentos = publicados.filter((t) => vivos.has(t));
const sinFirme = publicados.filter((t) => !vivos.has(t) && !FIRME.has(veredicto.get(t)));

console.log(`\n  PUERTA DEL REBUILD · reglas v${bloq.versionReglas}`);
console.log(`  publicados: ${publicados.length}   ·   exentos por seguir en el índice: ${exentos.length} (${exentos.join(" ") || "ninguno"})`);
console.log(`  auditables: ${publicados.length - exentos.length}   ·   con veredicto firme: ${publicados.length - exentos.length - sinFirme.length}   ·   bloqueados en total: ${Object.keys(bloq.bloqueados ?? {}).length}`);

if (sinFirme.length) {
  const porQue = {};
  for (const t of sinFirme) (porQue[veredicto.get(t) ?? "nunca auditado"] ??= []).push(t);
  console.error(`\n  ⛔ PUERTA CERRADA — ${sinFirme.length} tickers publicados sin veredicto firme:`);
  for (const [v, ts] of Object.entries(porQue)) console.error(`     ${v} (${ts.length}): ${ts.join(" ")}`);
  console.error(`\n  Sigue corriendo research/simbolos_reutilizados.mjs hasta que no quede ninguno.\n`);
  process.exit(1);
}

console.log(`\n  ✅ PUERTA ABIERTA — los ${publicados.length} publicados tienen veredicto firme. El rebuild puede correr.\n`);
