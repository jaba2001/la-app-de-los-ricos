// Diccionario inglés → español, repartido por zonas de la app. La clave es el texto inglés
// EXACTO que pinta la app; {marcas} para los trozos que cambian (ver lib/i18n/traducir.ts).
import { COMUN } from "./comun.ts";
import { PUBLICO } from "./publico.ts";
import { MACRO } from "./macro.ts";
import { ACCIONES } from "./acciones.ts";
import { CARTERA } from "./cartera.ts";
import { HISTORIAL } from "./historial.ts";
import { SERVIDOR } from "./servidor.ts";
import { LIB } from "./lib.ts";
import { LIB2 } from "./lib2.ts";
import { CATALOGOS } from "./catalogos.ts";
import { ASISTENTE } from "./asistente.ts";

export const ES: Record<string, string> = {
  ...COMUN,
  ...PUBLICO,
  ...MACRO,
  ...ACCIONES,
  ...CARTERA,
  ...HISTORIAL,
  ...SERVIDOR,
  ...LIB,
  ...LIB2,
  ...CATALOGOS,
  ...ASISTENTE,
};
