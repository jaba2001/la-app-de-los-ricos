// ─────────────────────────────────────────────────────────────────────────────
// LAS REGLAS DE UN ALIAS DE TICKER, PURAS
//
// Viven aparte de `publicar_resolucion.mjs` por un motivo concreto: ese fichero es un script
// con efectos —lee la resolución, llama a la SEC y escribe en `research/data/`—, así que
// importarlo desde un test lo EJECUTA. Pasó: el guardián de datos importó `elegirVivo` para
// comprobarla y de paso volvió a escribir los mapas y a pedirle el índice a la SEC.
//
// Aquí no hay efectos, sólo decisiones, y por eso se pueden comprobar sin red ni disco.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ UN CIK NO IDENTIFICA UNA ACCIÓN: IDENTIFICA UNA EMPRESA.
 *
 * Cuál de los tickers vivos de un CIK es LA ACCIÓN que llevaba el ticker muerto. Dos pasos, y
 * los dos salen de errores reales:
 *
 *   1. **La clase, si coincide.** El CSV de miembros escribe la clase con punto y la SEC con
 *      guion, así que `BF.B` normalizado es exactamente `BF-B`, uno de los dos tickers vivos
 *      del CIK. La primera versión se quedaba con el primero por orden alfabético «para que el
 *      resultado fuera estable», y el resultado estable era **`BF.B → BF-A`**: a la clase B de
 *      Brown-Forman le habría dado los precios de la clase A, que es otra acción con otro
 *      precio y otros derechos de voto.
 *   2. **Fuera lo que no es acción ordinaria.** `GENVR` y `VAL-WT` son derechos y warrants, y
 *      se reconocen sin listas negras: son EXTENSIONES de otro ticker del mismo CIK (`GEN`,
 *      `VAL`). Las clases de verdad no lo son — ni `BF-A` empieza por `BF-B` ni al revés.
 *
 * Si después de eso queda exactamente una, ésa es. Si quedan varias, no se inventa: devuelve
 * null y el que llama lo anota como ambiguo.
 */
export function elegirVivo(muerto, vivosDelCik) {
  const norm = String(muerto).toUpperCase().split(".").join("-");
  if (vivosDelCik.has(norm)) return norm;
  const lista = [...vivosDelCik];
  const ordinarias = lista.filter((t) => !lista.some((s) => s !== t && t.startsWith(s)));
  return ordinarias.length === 1 ? ordinarias[0] : null;
}

/**
 * ¿Convivieron dos tickers en el índice?
 *
 * Es lo que separa dos CLASES de la misma empresa —que cotizan a la vez— de una CADENA DE
 * RENOMBRES, que se suceden. `DISCA` y `DISCK` son clases y hoy son la misma `WBD`: aliasar
 * las dos mete en la cartera dos posiciones con serie idéntica, que es doble conteo
 * disfrazado. `SYMC` y `NLOK` también apuntan las dos a `GEN`, pero son Symantec y
 * NortonLifeLock, la misma empresa en momentos distintos, y ahí los dos alias son correctos.
 */
export function convivieron(a, b) {
  if (!a || !b) return false;
  return a.desde <= b.hasta && b.desde <= a.hasta;
}
