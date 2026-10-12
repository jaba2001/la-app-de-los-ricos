// Lleva al usuario hasta lo que cita el asistente y lo resalta, como la extensión de Claude.
//
// El modelo cita el texto de la página entre [[dobles corchetes]] (ver SISTEMA en
// lib/server/asistente.js) y el panel convierte cada cita en un enlace. Al pulsarlo, esto busca
// el texto en la página, la desplaza hasta él y lo marca.
//
// CÓMO SE BUSCA. Sin espacios: la foto (lib/pantalla.ts) los pone a su manera («Sharpe 1.42»
// para dos <span> pegados, o al revés), y compararlos haría fallar citas buenas. Sin mayúsculas
// y con comillas y guiones unificados, porque el modelo a veces los «corrige». Si la cita
// entera no aparece, se prueba con sus trozos (una fila de tabla citada con sus «|»).
//
// CÓMO SE MARCA. Con la CSS Custom Highlight API, que pinta un rango sin tocar el DOM: React
// gestiona esos nodos y envolverlos en un <mark> los rompería al siguiente render. Encima, un
// destello breve para que el ojo lo encuentre. Sin esa API (navegadores viejos), recuadros
// superpuestos.
//
// Las funciones puras van primero y sin DOM: las prueba scripts/asistente.test.mjs.
import { ATRIBUTO_EXCLUIR, graficosCapturados } from "./pantalla.ts";

/** Un carácter a su forma de búsqueda. Devuelve una cadena: toLowerCase puede dar dos. */
function normalChar(c: string): string {
  if (c === "’" || c === "‘" || c === "`" || c === "´") return "'";
  if (c === "“" || c === "”") return '"';
  if (c === "–" || c === "—" || c === "−") return "-";
  return c.toLowerCase();
}

const ESPACIO = /\s/;

/** Un texto a su forma de búsqueda: sin espacios, en minúsculas, comillas y guiones unificados. */
export function normalizar(s: string): string {
  let o = "";
  for (let i = 0; i < s.length; i++) if (!ESPACIO.test(s[i])) o += normalChar(s[i]);
  return o;
}

/**
 * Lo que se busca para una cita, de más a menos fiel: la cita limpia de adornos (corchetes,
 * comillas, «…» final) y después sus trozos, del más largo al más corto.
 */
export function candidatos(cita: string): string[] {
  const limpia = cita.trim()
    .replace(/^[[\]"'“”«»|\s]+|[[\]"'“”«»|\s]+$/g, "")
    .replace(/(…|\.\.\.)$/, "");
  const trozos = limpia.split(/\s*(?:\||·|…|\.\.\.)\s*/).sort((a, b) => b.length - a.length);
  return [...new Set([limpia, ...trozos].map(normalizar))].filter((x) => x.length >= 2);
}

/** Las posiciones de todas las apariciones de `aguja` en `pajar`. */
export function ocurrencias(pajar: string, aguja: string): number[] {
  const out: number[] = [];
  for (let i = pajar.indexOf(aguja); i !== -1; i = pajar.indexOf(aguja, i + 1)) out.push(i);
  return out;
}

/** «Chart 2», «[Chart 2 "Exposure"]»… → 2. Los gráficos se citan por su número en la foto. */
export function numeroDeGrafico(cita: string): number | null {
  const m = /^\[?\s*chart\s+(\d+)\b/i.exec(cita.trim());
  return m ? Number(m[1]) : null;
}

// ── En la página ─────────────────────────────────────────────────────────────────────

const NOMBRE = "sr-asis";
let capa: HTMLDivElement | null = null;
let quitarEscucha: (() => void) | null = null;
let estiloListo = false;

/**
 * El color de lo resaltado. Va aquí y no en ScreenAssistant.css porque el parser de CSS de
 * Turbopack no entiende ::highlight() y rechaza la hoja entera. Hoja construible: no añade nodos.
 */
function asegurarEstilo() {
  if (estiloListo) return;
  estiloListo = true;
  const regla = `::highlight(${NOMBRE}) { background-color: rgba(212, 160, 23, 0.45); color: inherit; }`;
  try {
    const hoja = new CSSStyleSheet();
    hoja.replaceSync(regla);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];
  } catch {
    const s = document.createElement("style");
    s.textContent = regla;
    document.head.appendChild(s);
  }
}

interface Indice { plano: string; pos: { nodo: Text; i: number }[] }

/** El texto visible de la página en forma de búsqueda, con el nodo y la posición de cada carácter. */
function indexar(): Indice {
  const visible = new Map<Element, boolean>();
  const seVe = (el: Element) => {
    let v = visible.get(el);
    if (v === undefined) {
      const c = el as Element & { checkVisibility?: (o?: object) => boolean };
      if (c.checkVisibility) v = c.checkVisibility({ visibilityProperty: true, opacityProperty: true });
      else { const cs = getComputedStyle(el); v = cs.display !== "none" && cs.visibility !== "hidden"; }
      visible.set(el, v);
    }
    return v;
  };
  const recorrido = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || p.closest(`[${ATRIBUTO_EXCLUIR}], script, style, noscript, template`)) return NodeFilter.FILTER_REJECT;
      return seVe(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let plano = "";
  const pos: Indice["pos"] = [];
  for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
    const nodo = n as Text, d = nodo.data;
    for (let i = 0; i < d.length; i++) {
      if (ESPACIO.test(d[i])) continue;
      for (const x of normalChar(d[i])) { plano += x; pos.push({ nodo, i }); }
    }
  }
  return { plano, pos };
}

/** Desplaza la página para que `rect` (de `el`) quede centrado en la pantalla. */
function centrar(el: Element, rect: DOMRect) {
  // Un elemento corto se centra él mismo (eso mueve también los contenedores con scroll que
  // haya en medio); de uno largo, como un párrafo entero, se centra solo el trozo citado.
  if (rect.height < window.innerHeight * 0.6 && el.getBoundingClientRect().height < window.innerHeight * 0.6) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 2, behavior: "smooth" });
  }
}

