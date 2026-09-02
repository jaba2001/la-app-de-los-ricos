// ─────────────────────────────────────────────────────────────────────────────
// INGRESOS POR SEGMENTO, DEL XBRL DE LA PRESENTACIÓN
//
// `companyfacts` NO trae ejes dimensionales —comprobado: las claves de NVDA y AMC vienen sin
// `segment`—, así que el desglose de ingresos por línea de negocio hay que sacarlo del documento
// XBRL de la propia presentación, que sí los lleva:
//
//   <context id="c-79">
//     <entity><identifier>0001045810</identifier>
//       <segment>
//         <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis"
//           >nvda:ComputeAndNetworkingSegmentMember</xbrldi:explicitMember>
//       </segment></entity>
//     <period><startDate>2025-01-27</startDate><endDate>2026-01-25</endDate></period>
//   </context>
//
// ⚠️ CUATRO TRAMPAS, y las cuatro producen un número creíble en vez de un error:
//
//   1. **UN CONTEXTO CON DOS EJES NO ES UN SEGMENTO.** `segmento × geografía` es una casilla de
//      una tabla cruzada, y sumarla con los totales de segmento cuenta lo mismo dos veces. Se
//      exige EXACTAMENTE UNA dimensión.
//   2. **HAY TRES EJERCICIOS EN EL MISMO FICHERO.** Un 10-K compara con los dos años anteriores.
//      Coger «los hechos de ingresos con eje de segmento» sin filtrar periodo mezcla tres años y
//      el total sale por triplicado.
//   3. **`instant` NO ES `duration`.** Los ingresos son de un periodo; un contexto con `instant`
//      es un saldo. Mezclarlos suma un balance con una cuenta de resultados.
//   4. **EL MIEMBRO ES DEL EMISOR, no de us-gaap.** `nvda:ComputeAndNetworkingSegmentMember` sólo
//      lo entiende NVIDIA. No hay taxonomía común: lo único honesto es limpiar el sufijo y
//      enseñar el nombre tal cual, nunca traducirlo a una categoría inventada.
// ─────────────────────────────────────────────────────────────────────────────

export interface Contexto {
  id: string;
  /** eje → miembro. Vacío si el contexto es el consolidado. */
  dims: Record<string, string>;
  inicio: string | null;
  fin: string | null;
  /** `true` si es un saldo a fecha y no un periodo. */
  instante: boolean;
}

export interface Hecho {
  tag: string;
  contexto: string;
  valor: number;
}

/** Etiquetas de ingresos, en orden de preferencia. Distintos emisores usan distintas. */
export const TAGS_INGRESOS = [
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
  "us-gaap:Revenues",
  "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
  "us-gaap:SalesRevenueNet",
] as const;

/** El eje de segmentos de negocio. Es el que declara la propia norma contable. */
export const EJE_SEGMENTO = "us-gaap:StatementBusinessSegmentsAxis";
/** El eje de línea de producto o servicio, que muchos usan en vez del de segmento. */
export const EJE_PRODUCTO = "srt:ProductOrServiceAxis";
/** Calificador, NO un cruce: dice «esto es un segmento de explotación». */
export const CALIFICADOR = "us-gaap:ConsolidationItemsAxis";

export function contextos(xml: string): Map<string, Contexto> {
  const out = new Map<string, Contexto>();
  for (const bloque of xml.match(/<context id="[^"]*">[\s\S]*?<\/context>/g) ?? []) {
    const id = bloque.match(/<context id="([^"]*)"/)?.[1];
    if (!id) continue;
    const dims: Record<string, string> = {};
    for (const m of bloque.matchAll(/dimension="([^"]+)"\s*>([^<]+)</g)) dims[m[1]] = m[2].trim();
    const inicio = bloque.match(/<startDate>([^<]+)<\/startDate>/)?.[1] ?? null;
    const fin = bloque.match(/<endDate>([^<]+)<\/endDate>/)?.[1] ?? null;
    const inst = bloque.match(/<instant>([^<]+)<\/instant>/)?.[1] ?? null;
    out.set(id, { id, dims, inicio, fin: fin ?? inst, instante: !!inst });
  }
  return out;
}

