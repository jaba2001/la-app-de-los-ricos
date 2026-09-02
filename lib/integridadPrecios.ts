// ─────────────────────────────────────────────────────────────────────────────
// ¿SE PUEDE PUBLICAR ESTA SERIE DE PRECIOS?
//
// ⚠️ EXISTE PORQUE UNA TABLA PÚBLICA NO ES UN BACKTEST, y la diferencia no es de grado.
//
// Ya hay un detector de series rotas: `saltoImposible()` en `picks_rules_backtest.mjs`, con el
// umbral en **+300 %** en una sesión. Está bien calibrado PARA LO QUE HACE — proteger una
// referencia equiponderada, donde `GME` +135 % en el squeeze de 2021 y `NKTR` +156 % con
// resultados de un ensayo son REALES, y tirarlos sesgaría el índice. Allí el coste de perder un
// nombre bueno supera al de dejar pasar uno raro.
//
// **En una tabla publicada la función de pérdida es la contraria.** Ahí la cifra sale en una
// página con el logo de la empresa al lado, y el coste de publicar basura supera al de omitir un
// nombre. Comprobado el 2026-09-01: `MRNA` subió +177 % en una sesión (log 1,019) y `saltoImposible`
// —con el listón en log 1,386— **no lo habría marcado**.
//
// Por eso este módulo tiene su PROPIO umbral y no reutiliza aquél. Dos umbrales para dos
// funciones opuestas, cada uno con su motivo escrito. Compartir un valor entre dos usos con
// necesidades distintas es exactamente cómo derivaron los pesos del ensemble durante meses.
//
// ⚠️ Y MARCA, NO TIRA. La decisión de publicar es de la capa de arriba: aquí sólo se dice qué
// tiene mala pinta y por qué. Un guardián que decide por su cuenta acaba escondiendo datos
// buenos, y uno que marca demasiado se aprende a ignorar — que es como quedó el guardián de
// frescura de artefactos hasta que se arregló esa misma mañana.
// ─────────────────────────────────────────────────────────────────────────────

/** Una barra tal como la sirve `research/prices.mjs`. */
export interface Barra {
  date: string;
  raw: number | null;
  adj: number | null;
}

export type TipoAviso = "salto" | "ida_y_vuelta" | "factor_ajuste";

export interface Aviso {
  tipo: TipoAviso;
  fecha: string;
  /** `alta` = casi seguro que el dato está roto. `media` = raro, hay que mirarlo. */
  gravedad: "alta" | "media";
  detalle: string;
}

/**
 * Los umbrales, y por qué cada uno.
 *
 * ⚠️ NO son los de `saltoImposible`. Ver la nota de la cabecera.
 */
export const UMBRALES = {
  /** Una acción del S&P 500 rara vez sube más de esto en una sesión, y cuando lo hace merece que
   *  alguien lo mire antes de publicarlo. `MRNA` hizo +177 %; `GME`, +135 %. Los dos entran. */
  saltoArriba: 0.40,
  /** Asimétrico a propósito: caer un 35 % en un día es más común que subir un 40 % —una guía
   *  retirada, un ensayo fallido— así que el listón de bajada es algo más bajo. */
  saltoAbajo: -0.35,
  /** Dos movimientos OPUESTOS de este tamaño, cerca, no son mercado: son un dato que va y vuelve. */
  vuelta: 0.30,
  /** Cuántas sesiones de margen para considerarlos la misma ida y vuelta. */
  vueltaSesiones: 5,
  /**
   * Cambio RELATIVO del factor `crudo/ajustado` para considerarlo un salto de escala.
   *
   * ⚠️ EMPEZÓ EN 0,01 ABSOLUTO Y ESTABA MAL. Con ese listón saltaban once nombres del S&P 500 en
   * un solo mes —BX, CLX, DOW, F, IP, KVUE, LYB, TAP, OKE, PRU, UPS— y todos por lo mismo: el
   * ajustado descuenta los DIVIDENDOS, así que el factor cambia en cada fecha ex-dividendo.
   * Medido: CLX −1,15 %, UPS −1,57 %, BX −1,00 %. Frente a MNST, −50,00 %.
   *
   * Un dividendo trimestral mueve el factor un 1-2 %; el split más pequeño que se ve (5:4) lo
   * mueve un 25 %. El 10 % los separa con holgura por los dos lados.
   */
  factorRelativo: 0.10,
} as const;

const finito = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;

/**
 * Revisa una serie y devuelve todo lo que huele mal. Puro: sin red, sin disco, sin reloj.
 *
 * Las tres comprobaciones no son independientes — la tercera sólo tiene sentido leída junto a la
 * primera, y se explica ahí por qué.
 */