/** Recuadros sobre la página, en coordenadas del documento (siguen al hacer scroll). */
function recuadros(rects: DOMRect[], clase: string) {
  if (!capa) {
    capa = document.createElement("div");
    capa.setAttribute(ATRIBUTO_EXCLUIR, "");
    capa.className = "sr-asis-capa";
    document.body.appendChild(capa);
  }
  for (const r of rects) {
    if (!r.width || !r.height) continue;
    const caja = document.createElement("div");
    caja.className = `sr-asis-marca ${clase}`;
    Object.assign(caja.style, {
      left: `${r.left + window.scrollX - 3}px`, top: `${r.top + window.scrollY - 2}px`,
      width: `${r.width + 6}px`, height: `${r.height + 4}px`,
    });
    capa.appendChild(caja);
    // El destello se va solo; las marcas fijas, al limpiar.
    if (clase === "sr-asis-marca-destello") caja.addEventListener("animationend", () => caja.remove());
  }
}

/** Quita lo resaltado. También al hacer clic en la página o al cambiar de ruta (el panel). */
export function limpiarResaltado() {
  const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
  css?.highlights?.delete(NOMBRE);
  capa?.remove();
  capa = null;
  quitarEscucha?.();
  quitarEscucha = null;
}

/** Al primer clic fuera del panel, se quita la marca: el usuario ya está en otra cosa. */
function limpiarAlTocarLaPagina() {
  const alPulsar = (e: PointerEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(`[${ATRIBUTO_EXCLUIR}]`)) limpiarResaltado();
  };
  document.addEventListener("pointerdown", alPulsar, true);
  quitarEscucha = () => document.removeEventListener("pointerdown", alPulsar, true);
}

/**
 * Busca la cita en la página, la desplaza hasta ella y la resalta. `vez` elige la aparición
 * (pulsar otra vez la misma cita lleva a la siguiente). Devuelve cuántas hay: 0 = no está.
 */
export function resaltarEnPagina(cita: string, vez = 0): { total: number } {
  limpiarResaltado();

  const n = numeroDeGrafico(cita);
  if (n != null) {
    const el = graficosCapturados()[n - 1];
    if (!el?.isConnected) return { total: 0 };
    const rect = el.getBoundingClientRect();
    centrar(el, rect);
    recuadros([rect], "sr-asis-marca-grafico");
    limpiarAlTocarLaPagina();
    return { total: 1 };
  }

  const { plano, pos } = indexar();
  const main = document.querySelector("main");
  for (const q of candidatos(cita)) {
    const todas = ocurrencias(plano, q);
    if (!todas.length) continue;
    // Primero lo del contenido y después lo de la barra o el pie: «Macro» está en el menú, pero
    // casi nunca es eso lo que se cita.
    const dentro = (i: number) => !!main?.contains(pos[i].nodo);
    const orden = [...todas.filter(dentro), ...todas.filter((i) => !dentro(i))];
    const ini = pos[orden[vez % orden.length]], fin = pos[orden[vez % orden.length] + q.length - 1];
    const rango = document.createRange();
    rango.setStart(ini.nodo, ini.i);
    rango.setEnd(fin.nodo, fin.i + 1);

    centrar(ini.nodo.parentElement ?? document.body, rango.getBoundingClientRect());
    const rects = [...rango.getClientRects()];
    const Resaltado = (globalThis as { Highlight?: new (r: Range) => unknown }).Highlight;
    const css = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    if (Resaltado && css?.highlights) {
      asegurarEstilo();
      css.highlights.set(NOMBRE, new Resaltado(rango));
      recuadros(rects, "sr-asis-marca-destello");
    } else {
      recuadros(rects, "sr-asis-marca-fija");
    }
    limpiarAlTocarLaPagina();
    return { total: orden.length };
  }
  return { total: 0 };
}
