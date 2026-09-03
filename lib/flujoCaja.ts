// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA DE CAJA — «lo que no es caja, no vale»
//
// El beneficio y la caja divergen por el **principio de devengo**: la cuenta de resultados
// reconoce ingresos que aún no se han cobrado (cuentas por cobrar) y gastos que ya se pagaron
// hace años (depreciación). Por eso una empresa puede batir estimaciones y caer en bolsa.
//
// Este módulo hace tres cosas, en orden de coste:
//   1. **Diagnóstico** — los ratios que dicen si el beneficio se convierte en caja.
//   2. **Banderas rojas** — las señales concretas de que algo no cuadra.
//   3. **El puente** — beneficio neto → CFO por el método indirecto, para poder enseñarlo.
//
// ⚠️ **TRES REGLAS QUE GOBIERNAN TODO EL FICHERO**, y las tres vienen de haberlas roto antes:
//
//   · **Un dato que falta es `null`, jamás 0.** Un cero dice «esta empresa no recompra acciones»;
//     `null` dice «no lo sé». Confundirlos es lo que convirtió 36 meses de crisis en meses planos
//     en el backtest del allocator.
//   · **Los bancos no tienen FCF.** «CFO − capex» no significa nada en una entidad financiera:
//     su capex no es su inversión y su circulante es su negocio. Se detecta y se dice, no se
//     calcula igualmente.
//   · **Si el desglose no cuadra con la variación de caja, no se publica.** Mismo listón que el
//     Sankey de resultados y que la atribución de Brinson.
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que hace falta de `fundamentalsAsOf`. Todo opcional: la mitad del trabajo es la ausencia. */
export interface EntradaCaja {
  ticker?: string;
  niTTM?: number | null; ocfTTM?: number | null; capexTTM?: number | null;
  daTTM?: number | null; sbcTTM?: number | null; revTTM?: number | null;
  buybacksTTM?: number | null; dividendsTTM?: number | null;
  cfiTTM?: number | null; cffTTM?: number | null; acqCostTTM?: number | null;
  deltaCashTTM?: number | null; deltaCashConFxTTM?: number | null;
  fxCashTTM?: number | null; cash?: number | null;
  receivables?: number | null; inventory?: number | null;
  curA?: number | null; curL?: number | null;
  /** Métricas de mercado, para los múltiplos. */
  marketCap?: number | null;
  /** Señales de que es una entidad financiera: para esas, el FCF no significa nada. */
  deposits?: number | null; loans?: number | null; premiumsTTM?: number | null;
  /**
   * Sector, si el llamante lo conoce (`sicSector` de edgar.mjs). Sólo se usa para NO leer un
   * negocio regulado con la plantilla de una industrial — ver `banderas`.
   */
  sector?: string | null;
  prev?: { revTTM?: number | null; receivables?: number | null; inventory?: number | null;
           ocfTTM?: number | null; niTTM?: number | null } | null;
}

/** ¿Es una entidad financiera? Para ellas el FCF no es un concepto con sentido. */
export function esFinanciera(f: EntradaCaja): boolean {
  return (f.deposits ?? 0) > 0 || (f.loans ?? 0) > 0 || (f.premiumsTTM ?? 0) > 0;
}

export interface Diagnostico {
  /** CFO ÷ beneficio neto. > 1 = el beneficio se convierte en caja y sobra. */
  cashConversion: number | null;
  /** CFO ÷ ventas. Cuanto más alto y más creciente, mejor. */
  margenCFO: number | null;
  /** CFO − capex. `null` en financieras: ahí no significa nada. */
  fcf: number | null;
  margenFCF: number | null;
  /** FCF ÷ capitalización. El vídeo sitúa lo atractivo a partir del 4-5 %. */
  fcfYield: number | null;
  /** Capitalización ÷ CFO. El sustituto del PER que no depende del devengo. */
  precioSobreCFO: number | null;
  capexSobreVentas: number | null;
  /** Crecimiento del CFO frente al del beneficio: si divergen, el beneficio pierde calidad. */
  crecimientoCFO: number | null;
  crecimientoBeneficio: number | null;
  financiera: boolean;
}

