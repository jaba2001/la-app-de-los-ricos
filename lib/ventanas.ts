// ─────────────────────────────────────────────────────────────────────────────
// LAS VENTANAS DE UN RANKING DE PRECIOS
//
// ⚠️ POR FECHA, NO POR NÚMERO DE BARRAS — pero NO por el motivo que yo creía.
//
// La primera prueba de ganadores/perdedores usaba `serie.slice(-21)` para «un mes». Con `MNST`,
// esa ventana incluyó una caída del −50,7 % **sin** el rebote del +94,1 % que venía justo después:
// −52,97 % mensual publicado, cuando componiendo los dos el neto era −3 %.
//
// **Escribí que una ventana de calendario lo arreglaba. Es falso, y el test lo demostró.** Con
// «un mes natural» hasta el 2026-08-31, el inicio cae el 2026-07-31 y el tramo **excluye la caída
// e incluye el rebote** — parte el mismo artefacto, sólo que por el otro lado.
//
// **Ninguna ventana protege de un dato roto.** Un borde es un borde: siempre puede caer entre dos
// barras anómalas. De eso protege `lib/integridadPrecios.ts`, que marca la serie ENTERA, y por eso
// esa capa va antes que ésta.
//
// Entonces, ¿por qué calendario? Por **reproducibilidad y honestidad de la etiqueta**:
//
//   · Con `slice(-N)` el borde depende de cuántas sesiones hubo —festivos, medias sesiones—, así
//     que «1 mes» mide un tramo distinto según el año, y dos ejecuciones no comparan lo mismo.
//   · Con una fecha, el borde es el mismo siempre, se puede publicar, y quien lea el ranking
//     puede reproducirlo. Y `tramoDe` devuelve las fechas REALES que se usaron, no las nominales:
//     un ranking que dice «1 mes» y mide cinco semanas está mintiendo aunque sea sin querer.
//
// Es puro: recibe fechas y devuelve fechas. Sin red, sin disco, sin reloj propio.
// ─────────────────────────────────────────────────────────────────────────────

export type Ventana = "1d" | "1s" | "1m" | "ytd";

export const VENTANAS: { id: Ventana; nombre: string }[] = [
  { id: "1d", nombre: "1 día" },
  { id: "1s", nombre: "1 semana" },
  { id: "1m", nombre: "1 mes" },
  { id: "ytd", nombre: "YTD" },
];

/** Resta días naturales a una fecha `AAAA-MM-DD`, sin zona horaria. */
export function menosDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * La fecha de INICIO de cada ventana, contando hacia atrás desde el último cierre.
 *
 * `1d` es un caso aparte: no es «ayer natural» —el lunes, ayer es domingo y no hay sesión— sino
 * **la sesión anterior**. Por eso se resuelve contra el calendario real y no restando un día.
 */
export function inicioDe(ventana: Ventana, hasta: string): string | null {
  switch (ventana) {
    case "1d": return null;                       // lo resuelve el calendario, ver `tramoDe`
    case "1s": return menosDias(hasta, 7);
    case "1m": return menosDias(hasta, 30);
    case "ytd": return `${hasta.slice(0, 4)}-01-01`;
  }
}

/**
 * El tramo de fechas de la serie que entra en la ventana.
 *
 * Devuelve `{ base, hasta }` con las fechas REALES de la serie, no las nominales.
 *
 * ⚠️ `base` NO es el primer día de la ventana: es **el último cierre ANTES** de ella, o sea el
 * precio contra el que se mide. Se llamaba `desde` y era engañoso — publicado como
 * «1 semana · 2026-08-21 → 2026-08-31» parece que la ventana dura diez días naturales, cuando lo
 * que dura es del 24 al 31 y el 21 es sólo la referencia.
 *
 * Se publica lo que se usó, no lo que se pidió: un ranking que dice «1 mes» y mide cinco semanas
 * miente aunque sea sin querer.
 */
export function tramoDe(fechas: string[], ventana: Ventana, hasta: string): { base: string; hasta: string } | null {
  if (!fechas?.length) return null;
  const fin = fechas.filter((f) => f <= hasta).at(-1);
  if (!fin) return null;

  if (ventana === "1d") {
    const i = fechas.indexOf(fin);
    if (i < 1) return null;
    return { base: fechas[i - 1], hasta: fin };
  }

  const nominal = inicioDe(ventana, fin);
  if (!nominal) return null;
  // La primera sesión EN o DESPUÉS del inicio nominal. El retorno se mide desde la sesión
  // ANTERIOR a ésa, que es el último cierre previo a la ventana.
  const iPrimera = fechas.findIndex((f) => f >= nominal);
  if (iPrimera < 1) return null;
  return { base: fechas[iPrimera - 1], hasta: fin };
}

/**
 * Retorno compuesto entre dos fechas, a partir de retornos logarítmicos diarios.
 *
 * `base` es el cierre de referencia y su propia barra NO entra: el retorno se mide DESDE ahí.
 *
 * Las barras fuera del tramo se ignoran; las no finitas también, y **se cuentan**: una serie con
 * huecos da un retorno que parece bueno y le faltan días.
 */
export function retornoEnTramo(
  serie: { date: string; ret: number }[],
  base: string,
  hasta: string,
): { pct: number; sesiones: number; huecos: number } | null {
  let log = 0, sesiones = 0, huecos = 0;
  for (const b of serie) {
    if (b.date <= base || b.date > hasta) continue;
    if (!Number.isFinite(b.ret)) { huecos++; continue; }
    log += b.ret;
    sesiones++;
  }
  if (!sesiones) return null;
  return { pct: (Math.exp(log) - 1) * 100, sesiones, huecos };
}
