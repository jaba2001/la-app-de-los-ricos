// ─────────────────────────────────────────────────────────────────────────────
// FORM 4 — LO QUE COMPRAN Y VENDEN LOS DIRECTIVOS
//
// El formulario 4 de la SEC es XML estructurado y público. Este módulo lo convierte en
// operaciones, y es PURO: recibe el texto, devuelve datos. Sin red, sin disco.
//
// ⚠️ CUATRO TRAMPAS DEL FORMATO, y las cuatro hunden un titular si se ignoran:
//
//   1. **`nonDerivativeHolding` NO es una operación.** Junto a las transacciones, el documento
//      declara lo que el insider POSEE sin haberlo movido. Los dos bloques llevan
//      `sharesOwnedFollowingTransaction`, así que un extractor que busque ese campo cuenta
//      tenencias como si fueran compras. Aquí sólo entran los bloques `…Transaction`.
//
//   2. **`transactionCode` no es opcional.** Una «venta» de código `M` es un ejercicio de
//      opciones y una de `A` es una concesión: ninguna de las dos es una decisión de mercado.
//      Publicar «el CEO vendió 37 M$» cuando fue un ejercicio automático es el error que se ve
//      en la competencia. El código se expone SIEMPRE y no se interpreta aquí.
//
//   3. **`aff10b5One` existe y hay que mirarlo.** Es la marca de que la operación venía de un
//      plan preprogramado (Regla 10b5-1). Un plan firmado meses antes NO es una señal sobre lo
//      que el directivo piensa hoy — y es justo lo que delata el titular de Insider Tracker
//      sobre Micron cuando dice «the sale was locked in months before the drop even started».
//
//   4. **La dirección la da `transactionAcquiredDisposedCode` (A/D), no el código.** Es el campo
//      que dice si entró o salió, y es independiente del motivo.
//
// Y una más, de higiene: el XML trae entidades (`&amp;`). Sin decodificarlas, «Moelis &amp; Co»
// no casa con nada — ya mordió al medir el emparejamiento CUSIP→ticker.
// ─────────────────────────────────────────────────────────────────────────────

export interface OperacionInsider {
  /** Ticker tal como lo declara el EMISOR en el propio documento. No hay que mapearlo. */
  ticker: string | null;
  emisorCik: string | null;
  emisor: string | null;
  insiderCik: string | null;
  insider: string | null;
  esDirector: boolean;
  esDirectivo: boolean;
  esDuenoDel10: boolean;
  /** Viene vacío a menudo. Si está vacío, es `null` — no se inventa. */
  cargo: string | null;
  fecha: string | null;
  /** `P` compra · `S` venta · `A` concesión · `M` ejercicio · `F` retención fiscal · `G` donación… */
  codigo: string | null;
  /** `A` adquirido · `D` dispuesto. La dirección real, independiente del motivo. */
  direccion: "A" | "D" | null;
  acciones: number | null;
  precio: number | null;
  /** `acciones × precio`, o null si falta alguno. Una concesión suele no llevar precio. */
  valor: number | null;
  accionesDespues: number | null;
  propiedad: "directa" | "indirecta" | null;
  /** ¿Venía de un plan 10b5-1 preprogramado? `null` si el documento no lo declara. */
  plan10b51: boolean | null;
  /** Las derivadas son opciones y warrants: otra cosa que las acciones. */
  derivada: boolean;
  titulo: string | null;
}

export interface Form4 {
  tipo: string | null;
  periodo: string | null;
  emisor: string | null;
  emisorCik: string | null;
  ticker: string | null;
  operaciones: OperacionInsider[];
  notas: string[];
}

const ENTIDADES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'",
};

/** Decodifica las entidades XML. Sin esto «Moelis &amp; Co» no casa con nada. */
export function decodificar(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#39);/g, (m) => ENTIDADES[m] ?? m);
}

/** El contenido de la PRIMERA etiqueta con ese nombre dentro del trozo dado. */
function campo(xml: string, nombre: string): string | null {
  const m = xml.match(new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`));
  if (!m) return null;
  const v = decodificar(m[1]).trim();
  return v === "" ? null : v;
}

/**
 * Un campo envuelto en `<value>`, que es como el Form 4 marca lo que es dato frente a lo que es
 * nota al pie. `<transactionShares><value>25.00</value></transactionShares>`.
 */
function valor(xml: string, nombre: string): string | null {
  const bloque = xml.match(new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`));
  if (!bloque) return null;
  return campo(bloque[1], "value");
}

