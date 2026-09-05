// ─────────────────────────────────────────────────────────────────────────────
// CUSIP → TICKER: LA PARTE QUE SE PUEDE PROBAR
//
// El emparejamiento vive aquí, fuera del script que descarga, para poder fijarlo con tests. La
// primera versión lo tenía todo dentro de `research/mapa_cusip.mjs` y por eso los cuatro fallos
// del normalizador tardaron una tanda entera de descargas en verse.
//
// ⚠️ TRES COSAS QUE CREÍA Y ERAN FALSAS, todas medidas contra datos reales el 2026-09-02:
//
//   1. «Los 532 ambiguos son dobles clases.» **No.** La inmensa mayoría son ACCIONES
//      PREFERENTES colándose en la lista de candidatos: `NEE` traía seis (`NEE-PN`, `NEE-PT`…),
//      `WFC` siete. Una preferente no es una clase de la común, y Scora sólo sigue común.
//   2. «La doble clase es irresoluble sin una fuente licenciada.» **Tampoco.** El N-PORT trae
//      `<title>` además de `<name>`, y el título SÍ lleva la clase:
//        `<name>ALPHABET INC</name>  <title>ALPHABET INC CAP STK CL C</title>  02079K107`
//      Yo leía sólo `<name>`. La información estaba en el mismo bloque XML.
//   3. «El normalizador ya está.» Cuatro diferencias más, y la peor era el apóstrofo: la SEC
//      escribe `LOWES`, `MCDONALDS`, `MOODYS` —sin él—, y yo lo sustituía por un ESPACIO, con
//      lo que `LOWE S COMPANIES` no casaba con nada. Ese solo fallo se llevaba por delante a
//      Lowe's, McDonald's, Moody's, Macy's, Kohl's…
// ─────────────────────────────────────────────────────────────────────────────

/** Entidades XML que aparecen en los nombres de la SEC. Sin esto, `Moelis &amp; Co` no casa. */
export function decodificar(s: string): string {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
}

/** Sufijos societarios que no distinguen a nadie. */
const RUIDO = /\b(INC|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|PLC|HOLDINGS?|GROUP|THE|COM|NEW|LLC|LP|SA|NV|AG|TRUST|REIT|CLASS [A-C])\b/g;

/**
 * Normaliza un nombre societario para compararlo.
 *
 * Las diferencias reales entre lo que dice un N-PORT y lo que dice `company_tickers.json`, todas
 * encontradas midiendo qué nombres del S&P 500 fallaban:
 *
 *   · **Apóstrofo BORRADO, no espaciado.** `LOWE'S` → `LOWES`, como lo escribe la SEC.
 *   · **Guion como espacio.** `COCA-COLA` → `COCA COLA`, `BRISTOL-MYERS` → `BRISTOL MYERS`.
 *   · **Sufijo de estado en sus dos formas.** `/DE/`, `/MN` y también `\DE\` (US BANCORP).
 *   · **`&` frente a `AND`.**
 *   · **Orden de palabras.** La SEC conserva `SMITH A O CORP` para A. O. Smith. Ordenar los
 *     tokens lo resuelve sin adivinar: si dos empresas distintas colisionaran quedarían
 *     AMBIGUAS y fuera, que es lo correcto.
 */
