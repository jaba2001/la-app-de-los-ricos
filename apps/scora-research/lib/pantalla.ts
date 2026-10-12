// La «foto» de la página que lee el asistente (components/ScreenAssistant.tsx).
//
// QUÉ SE CAPTURA. Lo que vería alguien mirando la pantalla, en una forma que un modelo lee bien:
//   · el TEXTO tal como se pinta (lo oculto no cuenta), con los títulos marcados (#), las
//     tablas por filas (| a | b |), los controles entre corchetes ([Run backtest]) y el valor
//     de los campos y desplegables;
//   · DÓNDE está cada cosa: encima, a la vista o debajo de lo que el usuario tiene en pantalla.
//     Así «¿qué significa esto?» se responde sobre lo visible y no sobre la página entera;
//   · los GRÁFICOS visibles convertidos en PNG (con su leyenda dibujada debajo). El texto de un
//     gráfico de Recharts son solo los ejes; la forma de la curva solo se ve en la imagen.
//
// POR QUÉ NO UNA CAPTURA DE PANTALLA DE VERDAD. El navegador no deja hacerla sin pedir permiso
// cada vez (getDisplayMedia), y en el móvil no existe. Rasterizar el HTML entero pide una
// librería. Y para una app de finanzas el texto es MEJOR que los píxeles: las cifras llegan
// exactas, sin leerlas de una imagen, y son las mismas contra las que el servidor comprueba el
// grounding. Los gráficos son lo único que el texto no cuenta, y un <svg> sí se puede pasar a
// PNG sin dependencias.
//
// Las contraseñas no se leen nunca, ni los campos ocultos.
//
// Sin imports a propósito: montarTexto() es puro y lo prueba scripts/asistente.test.mjs.

export type Zona = "arriba" | "visible" | "abajo";
export interface Linea { texto: string; zona: Zona }
export interface ImagenGrafico { media_type: "image/png"; data: string; label: string }
export interface Captura {
  path: string;
  title: string;
  text: string;
  selection: string;
  images: ImagenGrafico[];
}

/** ~7.500 tokens. Una página normal de Scora ocupa 5-20 mil caracteres. */
export const MAX_TEXTO = 30_000;
export const MAX_GRAFICOS = 4;
/** Atributo que marca lo que NO es la página (el propio panel del asistente). */
export const ATRIBUTO_EXCLUIR = "data-sr-asistente";

const MARCA: Record<Zona, string> = {
  arriba: "--- above the visible area (the user has scrolled past this) ---",
  visible: "--- VISIBLE ON SCREEN NOW ---",
  abajo: "--- below the visible area (not scrolled to yet) ---",
};

/**
 * Junta las líneas en el texto final, con una marca cada vez que cambia la zona.
 *
 * Si no cabe en `max`, se queda con TODO lo visible y va añadiendo lo más cercano por arriba y
 * por abajo, alternando, hasta llenar. Lo que se salta queda como «[…]», y el modelo sabe que
 * falta algo en vez de creer que la página acaba ahí.
 */
export function montarTexto(lineas: Linea[], max = MAX_TEXTO): string {
  const largo = (l: Linea) => l.texto.length + 1;
  let total = 0;
  for (const l of lineas) total += largo(l);

  let incluida: boolean[];
  let recortado = false;
  if (total <= max) {
    incluida = lineas.map(() => true);
  } else {
    recortado = true;
    incluida = lineas.map(() => false);
    let libre = max;
    const visibles = lineas.map((l, i) => (l.zona === "visible" ? i : -1)).filter((i) => i >= 0);
    // Lo visible primero, en orden; si ni eso cabe, lo de más arriba de la pantalla.
    for (const i of visibles) {
      if (largo(lineas[i]) > libre) break;
      incluida[i] = true;
      libre -= largo(lineas[i]);
    }
    // Y luego hacia fuera desde lo visible (o desde el principio si no hay nada a la vista).
    let arriba = visibles.length ? visibles[0] - 1 : -1;
    let abajo = visibles.length ? visibles[visibles.length - 1] + 1 : 0;
    let turnoAbajo = true;
    while (libre > 0 && (arriba >= 0 || abajo < lineas.length)) {
      const i = (turnoAbajo && abajo < lineas.length) || arriba < 0 ? abajo++ : arriba--;
      turnoAbajo = !turnoAbajo;
      if (incluida[i]) continue;
      if (largo(lineas[i]) > libre) { libre = 0; break; }
      incluida[i] = true;
      libre -= largo(lineas[i]);
    }
  }

  const fuera: string[] = [];
  let zona: Zona | null = null;
  let hueco = false;
  lineas.forEach((l, i) => {
    if (!incluida[i]) { hueco = true; return; }
    if (hueco) fuera.push("[…]");
    hueco = false;
    if (l.zona !== zona) { fuera.push(MARCA[l.zona]); zona = l.zona; }
    fuera.push(l.texto);
  });
  if (recortado) fuera.push("[… page text trimmed to fit]");
  return fuera.join("\n");
}

