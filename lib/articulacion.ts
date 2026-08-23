// ─────────────────────────────────────────────────────────────────────────────
// ARTICULACIÓN CONTABLE — la partida doble usada como TEST DE DATOS.
//
// Todo asiento tiene un cargo y un abono por el mismo importe. De ahí sale que
// `Activo = Pasivo + Patrimonio`, y de ahí sale algo mucho más útil para un sistema que
// ingiere estados financieros de terceros: **las cifras tienen que atar entre sí**. Si no
// atan, o el dato está mal o se están mezclando contextos, y cualquier ratio construido
// encima es un número creíble y equivocado.
//
// POR QUÉ ESTO EXISTE. Este repositorio tiene un historial concreto de fallos que no rompen
// nada: `EA` con 6 barras de precio en vez de 2.054, `BK` cotizando a 14,79 $ que eran de
// otro instrumento, `BRK.B` invisible por falta de CIK. Ninguno dio un error. Los tres
// habrían necesitado justo esto: una comprobación que diga "estas cifras no pueden ser
// ciertas a la vez".
//
// NO ES UNA SEÑAL Y NO PREDICE NADA. Es control de calidad del dato. Un nombre que no
// articula no es una mala empresa: es una empresa cuyos números no nos podemos creer.
//
// Puro y sin dependencias (igual que `lib/quality.ts`) para que la app, el backtest y los
// tests compartan una sola definición.
// ─────────────────────────────────────────────────────────────────────────────

const num = (x: number | null | undefined): x is number => x != null && isFinite(x);

/**
 * TOLERANCIAS, y no son de manual: están fijadas después de medir sobre las 586 empresas en
 * caché (2026-08-22). Ver `research/articulacion_lab.mjs`, que las recalcula.
 *
 * No son iguales porque las cuatro identidades no son igual de exigibles:
 *
 *  · El BALANCE es una identidad exacta. Sólo debería fallar si el dato está mal.
 *  · La CAJA arrastra el efecto del tipo de cambio sobre los saldos, que unos presentadores
 *    meten en el propio tag de variación y otros no.
 *  · El PATRIMONIO es el más ruidoso con diferencia: entre un ejercicio y otro se mueve por
 *    resultado global (OCI), pagos en acciones, ejercicio de opciones, conversiones... El
 *    roll-forward simple (resultado − dividendos − recompras) NO pretende cuadrar al 1 %.
 *  · El MARGEN BRUTO es aritmética pura cuando están las tres magnitudes.
 */
export const TOLERANCIA = {
  balance: 0.01,
  caja: 0.05,
  patrimonio: 0.25,
  margen: 0.01,
} as const;

export type IdComprobacion = "balance" | "caja" | "patrimonio" | "margen";

export interface Comprobacion {
  id: IdComprobacion;
  /** `null` = no se pudo comprobar (faltan magnitudes). No es un fallo: es un hueco. */
  ok: boolean | null;
  /** Lado izquierdo y derecho de la identidad, en la moneda de presentación. */
  izq: number | null;
  der: number | null;
  /** Desviación relativa |izq−der| / |izq|. `null` si no es comprobable. */
  desvio: number | null;
  /** Por qué no se pudo comprobar, o por qué falla. Nunca un fallo sin explicación. */
  motivo: string;
}

export type Confianza = "alta" | "media" | "baja";

export interface ArticulacionInputs {
  // A1 · balance
  assets?: number | null;
  liabilities?: number | null;
  equity?: number | null;
  minorityInterest?: number | null;
  /** Mezzanine: minoritarios rescatables y acciones rescatables, que en US GAAP van FUERA
   *  del patrimonio permanente. Tercer sumando de la identidad, no un detalle. */
  temporaryEquity?: number | null;
  // A2 · caja. `fxCash` es el CUARTO sumando y no es opcional por gusto: el saldo de caja
  // incluye lo que el tipo de cambio hace con los saldos en divisa, que no es un flujo de
  // explotación, inversión ni financiación. Sin él, una multinacional "descuadra" por el
  // importe exacto de ese efecto estando perfectamente bien.
  deltaCash?: number | null;
  ocf?: number | null;
  cfi?: number | null;
  cff?: number | null;
  fxCash?: number | null;
  // A3 · patrimonio.
  // `equityFin` es el patrimonio de cierre para ESTA identidad y va aparte de `equity` a
  // propósito: las dos comprobaciones exigen alineaciones distintas (el balance pide que
  // cuadre con activo y pasivo; el roll-forward, que cuadre con el resultado), así que una
  // sola casilla haría que el requisito de una anulara el de la otra.
  equityFin?: number | null;
  equityPrev?: number | null;
  netIncome?: number | null;
  dividends?: number | null;
  buybacks?: number | null;
  // A4 · margen bruto
  revenue?: number | null;
  cost?: number | null;
  grossProfit?: number | null;
}

