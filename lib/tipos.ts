// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA DE TIPOS — fase 2 del plan de las tres capas
//
// La idea que los dos vídeos de bonos explican bien y que Scora no tenía en ninguna parte:
// **el tipo sin riesgo es el suelo que todo lo demás tiene que batir**. Cuando sube, todo
// activo con riesgo se reprecia a la baja — y por eso una cartera puede caer un día sin
// ninguna noticia mala.
//
// Este módulo NO decide nada. No toca el asignador, no entra en el score, no mueve un peso.
// Es capa EXPLICATIVA: convierte cuatro series de FRED en frases comprobables. Por eso su
// riesgo de sobreajuste es exactamente cero, y por eso va antes que la fase 3.
//
// ⚠️ TRES REGLAS que este fichero no rompe:
//   1. Un dato ausente devuelve `null`, nunca un cero con forma de respuesta.
//   2. Un percentil sin muestra suficiente devuelve `null` con su motivo, no un número.
//   3. Todo juicio ("empinada", "ensanchándose") va acompañado del número que lo sostiene.
// ─────────────────────────────────────────────────────────────────────────────

/** Un punto de la curva del Tesoro, en % anual. `null` = no hay dato ese día. */
export interface Curva {
  m3: number | null;   // DGS3MO
  a2: number | null;   // DGS2
  a10: number | null;  // DGS10
  a30: number | null;  // DGS30
}

export type FormaCurva = "normal" | "plana" | "invertida" | "jorobada";

/** Umbrales ESCRITOS, no escondidos en un `if`. Todos en puntos porcentuales. */
export const UMBRALES_TIPOS = {
  /** Por debajo de esto la curva se considera plana, no normal. Convención de mesa. */
  planaHasta: 0.25,
  /** Muestra mínima para dar un percentil. Menos que esto y el percentil miente. */
  minObsPercentil: 250,
  /** Ventana para juzgar si el diferencial se está abriendo (días naturales). */
  ventanaEnsanche: 90,
  /** Apertura mínima en esa ventana para llamarlo "ensanchándose". */
  ensancheMinimo: 0.25,
} as const;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Diferencia entre dos tramos. `null` si falta cualquiera de los dos. */
export function pendiente(largo: number | null, corto: number | null): number | null {
  const l = num(largo), c = num(corto);
  return l == null || c == null ? null : l - c;
}

/**
 * La forma de la curva. Es la lectura más citada de todo el mercado de bonos: invertida =
 * el mercado cobra MENOS por prestar a diez años que a dos, que sólo tiene sentido si
 * espera que los tipos bajen, que es lo que pasa en las recesiones.
 *
 * "Jorobada" es el caso que casi nadie codifica y que aparece en los giros: el tramo medio
 * paga más que los dos extremos.
 */
export function forma(c: Curva): { forma: FormaCurva; t10y2: number | null; t10y3m: number | null } | null {
  const t10y2 = pendiente(c.a10, c.a2);
  const t10y3m = pendiente(c.a10, c.m3);
  // Sin ningún par completo no se puede decir nada de la forma.
  if (t10y2 == null && t10y3m == null) return null;
  const ref = t10y2 ?? t10y3m!;
  let f: FormaCurva;
  if (ref < 0) f = "invertida";
  else if (ref < UMBRALES_TIPOS.planaHasta) f = "plana";
  else f = "normal";
  // La joroba se comprueba aparte y gana: el tramo medio por encima de los DOS extremos.
  const { m3, a2, a10, a30 } = c;
  if (m3 != null && a2 != null && a10 != null && a30 != null && a2 > m3 && a2 > a30 && a10 > a30) f = "jorobada";
  return { forma: f, t10y2, t10y3m };
}

/**
 * El reparto del tipo nominal a 10 años entre su parte REAL y la inflación esperada.
 * Es la descomposición que explica por qué dos épocas con el mismo 4 % nominal no se
 * parecen en nada: 4 % con inflación esperada al 1 % aprieta mucho más que con el 3 %.
 *
 * `breakeven` sale de la identidad nominal − real. Si además hay `t5yifr` (la expectativa
 * a 5 años dentro de 5), se devuelve **sin mezclarla**: miden horizontes distintos y
 * promediarlas sería inventar una tercera cifra que no es ninguna de las dos.
 */
export function descomponer(a10: number | null, real10: number | null, t5yifr?: number | null):
  { nominal: number; real: number; breakeven: number; expectativa5a5: number | null } | null {
  const n = num(a10), r = num(real10);
  if (n == null || r == null) return null;
  return { nominal: n, real: r, breakeven: n - r, expectativa5a5: num(t5yifr ?? null) };
}

