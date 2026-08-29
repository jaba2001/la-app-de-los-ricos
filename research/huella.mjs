// ─────────────────────────────────────────────────────────────────────────────
// LA HUELLA DE UN ARTEFACTO — de qué entradas salió, para poder saber si sigue valiendo
//
// ⚠️ ESTO EXISTE POR UN FALLO CONCRETO, y del peor tipo: uno que no rompe nada.
//
// El 2026-08-29 el backtest de la ventana antigua abortó por falta de memoria **después** de
// construir las 192 fechas del panel — o sea, tras la parte cara y justo antes de escribir. El
// panel quedó en disco, el artefacto NO, y por tanto los números publicados siguieron siendo
// los de la corrida anterior. Nada lo dijo. Estuve a punto de dar por buenas cifras de un día
// antes; sólo lo cacé porque el código de salida era 134 y las dos ventanas daban EXACTAMENTE
// el mismo resultado.
//
// Documentar «lánzalo con más memoria» no arregla eso: el fallo consiste precisamente en que
// nadie se entera. Lo que arregla es que el artefacto DIGA de qué salió, y que haya un guardián
// que se niegue a citarlo cuando ya no cuadra.
//
// QUÉ ENTRA EN LA HUELLA, y por qué cada cosa:
//
//   · La versión de reglas de la auditoría de símbolos. Si cambia, el mapa de bloqueo cambia,
//     y con él qué nombres tienen precios.
//   · El contenido de los ficheros de `data/`. Son los que deciden qué empresas existen y
//     cuáles están bloqueadas: si se mueven, el resultado se mueve.
//   · La fecha de la última foto de miembros, que decide el universo.
//
// NO entra el código: un hash del fuente saltaría con cada comentario. Lo que se quiere detectar
// es que las ENTRADAS hayan cambiado sin que el artefacto se rehiciera, no que alguien tocara
// una línea.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATA = join(AQUI, "data");

/** Los ficheros de datos que deciden el resultado. Si se añade uno nuevo, va aquí. */
export const FICHEROS_DE_ENTRADA = [
  "cik_historicos.json",
  "alias_ticker.json",
  "simbolos_reutilizados.json",
];

/**
 * Huella de las entradas en este momento.
 *
 * El hash es del CONTENIDO, no de la fecha del fichero: una reescritura que no cambia nada
 * —volver a correr la auditoría sin que avance— no debe invalidar un artefacto bueno.
 */
export function huellaEntradas(ultimaFotoMiembros = null) {
  const h = createHash("sha256");
  const ficheros = {};
  for (const f of FICHEROS_DE_ENTRADA) {
    const p = join(DATA, f);
    if (!existsSync(p)) { ficheros[f] = null; h.update(f + ":ausente"); continue; }
    const txt = readFileSync(p, "utf8");
    // La marca de tiempo se quita antes de resumir: cambia en cada ejecución aunque el
    // contenido sea idéntico, y si entrara, la huella no distinguiría «cambió» de «se
    // reescribió igual» — que es justo la distinción que hace útil a este guardián.
    const sinFecha = txt.replace(/"generatedAt":\s*"[^"]*",?/g, "");
    const resumen = createHash("sha256").update(sinFecha).digest("hex").slice(0, 12);
    ficheros[f] = resumen;
    h.update(f + ":" + resumen);
  }
  let versionReglas = null;
  try {
    versionReglas = JSON.parse(readFileSync(join(DATA, "simbolos_reutilizados.json"), "utf8"))?.versionReglas ?? null;
  } catch { /* sin fichero, queda null */ }
  if (ultimaFotoMiembros) h.update("miembros:" + ultimaFotoMiembros);
  return {
    sha: h.digest("hex").slice(0, 16),
    ficheros,
    versionReglas,
    ultimaFotoMiembros,
  };
}

/**
 * ¿Sigue valiendo este artefacto?
 *
 * Devuelve `{ vale, motivos }`. Un artefacto SIN huella no se da por bueno: es de antes de que
 * esto existiera, y precisamente lo que no se puede saber de él es si está al día.
 */
export function comprobarHuella(artefacto, ahora) {
  const motivos = [];
  const h = artefacto?.huella;
  if (!h) return { vale: false, motivos: ["el artefacto no lleva huella: se generó antes de que existiera este guardián, así que no se puede saber de qué salió"] };
  if (h.sha !== ahora.sha) {
    for (const f of FICHEROS_DE_ENTRADA) {
      if (h.ficheros?.[f] !== ahora.ficheros?.[f]) motivos.push(`${f} ha cambiado desde que se generó (${h.ficheros?.[f] ?? "ausente"} → ${ahora.ficheros?.[f] ?? "ausente"})`);
    }
    if (h.versionReglas !== ahora.versionReglas) motivos.push(`la auditoría de símbolos iba por las reglas v${h.versionReglas} y ahora va por la v${ahora.versionReglas}`);
    if (h.ultimaFotoMiembros !== ahora.ultimaFotoMiembros) motivos.push(`la última foto de miembros era ${h.ultimaFotoMiembros} y ahora es ${ahora.ultimaFotoMiembros}`);
    if (!motivos.length) motivos.push(`la huella no coincide (${h.sha} → ${ahora.sha}) y no se puede decir en qué`);
  }
  return { vale: motivos.length === 0, motivos };
}

/** Fecha del fichero, o null. Para comparar artefacto contra entradas sin abrirlos. */
export function fechaDe(p) {
  try { return existsSync(p) ? statSync(p).mtime.toISOString() : null; } catch { return null; }
}
