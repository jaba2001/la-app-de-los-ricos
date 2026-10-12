// Lo que el usuario ESCRIBE: watchlist, diario de operaciones y alertas. Cada prueba crea algo,
// recarga la página (lo que se ve tiene que venir de la base, no del estado de React), lo borra
// y vuelve a recargar. Si deja basura es porque el borrado falló, y eso ya es un fallo.
//
// Corre contra la base del servidor que se pruebe (en local, una copia): escribe filas del
// usuario de pruebas y solo de él.
import { test, expect } from "@playwright/test";
import { vigilar } from "./vigilancia";

// KO no aparece en ningún otro sitio de las pruebas: si hay un KO en la watchlist, es de aquí.
const TICKER = "KO";

test("watchlist: añadir, persiste, quitar", async ({ page }) => {
  const problemas = vigilar(page, () => "watchlist");
  await page.goto("/watchlist");
  const fila = page.locator("tr", { has: page.getByRole("link", { name: TICKER, exact: true }) });
  // Restos de una ejecución anterior que se cortó a medias.
  await page.getByPlaceholder("AAPL, MSFT…").waitFor();
  await page.waitForLoadState("networkidle");
  while (await fila.count()) { await fila.first().getByTitle("Remove from watchlist").click(); await page.waitForTimeout(500); }

  await page.getByPlaceholder("AAPL, MSFT…").fill(TICKER);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(fila).toHaveCount(1, { timeout: 15_000 });

  await page.reload();
  await expect(fila, "tras recargar sigue ahí: se guardó en la base").toHaveCount(1, { timeout: 15_000 });

  await fila.getByTitle("Remove from watchlist").click();
  await expect(fila).toHaveCount(0);
  await page.reload();
  await page.getByPlaceholder("AAPL, MSFT…").waitFor();
  await page.waitForLoadState("networkidle");
  await expect(fila, "tras recargar ya no está: se borró de la base").toHaveCount(0);
  expect(problemas, problemas.join("\n")).toEqual([]);
});

test("diario: registrar una operación, persiste, borrar", async ({ page }) => {
  const problemas = vigilar(page, () => "journal");
  const marca = `e2e-${Date.now()}`;
  await page.goto("/journal");
  await page.getByPlaceholder("Ticker", { exact: true }).fill(TICKER);
  await page.getByPlaceholder("Shares", { exact: true }).fill("3");
  await page.getByPlaceholder("Price $", { exact: true }).fill("60");
  await page.getByPlaceholder("Thesis / tag (optional)").fill(marca);
  await page.getByRole("button", { name: "Add trade" }).click();

  // La operación sale en «Open positions» y también en otras tablas del diario: se mira la de
  // posiciones abiertas, que es la que tiene los botones.
  const filas = page.locator("tr", { hasText: marca });
  const fila = filas.filter({ has: page.getByTitle("Close at market") });
  await expect(fila).toHaveCount(1, { timeout: 15_000 });
  await expect(fila).toContainText("$60.00");

  await page.reload();
  await expect(fila, "tras recargar sigue ahí").toHaveCount(1, { timeout: 15_000 });

  await fila.getByTitle("Delete").click();
  await expect(filas).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Add trade" }).waitFor();
  await page.waitForLoadState("networkidle");
  await expect(filas, "tras recargar ya no está en ninguna tabla").toHaveCount(0);
  expect(problemas, problemas.join("\n")).toEqual([]);
});

test("alertas: crear una de precio en la ficha, persiste, pausar, borrar", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  // La ficha gasta ~21 llamadas a FMP (límite 40/min por usuario): pausa por la prueba anterior.
  await page.waitForTimeout(65_000);
  const problemas = vigilar(page, () => "alertas");
  await page.goto(`/stock/${TICKER}`);
  await page.getByRole("button", { name: new RegExp(`Analyze ${TICKER}`) }).first().click();

  const tarjeta = page.locator(".card", { has: page.getByText(`Alerts — ${TICKER}`) });
  await expect(tarjeta).toBeVisible({ timeout: 90_000 });
  // Umbral absurdo a propósito: la alerta no puede dispararse durante la prueba.
  const umbral = "9999";
  const alerta = tarjeta.locator("div", { hasText: `Price rises above $${umbral}.00` }).last();
  while (await alerta.count() && await alerta.isVisible()) { await alerta.getByTitle("Delete").click(); await page.waitForTimeout(500); }

  await tarjeta.locator("select").selectOption("price_above");
  await tarjeta.locator('input[type="number"]').fill(umbral);
  await tarjeta.getByRole("button", { name: "Add alert" }).click();
  await expect(alerta).toBeVisible({ timeout: 15_000 });

  // Duplicada: la app lo impide y lo dice.
  await tarjeta.locator('input[type="number"]').fill(umbral);
  await tarjeta.getByRole("button", { name: "Add alert" }).click();
  await expect(tarjeta.getByText("You already have that alert on this ticker.")).toBeVisible();

  await alerta.getByRole("button", { name: "Pause" }).click();
  await expect(alerta.getByRole("button", { name: "Resume" })).toBeVisible({ timeout: 15_000 });

  await alerta.getByTitle("Delete").click();
  await expect(tarjeta.getByText(`Price rises above $${umbral}.00`)).toHaveCount(0);
  expect(problemas, problemas.join("\n")).toEqual([]);
});
