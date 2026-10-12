// Recorre CADA página con sesión, en un navegador real, contra la API real — y dentro de cada
// página, su botón de carga y CADA pestaña (también las que solo aparecen al abrir otra).
//
// No basta con que la página «cargue»: se mira lo que un usuario vería roto.
//   · errores de consola y excepciones sin capturar (JavaScript que revienta);
//   · peticiones que fallan (4xx/5xx) — también las que van DENTRO de /api/batch, que responde
//     200 aunque la mitad de sus subpeticiones hayan fallado;
//   · textos que delatan un fallo en pantalla: NaN, undefined, Invalid Date, null suelto,
//     los avisos de DataError, y la pantalla de error de Next;
//   · texto en español: la interfaz va en inglés (decisión del 12-10-2026).
// Cada pestaña deja una captura en test-results/paginas/ para revisarla a ojo.
//
//   E2E_EMAIL=… E2E_PASSWORD=… NEXT_PUBLIC_FIREBASE_API_KEY=… npx playwright test --project con-sesion
import { test, expect } from "@playwright/test";
import { TEXTOS_ROTOS, lineasEnEspanol, vigilar, contadorDeRed } from "./vigilancia";

/** Rutas que existen en app/ — las dinámicas con un valor real. `carga`: el botón que trae los datos. */
export const PAGINAS: { ruta: string; carga?: RegExp }[] = [
  { ruta: "/" },
  { ruta: "/macro", carga: /Load Macro Data/ },
  { ruta: "/stock" },
  { ruta: "/stock/AAPL", carga: /Analyze AAPL/ },
  // Un ETF recorre otro camino entero (sin estados financieros, respaldo de Yahoo, pestañas ocultas).
  { ruta: "/stock/SPY", carga: /Analyze SPY/ },
  { ruta: "/watchlist" },
  { ruta: "/journal" },
  { ruta: "/discovery" },
  { ruta: "/momentum" },
  { ruta: "/picks" },
  { ruta: "/daily" },
  { ruta: "/track-record" },
  { ruta: "/evidence" },
  { ruta: "/audit" },
  { ruta: "/demo" },
  { ruta: "/pricing" },
  { ruta: "/account" },
];

for (const { ruta, carga } of PAGINAS) {
  test(`página ${ruta}`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    // Un análisis gasta ~21 llamadas a FMP y el límite es 40/min por usuario: sin esta pausa el
    // 429 de la ficha anterior se confundiría con un fallo de esta.
    if (ruta.startsWith("/stock/")) await page.waitForTimeout(65_000);

    let donde = "carga";
    const problemas = vigilar(page, () => donde);
    const quieta = contadorDeRed(page);
    const espanol = new Set<string>();

    const mira = async (nombre: string) => {
      if (!(await quieta())) problemas.push(`[${nombre}] la red no se asienta en 45 s`);
      await page.waitForTimeout(800);
      const texto = await page.locator("body").innerText().catch(() => "");
      for (const re of TEXTOS_ROTOS) {
        const i = texto.search(re);
        if (i >= 0) problemas.push(`[${nombre}] en pantalla: «${texto.slice(Math.max(0, i - 70), i + 50).replace(/\s+/g, " ")}»`);
      }
      for (const l of lineasEnEspanol(texto)) if (!espanol.has(l)) { espanol.add(l); problemas.push(`[${nombre}] español: «${l}»`); }
      await page.screenshot({ path: `test-results/paginas/${(ruta + "__" + nombre).replace(/[^\w-]+/g, "_")}.png`, fullPage: true }).catch(() => {});
    };

    await page.goto(ruta);
    await mira("inicio");

    if (carga) {
      // Sin botón también es correcto: si hoy ya se analizó el valor, la ficha carga sola la foto
      // del día (stock_snapshot) y el botón no llega a pintarse. Lo que salga mal en esa carga
      // lo cogen igual las comprobaciones de pantalla y de red.
      const boton = page.getByRole("button", { name: carga }).first();
      await boton.waitFor({ timeout: 10_000 }).catch(() => {});
      if (await boton.isVisible().catch(() => false)) {
        donde = "botón de carga";
        await boton.click();
        await page.waitForTimeout(2000);
        await mira("cargado");
      }
    }

    // Pestañas en anchura: abrir una puede descubrir otras (subpestañas) que se añaden a la cola.
    const vistas = new Set<string>();
    const cola = (await page.locator("button.subtab").allInnerTexts()).map((t) => t.trim());
    while (cola.length) {
      const nombre = cola.shift()!;
      if (!nombre || vistas.has(nombre)) continue;
      vistas.add(nombre);
      const pestaña = page.locator("button.subtab", { hasText: nombre }).first();
      if (!(await pestaña.isVisible().catch(() => false))) continue;
      donde = nombre;
      await pestaña.click().catch((e: Error) => problemas.push(`[${nombre}] no se pudo pulsar: ${e.message.slice(0, 80)}`));
      await mira(nombre);
      for (const t of await page.locator("button.subtab").allInnerTexts()) if (!vistas.has(t.trim())) cola.push(t.trim());
    }

    expect([...new Set(problemas)], [...new Set(problemas)].join("\n")).toEqual([]);
  });
}