// ── Lectura del DOM ──────────────────────────────────────────────────────────────────

const SALTAR = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "VIDEO", "AUDIO", "LINK", "META", "HEAD"]);
const ENCABEZADO: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const DISPLAY_EN_LINEA = new Set(["inline", "inline-block", "inline-flex", "inline-grid", "contents", "table-cell", "ruby"]);
// Un <svg> más pequeño que esto es un icono, no un gráfico.
const GRAFICO_MIN_ANCHO = 150, GRAFICO_MIN_ALTO = 80;

const plegar = (s: string) => s.replace(/\s+/g, " ").trim();
const recortar = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function zonaDe(el: Element): Zona {
  const r = el.getBoundingClientRect();
  if (r.bottom <= 0) return "arriba";
  if (r.top >= window.innerHeight) return "abajo";
  return "visible";
}

function seVe(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
  if (cs.opacity === "0") return false;
  // checkVisibility cubre además lo que hay dentro de un <details> cerrado.
  const conCheck = el as Element & { checkVisibility?: (o?: object) => boolean };
  return conCheck.checkVisibility ? conCheck.checkVisibility() : true;
}

interface Grafico { el: Element; n: number; titulo: string; zona: Zona; area: number }

class Lector {
  lineas: Linea[] = [];
  graficos: Grafico[] = [];
  private actual = "";
  private zonaActual: Zona = "visible";
  private ultimoTitulo = "";

