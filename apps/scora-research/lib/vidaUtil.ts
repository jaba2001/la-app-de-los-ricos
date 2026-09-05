// ─────────────────────────────────────────────────────────────────────────────
// LA VIDA ÚTIL IMPLÍCITA — lo que la depreciación revela sin que nadie lo declare
//
// Alargar la vida útil de un activo baja el gasto por depreciación de cada año y sube el
// beneficio declarado, sin que entre ni salga un euro de caja. Es una estimación contable que
// mueve miles de millones y que casi nadie mira.
//
// ⚠️ Y NO SE PUEDE PREGUNTAR: `PropertyPlantAndEquipmentUsefulLife` sólo lo etiqueta una
// minoría (de las cinco grandes, sólo Oracle). Meta y Alphabet no lo etiquetan y Amazon y
// Microsoft sólo la de intangibles. Está en el texto de la nota contable, no como hecho. Así
// que aquí se DERIVA de los números que sí publican todos.
//
// ─────────────────────────────────────────────────────────────────────────────
// LOS DOS CONFUNDIDORES, POR DELANTE, PORQUE LOS DOS PRODUCEN LA MISMA SEÑAL
// ─────────────────────────────────────────────────────────────────────────────
//
// **1. EL CRECIMIENTO DEL ACTIVO.** `bruto / depreciación` se infla sola cuando el activo
//    crece, porque lo comprado este año casi no ha depreciado todavía. Medido sobre las cinco
//    grandes: la vida implícita de Oracle en 2025 pasa de **15,4 años con la fórmula ingenua a
//    12,2 con base media** — la MITAD del aparente alargamiento era artefacto. Y Microsoft, que
//    con la ingenua parecía plano, con la corrección BAJA. En pleno auge de capex la versión
//    sin corregir acusa a todo el mundo. Por eso el veredicto usa SIEMPRE la base media.
//
// **2. EL CAMBIO DE MEZCLA, que la corrección NO arregla.** Un centro de datos son dos cosas
//    con vidas opuestas: el edificio (décadas) y los servidores (pocos años). Si una empresa
//    desplaza su inversión hacia obra civil, su vida útil implícita SUBE sin que nadie haya
//    tocado una estimación contable. Es un cambio real de negocio, no un maquillaje.
//
//    **Esta métrica NO puede distinguir las dos cosas**, y hay que decirlo al publicar. Lo que
//    hace es señalar dónde mirar la nota contable, no acusar. Una señal que no puede separar
//    «cambió el criterio» de «cambió lo que compra» no es una acusación: es una pregunta.
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaVidaUtil {
  ticker?: string;
  /** Gasto por depreciación del ejercicio (flujo anual, positivo). */
  depreciacion?: number | null;
  /** Inmovilizado BRUTO al cierre y a la apertura del ejercicio. */
  brutoFin?: number | null;
  brutoIni?: number | null;
  /** El ejercicio anterior, para poder ver el CAMBIO — que es lo único que informa. */
  prev?: { depreciacion?: number | null; brutoFin?: number | null; brutoIni?: number | null } | null;
}

export const UMBRALES_VIDA = {
  /** Vidas fuera de esta banda son casi siempre un problema de datos, no una política contable. */
  vidaMin: 2, vidaMax: 40,
  /** Alargamiento relativo interanual a partir del cual se señala. */
  extensionMinima: 0.10,
  /** Por encima de este crecimiento del activo, ni la base media corrige del todo: se avisa. */
  crecimientoRuidoso: 0.50,
} as const;