const div = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a == null || b == null || b === 0 ? null : a / b;

export function diagnosticar(f: EntradaCaja): Diagnostico {
  const fin = esFinanciera(f);
  // ⚠️ El FCF de un banco no se calcula: se declara que no aplica. Devolver un número aquí sería
  // dar una cifra con forma de respuesta a una pregunta que no tiene sentido.
  const fcf = fin || f.ocfTTM == null || f.capexTTM == null ? null : f.ocfTTM - f.capexTTM;
  const crec = (act: number | null | undefined, ant: number | null | undefined) =>
    act == null || ant == null || ant === 0 ? null : (act - ant) / Math.abs(ant);
  return {
    cashConversion: div(f.ocfTTM, f.niTTM),
    margenCFO: div(f.ocfTTM, f.revTTM),
    fcf,
    margenFCF: div(fcf, f.revTTM),
    fcfYield: div(fcf, f.marketCap),
    precioSobreCFO: div(f.marketCap, f.ocfTTM),
    capexSobreVentas: fin ? null : div(f.capexTTM, f.revTTM),
    crecimientoCFO: crec(f.ocfTTM, f.prev?.ocfTTM),
    crecimientoBeneficio: crec(f.niTTM, f.prev?.niTTM),
    financiera: fin,
  };
}

export type Gravedad = "aviso" | "alerta";

export interface Bandera {
  clave: string;
  gravedad: Gravedad;
  texto: string;
  /** Los números que la sostienen, para que se pueda comprobar sin creerse nada. */
  evidencia: Record<string, number>;
}

/**
 * Las banderas rojas.
 *
 * ⚠️ **CADA UMBRAL ESTÁ ESCRITO Y ES DISCUTIBLE, y por eso se declara aquí arriba en vez de
 * esconderse dentro de un `if`.** No son leyes: son los cortes que el material de referencia
 * propone. Cambiarlos es una decisión de producto que hay que tomar a la vista.
 */
export const UMBRALES = {
  /** Por debajo de esto, el beneficio no se está convirtiendo en caja. */
  cashConversionMala: 0.8,
  /** Cobros o inventario creciendo esto por encima de las ventas: algo se está atascando. */
  exceso: 0.15,
  /** La retribución al accionista sobre el FCF, por encima de la cual no se autofinancia. */
  retribucionSobreFCF: 1.0,
  /** Capex sobre ventas por encima del cual conviene mirar si da retorno. */
  capexAlto: 0.20,
} as const;