  cortar() {
    const t = plegar(this.actual);
    if (t) {
      this.lineas.push({ texto: t, zona: this.zonaActual });
      if (t.length <= 70) this.ultimoTitulo = t.replace(/^#+ /, "");
    }
    this.actual = "";
  }

  /** Añade texto a la línea en curso, separándolo de lo anterior si hace falta. */
  escribir(texto: string, desde: Element) {
    if (!texto.trim()) { if (this.actual && !this.actual.endsWith(" ")) this.actual += " "; return; }
    if (!this.actual.trim()) this.zonaActual = zonaDe(desde);
    this.actual += texto;
  }

  /** Para piezas sueltas (un control, un hueco de flex): con espacio delante. */
  pieza(texto: string, desde: Element) {
    if (this.actual && !/\s$/.test(this.actual)) this.actual += " ";
    this.escribir(texto, desde);
  }

  linea(texto: string, desde: Element) {
    this.cortar();
    this.escribir(texto, desde);
    this.cortar();
  }

  leer(nodo: Node, padreEnFila = false) {
    if (nodo.nodeType === Node.TEXT_NODE) {
      const p = nodo.parentElement;
      if (p) this.escribir((nodo as Text).data.replace(/\s+/g, " "), p);
      return;
    }
    if (nodo.nodeType !== Node.ELEMENT_NODE) return;
    const el = nodo as Element;
    const tag = el.tagName.toUpperCase();
    if (SALTAR.has(tag) || el.hasAttribute(ATRIBUTO_EXCLUIR) || el.getAttribute("aria-hidden") === "true") return;
    const cs = getComputedStyle(el);
    if (!seVe(el, cs)) return;

    if (tag === "SVG" || tag === "CANVAS") return this.leerGrafico(el);
    if (tag === "IMG") {
      const alt = plegar(el.getAttribute("alt") ?? "");
      if (alt) this.pieza(`[image: ${recortar(alt, 120)}]`, el);
      return;
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return this.leerCampo(el);
    if (tag === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "tab") {
      const nombre = plegar(el.getAttribute("aria-label") || (el as HTMLElement).innerText || "");
      if (nombre) this.pieza(`[${recortar(nombre, 80)}]${marcado(el) ? " (selected)" : ""}`, el);
      return;
    }
    if (tag === "TABLE") return this.leerTabla(el as HTMLTableElement);
    if (tag === "BR") { this.cortar(); return; }
    // Un <details> cerrado solo enseña su <summary>: lo de dentro no se pinta, pero su texto es
    // hijo directo del <details> (visible), así que seVe() no lo descartaría.
    if (tag === "DETAILS" && !(el as HTMLDetailsElement).open) {
      const resumen = el.querySelector(":scope > summary");
      if (resumen) { this.cortar(); this.leer(resumen); this.cortar(); }
      return;
    }
    // La leyenda de Recharts ya va en la línea de su gráfico (leerGrafico), con el nombre de cada serie.
    if (el.classList.contains("recharts-legend-wrapper")) return;

    const nivel = ENCABEZADO[tag];
    const enLinea = DISPLAY_EN_LINEA.has(cs.display) && tag !== "LI";
    // Los hijos de una fila flex (cifras y etiquetas de una tarjeta, pestañas…) siguen en la
    // misma línea, separados: «P/E 23.4» y no «P/E» y «23.4» en dos líneas sueltas.
    const esFila = (cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection.startsWith("row");

    if (nivel) { this.cortar(); this.escribir("#".repeat(nivel) + " ", el); }
    else if (tag === "LI") { this.cortar(); this.escribir("- ", el); }
    else if (padreEnFila) { if (this.actual.trim()) this.actual += "  "; }
    else if (!enLinea) this.cortar();

    for (const hijo of el.childNodes) this.leer(hijo, esFila);
    if (tag === "A" && marcado(el)) this.escribir(" (selected)", el);

    if (nivel || tag === "LI" || (!enLinea && !padreEnFila)) this.cortar();
  }

  private leerCampo(el: Element) {
    const tag = el.tagName.toUpperCase();
    const etiqueta = plegar(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || "");
    if (tag === "SELECT") {
      const s = el as HTMLSelectElement;
      const elegida = plegar(s.selectedOptions[0]?.text ?? "");
      this.pieza(`[dropdown${etiqueta ? ` ${etiqueta}` : ""}: ${elegida || "—"}]`, el);
      return;
    }
    const tipo = (el.getAttribute("type") || "text").toLowerCase();
    if (tipo === "hidden" || tipo === "password") return;
    const campo = el as HTMLInputElement;
    if (tipo === "checkbox" || tipo === "radio") {
      this.pieza(`[${tipo}${etiqueta ? ` ${etiqueta}` : ""}: ${campo.checked ? "on" : "off"}]`, el);
      return;
    }
    if (tipo === "submit" || tipo === "button") {
      if (campo.value) this.pieza(`[${recortar(campo.value, 80)}]`, el);
      return;
    }
    this.pieza(`[${tag === "TEXTAREA" ? "text box" : "field"}${etiqueta ? ` ${etiqueta}` : ""}: ${recortar(plegar(campo.value), 200) || "empty"}]`, el);
  }

  private leerTabla(tabla: HTMLTableElement) {
    this.cortar();
    if (tabla.caption) this.linea(`Table: ${plegar(tabla.caption.innerText)}`, tabla);
    for (const fila of tabla.rows) {
      if (!seVe(fila, getComputedStyle(fila))) continue;
      const celdas = [...fila.cells].map((c) => plegar(c.innerText).replace(/\|/g, "/"));
      if (celdas.some(Boolean)) this.linea(`| ${celdas.join(" | ")} |`, fila);
    }
  }

  private leerGrafico(el: Element) {
    const r = el.getBoundingClientRect();
    if (r.width < GRAFICO_MIN_ANCHO || r.height < GRAFICO_MIN_ALTO) return; // un icono
    const zona = zonaDe(el);
    const n = this.graficos.length + 1;
    this.graficos.push({ el, n, titulo: this.ultimoTitulo, zona, area: visibleArea(r) });
    // Las etiquetas de texto del gráfico (ejes, valores) también van en el texto: es lo que el
    // filtro de grounding puede comprobar, y lo único que hay de los gráficos fuera de pantalla.
    const etiquetas = el.tagName.toUpperCase() === "SVG"
      ? [...new Set([...el.querySelectorAll("text")].map((t) => plegar(t.textContent ?? "")).filter(Boolean))]
      : [];
    const leyenda = leyendaDe(el).map((x) => x.texto);
    const partes = [
      `[Chart ${n}${this.ultimoTitulo ? ` "${recortar(this.ultimoTitulo, 70)}"` : ""} — {{IMAGEN_${n}}}`,
      leyenda.length ? `legend: ${leyenda.join(", ")}` : "",
      etiquetas.length ? `labels: ${recortar(etiquetas.join(" · "), 600)}` : "",
    ].filter(Boolean);
    this.linea(partes.join("; ") + "]", el);
  }
}

function marcado(el: Element) {
  return el.getAttribute("aria-current") === "page" || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true";
}

function visibleArea(r: DOMRect) {
  const alto = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  const ancho = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  return alto * ancho;
}

/** La leyenda HTML de un gráfico de Recharts: color y nombre de cada serie. */
function leyendaDe(el: Element): { texto: string; color: string }[] {
  const caja = el.closest(".recharts-wrapper");
  if (!caja) return [];
  return [...caja.querySelectorAll(".recharts-legend-item")].map((item) => {
    const icono = item.querySelector("path, rect, line, circle");
    const cs = icono ? getComputedStyle(icono) : null;
    const color = cs && cs.fill && cs.fill !== "none" ? cs.fill : cs?.stroke || "#888";
    return { texto: plegar((item as HTMLElement).innerText), color };
  }).filter((x) => x.texto);
}

// ── Gráficos a PNG ───────────────────────────────────────────────────────────────────

// Lo que define cómo se pinta un SVG y que a menudo llega por CSS (variables --sr-*, clases):
// fuera de la página, como imagen suelta, esas reglas no existen, así que se copian los
// valores ya resueltos a cada elemento.
const ESTILOS_SVG = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "text-anchor",
  "dominant-baseline", "visibility", "display"];
const ANCHO_MAX_PNG = 1000;

function fondoDe(el: Element): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return "#ffffff";
}

function cargarImagen(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => mal(new Error("svg no rasterizable"));
    img.src = url;
  });
}