/**
 * El percentil de un valor dentro de su propia historia. Es lo que convierte "el
 * diferencial está en 2,1" —que no le dice nada a nadie— en "más alto que el 63 % de los
 * últimos 41 años".
 *
 * ⚠️ Devuelve `null` con motivo si la muestra no llega al mínimo. Un percentil sobre 200
 * observaciones presentado como "41 años de historia" es exactamente la clase de cifra
 * que parece evidencia y no lo es.
 */
export function percentil(valor: number | null, historia: number[]):
  { pct: number; n: number } | { pct: null; motivo: string } {
  const v = num(valor);
  if (v == null) return { pct: null, motivo: "sin valor" };
  const h = historia.filter((x) => Number.isFinite(x));
  if (h.length < UMBRALES_TIPOS.minObsPercentil)
    return { pct: null, motivo: `muestra insuficiente: ${h.length} obs, hacen falta ${UMBRALES_TIPOS.minObsPercentil}` };
  let menores = 0;
  for (const x of h) if (x < v) menores++;
  return { pct: (100 * menores) / h.length, n: h.length };
}

/**
 * El diferencial de crédito y si se está ABRIENDO. Es la única señal de alerta temprana
 * que los tres vídeos comparten: el mercado de bonos huele el problema antes que el de
 * acciones, y lo huele ensanchando el precio del riesgo.
 *
 * ⚠️ Aquí NO se usa la serie del vídeo (`BAMLH0A0HYM2`, high yield de ICE BofA): FRED sólo
 * sirve 786 observaciones desde 2023-09 porque está licenciada. Se usa `BAA10Y`, que mide
 * lo mismo —el precio del riesgo de crédito— con 41 años. Es una degradación, y hay que
 * decirla al publicar en vez de presentar el sustituto como si fuera el original.
 */
export function credito(serie: { date: string; v: number }[], hasta: string):
  { valor: number; fecha: string; percentil: number | null; motivoPercentil?: string;
    hace90d: number | null; delta: number | null; ensanchando: boolean } | null {
  const hist = serie.filter((o) => o.date <= hasta);
  if (!hist.length) return null;
  const ult = hist[hist.length - 1];
  const corte = new Date(new Date(hasta).getTime() - UMBRALES_TIPOS.ventanaEnsanche * 86400000)
    .toISOString().slice(0, 10);
  const antes = hist.filter((o) => o.date <= corte);
  const prev = antes.length ? antes[antes.length - 1].v : null;
  const delta = prev == null ? null : ult.v - prev;
  const p = percentil(ult.v, hist.map((o) => o.v));
  return {
    valor: ult.v, fecha: ult.date,
    percentil: p.pct, ...(p.pct == null ? { motivoPercentil: (p as { motivo: string }).motivo } : {}),
    hace90d: prev, delta,
    // "Ensanchándose" es una AFIRMACIÓN, así que necesita un corte declarado, no un signo.
    ensanchando: delta != null && delta >= UMBRALES_TIPOS.ensancheMinimo,
  };
}

/**
 * El listón: la frase que hace útil todo lo anterior. No predice nada — sólo dice contra
 * qué hay que medirse, que es justo lo que el vídeo explica y ningún panel retail enseña.
 */
/**
 * ⚠️ LA TASA BASE DEL AVISO, MEDIDA. Sin esto, `ensanchando: true` se lee como una alerta y
 * es exactamente lo que el vídeo hace: *«el mercado de bonos huele el problema antes que el
 * de acciones»*. Medido sobre 33 años y 22 episodios independientes (`aviso_credito_base.mjs`):
 *
 *   · tras un aviso, la peor caída del año siguiente es −16,4 % frente al −14,3 % de un mes
 *     cualquiera. La diferencia existe, pero **p = 0,149 en permutación: no se distingue del azar.**
 *   · **8 de los 22 avisos fueron seguidos de un año de más del +20 %.** Marzo de 2020 es el
 *     caso de manual: el aviso se enciende EN el suelo, no antes.
 *
 * El mecanismo es cierto —en 2007 se encendió 397 días antes de Lehman— pero como SEÑAL no
 * sobrevive al test. Por eso `ensanchando` es un hecho sobre los datos y no una recomendación,
 * y esta función es la que obliga a publicarlo con su tasa base al lado.
 */