export interface ArticulacionResult {
  comprobaciones: Comprobacion[];
  /** Cuántas se pudieron comprobar y cuántas pasan. */
  comprobables: number;
  pasan: number;
  /** alta = todo lo comprobable cuadra · media = falla una · baja = falla el balance, o dos+. */
  confianza: Confianza;
  /** Ids que fallan, para poder filtrar sin releer el detalle. */
  fallos: IdComprobacion[];
}

function comparar(
  id: IdComprobacion,
  izq: number | null | undefined,
  der: number | null | undefined,
  tol: number,
  faltan: string,
): Comprobacion {
  if (!num(izq) || !num(der)) {
    return { id, ok: null, izq: num(izq) ? izq : null, der: num(der) ? der : null, desvio: null, motivo: faltan };
  }
  // Un denominador cero no admite desviación relativa; se compara en absoluto contra el otro lado.
  const base = Math.max(Math.abs(izq), Math.abs(der));
  if (base === 0) return { id, ok: true, izq, der, desvio: 0, motivo: "ambos lados son cero" };
  const desvio = Math.abs(izq - der) / base;
  const ok = desvio <= tol;
  return {
    id, izq, der, ok, desvio: Math.round(desvio * 1e6) / 1e6,
    motivo: ok ? "" : `desvía ${(desvio * 100).toFixed(1)} % (tolerancia ${(tol * 100).toFixed(0)} %)`,
  };
}

/**
 * Aplica las cuatro identidades a un paquete de fundamentales.
 *
 * ⚠️ LAS IDENTIDADES COMPLETAS, QUE NO SON LAS DE MANUAL. Construyendo esto se plantearon mal
 * tres veces seguidas, y las tres veces el resultado fue el mismo: decenas de empresas
 * marcadas como defectuosas estando perfectamente bien. Vale la pena dejar escrito cuáles son
 * los sumandos que se olvidan, porque son justo los que no aparecen en la fórmula corta:
 *
 *   1. `Activo = Pasivo + Patrimonio` **+ minoritarios**. `StockholdersEquity` de US GAAP es
 *      lo atribuible a la matriz y deja fuera la parte de terceros en filiales consolidadas
 *      (DaVita, Vornado, SL Green, UDR).
 *   2. …**+ patrimonio temporal** (mezzanine). Las participaciones que el minoritario puede
 *      obligar a recomprar van FUERA del patrimonio permanente por norma (S&P Global,
 *      T. Rowe Price, Henry Schein). Al añadirlo, el balance pasó del 92,5 % al 97,0 %.
 *   3. `ΔCaja = CFO + CFI + CFF` **+ efecto del tipo de cambio**. Ese efecto no es flujo de
 *      nadie, pero sí mueve el saldo. Al añadirlo, la caja pasó del 81,1 % al 93,4 %.
 *
 * Y hay una cuarta trampa, distinta de las tres: comparar magnitudes de CIERRES DISTINTOS.
 * `articularFundamentales` lo evita exigiendo el mapa de periodos; ver su comentario.
 *
 * Una comprobación de integridad mal planteada no detecta problemas: los fabrica.
 */