async function svgAPng(svg: SVGSVGElement): Promise<string | null> {
  const r = svg.getBoundingClientRect();
  const clon = svg.cloneNode(true) as SVGSVGElement;
  const originales = [svg, ...svg.querySelectorAll("*")];
  const copias = [clon, ...clon.querySelectorAll("*")] as (SVGElement)[];
  originales.forEach((o, i) => {
    const cs = getComputedStyle(o);
    for (const p of ESTILOS_SVG) copias[i]?.style?.setProperty(p, cs.getPropertyValue(p));
  });
  clon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clon.setAttribute("width", String(r.width));
  clon.setAttribute("height", String(r.height));

  const leyenda = leyendaDe(svg);
  const escala = Math.min(2, ANCHO_MAX_PNG / r.width);
  const altoLeyenda = leyenda.length ? 28 : 0;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(r.width * escala);
  canvas.height = Math.round((r.height + altoLeyenda) * escala);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(escala, escala);
  ctx.fillStyle = fondoDe(svg);
  ctx.fillRect(0, 0, r.width, r.height + altoLeyenda);

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clon)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    ctx.drawImage(await cargarImagen(url), 0, 0, r.width, r.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  // La leyenda de Recharts es HTML, no está dentro del <svg>: se dibuja debajo para que los
  // colores de la imagen tengan nombre.
  if (leyenda.length) {
    ctx.font = "12px sans-serif";
    ctx.textBaseline = "middle";
    let x = 8;
    for (const { texto, color } of leyenda) {
      ctx.fillStyle = color;
      ctx.fillRect(x, r.height + 9, 10, 10);
      ctx.fillStyle = "#0E1A2B";
      ctx.fillText(texto, x + 14, r.height + 14);
      x += 14 + ctx.measureText(texto).width + 16;
    }
  }
  return canvas.toDataURL("image/png");
}

async function aPng(el: Element): Promise<string | null> {
  try {
    if (el.tagName.toUpperCase() === "CANVAS") return (el as HTMLCanvasElement).toDataURL("image/png");
    return await svgAPng(el as SVGSVGElement);
  } catch {
    // Un canvas «contaminado» por imágenes de otro origen, o un SVG que el navegador no sabe
    // pintar suelto: ese gráfico se queda en texto, el resto de la foto sigue.
    return null;
  }
}

// Los gráficos de la última foto, en el orden en que se numeraron («Chart 1», «Chart 2»…). Para
// que lib/resaltar.ts encuentre el gráfico que cita el modelo: es el mismo que él vio.
let ultimosGraficos: Element[] = [];
export const graficosCapturados = () => ultimosGraficos;

/** La foto completa de la página. `seleccion` la guarda el panel (al hacer clic en él se pierde). */
export async function capturarPantalla(seleccion = ""): Promise<Captura> {
  const lector = new Lector();
  lector.leer(document.body);
  lector.cortar();
  ultimosGraficos = lector.graficos.map((g) => g.el);

  // Imagen para los gráficos que más se ven, hasta MAX_GRAFICOS.
  const elegidos = lector.graficos.filter((g) => g.zona === "visible" && g.area > 0)
    .sort((a, b) => b.area - a.area).slice(0, MAX_GRAFICOS);
  const images: ImagenGrafico[] = [];
  const conImagen = new Map<number, number>();
  for (const g of elegidos.sort((a, b) => a.n - b.n)) {
    const png = await aPng(g.el);
    const data = png?.startsWith("data:image/png;base64,") ? png.slice("data:image/png;base64,".length) : null;
    if (!data) continue;
    images.push({ media_type: "image/png", data, label: `Chart ${g.n}${g.titulo ? ` "${recortar(g.titulo, 70)}"` : ""}` });
    conImagen.set(g.n, images.length);
  }

  const text = montarTexto(lector.lineas).replace(/\{\{IMAGEN_(\d+)\}\}/g, (_, n) => {
    const i = conImagen.get(Number(n));
    return i ? `image ${i} attached` : "no image (off screen or not renderable)";
  });

  return {
    path: location.pathname + location.search,
    title: document.title,
    text,
    selection: seleccion.slice(0, 4000),
    images,
  };
}
