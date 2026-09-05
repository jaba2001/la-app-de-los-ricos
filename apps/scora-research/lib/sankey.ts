// ─────────────────────────────────────────────────────────────────────────────
// CÓMO GANA (O PIERDE) DINERO UNA EMPRESA
//
// Construye el diagrama de flujo desde los ingresos hasta el resultado, a partir de los
// fundamentales que ya extrae `research/edgar.mjs`. Puro: recibe datos, devuelve estructura.
//
// LA CADENA CONTABLE, que es lo que hace que el diagrama sea comprobable y no decorativo:
//
//     Ingresos
//       − Coste de ingresos            = Margen bruto
//       − I+D − SG&A − Otros gastos    = Resultado de explotación
//       − Impuestos y otros            = Resultado neto
//
// Y por tanto: **Ingresos = coste + I+D + SG&A + otros + impuestos + resultado neto.**
//
// ⚠️ EL DIAGRAMA SIEMPRE CIERRA, Y LO QUE FALTA SE DIBUJA. La tentación de un Sankey es escalar
// las barras para que encajen: queda bonito y miente. Aquí lo que no se puede atribuir a un
// concepto se dibuja como un bloque **«No desglosado»** con su tamaño real, y nunca se reparte
// entre los demás. Así el hueco se VE en vez de esconderse en un margen que no cuadra.
//
// Y `cuadre.ok` dice si ese bloque es pequeño: un diagrama con el 90 % «no desglosado» es
// correcto y no informa de nada. Medido sobre el índice, le pasa al 38 % de los de nivel `minimo`.
//
// TRES NIVELES, porque la cobertura real es muy desigual y esconderlo sería peor:
//
//   · `completo`  — ingresos, coste, I+D, SG&A y resultado. Es el diagrama de NVIDIA de Moby.
//   · `minimo`    — ingresos, un bloque de coste y resultado. Se dibuja, con menos detalle.
//   · `sin_datos` — ni eso. Se dice, no se rellena.
//
// Y el lado IZQUIERDO (ingresos por línea de negocio) es opcional: sólo lo publican algunas
// empresas en XBRL. Cuando no está, hay una sola barra de entrada y el diagrama lo declara.
// ─────────────────────────────────────────────────────────────────────────────

export interface Flujo {
  nombre: string;
  valor: number;
  /** `entrada` alimenta los ingresos; `salida` sale de ellos. */
  lado: "entrada" | "salida";
  /** Para colorear: un resultado negativo es la historia de «cómo PIERDE dinero». */
  clase: "ingreso" | "coste" | "beneficio" | "perdida";
}

export interface Sankey {
  nivel: "completo" | "minimo" | "sin_datos";
  ingresos: number | null;
  entradas: Flujo[];
  salidas: Flujo[];
  /**
   * Cuánto de los ingresos NO se ha podido atribuir a un concepto, publicado siempre.
   *
   * El diagrama SIEMPRE cierra —el residuo se dibuja como bloque «No desglosado»— así que esto
   * no dice si cierra, sino **cuánto de lo que se enseña es un agujero con nombre**. `ok` es
   * falso cuando ese agujero pasa del umbral, y entonces el diagrama informa poco aunque sea
   * correcto.
   */
  cuadre: { residuo: number; pct: number; ok: boolean };
  /** Qué NO se ha podido dibujar, dicho con nombre. */
  faltan: string[];
  /** ¿El resultado neto es negativo? Es «cómo pierde dinero», el mismo diagrama en rojo. */
  pierde: boolean;
}

/** Descuadre máximo tolerado, en fracción de los ingresos. */
export const TOLERANCIA_CUADRE = 0.02;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export interface Fundamentales {
  revTTM?: number | null;
  costTTM?: number | null;
  gpTTM?: number | null;
  rndTTM?: number | null;
  sgaTTM?: number | null;
  oiTTM?: number | null;
  niTTM?: number | null;
}

/** Una línea de ingreso del lado izquierdo, si la empresa la publica. */
export interface LineaIngreso { nombre: string; valor: number }