export function banderas(f: EntradaCaja, d = diagnosticar(f)): Bandera[] {
  const out: Bandera[] = [];
  const pon = (clave: string, gravedad: Gravedad, texto: string, evidencia: Record<string, number>) =>
    out.push({ clave, gravedad, texto, evidencia });

  // 1 · El beneficio no se convierte en caja.
  //
  // ⚠️ **NO SE APLICA A FINANCIERAS, y la prueba lo cazo.** JPMorgan salia con una conversion de
  // -1,83 y bandera roja: en un banco el flujo de caja operativo NEGATIVO es normal, porque
  // conceder prestamos ES su operacion y se contabiliza como salida de caja operativa. Marcar eso
  // como "el beneficio no se convierte en caja" es leer un estado financiero con la plantilla
  // equivocada — el mismo error que calcular el FCF de un banco.
  if (!d.financiera && d.cashConversion != null && d.cashConversion < UMBRALES.cashConversionMala) {
    pon("conversion_baja", "alerta",
      `El beneficio no se está convirtiendo en caja: por cada euro de beneficio entran ${d.cashConversion.toFixed(2)} de caja operativa.`,
      { cashConversion: +d.cashConversion.toFixed(3) });
  }

  // 2 · Los cobros crecen mucho más que las ventas: se vende, pero no se cobra.
  const crecVentas = f.revTTM != null && f.prev?.revTTM ? (f.revTTM - f.prev.revTTM) / Math.abs(f.prev.revTTM) : null;
  const crecCobros = f.receivables != null && f.prev?.receivables ? (f.receivables - f.prev.receivables) / Math.abs(f.prev.receivables) : null;
  if (!d.financiera && crecVentas != null && crecCobros != null && crecCobros - crecVentas > UMBRALES.exceso) {
    pon("cobros_disparados", "alerta",
      `Las cuentas por cobrar crecen ${(100 * crecCobros).toFixed(0)} % y las ventas ${(100 * crecVentas).toFixed(0)} %: se está vendiendo más rápido de lo que se cobra.`,
      { crecimientoCobros: +crecCobros.toFixed(3), crecimientoVentas: +crecVentas.toFixed(3) });
  }

  // 3 · El inventario se acumula: se compra y no se vende.
  const crecInv = f.inventory != null && f.prev?.inventory ? (f.inventory - f.prev.inventory) / Math.abs(f.prev.inventory) : null;
  if (!d.financiera && crecVentas != null && crecInv != null && crecInv - crecVentas > UMBRALES.exceso) {
    pon("inventario_acumulado", "aviso",
      `El inventario crece ${(100 * crecInv).toFixed(0)} % frente a unas ventas que crecen ${(100 * crecVentas).toFixed(0)} %: se está acumulando mercancía sin vender.`,
      { crecimientoInventario: +crecInv.toFixed(3), crecimientoVentas: +crecVentas.toFixed(3) });
  }

  // ⚠️ **UNA UTILITY REGULADA TIENE FCF NEGATIVO POR DISEÑO, y ejecutarlo lo demostró.** En la
  // primera pasada sobre 60 nombres salieron marcadas AEE, AES, ATO y AWK —eléctricas y aguas—
  // por «repartir dividendo con FCF negativo». Pero ése ES su modelo: se endeudan para construir
  // infraestructura y pagan dividendo del retorno que el regulador les garantiza. La señal es
  // cierta como hecho y ENGAÑOSA como alarma, así que baja a aviso y se explica. Es la misma
  // lección que los bancos: no se lee un estado financiero con la plantilla de otro sector.
  const regulada = /utilit|servicios p|real estate|inmobiliar/i.test(f.sector ?? "");
  const gravedadRetribucion: Gravedad = regulada ? "aviso" : "alerta";
  const notaRegulada = regulada
    ? " En un negocio regulado e intensivo en capital esto es habitual: la inversión se financia con deuda y el dividendo sale del retorno regulado."
    : "";

  // 4 · **La bandera del manual**: se devuelve al accionista más de lo que el negocio genera.
  //     Ese exceso sale de la caja acumulada o de deuda nueva; en ninguno de los dos casos es
  //     sostenible, y es lo que ningún panel para inversor particular enseña.
  const retribucion = (f.buybacksTTM ?? 0) + (f.dividendsTTM ?? 0);
  if (d.fcf != null && d.fcf > 0 && retribucion > 0 && retribucion / d.fcf > UMBRALES.retribucionSobreFCF) {
    pon("retribucion_no_autofinanciada", gravedadRetribucion,
      `Recompras y dividendos suman ${(retribucion / 1e9).toFixed(1)} B$ frente a un flujo de caja libre de ${(d.fcf / 1e9).toFixed(1)} B$: se está devolviendo más de lo que el negocio genera.${notaRegulada}`,
      { retribucion, fcf: d.fcf, veces: +(retribucion / d.fcf).toFixed(2) });
  }
  // Y el caso extremo: FCF negativo mientras se sigue retribuyendo.
  if (d.fcf != null && d.fcf <= 0 && retribucion > 0) {
    pon("retribucion_con_fcf_negativo", gravedadRetribucion,
      `Se reparten ${(retribucion / 1e9).toFixed(1)} B$ entre recompras y dividendos con un flujo de caja libre NEGATIVO (${(d.fcf / 1e9).toFixed(1)} B$).${notaRegulada}`,
      { retribucion, fcf: d.fcf });
  }

  // 5 · Capex alto que aún no se traduce en más caja operativa.
  if (d.capexSobreVentas != null && d.capexSobreVentas > UMBRALES.capexAlto &&
      d.crecimientoCFO != null && d.crecimientoCFO <= 0) {
    pon("capex_sin_retorno", "aviso",
      `La inversión se lleva el ${(100 * d.capexSobreVentas).toFixed(0)} % de las ventas y la caja operativa no crece (${(100 * d.crecimientoCFO).toFixed(0)} %). Habrá que ver si esa inversión da retorno.`,
      { capexSobreVentas: +d.capexSobreVentas.toFixed(3), crecimientoCFO: +d.crecimientoCFO.toFixed(3) });
  }

  return out;
}