export const BASE_AVISO = {
  episodios: 22, desde: 1993,
  caidaTrasAviso: -16.4, caidaSinCondicionar: -14.3, p: 0.146,
  seguidosDeUnBuenAno: 8,
} as const;

/**
 * ⚠️ LA SENSIBILIDAD AL TIPO REAL, MEDIDA — y por qué se publica como CONTEXTO y no como señal.
 *
 * Dos de los vídeos afirman lo mismo: cuando el tipo real baja, el oro sube. Es cierto y la
 * lógica es buena —el oro no paga cupón, así que su coste de oportunidad ES el tipo real—.
 * Medido sobre 259 meses desde 2003 (`research/tipos_reales.mjs`):
 *
 *   · **Contemporáneo**: ρ = −0,34 en el oro. Con el tipo real bajando hace **+2,46 %/mes**;
 *     subiendo, **−0,79 %**. Una diferencia de 3,25 puntos al mes. Enorme.
 *   · **PREDICTIVO** (el cambio de este mes contra el retorno del SIGUIENTE): ρ = −0,078.
 *
 * El |ρ| medio de los CINCO activos pasa de **0,312 a 0,098 al mirar hacia adelante**: cae un
 * 69 %. Y la relacion es fuerte solo donde el argumento tiene sentido: oro −0,34 y plata −0,30,
 * frente a **Bitcoin −0,11 y S&P 500 −0,12**, que el video 4 mete en el mismo saco. La relación explica lo que pasó y no anticipa nada, porque para operarla haría falta
 * conocer el movimiento del tipo por adelantado — y quien lo conociera tendría negocios mejores
 * que el oro. Por eso esta constante existe: para que el número no se publique sin su límite.
 */
export const SENSIBILIDAD_REAL = {
  meses: 259, desde: 2003,
  oro: { contemporaneo: -0.339, predictivo: -0.078, bajando: 2.46, subiendo: -0.79 },
  plata: { contemporaneo: -0.304, predictivo: -0.083 },
  sp500: { contemporaneo: -0.115, predictivo: -0.108 },
  bitcoin: { contemporaneo: -0.113, predictivo: -0.167, meses: 98 },
  rhoMedioContemporaneo: 0.312, rhoMedioPredictivo: 0.098,
} as const;

/** La frase honesta para el panel. El número contemporáneo NUNCA sale sin el predictivo. */
export function lecturaTipoReal(deltaReal: number | null): string {
  const s = SENSIBILIDAD_REAL;
  const base = `Medido sobre ${s.meses} meses desde ${s.desde}: con el tipo real bajando, el oro hace ` +
    `${s.oro.bajando >= 0 ? "+" : ""}${s.oro.bajando} %/mes; subiendo, ${s.oro.subiendo} %. ` +
    `Pero eso es CONTEMPORÁNEO: mide el mismo mes. Mirando al mes siguiente la correlación cae de ` +
    `${s.oro.contemporaneo} a ${s.oro.predictivo}. Explica lo que pasó, no anticipa lo que viene.`;
  if (deltaReal == null) return base;
  return `El tipo real ${deltaReal < 0 ? "ha bajado" : "ha subido"} ${Math.abs(deltaReal).toFixed(2)} puntos. ${base}`;
}

/** La frase honesta para acompañar a un aviso encendido. NUNCA se publica el booleano solo. */
export function avisoConTasaBase(ensanchando: boolean): string {
  if (!ensanchando) return "El diferencial de crédito no se está abriendo por encima del corte declarado.";
  return `El diferencial se está abriendo. Contexto medido: de ${BASE_AVISO.episodios} avisos como éste desde ` +
    `${BASE_AVISO.desde}, ${BASE_AVISO.seguidosDeUnBuenAno} fueron seguidos de un año de más del +20 %. ` +
    `La caída media posterior (${BASE_AVISO.caidaTrasAviso} %) no se distingue estadísticamente de la de un ` +
    `mes cualquiera (${BASE_AVISO.caidaSinCondicionar} %, p = ${BASE_AVISO.p}). Es contexto, no una señal.`;
}

export function liston(a10: number | null, real10: number | null): string | null {
  const n = num(a10);
  if (n == null) return null;
  const r = num(real10);
  const base = `El Tesoro a 10 años paga ${n.toFixed(2)} % sin riesgo de impago: cualquier activo con riesgo tiene que batir eso para compensar.`;
  return r == null ? base
    : `${base} Descontada la inflación esperada, el listón real es ${r.toFixed(2)} %.`;
}