/**
 * Construye el diagrama. Devuelve `null` sólo si no hay ni ingresos.
 *
 * `lineas` es el desglose del lado izquierdo. Si suma distinto de los ingresos totales —cosa
 * habitual, porque las empresas no siempre desglosan el 100 %— la diferencia se dibuja como
 * «otros ingresos», NO se escala.
 */
export function construirSankey(f: Fundamentales, lineas: LineaIngreso[] = []): Sankey | null {
  const rev = fin(f.revTTM) && f.revTTM > 0 ? f.revTTM : null;
  if (rev == null) return null;

  const faltan: string[] = [];
  const salidas: Flujo[] = [];

  const cost = fin(f.costTTM) ? f.costTTM : null;
  const gp = fin(f.gpTTM) ? f.gpTTM : (cost != null ? rev - cost : null);
  const rnd = fin(f.rndTTM) ? f.rndTTM : null;
  const sga = fin(f.sgaTTM) ? f.sgaTTM : null;
  const oi = fin(f.oiTTM) ? f.oiTTM : null;
  const ni = fin(f.niTTM) ? f.niTTM : null;

  if (cost == null) faltan.push("coste de ingresos");
  if (rnd == null) faltan.push("I+D");
  if (sga == null) faltan.push("gastos generales y de venta");
  if (oi == null) faltan.push("resultado de explotación");
  if (ni == null) faltan.push("resultado neto");

  if (cost != null) salidas.push({ nombre: "Coste de ingresos", valor: cost, lado: "salida", clase: "coste" });
  if (rnd != null) salidas.push({ nombre: "I+D", valor: rnd, lado: "salida", clase: "coste" });
  if (sga != null) salidas.push({ nombre: "Gastos generales y de venta", valor: sga, lado: "salida", clase: "coste" });

  if (cost != null && gp != null && oi != null) {
    // Otros gastos de explotación = lo que va del margen bruto al resultado de explotación y no
    // es I+D ni SG&A. Se DERIVA, y por eso sólo existe si están las tres piezas.
    const otros = gp - (rnd ?? 0) - (sga ?? 0) - oi;
    // Un «otros» negativo significaría que I+D y SG&A suman más que el hueco: los datos no
    // articulan. Se publica igualmente para que se vea, en vez de recortarlo a cero.
    if (Math.abs(otros) > rev * 0.001) {
      salidas.push({ nombre: "Otros gastos de explotación", valor: otros, lado: "salida", clase: "coste" });
    }
  } else if (cost == null && oi != null) {
    // ⚠️ SIN DESGLOSE DE COSTES PERO CON RESULTADO DE EXPLOTACIÓN todavía hay diagrama, y es el
    // caso de `AMC` — el «How AMC Loses Money» de Moby. Con ingresos y explotación, todo lo que
    // hay en medio son costes de explotación, aunque no se sepa repartirlos.
    //
    // Se dibuja UNA barra agregada y se llama por lo que es. La primera versión mandaba este
    // caso a `sin_datos` y se dejaba fuera a empresas que sí se pueden enseñar.
    const costes = rev - oi;
    if (Math.abs(costes) > rev * 0.001) {
      salidas.push({ nombre: "Costes de explotación", valor: costes, lado: "salida", clase: "coste" });
    }
  }

  // Impuestos y otros = del resultado de explotación al neto. Incluye financieros e impuestos:
  // no se separan porque el extractor no los da por separado de forma fiable, y agrupar diciendo
  // qué agrupa es mejor que inventar dos barras.
  if (oi != null && ni != null) {
    const imp = oi - ni;
    if (Math.abs(imp) > rev * 0.001) {
      salidas.push({ nombre: "Impuestos, financieros y otros", valor: imp, lado: "salida", clase: "coste" });
    }
  }

  const pierde = ni != null && ni < 0;
  if (ni != null) {
    salidas.push({
      nombre: pierde ? "Pérdida neta" : "Beneficio neto",
      valor: ni,
      lado: "salida",
      clase: pierde ? "perdida" : "beneficio",
    });
  }

  // ── El lado izquierdo ──────────────────────────────────────────────────────────────────
  const entradas: Flujo[] = [];
  const sumaLineas = lineas.reduce((a, l) => a + (fin(l.valor) ? l.valor : 0), 0);
  if (lineas.length >= 2 && sumaLineas > 0) {
    for (const l of lineas) entradas.push({ nombre: l.nombre, valor: l.valor, lado: "entrada", clase: "ingreso" });
    const resto = rev - sumaLineas;
    // ⚠️ La diferencia se dibuja, no se reparte. Las empresas rara vez desglosan el 100 %, y
    // escalar las líneas para que sumen sería inventar cuánto vende cada negocio.
    if (Math.abs(resto) > rev * 0.005) {
      entradas.push({ nombre: "Otros ingresos", valor: resto, lado: "entrada", clase: "ingreso" });
    }
  } else {
    entradas.push({ nombre: "Ingresos totales", valor: rev, lado: "entrada", clase: "ingreso" });
    faltan.push("desglose de ingresos por línea de negocio");
  }

  // ── Lo que no se ha podido atribuir, DIBUJADO ─────────────────────────────────────────
  //
  // ⚠️ ESTO FALTABA, y la cabecera lo prometía. Sin este bloque el diagrama simplemente no
  // cerraba: las salidas sumaban menos que los ingresos y el hueco quedaba invisible, que es
  // justo lo contrario de lo que un Sankey debe hacer.
  //
  // Medido sobre el índice: los diagramas de nivel `minimo` dejaban sin atribuir un 38 % de los
  // casos, con `CNC` al 91 % y `BXP` al 86 %. Enseñar eso sin la barra sería dibujar una empresa
  // cuyos costes no se ven.
  //
  // Se dibuja como una salida más, con su nombre, y NUNCA se reparte entre las otras.
  const bruto = salidas.reduce((a, s) => a + s.valor, 0);
  const residuo = rev - bruto;
  const pct = (residuo / rev) * 100;
  if (Math.abs(residuo) > rev * 0.001) {
    // Se inserta ANTES del resultado neto, que es donde tiene sentido leerlo: entre los costes.
    const iNeto = salidas.findIndex((s) => s.clase === "beneficio" || s.clase === "perdida");
    const bloque: Flujo = {
      nombre: residuo > 0 ? "No desglosado" : "Ajuste no desglosado",
      valor: residuo,
      lado: "salida",
      clase: "coste",
    };
    if (iNeto >= 0) salidas.splice(iNeto, 0, bloque); else salidas.push(bloque);
  }

  // `minimo` incluye el caso de tener sólo ingresos + explotación + neto: se dibuja el flujo con
  // una barra agregada de costes. Excluirlo dejaba fuera a empresas perfectamente enseñables.
  const nivel: Sankey["nivel"] =
    cost != null && rnd != null && sga != null && ni != null ? "completo"
      : ni != null && (cost != null || gp != null || oi != null) ? "minimo"
        : "sin_datos";

  return {
    nivel,
    ingresos: rev,
    entradas,
    salidas,
    cuadre: { residuo, pct: Number(pct.toFixed(2)), ok: Math.abs(residuo) <= rev * TOLERANCIA_CUADRE },
    faltan,
    pierde,
  };
}

/** Texto corto y honesto de qué se está enseñando. Se publica junto al diagrama. */
export function etiquetaDe(s: Sankey): string {
  if (s.nivel === "sin_datos") return "esta empresa no publica lo suficiente en XBRL para dibujar el flujo";
  const base = s.nivel === "completo"
    ? "flujo completo: ingresos, costes, I+D y gastos generales"
    : "flujo simplificado: la empresa no publica el desglose de costes";
  const desglose = s.entradas.length > 1 ? "" : " · sin desglose de ingresos por línea de negocio";
  const cuadre = s.cuadre.ok ? "" : ` · ⚠ un ${Math.abs(s.cuadre.pct).toFixed(0)} % de los ingresos queda sin desglosar`;
  return base + desglose + cuadre;
}
