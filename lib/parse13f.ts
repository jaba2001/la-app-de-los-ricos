// ─────────────────────────────────────────────────────────────────────────────
// 13F — LAS CARTERAS DE LOS GRANDES GESTORES
//
// Es el producto de Autopilot: «the app where top investors invest for you». Sale de EDGAR, en
// XML estructurado. Este módulo lo convierte en posiciones, y es PURO.
//
// ⚠️ CINCO TRAMPAS DEL FORMATO, las cinco medidas sobre declarantes reales (Berkshire,
// Bridgewater, Renaissance y Pershing Square) antes de escribir una línea:
//
//   1. **Los ESPACIOS DE NOMBRES son opcionales.** Bridgewater declara `<ns1:infoTable>` y los
//      otros tres `<infoTable>`. Buscando la forma sin prefijo, Bridgewater daba **0 posiciones**
//      teniendo 997 — y cero se lee como «este gestor no tiene nada», no como «mi parser no
//      entiende el documento». Es el fallo silencioso otra vez.
//   2. **El fichero de posiciones no se llama igual.** `56757.xml`, `form13fInfoTable.xml`,
//      `infotable.xml`, `renaissance13Fq22026_holding.xml`. No se adivina: es el XML que no es
//      `primary_doc.xml`.
//   3. **El FIGI existe pero casi nadie lo pone.** Sólo Bridgewater (100 %); los otros tres, 0 %.
//      Sería un identificador abierto y perfecto, y no se puede usar como clave. El CUSIP sí está
//      en el 100 %.
//   4. **`periodOfReport` viene en MM-DD-AAAA**, no en ISO. Parsearlo como ISO da fechas
//      inválidas en silencio.
//   5. **Las posiciones en OPCIONES no son acciones.** Llevan `putCall` y hay que separarlas: un
//      «tiene 5 M$ de NVDA» que en realidad son puts es exactamente lo contrario de lo que
//      parece.
//
// Y una más, de contexto: **45 días de retraso regulatorio**. Toda cifra tiene que publicarse con
// la fecha del TRIMESTRE, nunca con la de presentación, o se lee como si fuera de hoy.
// ─────────────────────────────────────────────────────────────────────────────

export interface Posicion {
  emisor: string | null;
  cusip: string | null;
  /** Identificador abierto. Casi nadie lo publica: no sirve como clave. */
  figi: string | null;
  titulo: string | null;
  /** Valor en dólares declarado por el gestor. */
  valor: number | null;
  cantidad: number | null;
  /** `SH` acciones · `PRN` principal (deuda). */
  tipoCantidad: string | null;
  /** Si está, la posición es una OPCIÓN y no acciones. */
  opcion: "Call" | "Put" | null;
}

export interface Info13F {
  /** El trimestre al que se refiere, en ISO. Es la fecha que hay que publicar. */
  periodo: string | null;
  posiciones: Posicion[];
  /** Sólo las de acciones: sin opciones ni deuda. */
  acciones: Posicion[];
  valorTotal: number;
}

