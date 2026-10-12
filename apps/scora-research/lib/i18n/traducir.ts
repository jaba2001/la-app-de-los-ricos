// Traducción de la interfaz (12-10-2026: inglés y español, a elegir por el usuario).
//
// CÓMO FUNCIONA. El texto de la app se escribe en inglés y ESE texto es la clave: el
// diccionario dice cómo se dice en español. Si una frase no está, sale en inglés — nunca rota
// ni vacía. scripts/i18n.test.mjs avisa de las que faltan.
//
// Las frases con datos se traducen ya montadas: «You hold 5 names» encaja con la plantilla
// «You hold {n} names» → «Tienes {n} nombres», y el 5 pasa tal cual. Así ni los componentes ni
// lib/ tienen que cambiar cómo construyen sus textos: basta con envolver el resultado en t().
//
// Funciones puras, sin React: las usan el cliente, el servidor y las pruebas.

export type Idioma = "en" | "es";
export const IDIOMAS: readonly Idioma[] = ["en", "es"] as const;
export const IDIOMA_POR_DEFECTO: Idioma = "en";
export const COOKIE_IDIOMA = "scora_idioma";

export const esIdioma = (x: unknown): x is Idioma => x === "en" || x === "es";

/** Del encabezado Accept-Language del navegador: «es-ES,es;q=0.9,en;q=0.8» → "es". */
export function idiomaDeNavegador(acepta: string | null | undefined): Idioma {
  for (const parte of (acepta ?? "").split(",")) {
    const cod = parte.trim().split(";")[0].toLowerCase().slice(0, 2);
    if (esIdioma(cod)) return cod;
  }
  return IDIOMA_POR_DEFECTO;
}

type Plantilla = { re: RegExp; nombres: string[]; destino: string };

const MARCA = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
// Los espacios de no separación (&nbsp;) cuentan como espacios normales al buscar.
const normal = (s: string) => s.replace(/\u00a0/g, " ");
const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Prepara un diccionario: entradas exactas y plantillas con {marcas}. */
export function compilar(dic: Record<string, string>) {
  const exactas = new Map<string, string>();
  const plantillas: Plantilla[] = [];
  for (const [enCrudo, es] of Object.entries(dic)) {
    const en = normal(enCrudo);
    if (!MARCA.test(en)) { exactas.set(en, es); continue; }
    MARCA.lastIndex = 0;
    const nombres: string[] = [];
    let patron = "^", ultimo = 0;
    for (const m of en.matchAll(MARCA)) {
      patron += escaparRe(en.slice(ultimo, m.index)) + "([\\s\\S]*?)";
      nombres.push(m[1]);
      ultimo = (m.index ?? 0) + m[0].length;
    }
    patron += escaparRe(en.slice(ultimo)) + "$";
    // Una plantilla que es solo marcas («{x}») encajaría con cualquier cosa.
    if (en.replace(MARCA, "").trim().length < 2) continue;
    plantillas.push({ re: new RegExp(patron, "s"), nombres, destino: es });
  }
  // Las más largas primero: «Only {n} observations.» antes que «{n} observations.».
  plantillas.sort((a, b) => b.re.source.length - a.re.source.length);
  return { exactas, plantillas, cache: new Map<string, string>() };
}

export type Compilado = ReturnType<typeof compilar>;

/** Traduce un texto ya montado. Respeta los espacios del principio y del final. */
export function traducir(texto: string, idioma: Idioma, dic: Compilado): string {
  if (idioma === "en" || !texto) return texto;
  const enCache = dic.cache.get(texto);
  if (enCache !== undefined) return enCache;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(texto)!;
  const [, antes, nucleoCrudo, despues] = m;
  const nucleo = normal(nucleoCrudo);
  let fuera = dic.exactas.get(nucleo);
  if (fuera === undefined) {
    for (const p of dic.plantillas) {
      const r = p.re.exec(nucleo);
      if (!r) continue;
      // Los trozos variables también se traducen si son frases conocidas: así una lectura
      // compuesta («The real yield has fallen {a} points. {b}») sale entera en español aunque
      // {b} sea otra frase. Cada trozo es más corto que el texto, así que la recursión acaba.
      const valores = Object.fromEntries(p.nombres.map((n, i) => {
        const v = r[i + 1];
        return [n, /[a-zA-Z]{3,}/.test(v) && v.length < nucleo.length ? traducir(v, idioma, dic) : v];
      }));
      fuera = p.destino.replace(MARCA, (_, n: string) => valores[n] ?? `{${n}}`);
      break;
    }
  }
  const resultado = fuera === undefined ? texto : antes + fuera + despues;
  if (dic.cache.size < 5000) dic.cache.set(texto, resultado);
  return resultado;
}

/** Parte un párrafo montado con frases sueltas («The S&P 500 closed +0.4%. It moved…») para
 *  traducirlas una a una: el párrafo entero no está en el diccionario, cada frase sí. */
export const frases = (s: string): string[] => s.split(/(?<=[.!?])\s+(?=[A-Z¿¡])/);

/** ¿Está esta frase en el diccionario (exacta o por plantilla)? Aunque se diga igual. */
export function tieneTraduccion(texto: string, dic: Compilado): boolean {
  const nucleo = normal(texto.trim());
  if (!nucleo) return true;
  if (dic.exactas.has(nucleo)) return true;
  return dic.plantillas.some((p) => p.re.test(nucleo));
}

/**
 * Texto con marcas de formato: «Regresses <b>your portfolio</b> returns». Devuelve los trozos
 * para que React los pinte, cada uno con la etiqueta que lo envuelve (o null).
 */
export function trocear(texto: string): { etiqueta: string | null; texto: string }[] {
  const out: { etiqueta: string | null; texto: string }[] = [];
  const re = /<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/g;
  let ultimo = 0;
  for (const m of texto.matchAll(re)) {
    if ((m.index ?? 0) > ultimo) out.push({ etiqueta: null, texto: texto.slice(ultimo, m.index) });
    out.push({ etiqueta: m[1], texto: m[2] });
    ultimo = (m.index ?? 0) + m[0].length;
  }
  if (ultimo < texto.length) out.push({ etiqueta: null, texto: texto.slice(ultimo) });
  return out;
}

/** Locale de Intl para fechas y números. */
export const LOCALE: Record<Idioma, string> = { en: "en-US", es: "es-ES" };