export interface VidaUtil {
  /** `bruto al cierre / depreciación`. Se expone SÓLO para poder enseñar el sesgo. */
  vidaIngenua: number | null;
  /** `bruto MEDIO / depreciación`. **Ésta es la que manda.** */
  vidaCorregida: number | null;
  crecimientoActivo: number | null;
  /** Cuánto exagera la fórmula ingenua, en años. */
  sesgoCrecimiento: number | null;
  vidaPrevia: number | null;
  cambio: number | null;
  cambioRelativo: number | null;
  /** Beneficio que la extensión añade al año, si la hay: `bruto × (1/L₀ − 1/L₁)`. */
  beneficioInflado: number | null;
  /** El crecimiento del activo es tan alto que ni la base media corrige bien. */
  ruidoso: boolean;
  fuera: boolean;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;

function vidaDe(dep: number | null, fin: number | null, ini: number | null): number | null {
  const d = num(dep), f = num(fin);
  if (d == null || f == null || d <= 0) return null;
  const i = num(ini);
  // Sin la apertura NO se cae a la fórmula ingenua en silencio: se devuelve null. Dar el
  // número sesgado disfrazado del bueno es peor que no dar ninguno.
  if (i == null) return null;
  return ((f + i) / 2) / d;
}

export function vidaUtil(e: EntradaVidaUtil): VidaUtil {
  const d = num(e.depreciacion), f = num(e.brutoFin), i = num(e.brutoIni);
  const vidaIngenua = d != null && f != null && d > 0 ? f / d : null;
  const vidaCorregida = vidaDe(d, f, i);
  const crecimientoActivo = f != null && i != null ? f / i - 1 : null;
  const vidaPrevia = e.prev ? vidaDe(e.prev.depreciacion ?? null, e.prev.brutoFin ?? null, e.prev.brutoIni ?? null) : null;

  const cambio = vidaCorregida != null && vidaPrevia != null ? vidaCorregida - vidaPrevia : null;
  const cambioRelativo = cambio != null && vidaPrevia ? cambio / vidaPrevia : null;

  // El beneficio que aparece por el alargamiento: la depreciación que YA NO se contabiliza.
  // Se calcula sobre la base media, coherente con la vida que la sostiene.
  const base = f != null && i != null ? (f + i) / 2 : null;
  const beneficioInflado = base != null && vidaCorregida != null && vidaPrevia != null && cambio != null && cambio > 0
    ? base * (1 / vidaPrevia - 1 / vidaCorregida) : null;

  const fuera = vidaCorregida != null &&
    (vidaCorregida < UMBRALES_VIDA.vidaMin || vidaCorregida > UMBRALES_VIDA.vidaMax);

  return {
    vidaIngenua: vidaIngenua, vidaCorregida, crecimientoActivo,
    sesgoCrecimiento: vidaIngenua != null && vidaCorregida != null ? vidaIngenua - vidaCorregida : null,
    vidaPrevia, cambio, cambioRelativo, beneficioInflado,
    ruidoso: crecimientoActivo != null && crecimientoActivo > UMBRALES_VIDA.crecimientoRuidoso,
    fuera,
  };
}

export interface SeñalVida {
  clave: "vida_util_alargada" | "vida_util_acortada";
  gravedad: "aviso" | "alerta";
  texto: string;
  evidencia: Record<string, number>;
}

/**
 * La señal. **Siempre es «aviso», nunca «alerta»**, y esto es deliberado: la métrica no puede
 * separar un cambio de criterio contable de un cambio en lo que la empresa compra. Marcarla
 * como alerta sería acusar con una prueba que no distingue las dos cosas.
 *
 * Acortar la vida útil también se señala. Es lo contrario de un maquillaje —reconoce más gasto
 * y baja el beneficio— y por eso mismo informa: Amazon lo hizo en 2025 citando «el ritmo de
 * desarrollo tecnológico, particularmente en inteligencia artificial».
 */
export function señalesVida(v: VidaUtil): SeñalVida[] {
  const out: SeñalVida[] = [];
  if (v.fuera || v.cambioRelativo == null || v.vidaPrevia == null || v.vidaCorregida == null) return out;

  const pp = (x: number) => x.toFixed(1);
  if (v.cambioRelativo >= UMBRALES_VIDA.extensionMinima) {
    out.push({
      clave: "vida_util_alargada", gravedad: "aviso",
      texto: `La vida útil implícita de su inmovilizado pasa de ${pp(v.vidaPrevia)} a ${pp(v.vidaCorregida)} años` +
        (v.beneficioInflado != null ? `, lo que reduce el gasto por depreciación y sube el beneficio declarado sin que entre caja` : "") +
        `. Puede ser un cambio de criterio contable o simplemente que ahora compra activos de vida más larga: esta medida NO las distingue.` +
        (v.ruidoso ? " Y su activo crece tan rápido que la cifra es especialmente ruidosa." : ""),
      evidencia: {
        vidaAntes: +v.vidaPrevia.toFixed(2), vidaAhora: +v.vidaCorregida.toFixed(2),
        cambioPct: +(v.cambioRelativo * 100).toFixed(1),
        ...(v.beneficioInflado != null ? { beneficioAnadido: Math.round(v.beneficioInflado) } : {}),
        ...(v.crecimientoActivo != null ? { crecimientoActivoPct: +(v.crecimientoActivo * 100).toFixed(1) } : {}),
      },
    });
  } else if (v.cambioRelativo <= -UMBRALES_VIDA.extensionMinima) {
    out.push({
      clave: "vida_util_acortada", gravedad: "aviso",
      texto: `La vida útil implícita baja de ${pp(v.vidaPrevia)} a ${pp(v.vidaCorregida)} años: reconoce MÁS gasto por depreciación ` +
        `y por tanto menos beneficio. Es lo contrario de un maquillaje, y suele señalar que la empresa espera que sus activos se queden obsoletos antes.`,
      evidencia: {
        vidaAntes: +v.vidaPrevia.toFixed(2), vidaAhora: +v.vidaCorregida.toFixed(2),
        cambioPct: +(v.cambioRelativo * 100).toFixed(1),
      },
    });
  }
  return out;
}
