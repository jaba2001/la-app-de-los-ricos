// ─────────────────────────────────────────────────────────────────────────────
// LOS HECHOS DE UNA TABLA DE MOVIMIENTOS
//
// Es lo que convierte diez filas en algo que se lee. Moby lo hace en el pie: «el viernes fue de
// cripto y de activos duros». Sin eso, una tabla es un terminal.
//
// ⚠️ PERO ESTO NO ESCRIBE PROSA, Y ESA ES LA DECISIÓN DE DISEÑO. Deriva HECHOS de las filas ya
// calculadas, cada uno con la evidencia que lo sostiene. Tres motivos:
//
//   1. **Casi todo el valor es determinista.** «6 de las 8 mayores subidas son tecnología» es un
//      agrupamiento; «EIX y PCG caen lo mismo» es una resta. No hace falta un modelo, y lo que
//      no hace falta no se pone.
//   2. **Un texto generado inventa causas.** «Cayeron por el incendio» no está en los datos. Aquí
//      sólo se puede decir lo que las filas contienen: sectores, tamaños, cuántos, y coincidencias.
//   3. **Y sobre todo: el resumen NO elige filas.** Se ejecuta DESPUÉS del ranking, sobre lo ya
//      publicado. Un texto que decidiera qué enseñar sería una selección disfrazada de resumen —
//      el mismo error que este repo lleva una semana quitándose de encima.
//
// NADA DE CAUSAS Y NADA DE FUTURO. Un hecho de aquí se puede comprobar apuntando a una fila.
// «Seis de las ocho son tecnología» sí. «Por la rotación hacia software» no: eso es una teoría.
// ─────────────────────────────────────────────────────────────────────────────

export interface Fila {
  ticker: string;
  pct: number;
  /** Puede faltar: el SIC no resuelve todos los nombres, y eso se dice en vez de agruparlos. */
  sector?: string | null;
}

export interface Hecho {
  tipo: "concentracion" | "comovimiento" | "amplitud" | "extremo" | "sin_sector";
  texto: string;
  /** Los tickers que lo sostienen. Cada hecho se puede comprobar mirando estas filas. */
  evidencia: string[];
}

export const UMBRALES_NARRATIVA = {
  /** Cuántas filas de la cabecera se miran para la concentración. */
  cabecera: 8,
  /** Mínimo de filas del mismo sector para que sea una concentración y no una coincidencia. */
  minConcentracion: 4,
  /** Dos movimientos se consideran «casi el mismo» si difieren menos que esto, en puntos. */
  comovimiento: 1.0,
  /** Y sólo cuenta si los dos son grandes: un ±0,2 % igual no dice nada. */
  minMovimiento: 5.0,
  /** Si falta el sector en más de esta fracción de la cabecera, no se afirma concentración. */
  maxSinSector: 0.25,
  /**
   * Cuánto tiene que destacar el primero sobre el segundo para merecer una frase.
   *
   * ⚠️ Sin esto la frase repetía la tabla: «la mayor subida es CRWD, +5,8 %» cuando CRWD es
   * literalmente la primera fila que el lector tiene delante. Sólo informa cuando el primero se
   * despega — `MRNA` +156 % con el segundo en +51 % sí; +5,77 contra +5,51 no.
   */
  destaqueExtremo: 1.5,
} as const;

