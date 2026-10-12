// Vigilantes compartidos por las pruebas con sesión (e2e/sesion/*.spec.ts).
// Fichero aparte porque importar un .spec desde otro registraría sus pruebas dos veces.
import type { Page, Request } from "@playwright/test";

// Ruido que no es un fallo de la app (igual que en e2e/publico.spec.ts).
export const RUIDO = /favicon|manifest|sw\.js|swe-worker|posthog|sentry|_vercel/i;

export const TEXTOS_ROTOS = [
  /\bNaN\b/, /\bundefined\b/, /Invalid Date/, /\[object Object\]/, /\bnull\b(?!\s+hypothes)/, /-?Infinity/,
  /Couldn't load this data/, /Couldn't save/, /Application error/, /Something went wrong/i,
];

// Español en pantalla. Dos niveles para no confundir inglés con español:
//   · palabras que NO existen en inglés: basta una;
//   · palabras cortas que sí podrían aparecer (nombres propios, titulares): hacen falta dos.
const ESPANOL_SEGURO = /(?:^|[^\p{L}_])(?:está|están|según|también|cuando|porque|años?|meses|semanas?|régimen|señal(?:es)?|fricción|precio|cartera|beneficio|ingresos|ventas|deuda|caja|riesgo|crecimiento|inversión|análisis|datos|últim[oa]s?|próxim[oa]s?|días|hoy|ayer|cargando|guardar|añadir|agregar|eliminar|quitar|ningun[oa]|todavía|aún|sólo|más|desde|hasta|mientras|explotación|patrimonio|impago|confianza|calidad|ajustar|escenarios?|varianza)(?![\p{L}_])|[¿¡]/iu;
const ESPANOL_DEBIL = /(?:^|[^\p{L}_])(?:de la|de los|de las|del|los|las|que|para|sin|con|una|por|sobre|entre|tras|hay)(?![\p{L}_])/giu;
// Los nombres de campo en snake_case (cartera_quadrant, en la pestaña Raw Data) son
// identificadores, no texto: el «_» cuenta como parte de la palabra.
// Y cualquier palabra con á, í, ó, ú o ñ («Expansión», «Transición»): en inglés no aparecen.
// La é se deja fuera a propósito (Nestlé, Société, café).
const ACENTO = /(?:^|[^\p{L}_])\p{L}*[áíóúñÁÍÓÚÑ]\p{L}*(?![\p{L}_])/u;
// Nombres propios que disparan lo anterior sin ser texto de la interfaz.
const NOMBRES = /Mercado Libre|Las Vegas|Los Angeles|Del Monte|Banco [A-Z]\w+|Grupo [A-Z]\w+|Telef[oó]nica|S[aã]o Paulo|L[oó]pez de Prado/g;

export function lineasEnEspanol(texto: string): string[] {
  const out: string[] = [];
  for (const bruta of texto.split("\n")) {
    const l = bruta.replace(NOMBRES, "").trim();
    if (!l) continue;
    const debiles = new Set((l.match(ESPANOL_DEBIL) ?? []).map((x) => x.trim().toLowerCase()));
    if (ESPANOL_SEGURO.test(l) || ACENTO.test(l) || debiles.size >= 2) out.push(l.slice(0, 120));
  }
  return out;
}

/** Engancha los vigilantes. `donde()` dice en qué pestaña está, para que el informe sea legible. */
export function vigilar(page: Page, donde: () => string) {
  const problemas: string[] = [];
  const anota = (s: string) => problemas.push(`[${donde()}] ${s}`);
  page.on("console", (m) => { if (m.type() === "error" && !RUIDO.test(m.text()) && !/Failed to load resource/.test(m.text())) anota(`consola: ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => anota(`excepción: ${e.message.slice(0, 300)}`));
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/batch") && r.ok()) {
      // El lote responde 200 y lleva el estado de cada subpetición dentro.
      try {
        const req = JSON.parse(r.request().postData() || "{}") as { requests?: { id: string; path: string }[] };
        const j = await r.json() as { results?: { id: string; status: number; body?: unknown }[] };
        const rutas = Object.fromEntries((req.requests ?? []).map((x) => [x.id, x.path]));
        for (const x of j.results ?? []) {
          if (x.status >= 400 || x.status === 0) anota(`${x.status} (lote) ${rutas[x.id]} → ${String(typeof x.body === "string" ? x.body : JSON.stringify(x.body ?? "")).slice(0, 100).replace(/\s+/g, " ")}`);
        }
      } catch { /* respuesta ya consumida o no JSON: la cuenta el status de fuera */ }
    } else if (r.status() >= 400 && !RUIDO.test(u)) {
      anota(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "").replace(/apikey=[^&]+/, "apikey=…").slice(0, 200)}`);
    }
  });
  return problemas;
}

/**
 * Espera a que la página deje de pedir cosas. `waitForLoadState("networkidle")` no sirve tras un
 * clic: si la página YA estuvo inactiva antes, vuelve al instante. Se cuentan las peticiones en
 * curso a mano: 1,5 s seguidos sin ninguna = quieta.
 */
export function contadorDeRed(page: Page) {
  const vivas = new Set<Request>();
  page.on("request", (r) => vivas.add(r));
  page.on("requestfinished", (r) => vivas.delete(r));
  page.on("requestfailed", (r) => vivas.delete(r));
  return async (ms = 45_000): Promise<boolean> => {
    const fin = Date.now() + ms;
    let cero: number | null = null;
    await page.waitForTimeout(600); // que arranquen las peticiones del clic
    while (Date.now() < fin) {
      const n = [...vivas].filter((r) => !RUIDO.test(r.url())).length;
      if (n === 0) { cero ??= Date.now(); if (Date.now() - cero >= 1500) return true; } else cero = null;
      await page.waitForTimeout(200);
    }
    return false;
  };
}
