// ─────────────────────────────────────────────────────────────────────────────
// EL PRECIO DE RECOMPRA — el valor razonable que la directiva REVELA con su dinero
//
// Berkshire recompró sus acciones a una media de 487 $ mientras cotizaban a 521. Eso no es la
// opinión de un analista ni una diapositiva de resultados: es la directiva poniendo el dinero
// de la empresa en una banda de precio concreta. Es la única estimación de valor razonable que
// viene firmada con una transferencia bancaria.
//
// Se deriva de dos cifras que casi todo el mundo publica:
//     precio medio = importe de las recompras ÷ acciones recompradas
//
// **Cobertura MEDIDA, y la cifra honesta NO es la primera que salió.** Sobre 45 nombres del
// S&P 500, el 69 % tiene los dos tags. Pero lo que de verdad se puede publicar —con el importe
// del MISMO ejercicio y una serie de precios con la que comprobarlo— es el **55 %**. Y con
// cuatro nombres salía el 25 %: cuatro nombres no son una medición de cobertura.
//
// ⚠️ EL CONFUNDIDOR, DENTRO Y NO EN UNA NOTA AL PIE: muchas empresas incluyen en las acciones
// «adquiridas» las que RETIENEN a sus empleados para pagar los impuestos de la retribución en
// acciones. Ésas no se compran en el mercado. Al sumarlas, el denominador crece y **el precio
// medio sale más BARATO de lo que realmente pagaron**, que es justo el sesgo que haría parecer
// lista a una directiva torpe. Por eso este módulo exige que el precio medio caiga dentro del
// rango en el que la acción cotizó de verdad, y si no, NO lo publica.
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaRecompra {
  ticker?: string;
  /** Importe pagado en recompras durante el periodo (magnitud positiva). */
  importe?: number | null;
  /** Acciones adquiridas en el periodo. */
  acciones?: number | null;
  /** Precio de mercado hoy. */
  precioActual?: number | null;
  /** Rango en el que la acción cotizó DURANTE el periodo — el control de cordura. */
  precioMin?: number | null;
  precioMax?: number | null;
  /** Años transcurridos desde el cierre del ejercicio de la recompra. */
  antiguedadAnos?: number | null;
}

export const UMBRALES_RECOMPRA = {
  /** Tolerancia al salirse del rango del periodo, en tanto por uno. Cubre el redondeo y que el
   *  rango venga de cierres diarios y las compras sean intradía. */
  toleranciaRango: 0.05,
  /** Diferencia con el precio actual a partir de la cual la lectura se considera informativa. */
  diferenciaMinima: 0.05,
  /**
   * ⚠️ Antigüedad máxima del hecho para leerlo como valor razonable REVELADO. Medido sobre 33
   * nombres del S&P 500: **11 publicaban un dato anterior a 2024 y dos de 2013**. El tag
   * responde, simplemente dejó de actualizarse. Axon comparaba una recompra de 2016 con el
   * precio de hoy y daba «+2.922 %»: aritméticamente correcto y como lectura, una tontería.
   * Lo que la directiva creía hace nueve años no es lo que cree ahora.
   */
  antiguedadMaxAnos: 2,
} as const;

