// ─────────────────────────────────────────────────────────────────────────────
// FASE 5b · PROSA CON MODELO, SOBRE LOS HECHOS DETERMINISTAS
//
// La fase 5a produce hechos y una redacción mecánica. Esto añade una capa de prosa escrita por un
// modelo, con UNA regla que lo gobierna todo:
//
//   **EL MODELO REDACTA. NO APORTA NI UN DATO.** Todo número, dirección y nombre tiene que estar
//   ya en los hechos deterministas. Si el texto trae algo que no está, NO se publica: se cae al
//   texto de 5a, que siempre es correcto aunque sea seco.
//
// O sea que el modelo sólo puede empeorar la forma, nunca la verdad. Esa asimetría es la única
// razón por la que esta capa puede existir en un producto financiero.
//
// ⚠️ **LA COMPUERTA QUE YA HABÍA ES SÓLO INGLESA, y eso la haría inútil aquí.** `lib/grounding.ts`
// trae `checkAdvice`, y sus patrones son `you should buy`, `guaranteed`, `risk-free`… La narrativa
// de Scora se escribe EN ESPAÑOL: pasarla por ahí devuelve «sin infracciones» siempre, para
// cualquier texto, incluido «deberías comprar, es una ganancia garantizada sin riesgo». Una
// compuerta que no cierra es peor que ninguna, porque además tranquiliza. Los números sí se
// comprueban con `checkGrounding`, que es independiente del idioma.
//
// ⚠️ Y LO QUE PROHÍBE 5a SIGUE PROHIBIDO: sin CAUSAS («cayó POR los aranceles» — el dato es la
// caída, no el motivo) y sin PRONÓSTICOS («seguirá subiendo»). Un modelo escribe las dos cosas
// con toda naturalidad porque suenan bien; por eso van al listón, no a la instrucción.
// ─────────────────────────────────────────────────────────────────────────────
import { checkGrounding } from "./grounding.ts";
import type { Fila, Hecho } from "./narrativa.ts";
import { redactar } from "./narrativa.ts";

/** Consejo, certeza y venta. En español, que es como se escribe la narrativa. */
export const PATRONES_CONSEJO: { re: RegExp; etiqueta: string }[] = [
  { re: /\b(deber[íi]as?|deber[íi]an?|hay que|conviene)\s+(comprar|vender|invertir|entrar|salir)/i, etiqueta: "recomendación imperativa" },
  { re: /\b(recomiendo|recomendamos|aconsejo|aconsejamos|sugerimos comprar|sugiero comprar)\b/i, etiqueta: "recomendación explícita" },
  { re: /\b(garantizad[oa]s?|asegurad[oa] al 100|sin ning[úu]n riesgo|sin riesgo alguno)\b/i, etiqueta: "certeza falsa" },
  { re: /\b(oportunidad [úu]nica|no te lo pierdas|momento ideal para (comprar|entrar))\b/i, etiqueta: "lenguaje de venta" },
  { re: /\b(chollo|ganancia segura|dinero f[áa]cil)\b/i, etiqueta: "promesa de rentabilidad" },
];

/** Pronóstico: hablar de lo que va a pasar. Los hechos son de lo que YA pasó. */
export const PATRONES_PRONOSTICO: { re: RegExp; etiqueta: string }[] = [
  { re: /\b(seguir[áa]n?|continuar[áa]n?)\s+(subiendo|bajando|cayendo|creciendo)/i, etiqueta: "pronóstico de continuidad" },
  { re: /\b(va|van|ir[áa]n?|iba)\s+a\s+(subir|bajar|caer|recuperarse|dispararse)/i, etiqueta: "pronóstico directo" },
  { re: /\b(se espera que|previsiblemente|es de esperar que|apunta a que)\b/i, etiqueta: "pronóstico atenuado" },
  // Sin `\b` al final: `rebotará` acaba en `á` y la frontera no existe ahí — ver la nota de
  // PATRONES_CAUSA. Este patrón estuvo roto hasta que el test lo cubrió.
  { re: /\b(rebotar[áa]|repuntar[áa]|tocar[áa] fondo)(?=\s|[.,;:!?]|$)/i, etiqueta: "pronóstico de giro" },
];

/**
 * Causa. El dato es que algo cayó; POR QUÉ cayó no está en ninguna serie de precios.
 *
 * ⚠️ El patrón exige un VERBO DE MOVIMIENTO cerca. Sin eso, «por» y «tras» son preposiciones
 * corrientes —«por encima de», «tras el cierre»— y la compuerta rechazaría texto correcto. Un
 * listón que da falsos positivos acaba desactivado, que es la lección de PCG/EIX.
 *
 * ⚠️ **Y NO SE PONE `\b` DETRÁS DE UNA VOCAL ACENTUADA.** En JavaScript `\b` se define sobre
 * `[A-Za-z0-9_]`, y `ó` no está ahí: entre `ó` y el espacio siguiente NO hay frontera, así que
 * `cay[óo]\b` no casa NUNCA con «cayó» —sólo con «cayo»—. El patrón parecía correcto, no daba
 * ningún error, y dejaba pasar exactamente las frases que existe para bloquear. Es el mismo
 * defecto que la `\s` perdida del typecheck: una expresión rota no falla, deja de vigilar.
 */