const num = (s: string | null): number | null => {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

/**
 * Contenido de una etiqueta, **con o sin prefijo de espacio de nombres**.
 *
 * Ver trampa 1: sin el `(?:\w+:)?` Bridgewater devolvía cero posiciones teniendo 997.
 */
function campo(xml: string, nombre: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`));
  if (!m) return null;
  const v = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  return v === "" ? null : v;
}

/** Los bloques de una etiqueta, con o sin prefijo. */
function bloques(xml: string, nombre: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${nombre}>([\\s\\S]*?)</(?:\\w+:)?${nombre}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/**
 * `MM-DD-AAAA` → `AAAA-MM-DD`. Ver trampa 4.
 *
 * Devuelve `null` si no encaja, en vez de una fecha inventada: una fecha mal parseada se propaga
 * a todo lo que se publique después.
 */
export function periodoISO(s: string | null): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  // Algunos declaran ya en ISO.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s).trim())) return String(s).trim();
  return null;
}

/** Convierte la tabla de posiciones de un 13F en datos. `periodo` viene de `primary_doc.xml`. */
export function parse13F(tablaXml: string, periodoCrudo?: string | null): Info13F {
  const posiciones: Posicion[] = [];

  for (const b of bloques(tablaXml, "infoTable")) {
    const cantidadBloque = bloques(b, "shrsOrPrnAmt")[0] ?? "";
    // ⚠️ `putCall` sólo aparece en opciones. Su ausencia significa acciones, no «no se sabe».
    const pc = campo(b, "putCall");
    posiciones.push({
      emisor: campo(b, "nameOfIssuer"),
      cusip: campo(b, "cusip"),
      figi: campo(b, "figi"),
      titulo: campo(b, "titleOfClass"),
      valor: num(campo(b, "value")),
      cantidad: num(campo(cantidadBloque, "sshPrnamt")),
      tipoCantidad: campo(cantidadBloque, "sshPrnamtType"),
      opcion: pc === "Call" || pc === "Put" ? pc : null,
    });
  }

  // Sólo acciones: ni opciones ni principal de deuda. Mezclarlas daría una «cartera» que no
  // existe — un put es una apuesta contraria, no una posición en la empresa.
  const acciones = posiciones.filter((p) => p.opcion == null && (p.tipoCantidad === "SH" || p.tipoCantidad == null));

  return {
    periodo: periodoISO(periodoCrudo ?? null),
    posiciones,
    acciones,
    valorTotal: acciones.reduce((a, p) => a + (p.valor ?? 0), 0),
  };
}

/**
 * ¿Cuál de los ficheros de la carpeta es la tabla de posiciones?
 *
 * Ver trampa 2: los nombres son arbitrarios. La regla es «el XML que no es `primary_doc.xml`».
 * Si hay varios o ninguno, se devuelve `null` y quien llama lo cuenta — adivinar sería peor.
 */
export function ficheroDeTabla(nombres: string[]): string | null {
  const xml = nombres.filter((f) => f.toLowerCase().endsWith(".xml") && f.toLowerCase() !== "primary_doc.xml");
  return xml.length === 1 ? xml[0] : null;
}

/**
 * Días entre el cierre del trimestre y la presentación.
 *
 * Se publica junto a la cartera. El 13F llega con ~45 días de retraso por regulación, y una
 * cartera de hace mes y medio presentada sin esa fecha se lee como si fuera de hoy.
 */
export function retrasoDias(periodoISO: string | null, presentado: string | null): number | null {
  if (!periodoISO || !presentado) return null;
  const a = Date.parse(`${periodoISO}T00:00:00Z`), b = Date.parse(`${presentado}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * ¿En qué unidad declara los valores esta presentación? Devuelve el factor a aplicar.
 *
 * ⚠️ **LA COLUMNA `value` CAMBIÓ DE UNIDAD.** Hasta la reforma de 2022 el 13F declaraba el valor
 * en MILES de dólares; desde 2023 en dólares. Y no todos los declarantes se cambiaron: el
 * 2026-09-02, con los seis gestores medidos, cinco declaraban en dólares y **Duquesne Family
 * Office seguía en miles**. Sin corregirlo, su cartera se publicaba como «4 M$» cuando son unos
 * 4.000 M$: un error de tres órdenes de magnitud en una cifra que se enseña.
 *
 * NO se detecta por la fecha —hay declarantes tardíos en las dos direcciones— sino por el dato:
 * `valor / cantidad` es el PRECIO POR ACCIÓN, y un precio tiene un rango conocido. Si la mediana
 * de la cartera sale por debajo de un dólar, no es que el gestor compre céntimos: es que los
 * valores están en miles.
 *
 * Devuelve `null` si no hay con qué decidir (sin posiciones en acciones con cantidad), y en ese
 * caso NO se escala: preferible una cifra sin tocar que una multiplicada a ciegas.
 */
export function escalaDeValor(posiciones: Posicion[]): { factor: number; precioMediano: number } | null {
  const precios = posiciones
    .filter((p) => !p.opcion && p.tipoCantidad !== "PRN" && (p.cantidad ?? 0) > 0 && (p.valor ?? 0) > 0)
    .map((p) => (p.valor as number) / (p.cantidad as number))
    .sort((a, b) => a - b);
  if (!precios.length) return null;
  const mediano = precios[Math.floor(precios.length / 2)];
  // Una acción por debajo de 1 $ existe, pero una CARTERA cuyo precio MEDIANO está por debajo de
  // 1 $ no: eso es la unidad, no el mercado.
  return mediano < 1 ? { factor: 1000, precioMediano: mediano } : { factor: 1, precioMediano: mediano };
}