export interface Recompra {
  precioMedio: number | null;
  /** Cuánto ha subido (o bajado) la acción desde lo que pagó la directiva. */
  retornoDesdeRecompra: number | null;
  /** `null` mientras no haya rango con el que comprobar. `false` = precio medio imposible. */
  creible: boolean | null;
  motivo: string | null;
  /** Fracción del importe sobre la capitalización, si se conoce. */
  intensidad: number | null;
  /** El hecho es demasiado viejo para leerlo como lo que la directiva cree HOY. */
  rancio: boolean;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export function recompra(e: EntradaRecompra, marketCap?: number | null): Recompra {
  const imp = num(e.importe), acc = num(e.acciones);
  const vacio: Recompra = { precioMedio: null, retornoDesdeRecompra: null, creible: null, motivo: null, intensidad: null, rancio: false };
  if (imp == null || acc == null || acc <= 0 || imp <= 0) {
    return { ...vacio, motivo: imp == null || acc == null ? "sin importe o sin acciones" : "importe o acciones no positivos" };
  }

  const precioMedio = Math.abs(imp) / Math.abs(acc);
  const act = num(e.precioActual);
  const min = num(e.precioMin), max = num(e.precioMax);

  // ⚠️ EL CONTROL DE CORDURA. Un precio medio fuera del rango en que la acción cotizó es
  // aritméticamente imposible, y cuando pasa la causa casi siempre es la misma: el recuento de
  // acciones incluye las retenidas a empleados por impuestos, que no se compraron en el
  // mercado. Se declara NO creíble en vez de publicar una cifra bonita y falsa.
  let creible: boolean | null = null, motivo: string | null = null;
  if (min != null && max != null && min > 0 && max >= min) {
    const t = UMBRALES_RECOMPRA.toleranciaRango;
    if (precioMedio < min * (1 - t)) {
      creible = false;
      motivo = `precio medio ${precioMedio.toFixed(2)} por debajo del mínimo del periodo (${min.toFixed(2)}): el recuento de acciones probablemente incluye retenciones por impuestos de la retribución en acciones, que no se compran en el mercado`;
    } else if (precioMedio > max * (1 + t)) {
      creible = false;
      motivo = `precio medio ${precioMedio.toFixed(2)} por encima del máximo del periodo (${max.toFixed(2)}): las dos cifras no describen el mismo periodo`;
    } else creible = true;
  }

  return {
    precioMedio,
    retornoDesdeRecompra: act != null && precioMedio > 0 ? act / precioMedio - 1 : null,
    creible, motivo,
    intensidad: marketCap != null && marketCap > 0 ? Math.abs(imp) / marketCap : null,
    rancio: (num(e.antiguedadAnos) ?? 0) > UMBRALES_RECOMPRA.antiguedadMaxAnos,
  };
}

export interface LecturaRecompra {
  clave: "recompro_barato" | "recompro_caro" | "no_creible" | "rancio";
  texto: string;
  evidencia: Record<string, number | string>;
}

/**
 * La lectura. **Es descriptiva, no una recomendación**, y la distinción importa: que la
 * directiva comprara barato dice lo que ELLA creía entonces y cómo le ha salido, no lo que la
 * acción hará. Un historial de recomprar caro es una señal de asignación de capital pobre —
 * eso sí es un juicio sobre la gestión, no sobre el precio.
 */
export function lecturaRecompra(r: Recompra, precioActual?: number | null): LecturaRecompra | null {
  if (r.precioMedio == null) return null;
  if (r.creible === false) {
    return { clave: "no_creible", texto: `No se publica el precio de recompra: ${r.motivo}`, evidencia: { motivo: r.motivo ?? "" } };
  }
  // ⚠️ Un hecho viejo NO se lee como valor razonable revelado. Se dice que existe y se para.
  if (r.rancio) {
    return { clave: "rancio",
      texto: `La última recompra etiquetada es demasiado antigua para leerla como lo que la directiva cree hoy: ` +
        `a ${r.precioMedio.toFixed(2)} por acción. Se publica como dato histórico, no como estimación de valor razonable actual.`,
      evidencia: { precioMedioRecompra: +r.precioMedio.toFixed(2) } };
  }
  const ret = r.retornoDesdeRecompra;
  if (ret == null || Math.abs(ret) < UMBRALES_RECOMPRA.diferenciaMinima) return null;

  const p = (x: number) => x.toFixed(2);
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;
  const ev = {
    precioMedioRecompra: +r.precioMedio.toFixed(2),
    ...(precioActual != null ? { precioActual: +precioActual.toFixed(2) } : {}),
    retornoPct: +(ret * 100).toFixed(1),
  };

  return ret > 0
    ? { clave: "recompro_barato",
        texto: `La directiva recompró a una media de ${p(r.precioMedio)} y la acción cotiza hoy ${pct(ret)} por encima. ` +
          `Con su propio dinero situó el valor razonable por debajo del precio actual, y de momento le ha salido bien. ` +
          `Es lo que creían entonces, no un pronóstico sobre lo que hará la acción.`,
        evidencia: ev }
    : { clave: "recompro_caro",
        texto: `La directiva recompró a una media de ${p(r.precioMedio)} y la acción cotiza hoy ${pct(ret)}. ` +
          `Pagó por encima de donde está el mercado: eso es una decisión de asignación de capital que ha destruido valor, ` +
          `y sobre eso —no sobre el precio futuro— sí se puede juzgar a una directiva.`,
        evidencia: ev };
}