export function articular(inp: ArticulacionInputs): ArticulacionResult {
  const pasivoMasNeto =
    num(inp.liabilities) && num(inp.equity)
      ? inp.liabilities + inp.equity
        + (num(inp.minorityInterest) ? inp.minorityInterest : 0)
        + (num(inp.temporaryEquity) ? inp.temporaryEquity : 0)
      : null;

  const flujoNeto = num(inp.ocf) && num(inp.cfi) && num(inp.cff)
    ? inp.ocf + inp.cfi + inp.cff + (num(inp.fxCash) ? inp.fxCash : 0)
    : null;

  const netoEsperado =
    num(inp.equityPrev) && num(inp.netIncome)
      ? inp.equityPrev + inp.netIncome - (num(inp.dividends) ? inp.dividends : 0) - (num(inp.buybacks) ? inp.buybacks : 0)
      : null;

  const brutoEsperado = num(inp.revenue) && num(inp.cost) ? inp.revenue - inp.cost : null;

  const comprobaciones: Comprobacion[] = [
    comparar("balance", inp.assets, pasivoMasNeto, TOLERANCIA.balance,
      "falta activo, pasivo o patrimonio al mismo cierre"),
    comparar("caja", inp.deltaCash, flujoNeto, TOLERANCIA.caja,
      "falta la variación de caja o alguno de los tres flujos"),
    comparar("patrimonio", inp.equityFin ?? inp.equity, netoEsperado, TOLERANCIA.patrimonio,
      "falta el patrimonio del ejercicio anterior o el resultado"),
    comparar("margen", inp.grossProfit, brutoEsperado, TOLERANCIA.margen,
      "falta margen bruto, ingresos o coste de ventas"),
  ];

  const evaluadas = comprobaciones.filter((c) => c.ok !== null);
  const fallos = evaluadas.filter((c) => c.ok === false).map((c) => c.id);
  // El balance pesa más que las otras: es la única identidad exacta, así que si falla ÉL, el
  // paquete entero es sospechoso aunque las demás cuadren.
  const confianza: Confianza = fallos.includes("balance") || fallos.length >= 2 ? "baja" : fallos.length === 1 ? "media" : "alta";

  return { comprobaciones, comprobables: evaluadas.length, pasan: evaluadas.length - fallos.length, confianza, fallos };
}

/**
 * Adaptador desde un paquete de `fundamentalsAsOf()` (+ el del ejercicio anterior, opcional).
 *
 * Vive aquí y no en cada script por el mismo motivo que `picksSignal.mjs`: si el laboratorio
 * y la app mapearan los campos por su cuenta, podrían medir cosas distintas sin que nada
 * fallara.
 */
export function articularFundamentales(f: Record<string, unknown>, fPrev?: Record<string, unknown> | null): ArticulacionResult {
  const n = (k: string, src: Record<string, unknown> | null | undefined = f): number | null => {
    const v = src?.[k];
    return typeof v === "number" && isFinite(v) ? v : null;
  };

  // ── ALINEACIÓN DE PERIODOS ──────────────────────────────────────────────────────────────
  // Una identidad contable sólo se puede exigir entre magnitudes del MISMO cierre. `flowTTM`
  // e `instant` eligen la ventana más reciente de cada tag por separado, así que el activo
  // puede ser de junio y el pasivo de marzo. Restarlos y llamar "descuadre" a la diferencia
  // no detecta un problema: lo inventa. Medido antes de poner esto, el margen bruto "fallaba"
  // en el 36 % de los nombres y eran todas alarmas falsas.
  //
  // Lo que no está alineado se pasa como `null`, y `comparar()` lo declara NO COMPROBABLE.
  // No comprobable y erróneo no son lo mismo, y confundirlos es lo que hace inútil a un
  // control de calidad.
  const per = (f?.periodos ?? {}) as Record<string, string | null>;
  const alineado = (...claves: string[]): boolean => {
    const fechas = claves.map((k) => per[k]).filter((x): x is string => !!x);
    if (fechas.length !== claves.length) return false;
    return fechas.every((x) => x === fechas[0]);
  };
  /** Devuelve el valor sólo si todas las magnitudes de la identidad son del mismo corte. */
  const si = (cond: boolean, v: number | null): number | null => (cond ? v : null);

  const okBalance = alineado("assets", "liabilities", "equity");
  const okCaja = alineado("deltaCash", "ocf", "cfi", "cff");
  const okMargen = alineado("gp", "rev", "cost");
  // El patrimonio compara dos FOTOS distintas por definición (la de ahora y la de hace un
  // año), así que aquí sólo se exige que el resultado y el patrimonio actual vayan juntos.
  const okNeto = alineado("equity", "ni");

  return articular({
    assets: si(okBalance, n("assets")),
    liabilities: si(okBalance, n("liabilities")),
    equity: si(okBalance, n("equity")),
    minorityInterest: n("minorityInterest"),
    temporaryEquity: n("temporaryEquity"),
    deltaCash: si(okCaja, n("deltaCashTTM")),
    ocf: si(okCaja, n("ocfTTM")),
    cfi: si(okCaja, n("cfiTTM")),
    cff: si(okCaja, n("cffTTM")),
    fxCash: si(okCaja, n("fxCashTTM")),
    equityFin: si(okNeto, n("equity")),
    equityPrev: fPrev ? n("equity", fPrev) : null,
    netIncome: si(okNeto, n("niTTM")),
    dividends: n("dividendsTTM"),
    buybacks: n("buybacksTTM"),
    revenue: si(okMargen, n("revTTM")),
    cost: si(okMargen, n("costTTM")),
    grossProfit: si(okMargen, n("gpTTM")),
  });
}