/**
 * Los hechos de las etiquetas pedidas, **uno por contexto**.
 *
 * ⚠️ EL MISMO HECHO APARECE VARIAS VECES EN EL DOCUMENTO, una por cada tabla del informe que lo
 * enseña. Apple declara `Service` = 109,2 B$ DOS veces, con el mismo `contextRef`. Sin deduplicar,
 * el desglose suma esa línea dos veces —y, peor, el detector de padres veía dos valores idénticos
 * que se «explicaban» el uno al otro y borraba los dos—. Un contexto identifica un hecho: si sale
 * repetido es la misma cifra, no dos.
 */
export function hechos(xml: string, tags: readonly string[]): Hecho[] {
  const vistos = new Map<string, Hecho>();
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b([^>]*)>([^<]*)</${tag}>`, "g");
    for (const m of xml.matchAll(re)) {
      const ctx = m[1].match(/contextRef="([^"]+)"/)?.[1];
      const v = Number(String(m[2]).replace(/,/g, "").trim());
      if (ctx && Number.isFinite(v) && !vistos.has(`${tag}|${ctx}`)) {
        vistos.set(`${tag}|${ctx}`, { tag, contexto: ctx, valor: v });
      }
    }
  }
  return [...vistos.values()];
}

/** `nvda:ComputeAndNetworkingSegmentMember` → «Compute And Networking». */
export function nombreDeMiembro(miembro: string): string {
  return String(miembro)
    .replace(/^[^:]*:/, "")
    .replace(/(Segment)?Member$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ").trim();
}

/**
 * Quita los miembros PADRE, que en el mismo eje conviven con sus hijos.
 *
 * ⚠️ **UN EJE TRAE VARIOS NIVELES A LA VEZ, y sumarlos cuenta lo mismo dos veces.** Medido el
 * 2026-09-02: NVIDIA declara `Data Center` 193,7 B$ Y ADEMÁS sus dos hijos `Compute` 162,4 y
 * `Networking` 31,4, todos sobre `ProductOrServiceAxis`. El desglose sumaba 1,90 veces el total.
 * Apple es peor: `Product` 307,0 y `Service` 109,2 son un nivel, y `iPhone`/`Mac`/`iPad`/
 * `Wearables` el siguiente — sumaba exactamente 2,0 veces.
 *
 * Un miembro es PADRE si algún subconjunto de los OTROS suma su valor. Se busca de forma
 * exhaustiva porque los desgloses tienen pocos miembros; por encima de `MAX_BUSQUEDA` no se
 * intenta y se deja que lo diga el cuadre, que es preferible a adivinar.
 */
export const MAX_BUSQUEDA = 16;

export function quitarPadres<T extends { valor: number }>(lineas: T[], tol = 0.005): T[] {
  if (lineas.length < 3 || lineas.length > MAX_BUSQUEDA) return lineas;
  const padres = new Set<number>();
  for (let i = 0; i < lineas.length; i++) {
    const objetivo = lineas[i].valor;
    if (!(objetivo > 0)) continue;
    const otros = lineas.map((l, k) => (k === i ? null : l.valor)).filter((v): v is number => v != null);
    // Búsqueda exhaustiva por máscara de bits: con ≤15 «otros» son 32.768 combinaciones.
    let hallado = false;
    for (let m = 1; m < (1 << otros.length) && !hallado; m++) {
      // ⚠️ UN PADRE TIENE AL MENOS DOS HIJOS. Aceptar subconjuntos de UNO hacía que dos miembros
      // con el mismo valor se «explicaran» mutuamente y se borrasen los dos: le pasó a Apple con
      // `Service` duplicado. Exigir dos es además lo que significa la palabra.
      let s = 0, n = 0;
      for (let b = 0; b < otros.length; b++) if (m & (1 << b)) { s += otros[b]; n++; }
      if (n >= 2 && Math.abs(s - objetivo) <= tol * objetivo) hallado = true;
    }
    if (hallado) padres.add(i);
  }
  // Si TODO sale padre, la detección no ha distinguido nada: mejor no tocar.
  if (!padres.size || padres.size === lineas.length) return lineas;
  return lineas.filter((_, i) => !padres.has(i));
}

export interface Desglose {
  /** El ejercicio usado, para que se pueda comprobar. */
  periodo: { inicio: string | null; fin: string | null };
  tag: string | null;
  eje: string | null;
  total: number | null;
  lineas: { miembro: string; nombre: string; valor: number }[];
  /** Suma de las líneas ÷ total. 1 = cuadra. */
  cuadre: number | null;
  /** `true` si hubo que quitar miembros padre porque el eje traía dos niveles. */
  nivelesMezclados?: boolean;
  motivo?: string;
}

/**
 * Saca el desglose de ingresos del ejercicio más reciente.
 *
 * El criterio de periodo: se toma el que usa el TOTAL consolidado —el hecho de ingresos sin
 * ninguna dimensión, con la duración más larga y la fecha de fin más alta— y las líneas tienen
 * que compartir exactamente ese periodo. Elegir el periodo por su cuenta y luego buscar el total
 * es lo que mezcla tres ejercicios.
 */
export function desgloseIngresos(xml: string): Desglose {
  const ctx = contextos(xml);
  const vacio: Desglose = { periodo: { inicio: null, fin: null }, tag: null, eje: null, total: null, lineas: [], cuadre: null };

  const dias = (c: Contexto) =>
    c.inicio && c.fin ? (Date.parse(c.fin) - Date.parse(c.inicio)) / 86400000 : 0;

  // ⚠️ EL TOTAL Y EL DESGLOSE PUEDEN USAR ETIQUETAS DISTINTAS. Aptiv declara el total con
  // `RevenueFromContractWithCustomerExcludingAssessedTax` y sus SEGMENTOS con `Revenues` —69
  // hechos frente a 9—. Buscando las líneas sólo con la etiqueta del total salían cero, y eso se
  // leía como «esta empresa no publica segmentos». Se cruzan todas las combinaciones y se elige
  // la que CUADRA, que es el único criterio que no depende de adivinar.
  const todos = hechos(xml, TAGS_INGRESOS);

  {
    // El total consolidado: sin dimensiones, duración anual (300-400 días), fin más reciente. Con
    // empate de fecha manda el orden de preferencia de TAGS_INGRESOS.
    const totales = todos
      .map((h) => ({ h, c: ctx.get(h.contexto) }))
      .filter((x): x is { h: Hecho; c: Contexto } => !!x.c && !x.c.instante
        && Object.keys(x.c.dims).length === 0 && dias(x.c) >= 300 && dias(x.c) <= 400)
      .sort((a, b) => String(b.c.fin).localeCompare(String(a.c.fin))
        || TAGS_INGRESOS.indexOf(a.h.tag as never) - TAGS_INGRESOS.indexOf(b.h.tag as never));
    if (!totales.length) return { ...vacio, motivo: "ninguna etiqueta de ingresos con un total anual sin dimensiones" };
    const { h: total, c: periodo } = totales[0];
    const hs = todos;
    const tag = total.tag;

    // Las líneas: MISMO periodo exacto, sobre un eje de desglose, y sin cruzar con otro eje.
    //
    // ⚠️ `ConsolidationItemsAxis=OperatingSegmentsMember` NO ES UN CRUCE: es un CALIFICADOR que
    // dice «esto es un segmento de explotación». Descartándolo por tener dos dimensiones, los
    // segmentos de verdad de Apple —Américas, Europa, Gran China, Japón, resto de Asia-Pacífico,
    // que suman exactamente sus 416,2 B$— se tiraban a la basura y quedaban sólo las líneas de
    // producto. Se admite como SEGUNDA opción, nunca mezclado con la primera: si las dos
    // existieran, sumarlas contaría los segmentos dos veces.
    const combos: [string, boolean][] = [[EJE_SEGMENTO, false], [EJE_SEGMENTO, true], [EJE_PRODUCTO, false], [EJE_PRODUCTO, true]];
    // Se evalúan TODAS y se elige por cuadre. Quedarse con la primera que tenga líneas era lo que
    // hacía antes, y con una sola etiqueta daba igual; cruzando etiquetas ya no: la primera puede
    // ser un desglose parcial y la tercera el bueno.
    //
    // ⚠️ Y CADA CANDIDATO USA UNA SOLA ETIQUETA. El primer intento juntó todas en un mismo
    // conjunto y un combo recogía líneas de dos etiquetas a la vez, sumando el mismo segmento dos
    // veces: la cobertura BAJÓ de 38 % a 33 %. Cruzar etiquetas significa probarlas por separado,
    // no mezclarlas.
    const candidatos: Desglose[] = [];
    for (const tagLinea of TAGS_INGRESOS) for (const [eje, conCalificador] of combos) {
      const lineas = hs
        .filter((h) => h.tag === tagLinea)
        .map((h) => ({ h, c: ctx.get(h.contexto) }))
        .filter((x): x is { h: Hecho; c: Contexto } => {
          if (!x.c || x.c.instante) return false;
          if (x.c.inicio !== periodo.inicio || x.c.fin !== periodo.fin) return false;
          if (!x.c.dims[eje]) return false;
          const otras = Object.keys(x.c.dims).filter((a) => a !== eje);
          if (!conCalificador) return otras.length === 0;
          return otras.length === 1 && otras[0] === CALIFICADOR
            && /OperatingSegmentsMember$/.test(x.c.dims[CALIFICADOR]);
        })
        .map((x) => ({ miembro: x.c.dims[eje], nombre: nombreDeMiembro(x.c.dims[eje]), valor: x.h.valor }));

      // Un solo miembro no es un desglose: es el total con otra etiqueta.
      if (lineas.length < 2) continue;

      // Se quitan los padres SÓLO si con ello el desglose pasa a cuadrar. Si no mejora, se deja
      // como estaba y que lo diga el cuadre: una corrección que no arregla nada es ruido que
      // además borra líneas reales.
      const cuadreDe = (ls: typeof lineas) =>
        total.valor ? ls.reduce((s, l) => s + l.valor, 0) / total.valor : null;
      const sinPadres = quitarPadres(lineas);
      const c0 = cuadreDe(lineas), c1 = cuadreDe(sinPadres);
      const mejor = c1 != null && c0 != null && Math.abs(c1 - 1) < Math.abs(c0 - 1);
      const finales = mejor ? sinPadres : lineas;

      candidatos.push({
        periodo: { inicio: periodo.inicio, fin: periodo.fin },
        tag: tagLinea, eje, total: total.valor, lineas: finales,
        cuadre: Number((cuadreDe(finales) ?? 0).toFixed(4)),
        nivelesMezclados: mejor,
      });
    }
    if (!candidatos.length) {
      return { ...vacio, periodo: { inicio: periodo.inicio, fin: periodo.fin }, tag, total: total.valor,
               motivo: "hay total consolidado pero ninguna línea con un eje de segmento o producto" };
    }
    // El mejor cuadre gana. A igualdad, el que más líneas tenga: un desglose de cinco dice más
    // que uno de dos, y si los dos cuadran los dos son ciertos.
    candidatos.sort((a, b) =>
      Math.abs((a.cuadre ?? 9) - 1) - Math.abs((b.cuadre ?? 9) - 1) || b.lineas.length - a.lineas.length);
    return candidatos[0];
  }
}