export interface Puente {
  pasos: { concepto: string; importe: number; tipo: "inicio" | "suma" | "resta" | "fin" }[];
  /** Lo que no explican los conceptos conocidos. Se muestra, no se reparte. */
  sinExplicar: number;
  /** `true` si los pasos conocidos explican al menos el 80 % del salto. */
  suficiente: boolean;
}

/**
 * El puente del beneficio a la caja operativa (método indirecto).
 *
 * ⚠️ **NO SE PUEDE CERRAR DEL TODO Y NO SE FINGE QUE SÍ.** El estado de flujos real trae decenas
 * de ajustes —impuestos diferidos, provisiones, resultados de participadas— que `companyfacts`
 * no desglosa. Aquí se muestran los tres grandes (D&A, compensación en acciones y circulante) y
 * **el resto se etiqueta como «otros ajustes», con su importe**. Repartirlo entre los conocidos
 * para que cuadre sería inventar la explicación.
 */
export function puente(f: EntradaCaja): Puente | null {
  if (f.niTTM == null || f.ocfTTM == null) return null;
  const pasos: Puente["pasos"] = [{ concepto: "Beneficio neto", importe: f.niTTM, tipo: "inicio" }];
  let acc = f.niTTM;
  if (f.daTTM != null) { pasos.push({ concepto: "Depreciación y amortización", importe: f.daTTM, tipo: "suma" }); acc += f.daTTM; }
  if (f.sbcTTM != null) { pasos.push({ concepto: "Compensación en acciones", importe: f.sbcTTM, tipo: "suma" }); acc += f.sbcTTM; }

  // Circulante operativo: lo que el negocio inmoviliza (o libera) en cobros e inventario.
  const dCobros = f.receivables != null && f.prev?.receivables != null ? f.receivables - f.prev.receivables : null;
  const dInv = f.inventory != null && f.prev?.inventory != null ? f.inventory - f.prev.inventory : null;
  if (dCobros != null && dCobros !== 0) { pasos.push({ concepto: "Variación de cuentas por cobrar", importe: -dCobros, tipo: dCobros > 0 ? "resta" : "suma" }); acc -= dCobros; }
  if (dInv != null && dInv !== 0) { pasos.push({ concepto: "Variación de inventario", importe: -dInv, tipo: dInv > 0 ? "resta" : "suma" }); acc -= dInv; }

  const sinExplicar = f.ocfTTM - acc;
  if (Math.abs(sinExplicar) > 1) {
    pasos.push({ concepto: "Otros ajustes (no desglosados)", importe: sinExplicar, tipo: sinExplicar >= 0 ? "suma" : "resta" });
  }
  pasos.push({ concepto: "Flujo de caja operativo", importe: f.ocfTTM, tipo: "fin" });

  const salto = Math.abs(f.ocfTTM - f.niTTM);
  return { pasos, sinExplicar, suficiente: salto === 0 ? true : Math.abs(sinExplicar) / salto <= 0.2 };
}

export interface DestinoCaja {
  bloques: { concepto: string; importe: number }[];
  cfo: number;
  variacionCalculada: number;
  variacionDeclarada: number | null;
  residuo: number | null;
  cuadra: boolean;
}