export function revisarSerie(barras: Barra[], umbrales = UMBRALES): Aviso[] {
  const avisos: Aviso[] = [];
  if (!barras?.length) return avisos;

  // ── 1 · Saltos en la serie AJUSTADA ─────────────────────────────────────────────────────
  // Se mira el ajustado, no el crudo: el crudo salta en cada split de forma legítima.
  const mov: { i: number; fecha: string; r: number }[] = [];
  for (let i = 1; i < barras.length; i++) {
    const a = barras[i - 1].adj, b = barras[i].adj;
    if (!finito(a) || !finito(b) || a <= 0 || b <= 0) continue;
    const r = b / a - 1;
    mov.push({ i, fecha: barras[i].date, r });
    if (r > umbrales.saltoArriba || r < umbrales.saltoAbajo) {
      avisos.push({
        tipo: "salto",
        fecha: barras[i].date,
        gravedad: "media",
        detalle: `${pct(r)} en una sesión`,
      });
    }
  }

  // ── 2 · Ida y vuelta ────────────────────────────────────────────────────────────────────
  // Es la que caza a `MNST`, y la que `saltoImposible` NO puede ver porque mira barras sueltas.
  // Un precio que se parte por la mitad y vuelve en la sesión siguiente no es un desplome con
  // rebote: es el proveedor sirviendo dos escalas distintas. Medido el 2026-09-01: cinco
  // movimientos de más del 15 % en 21 barras —−50,7 · +94,1 · −50,2 · +91,9 · −49,6— con el
  // ratio crudo/ajustado saltando de 2,000 a 1,000. Tres mitades y dos dobles = −53 % neto, que
  // es la cifra que se habría publicado con el logo de Monster al lado.
  const grandes = mov.filter((m) => Math.abs(m.r) >= umbrales.vuelta);
  for (let k = 0; k < grandes.length; k++) {
    for (let j = k + 1; j < grandes.length; j++) {
      const a = grandes[k], b = grandes[j];
      if (b.i - a.i > umbrales.vueltaSesiones) break;
      if (Math.sign(a.r) === Math.sign(b.r)) continue;
      // ¿Vuelve de verdad al punto de partida? Componer los dos y ver si se cancelan.
      const neto = (1 + a.r) * (1 + b.r) - 1;
      if (Math.abs(neto) < 0.15) {
        avisos.push({
          tipo: "ida_y_vuelta",
          fecha: a.fecha,
          gravedad: "alta",
          detalle: `${pct(a.r)} el ${a.fecha} y ${pct(b.r)} el ${b.fecha}: neto ${pct(neto)} en ${b.i - a.i} sesión(es)`,
        });
      }
    }
  }

  // ── 3 · Salto del factor de ajuste ──────────────────────────────────────────────────────
  // ⚠️ ESTA SOLA NO PRUEBA NADA, y conviene decirlo: `crudo/ajustado` CAMBIA legítimamente en un
  // split, que es justo para lo que existe el ajuste. Medido sobre 400 barras: AAPL, MSFT y NVDA
  // dan CERO cambios, y `MNST` da exactamente uno, el 2026-08-11 (2,000 → 1,000).
  //
  // Su valor está en la COMBINACIÓN: un cambio de factor con la serie ajustada limpia es un split
  // normal; con saltos alrededor, es un ajuste aplicado a medias. Por eso la gravedad es `media`
  // y el texto lo dice.
  let prev: number | null = null;
  for (const b of barras) {
    if (!finito(b.raw) || !finito(b.adj) || b.adj <= 0) { prev = null; continue; }
    const f = b.raw / b.adj;
    if (prev != null && prev > 0 && Math.abs(f / prev - 1) > umbrales.factorRelativo) {
      avisos.push({
        tipo: "factor_ajuste",
        fecha: b.date,
        gravedad: "media",
        detalle: `el factor crudo/ajustado pasa de ${prev.toFixed(3)} a ${f.toFixed(3)} (${pct(f / prev - 1)}) — puede ser un split legítimo; sólo preocupa si hay saltos cerca`,
      });
    }
    prev = f;
  }

  return avisos;
}

/**
 * ¿Se puede publicar? Resume los avisos en una decisión con motivo.
 *
 * El corte es por GRAVEDAD, no por cantidad: un solo `ida_y_vuelta` basta para no publicar la
 * cifra sin marcarla, y diez saltos `media` en diez años no son motivo de nada.
 */
export function veredicto(avisos: Aviso[], desde?: string): {
  publicable: boolean;
  motivo: string | null;
  enVentana: Aviso[];
} {
  const enVentana = desde ? avisos.filter((a) => a.fecha >= desde) : avisos;
  const altas = enVentana.filter((a) => a.gravedad === "alta");
  if (altas.length) {
    return { publicable: false, motivo: altas[0].detalle, enVentana };
  }
  // ⚠️ Cualquier aviso en la ventana TIENE que producir un motivo. La primera versión sólo
  // miraba los de tipo `salto`, así que once nombres salieron con `motivo: null` — marcados y
  // sin decir por qué. Un aviso mudo es peor que no tenerlo: ocupa sitio y no informa.
  if (enVentana.length) {
    const s = enVentana.find((a) => a.tipo === "salto") ?? enVentana[0];
    return { publicable: true, motivo: `con aviso: ${s.detalle}`, enVentana };
  }
  return { publicable: true, motivo: null, enVentana };
}

/**
 * ¿Acaban todas las series en la misma sesión?
 *
 * Un ranking que compara el «último día» de nombres que cierran en días distintos no compara
 * nada. Devuelve los que se desalinean, no un booleano: hay que poder decir cuáles.
 */
export function cierresDesalineados(
  ultimas: { ticker: string; fecha: string }[],
): { referencia: string | null; fuera: { ticker: string; fecha: string }[] } {
  if (!ultimas.length) return { referencia: null, fuera: [] };
  const conteo = new Map<string, number>();
  for (const u of ultimas) conteo.set(u.fecha, (conteo.get(u.fecha) ?? 0) + 1);
  let referencia: string | null = null, mejor = -1;
  for (const [f, n] of conteo) if (n > mejor) { mejor = n; referencia = f; }
  return { referencia, fuera: ultimas.filter((u) => u.fecha !== referencia) };
}