export function norm(s: string): string {
  return decodificar(s).toUpperCase()
    // El sufijo de estado, en TODAS sus formas. `{0,3}` y no `{2,}` porque la SEC también deja la
    // barra desnuda —`AMETEK INC/`, `METTLER TOLEDO INTERNATIONAL /`— y con un espacio delante
    // —`VERTEX PHARMACEUTICALS INC / MA`—. Exigir dos letras dejaba fuera esos tres.
    .replace(/\s*[\\/]\s*[A-Z]{0,3}\s*[\\/]?\s*$/g, " ")
    .replace(/['’`]/g, "")                       // APÓSTROFO: se BORRA (LOWE'S -> LOWES)
    .replace(/&/g, " AND ")
    .replace(/[-–—]/g, " ")                      // COCA-COLA -> COCA COLA
    .replace(/[.,"()!¡?¿:;]/g, " ")              // el `!` de YUM! BRANDS
    .replace(RUIDO, " ")
    .replace(/\s+/g, " ").trim()
    // ⚠️ EL SUFIJO SOCIETARIO EXTRANJERO, y sólo AL FINAL. `N.V.` se convierte en dos fichas
    // sueltas `N` y `V` al quitar los puntos, y ya no casa con el `NV` que escribe el fondo (NXP,
    // LyondellBasell). El primer intento fue unir cualquier par de letras con punto, y eso ROMPIÓ
    // `A. O. Smith` —lo convertía en `AO` cuando la SEC escribe `SMITH A O`—. Se limita a la
    // posición de sufijo y a una lista cerrada: `A O` no está en ella, así que A. O. Smith sigue
    // casando. Se repite porque puede haber más de uno.
    .replace(/(?:\s(?:N V|S A|A G|A B|A S|S P A))+$/g, "")
    .split(" ").filter(Boolean).sort().join(" ");
}

/**
 * Segunda clave, sin espacios. `JP MORGAN CHASE` contra `JPMORGAN CHASE`: la SEC junta lo que el
 * fondo separa, y al ordenar tokens eso da claves distintas. Sólo se usa si la primera falla, y
 * exigiendo candidato único igual que la primera.
 */
export const normSinEspacios = (s: string): string => norm(s).replace(/ /g, "");

/**
 * ¿Es una PREFERENTE (o un híbrido) y no la acción común?
 *
 * La convención de los mercados estadounidenses: `-P` seguido de la letra de la serie —`NEE-PN`,
 * `WFC-PY`, `SCHW-PD`—. ⚠️ Ojo con el falso amigo: `BRK-A`, `BF-B`, `MOG-A` y `CRD-A` llevan
 * guion y son CLASES DE LA COMÚN, no preferentes. Lo que marca la preferente es la `P`.
 */
export const esPreferente = (t: string): boolean => /-P[A-Z]?$/.test(String(t).toUpperCase());

/**
 * La clase que declara el título del N-PORT, o `null`.
 *
 *   `ALPHABET INC CAP STK CL C`      → "C"
 *   `BERKSHIRE HATHAWAY INC CL B`    → "B"
 *   `APPLE INC`                      → null (clase única: no hay nada que desambiguar)
 */
export function claseDeTitulo(titulo: string | undefined | null): string | null {
  if (!titulo) return null;
  const m = String(titulo).toUpperCase().match(/\b(?:CL|CLASS|SER|SERIES)\s+([A-Z])\b/);
  return m ? m[1] : null;
}

/**
 * La clase que declara el propio TICKER, o `null`. `BRK-A` → "A", `BF-B` → "B", `AAPL` → null.
 * Sólo cuenta el guion: un ticker de cinco letras como `GOOGL` no declara clase ninguna —la `L`
 * no es una letra de clase, y tratarla como tal sería justo el tipo de suposición que produjo
 * «Wendy's como dueña de TWC».
 */
export function claseDeTicker(t: string): string | null {
  const m = String(t).toUpperCase().match(/-([A-Z])$/);
  return m && m[1] !== "P" ? m[1] : null;
}

export type Resolucion =
  | { ticker: string; via: "único" | "universo" | "clase" | "tabla" }
  | { ticker: null; via: "ambiguo" | "sin candidatos"; candidatos: string[] };

/**
 * Elige UN ticker entre los candidatos de un nombre, o declara que no se puede.
 *
 * El orden de los filtros importa y cada uno tiene su razón:
 *   1. **Preferentes fuera.** No son la común; ninguna está en el universo de Scora.
 *   2. **Intersección con el universo.** Es la pregunta que de verdad se hace: no hace falta
 *      resolver todo el mercado, sólo los nombres que Scora sigue.
 *   3. **La clase del título.** `CL B` deja sólo `BRK-B` entre `BRK-A` y `BRK-B`.
 *   4. **La tabla revisada.** Para las clases cuyo ticker no lleva la letra —`GOOGL` es la A y
 *      `GOOG` la C, y eso no se deduce de las letras—. Va con su evidencia y es la ÚNICA vía
 *      que no es deducción; por eso se marca aparte.
 *
 * Si tras todo queda más de uno, devuelve `null` y los candidatos. **Nunca elige el más
 * probable**: es la misma disciplina del nivel B de los CIK.
 */
export function resolver(
  candidatos: string[],
  opciones: { universo?: Set<string>; titulo?: string | null; tabla?: Record<string, string> } = {},
): Resolucion {
  const { universo, titulo, tabla } = opciones;
  let c = [...new Set(candidatos.map((x) => String(x).toUpperCase()))];
  if (!c.length) return { ticker: null, via: "sin candidatos", candidatos: [] };
  if (c.length === 1) return { ticker: c[0], via: "único" };

  const sinPref = c.filter((t) => !esPreferente(t));
  if (sinPref.length) c = sinPref;
  if (c.length === 1) return { ticker: c[0], via: "único" };

  if (universo?.size) {
    const dentro = c.filter((t) => universo.has(t) || universo.has(t.replace(/-/g, ".")));
    if (dentro.length === 1) return { ticker: dentro[0], via: "universo" };
    if (dentro.length) c = dentro;
  }

  const cl = claseDeTitulo(titulo);
  if (cl) {
    const iguales = c.filter((t) => claseDeTicker(t) === cl);
    if (iguales.length === 1) return { ticker: iguales[0], via: "clase" };

    // El ticker no lleva la letra (GOOGL/GOOG): sólo la tabla revisada puede decidir.
    if (tabla) {
      const clave = `${norm(String(titulo).replace(/\b(?:CAP STK|COM|CL|CLASS|SER|SERIES)\b.*$/i, ""))}|${cl}`;
      const t = tabla[clave];
      if (t && c.includes(t.toUpperCase())) return { ticker: t.toUpperCase(), via: "tabla" };
    }
  }

  return { ticker: null, via: "ambiguo", candidatos: c };
}
