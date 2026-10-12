// Cada página con sesión, a ancho de móvil (iPhone 13, 390 px): nada puede salirse por la
// derecha. El 12-10-2026 Macro, Discovery, Journal, Track Record y la ficha se salían: la barra
// de arriba no cabía, las rejillas no se apilaban y las tablas arrastraban la página entera.
//
// También se comprueba que la página PINTA algo: una página en blanco no se desborda nunca, y
// así un fallo de carga pasaba por «bien».
import { test, expect, devices, type Page } from "@playwright/test";

// Las medidas del iPhone 13 en Chromium (el perfil completo pide WebKit, que no hace falta
// para medir anchos).
const { defaultBrowserType: _webkit, ...iphone } = devices["iPhone 13"];
test.use(iphone);

const PAGINAS = ["/", "/pricing", "/macro", "/discovery", "/momentum", "/watchlist", "/journal", "/daily", "/picks", "/track-record", "/evidence", "/audit", "/account", "/stock"];

async function seSale(page: Page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth, sw = document.documentElement.scrollWidth;
    return sw > W + 2 ? `la página mide ${sw}px en una pantalla de ${W}px` : null;
  });
}

for (const ruta of PAGINAS) {
  test(`móvil ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});
    if (ruta === "/macro") {
      const cargar = page.getByRole("button", { name: /Load Macro Data/ }).first();
      if (await cargar.isVisible().catch(() => false)) { await cargar.click(); await page.waitForTimeout(4000); }
    }
    await page.waitForTimeout(1000);
    expect((await page.locator("body").innerText()).length, "la página tiene contenido").toBeGreaterThan(400);
    expect(await seSale(page)).toBeNull();
    // Y cada pestaña de la página, si las tiene.
    for (const nombre of [...new Set((await page.locator("button.subtab").allInnerTexts()).map((t) => t.trim()))]) {
      const pestaña = page.locator("button.subtab", { hasText: nombre }).first();
      if (!(await pestaña.isVisible().catch(() => false))) continue;
      await pestaña.click();
      await page.waitForTimeout(1500);
      expect(await seSale(page), `pestaña ${nombre}`).toBeNull();
    }
  });
}

test("móvil: el menú ☰ abre las secciones", async ({ page }) => {
  await page.goto("/macro");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("button", { name: "Journal" })).toBeVisible();
  await page.getByRole("button", { name: "Journal" }).click();
  await expect(page).toHaveURL(/\/journal/);
});