const U = UMBRALES_NARRATIVA;
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)} %`;

/**
 * Los hechos de una cabecera de ranking (ganadores o perdedores).
 *
 * `direccion` sólo cambia cómo se redacta; los umbrales son los mismos.
 */
export function hechosDeCabecera(filas: Fila[], direccion: "suben" | "bajan"): Hecho[] {
  const hechos: Hecho[] = [];
  const cab = filas.slice(0, U.cabecera);
  if (!cab.length) return hechos;

  // ── Cuántos sin sector ─────────────────────────────────────────────────────────────────
  // ⚠️ Se dice ANTES de cualquier afirmación sobre sectores. Si faltan muchos, la concentración
  // que se calcule es sobre una muestra incompleta y afirmarla sería colar un dato ausente como
  // si fuera un hecho — el error que este repo lleva una semana persiguiendo.
  const sinSector = cab.filter((f) => !f.sector);
  const fiable = sinSector.length / cab.length <= U.maxSinSector;
  if (sinSector.length) {
    hechos.push({
      tipo: "sin_sector",
      texto: `${sinSector.length} de ${cab.length} no ${sinSector.length === 1 ? "tiene" : "tienen"} sector asignado${fiable ? "" : ", así que no se afirma nada sobre concentración sectorial"}`,
      evidencia: sinSector.map((f) => f.ticker),
    });
  }

  // ── Concentración sectorial ────────────────────────────────────────────────────────────
  if (fiable) {
    const porSector = new Map<string, string[]>();
    for (const f of cab) {
      if (!f.sector) continue;
      if (!porSector.has(f.sector)) porSector.set(f.sector, []);
      porSector.get(f.sector)!.push(f.ticker);
    }
    for (const [sector, tickers] of [...porSector.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (tickers.length < U.minConcentracion) break;
      hechos.push({
        tipo: "concentracion",
        texto: `${tickers.length} de las ${cab.length} que más ${direccion} son de ${sector}`,
        evidencia: tickers,
      });
    }
  }

  // ── Co-movimiento ──────────────────────────────────────────────────────────────────────
  // Dos nombres que se mueven casi igual. Se exige que los dos sean grandes Y del mismo sector:
  // con quinientos nombres, que dos cualesquiera coincidan al decimal es puro azar, y decirlo
  // sería vender una casualidad como un patrón.
  //
  // ⚠️ Y NO SE REPITE LO QUE YA DICE LA CONCENTRACIÓN. Si seis de ocho son tecnología, que dos de
  // ellas se muevan parecido no es información nueva: es la misma observación contada dos veces,
  // y en la semana del 2026-08-31 producía tres frases donde había una idea. El co-movimiento
  // informa cuando ocurre CONTRA el fondo — «PCG» y «EIX» en Utilities, que son sólo dos de ocho.
  const concentrados = new Set(hechos.filter((h) => h.tipo === "concentracion").map((h) => h.texto.split(" son de ")[1]));
  const yaDicho = new Set<string>();
  for (let i = 0; i < cab.length; i++) {
    for (let j = i + 1; j < cab.length; j++) {
      const a = cab[i], b = cab[j];
      if (Math.abs(a.pct) < U.minMovimiento || Math.abs(b.pct) < U.minMovimiento) continue;
      if (Math.abs(a.pct - b.pct) > U.comovimiento) continue;
      if (!a.sector || !b.sector || a.sector !== b.sector) continue;
      if (concentrados.has(a.sector)) continue;      // ya está dicho, y mejor
      if (yaDicho.has(a.sector)) continue;           // una pareja por sector basta
      yaDicho.add(a.sector);
      hechos.push({
        tipo: "comovimiento",
        texto: `${a.ticker} y ${b.ticker}, las dos de ${a.sector}, se mueven casi lo mismo (${pct(a.pct)} y ${pct(b.pct)})`,
        evidencia: [a.ticker, b.ticker],
      });
    }
  }

  // ── El extremo, sólo cuando se despega ─────────────────────────────────────────────────
  // La primera fila ya está en la tabla: repetirla en el pie no informa. Sólo merece una frase
  // cuando el primero deja atrás al segundo — y entonces lo que se dice es esa distancia.
  const primero = cab[0], segundo = cab[1];
  if (primero && Math.abs(primero.pct) >= U.minMovimiento) {
    const destaca = !segundo || Math.abs(segundo.pct) === 0
      || Math.abs(primero.pct) / Math.abs(segundo.pct) >= U.destaqueExtremo;
    if (destaca) {
      hechos.push({
        tipo: "extremo",
        texto: segundo
          ? `${primero.ticker} se despega: ${pct(primero.pct)} frente al ${pct(segundo.pct)} del siguiente`
          : `la mayor ${direccion === "suben" ? "subida" : "caída"} es ${primero.ticker}, ${pct(primero.pct)}`,
        evidencia: segundo ? [primero.ticker, segundo.ticker] : [primero.ticker],
      });
    }
  }

  return hechos;
}

/**
 * La amplitud: cuántos suben y cuántos bajan en TODO el universo, no en la cabecera.
 *
 * Es el contexto que falta en cualquier tabla de diez filas: diez subidas del 5 % significan una
 * cosa si sube el 80 % del índice y otra muy distinta si baja.
 */
export function hechoDeAmplitud(todas: Fila[]): Hecho | null {
  const validas = todas.filter((f) => Number.isFinite(f.pct));
  if (validas.length < 20) return null;
  const suben = validas.filter((f) => f.pct > 0).length;
  const p = (100 * suben) / validas.length;
  return {
    tipo: "amplitud",
    texto: `suben ${suben} de ${validas.length} (${p.toFixed(0)} %)`,
    evidencia: [],
  };
}

/**
 * Une los hechos en una frase, sin adornos.
 *
 * No hay conectores que insinúen causa —«porque», «debido a», «impulsado por»— a propósito. Se
 * enumeran hechos separados por punto. Suena seco; es lo que se puede sostener.
 */
export function redactar(hechos: Hecho[]): string {
  const orden: Hecho["tipo"][] = ["amplitud", "concentracion", "comovimiento", "extremo", "sin_sector"];
  return hechos
    .slice()
    .sort((a, b) => orden.indexOf(a.tipo) - orden.indexOf(b.tipo))
    .map((h) => h.texto)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(". ") + (hechos.length ? "." : "");
}

/**
 * ¿Todo número del texto sale de las filas?
 *
 * Existe para cuando encima de esto se ponga un modelo (fase 5b). Un texto generado puede
 * introducir cifras que no están en ningún sitio, y eso hay que poder comprobarlo mecánicamente
 * antes de publicarlo, no confiando en que no lo haga.
 */
export function numerosNoSoportados(texto: string, filas: Fila[]): string[] {
  const permitidos = new Set<string>();
  for (const f of filas) {
    permitidos.add(Math.abs(f.pct).toFixed(1));
    permitidos.add(String(Math.round(Math.abs(f.pct))));
  }
  // Los recuentos pequeños (cuántos de cuántos) también son legítimos.
  for (let i = 0; i <= filas.length; i++) permitidos.add(String(i));

  const enTexto = texto.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return [...new Set(enTexto.map((n) => n.replace(",", ".")))].filter((n) => !permitidos.has(n));
}
