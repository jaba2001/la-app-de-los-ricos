// t() para los componentes de SERVIDOR (layout, /daily, /evidence, /picks): el idioma sale de
// la cookie de la petición o, la primera vez, del idioma del navegador.
import { cookies, headers } from "next/headers";
import { compilar, traducir, idiomaDeNavegador, esIdioma, COOKIE_IDIOMA, type Idioma } from "./traducir.ts";
import { ES } from "./es/index.ts";

const DIC = compilar(ES);

export async function idiomaPeticion(): Promise<Idioma> {
  const c = (await cookies()).get(COOKIE_IDIOMA)?.value;
  if (esIdioma(c)) return c;
  return idiomaDeNavegador((await headers()).get("accept-language"));
}

/** Un t() fijado al idioma de esta petición. */
export async function tServidor(): Promise<(texto: string) => string> {
  const idioma = await idiomaPeticion();
  return (texto: string) => traducir(texto, idioma, DIC);
}