const num = (s: string | null): number | null => {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

const bool = (s: string | null): boolean => s === "true" || s === "1";

/** Todos los bloques `<nombre>…</nombre>`, sin anidar. */
function bloques(xml: string, nombre: string): string[] {
  const re = new RegExp(`<${nombre}>([\\s\\S]*?)</${nombre}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

/** Convierte el XML de un Form 4 en sus operaciones. Devuelve `null` si no es un Form 4. */
export function parseForm4(xml: string): Form4 | null {
  if (!xml || !/<ownershipDocument>/.test(xml)) return null;

  const emisorBloque = bloques(xml, "issuer")[0] ?? "";
  const emisorCik = campo(emisorBloque, "issuerCik");
  const emisor = campo(emisorBloque, "issuerName");
  const ticker = campo(emisorBloque, "issuerTradingSymbol");

  // ⚠️ Se lee del documento, no se infiere del código de transacción. Ver trampa 3.
  const plan = xml.includes("<aff10b5One>") ? bool(campo(xml, "aff10b5One")) : null;

  const dueno = bloques(xml, "reportingOwner")[0] ?? "";
  const rel = bloques(dueno, "reportingOwnerRelationship")[0] ?? "";
  const insiderCik = campo(dueno, "rptOwnerCik");
  const insider = campo(dueno, "rptOwnerName");
  const esDirector = bool(campo(rel, "isDirector"));
  const esDirectivo = bool(campo(rel, "isOfficer"));
  const esDuenoDel10 = bool(campo(rel, "isTenPercentOwner"));
  const cargo = campo(rel, "officerTitle");

  const operaciones: OperacionInsider[] = [];

  // ⚠️ SÓLO los bloques `…Transaction`. Los `…Holding` declaran lo que se posee sin haberlo
  // movido, y llevan los mismos campos de tenencia. Ver trampa 1.
  for (const [nombre, derivada] of [["nonDerivativeTransaction", false], ["derivativeTransaction", true]] as const) {
    for (const b of bloques(xml, nombre)) {
      const cod = bloques(b, "transactionCoding")[0] ?? "";
      const cantidades = bloques(b, "transactionAmounts")[0] ?? "";
      const despues = bloques(b, "postTransactionAmounts")[0] ?? "";
      const naturaleza = bloques(b, "ownershipNature")[0] ?? "";

      const acciones = num(valor(cantidades, "transactionShares"));
      const precio = num(valor(cantidades, "transactionPricePerShare"));
      const dir = valor(cantidades, "transactionAcquiredDisposedCode");
      const prop = valor(naturaleza, "directOrIndirectOwnership");

      operaciones.push({
        ticker, emisorCik, emisor, insiderCik, insider,
        esDirector, esDirectivo, esDuenoDel10, cargo,
        fecha: valor(b, "transactionDate"),
        codigo: campo(cod, "transactionCode"),
        direccion: dir === "A" || dir === "D" ? dir : null,
        acciones,
        precio,
        valor: acciones != null && precio != null ? acciones * precio : null,
        accionesDespues: num(valor(despues, "sharesOwnedFollowingTransaction")),
        propiedad: prop === "D" ? "directa" : prop === "I" ? "indirecta" : null,
        plan10b51: plan,
        derivada,
        titulo: valor(b, "securityTitle"),
      });
    }
  }

  return {
    tipo: campo(xml, "documentType"),
    periodo: campo(xml, "periodOfReport"),
    emisor, emisorCik, ticker,
    operaciones,
    notas: bloques(xml, "footnotes").flatMap((f) =>
      [...f.matchAll(/<footnote[^>]*>([\s\S]*?)<\/footnote>/g)].map((m) => decodificar(m[1]).trim()),
    ),
  };
}

/**
 * ¿Es una decisión de mercado, o mecánica?
 *
 * NO decide si publicar — eso es de la capa de arriba. Sólo separa lo que un humano eligió hacer
 * de lo que ocurrió por un calendario o por el plan de retribución.
 *
 *   · `P` / `S` sin plan 10b5-1 → decisión.
 *   · `A` (concesión), `M` (ejercicio), `F` (retención fiscal para impuestos) → mecánica.
 *   · Cualquier cosa con `plan10b51 = true` → mecánica, aunque el código sea `S`. Ésa es la que
 *     distingue «el CEO vendió al ver la caída» de «se ejecutó un plan firmado en marzo».
 */
export function esDecisionDeMercado(op: OperacionInsider): boolean {
  if (op.plan10b51 === true) return false;
  return op.codigo === "P" || op.codigo === "S";
}
