// t() para los componentes de cliente (casi toda la app).
//
// En el NAVEGADOR el idioma vive en una variable del módulo, que fija IdiomaProvider al pintarse
// (antes que sus hijos) — así t() se puede llamar en cualquier sitio: al pintar, en un manejador
// de clic o en lib/proxy.ts. Cambiar de idioma recarga la página (components/SelectorIdioma).
//
// En el SERVIDOR (el primer HTML de los componentes de cliente) una variable de módulo se
// mezclaría entre peticiones de usuarios distintos: ahí se lee del contexto de React, que es por
// petición. Los componentes de SERVIDOR no importan esto: usan lib/i18n/servidor.ts.
import { createContext, useContext } from "react";
import { compilar, traducir, trocear, LOCALE, IDIOMA_POR_DEFECTO, type Idioma } from "./traducir.ts";
import { ES } from "./es/index.ts";

const DIC = compilar(ES);

export const IdiomaContexto = createContext<Idioma>(IDIOMA_POR_DEFECTO);

let idiomaCliente: Idioma = IDIOMA_POR_DEFECTO;
export function fijarIdiomaCliente(i: Idioma) { idiomaCliente = i; }

export function idiomaActivo(): Idioma {
  if (typeof window !== "undefined") return idiomaCliente;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- solo en el servidor, durante el render
    return useContext(IdiomaContexto);
  } catch {
    return IDIOMA_POR_DEFECTO;
  }
}

/** Traduce un texto ya montado al idioma activo. */
export function t(texto: string): string {
  return traducir(texto, idiomaActivo(), DIC);
}

/**
 * Como t(), pero acepta cualquier cosa: traduce si es texto y devuelve lo demás tal cual
 * (números, null, undefined). Para pintar campos que vienen de lib/ (lecturas, etiquetas)
 * sin tener que estrechar su tipo en cada sitio.
 */
export function tv<T>(v: T): T {
  return (typeof v === "string" ? t(v) : v) as T;
}

export { trocear };

/** Fecha en el formato del idioma activo. */
export function fecha(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(+x) ? "—" : x.toLocaleDateString(LOCALE[idiomaActivo()], opts);
}

/** Fecha y hora en el formato del idioma activo. */
export function fechaHora(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(+x) ? "—" : x.toLocaleString(LOCALE[idiomaActivo()], opts);
}

/** Número en el formato del idioma activo. */
export function numero(n: number, opts?: Intl.NumberFormatOptions): string {
  return Number.isFinite(n) ? n.toLocaleString(LOCALE[idiomaActivo()], opts) : "—";
}
