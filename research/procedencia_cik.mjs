// ─────────────────────────────────────────────────────────────────────────────
// ¿QUIÉN TOMÓ ESTA DECISIÓN SOBRE UN CIK?
//
// ⚠️ ERAN DOS ESTADOS Y TENÍAN QUE SER TRES, y la diferencia no es cosmética.
//
// \`esHumano\` era \`!/--proponer/\`: o lo había escrito el script de corroboración, o se contaba
// como REVISIÓN HUMANA. El 2026-09-01, al revisar \`AKS\` y \`DO\` contra el historial de EDGAR,
// esas dos decisiones se habrían publicado como «revisadas por una PERSONA». No lo eran: las
// tomó un asistente leyendo presentaciones. Plausible, comprobable y con su evidencia escrita —
// pero no es lo mismo, y el propio fichero avisa de por qué: «lo que no se sabe acaba contándose
// como lo más favorable».
//
// Tres estados, entonces, y el convenio es explícito en el texto de \`propuestoPor\`:
//
//   · \`corroborado\` — lo escribió \`revisar_cik.mjs --proponer\`: dos fuentes independientes que
//     coinciden. Máquina, sin nadie mirando.
//   · \`asistente\`   — lo decidió un asistente comprobando la evidencia (prefijo \`asistente:\`).
//     Hay razonamiento y hay evidencia citada, pero no hay una persona respondiendo por ello.
//   · \`revisado\`    — lo miró una persona.
//
// El orden importa: ante la duda, la etiqueta MENOS favorable. Una decisión sin \`propuestoPor\`
// no es «humana por defecto», es \`null\` — y hay un test que la rechaza.
// ─────────────────────────────────────────────────────────────────────────────

/** \`corroborado\` | \`asistente\` | \`revisado\`, o null si no lo declara. */
export function procedenciaDe(d) {
  const p = String(d?.propuestoPor ?? "").trim();
  if (!p) return null;
  if (/--proponer/.test(p)) return "corroborado";
  if (/^asistente:/i.test(p)) return "asistente";
  return "revisado";
}

/** Sólo cuenta como revisión humana lo que lo es. Ver la nota de arriba. */
export function esRevisionHumana(d) {
  return procedenciaDe(d) === "revisado";
}