export const PATRONES_CAUSA: { re: RegExp; etiqueta: string }[] = [
  { re: /(cay[óo]|subi[óo]|baj[óo]|se desplom[óo]|retrocedi[óo]|avanz[óo])[^.]{0,40}?\s(por|debido a|a causa de|tras conocerse|como consecuencia de|impulsad[oa] por|lastrad[oa] por)\s/i, etiqueta: "causa atribuida" },
  { re: /(se explica por|responde a|obedece a|el motivo (es|fue)|la raz[óo]n (es|fue))\s/i, etiqueta: "explicación causal" },
];

/**
 * Pasa los números del español al formato que entiende `checkGrounding`.
 *
 * ⚠️ **LA COMPUERTA NUMÉRICA TAMBIÉN ERA DEPENDIENTE DEL IDIOMA, y de forma peor que la de
 * consejo: no dejaba pasar de más, sino que MARCABA TEXTO CORRECTO.** En español «24,6 %» lleva
 * coma decimal, y `extractNumbers` lo parte en `24` y `6`; el `6` no está en los datos, así que
 * un pie perfectamente cierto se rechazaba. Y una compuerta que rechaza lo bueno se acaba
 * quitando, con lo que también deja de rechazar lo malo.
 *
 * El orden importa: primero el punto de los millares —`1.234` → `1234`— y sólo después la coma
 * decimal. Al revés, `1.234,5` quedaría en `1.234.5`, que no es un número.
 */
export function normalizarNumeros(texto: string): string {
  return String(texto)
    .replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2")
    .replace(/(\d),(\d+)/g, "$1.$2");
}

export interface Revision {
  ok: boolean;
  motivos: string[];
  /** Números del texto que no salen de los hechos. */
  numerosInventados: number[];
}

/**
 * El bloque de datos que se le enseña al modelo Y contra el que se comprueba su salida.
 *
 * Es EL MISMO texto para las dos cosas a propósito: si el prompt y el listón salieran de fuentes
 * distintas, un cambio en uno dejaría al otro comprobando algo que ya no se pide.
 */
export function bloqueDeDatos(hechos: Hecho[], filas: Fila[]): string {
  const lineas = hechos.map((h) => `- ${h.texto}`);
  // ⚠️ LA DIRECCIÓN VA EN PALABRAS Y LA CIFRA EN MAGNITUD. Escribiendo `-24.60`, la prosa
  // correcta «cayó un 24,6 %» quedaba marcada como número inventado: el texto habla de la
  // MAGNITUD y el signo lo lleva el verbo. Poniendo «baja 24.60 %» coinciden, y además el modelo
  // recibe la dirección explícita en vez de tener que deducirla de un menos.
  for (const f of filas) lineas.push(`- ${f.ticker}: ${f.pct < 0 ? "baja" : "sube"} ${Math.abs(f.pct).toFixed(2)} %`);
  return lineas.join("\n");
}

/** La instrucción. Corta a propósito: cuanto más se le pide a un modelo, más se inventa. */
export function construirPrompt(hechos: Hecho[], filas: Fila[]): { sistema: string; usuario: string } {
  return {
    sistema: [
      "Redactas el pie de un panel de mercado, en español de España.",
      "REGLAS, sin excepción:",
      "1. Usa ÚNICAMENTE los datos de abajo. No añadas ni un número, ni un nombre, ni un porcentaje.",
      "2. No expliques POR QUÉ pasó nada. No hay causas en los datos.",
      "3. No digas qué va a pasar. No hay pronósticos.",
      "4. No des consejo de inversión ni sugieras comprar o vender.",
      "5. Dos o tres frases. Si los datos no dan para más, escribe menos.",
    ].join("\n"),
    usuario: `Datos:\n${bloqueDeDatos(hechos, filas)}\n\nEscribe el pie.`,
  };
}

/** Pasa el texto por los cuatro listones. */
export function revisar(texto: string, hechos: Hecho[], filas: Fila[]): Revision {
  const motivos: string[] = [];
  const g = checkGrounding(normalizarNumeros(texto), normalizarNumeros(bloqueDeDatos(hechos, filas)));
  if (!g.ok) motivos.push(`números que no salen de los datos: ${g.violations.join(", ")}`);
  for (const grupo of [PATRONES_CONSEJO, PATRONES_PRONOSTICO, PATRONES_CAUSA]) {
    for (const p of grupo) if (p.re.test(texto)) motivos.push(p.etiqueta);
  }
  if (!texto.trim()) motivos.push("texto vacío");
  return { ok: motivos.length === 0, motivos, numerosInventados: g.violations };
}

export interface Resultado {
  texto: string;
  via: "modelo" | "determinista";
  motivos: string[];
}

/**
 * El texto que se publica.
 *
 * ⚠️ **EL FALLO SIEMPRE CAE HACIA EL LADO CORRECTO.** Si la prosa del modelo no pasa, se publica
 * la de 5a — que es seca pero cierta— y se dice por qué. Nunca se publica prosa sin revisar, y
 * nunca se deja el hueco vacío: las dos cosas serían peores que una frase sosa.
 */
export function prosaOFallback(textoModelo: string | null | undefined, hechos: Hecho[], filas: Fila[]): Resultado {
  const determinista = redactar(hechos);
  if (!textoModelo?.trim()) return { texto: determinista, via: "determinista", motivos: ["el modelo no devolvió texto"] };
  const r = revisar(textoModelo, hechos, filas);
  return r.ok
    ? { texto: textoModelo.trim(), via: "modelo", motivos: [] }
    : { texto: determinista, via: "determinista", motivos: r.motivos };
}