/**
 * A dónde va la caja: el Sankey de caja.
 *
 * ⚠️ **EL CRITERIO ES EL CUADRE.** CFO + inversión + financiación + divisa tiene que dar la
 * variación de caja que la empresa declara. Si no cuadra, no se publica — el mismo listón que el
 * Sankey de resultados y que la atribución de Brinson.
 */
export function destino(f: EntradaCaja, tolerancia = 0.02): DestinoCaja | null {
  if (f.ocfTTM == null) return null;
  const bloques: DestinoCaja["bloques"] = [];
  const add = (concepto: string, importe: number | null | undefined) => {
    if (importe != null && importe !== 0) bloques.push({ concepto, importe });
  };
  add("Inversión (CFI)", f.cfiTTM);
  add("Financiación (CFF)", f.cffTTM);
  add("Efecto del tipo de cambio", f.fxCashTTM);

  const variacionCalculada = f.ocfTTM + bloques.reduce((s, b) => s + b.importe, 0);
  const variacionDeclarada = f.deltaCashConFxTTM ?? f.deltaCashTTM ?? null;
  const residuo = variacionDeclarada == null ? null : variacionDeclarada - variacionCalculada;
  const escala = Math.max(Math.abs(f.ocfTTM), 1);
  return {
    bloques, cfo: f.ocfTTM, variacionCalculada, variacionDeclarada, residuo,
    cuadra: residuo == null ? false : Math.abs(residuo) / escala <= tolerancia,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EL SANKEY DE CAJA — el gemelo del de resultados
//
// Aquel contaba cómo se gana el dinero; éste cuenta **a dónde va**. La cadena que lo hace
// comprobable en vez de decorativo es la identidad del estado de flujos:
//
//     CFO + inversión + financiación + efecto divisa = variación de la caja
//
// ⚠️ MISMO LISTÓN QUE SU HERMANO, y por la misma razón: la tentación de un Sankey es
// escalar las barras para que encajen. Queda bonito y miente. Aquí lo que no se puede
// atribuir a un concepto conocido se dibuja como **«resto»** con su tamaño real y NUNCA se
// reparte entre los demás. Si `cuadra` es falso, no se publica.
//
// La granularidad sale de lo que EDGAR expone de verdad: dentro de la inversión sabemos el
// capex; dentro de la financiación, recompras y dividendos. Lo demás —adquisiciones, compra
// y venta de inversiones financieras, emisión y amortización de deuda— va agregado en su
// «resto», que es honesto: son bloques que existen, no huecos.
// ─────────────────────────────────────────────────────────────────────────────

export interface FlujoCaja {
  concepto: string;
  /** Magnitud siempre POSITIVA: el sentido lo dice `lado`, no el signo. */
  valor: number;
  lado: "origen" | "destino";
  clase: "operacion" | "inversion" | "financiacion" | "divisa" | "caja" | "resto";
}

export interface SankeyCaja {
  nivel: "completo" | "minimo" | "sin_datos";
  flujos: FlujoCaja[];
  cfo: number;
  variacionDeclarada: number | null;
  residuo: number | null;
  /** Si es falso, NO se publica. Mismo criterio que el Sankey de resultados. */
  cuadra: boolean;
  /** Un banco no tiene esta lectura: su CFO negativo es la operación, no una fuga. */
  financiera: boolean;
}

/**
 * Construye el diagrama. `nivel`:
 *   · `completo` — hay capex Y alguna partida de retribución al accionista.
 *   · `minimo`   — hay CFO y los agregados, pero sin desglose fino. Se dibuja igual.
 *   · `sin_datos`— no hay ni CFO. Se dice, no se rellena.
 */
export function sankeyCaja(f: EntradaCaja, tolerancia = 0.02): SankeyCaja {
  const d = destino(f, tolerancia);
  if (!d) return { nivel: "sin_datos", flujos: [], cfo: 0, variacionDeclarada: null,
                   residuo: null, cuadra: false, financiera: esFinanciera(f) };

  const flujos: FlujoCaja[] = [];
  const push = (concepto: string, valor: number | null | undefined,
                lado: FlujoCaja["lado"], clase: FlujoCaja["clase"]) => {
    if (valor != null && Math.abs(valor) > 0) flujos.push({ concepto, valor: Math.abs(valor), lado, clase });
  };

  // ── ORIGEN. Un CFO negativo no es un destino con signo: es que el negocio CONSUME caja,
  // y entonces la historia que cuenta el diagrama es de dónde sale ese dinero.
  if (d.cfo >= 0) push("Flujo de explotación", d.cfo, "origen", "operacion");
  else push("El negocio consume caja", d.cfo, "destino", "operacion");

  // ── INVERSIÓN. `capexTTM` viene como magnitud positiva; el resto de la inversión es lo
  // que queda del agregado, y puede ser entrada (vender inversiones) o salida.
  const capex = f.capexTTM ?? null;
  const cfi = f.cfiTTM ?? null;
  if (capex != null) push("Capex", capex, "destino", "inversion");
  if (cfi != null) {
    const resto = cfi + (capex ?? 0);   // cfi es negativo cuando sale caja
    push(capex == null ? "Inversión (sin desglosar)" : "Resto de inversión",
         resto, resto < 0 ? "destino" : "origen", capex == null ? "inversion" : "resto");
  }

  // ── FINANCIACIÓN. Recompras y dividendos son lo que el vídeo llama la retribución; el
  // resto es sobre todo deuda, y su SIGNO es la mitad de la historia: endeudarse es un
  // origen de caja, amortizar un destino.
  const buy = f.buybacksTTM ?? null, div = f.dividendsTTM ?? null;
  const cff = f.cffTTM ?? null;
  push("Recompras", buy, "destino", "financiacion");
  push("Dividendos", div, "destino", "financiacion");
  if (cff != null) {
    const retribucion = (buy ?? 0) + (div ?? 0);
    const resto = cff + retribucion;
    const sinDesglose = buy == null && div == null;
    push(sinDesglose ? "Financiación (sin desglosar)" : "Resto de financiación (deuda)",
         resto, resto < 0 ? "destino" : "origen", sinDesglose ? "financiacion" : "resto");
  }

  push("Efecto del tipo de cambio", f.fxCashTTM, (f.fxCashTTM ?? 0) < 0 ? "destino" : "origen", "divisa");

  // ── EL CIERRE. La variación de caja es lo que queda, y se dibuja con su signo real: si la
  // caja BAJA, es un origen más (se tiró de hucha), no un destino.
  const v = d.variacionDeclarada ?? d.variacionCalculada;
  push(v >= 0 ? "Aumento de la caja" : "Reducción de la caja", v, v >= 0 ? "destino" : "origen", "caja");

  // ⚠️ EL BLOQUE QUE HACE QUE EL DIBUJO NO MIENTA, y que el test sintético no podía pedir
  // porque ahí el residuo siempre era cero. Sobre datos reales SIEMPRE hay residuo: la
  // variación que la empresa DECLARA casi nunca es exactamente la suma de sus tres flujos
  // —redondeos, caja restringida, equivalentes reclasificados—. Medido: 16 de 60 diagramas
  // del S&P 500 no cerraban por esto, todos dentro de la tolerancia del 2 %.
  //
  // Se dibuja con su tamaño real y del lado que corresponde, exactamente igual que el
  // «No desglosado» del Sankey de resultados. Repartirlo entre los demás para que encaje es
  // la forma bonita de mentir; enseñarlo es lo que convierte el hueco en información.
  if (d.residuo != null && d.residuo !== 0)
    push("No explicado", d.residuo, d.residuo > 0 ? "origen" : "destino", "resto");

  const tieneDesglose = capex != null && (buy != null || div != null);
  const nivel: SankeyCaja["nivel"] = tieneDesglose ? "completo" : "minimo";
  return { nivel, flujos, cfo: d.cfo, variacionDeclarada: d.variacionDeclarada,
           residuo: d.residuo, cuadra: d.cuadra, financiera: esFinanciera(f) };
}
