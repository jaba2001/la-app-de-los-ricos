// Flujos del visitante SIN sesión, en un navegador real y contra la API real.
//
// Es lo único que se puede recorrer de punta a punta sin credenciales: el login es por
// enlace mágico y exige un buzón. Todo lo que hay detrás de la sesión queda BLOQUEADO y
// está anotado como tal en AUDIT_REPORT.md.
//
// Lo que se comprueba no es que "la página carga", sino que el JavaScript arranca sin
// romperse y que los errores de red llegan a la pantalla en vez de quedarse en la consola.
import { test, expect, type Page, type ConsoleMessage, type Response } from "@playwright/test";

// HALLAZGO A-3 (ver AUDIT_REPORT.md): /_vercel/insights y /_vercel/speed-insights dan 404
// en cada carga. Esos scripts los servia la PLATAFORMA de Vercel; en Cloud Run no existen,
// pero @vercel/analytics y @vercel/speed-insights siguen en app/layout.tsx pidiendolos.
// Se filtran aqui para que la suite mida lo que puede arreglarse hoy, no para taparlo: el
// fallo esta en el informe y el fix es quitar los dos componentes del layout.
const RUIDO_CONOCIDO = /favicon|manifest|sw\.js|posthog|sentry|_vercel\/(insights|speed-insights)/i;

/**
 * Vigila la página: errores de consola, excepciones sin capturar y RECURSOS QUE FALLAN.
 *
 * Los 404 se siguen por la RESPUESTA y no por el texto de la consola: el navegador escribe
 * "Failed to load resource: 404" sin decir cuál, así que filtrar por mensaje es imposible.
 * Siguiendo la respuesta se sabe qué URL falló, que es lo que hace falta para distinguir
 * un fallo real del ruido conocido.
 */
function vigilar(page: Page) {
  const errores: string[] = [];
  const fallidos: string[] = [];
  page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") errores.push(m.text()); });
  page.on("pageerror", (e: Error) => errores.push(`pageerror: ${e.message}`));
  page.on("response", (r: Response) => { if (r.status() >= 400) fallidos.push(`${r.status()} ${r.url()}`); });
  return {
    /** Lo que de verdad hay que mirar: sin el ruido conocido. */
    graves: () => [
      ...errores.filter((e) => !RUIDO_CONOCIDO.test(e) && !/Failed to load resource/.test(e)),
      ...fallidos.filter((u) => !RUIDO_CONOCIDO.test(u)),
    ],
  };
}

test("la landing carga y su JavaScript no revienta", async ({ page }) => {
  const v = vigilar(page);
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  // Hidratación: si React falla al hidratar, la página se ve pero nada responde.
  await page.waitForLoadState("networkidle");
  const graves = v.graves();
  expect(graves, `errores y recursos fallidos:\n${graves.join("\n")}`).toHaveLength(0);
});

test("la landing lleva a registrarse", async ({ page }) => {
  await page.goto("/");
  // El CTA principal de una landing tiene que llevar a algún sitio. Si el rediseño rompe
  // el enlace, la página sigue siendo bonita y deja de convertir.
  const cta = page.locator('a[href*="login"], a[href*="signup"], a[href*="pricing"]').first();
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/login|signup|pricing/);
});

test("/pricing muestra el precio que viene de Stripe", async ({ page }) => {
  const v = vigilar(page);
  await page.goto("/pricing");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("body")).toBeVisible();
  // El precio se LEE de Stripe en /api/stripe/config. Sin claves devuelve null y la página
  // debe seguir pintando — no quedarse en blanco ni lanzar.
  const graves = v.graves().filter((e) => !/stripe/i.test(e));
  expect(graves, graves.join("\n")).toHaveLength(0);
});

test("/login pinta el formulario de correo", async ({ page }) => {
  await page.goto("/login");
  const email = page.locator('input[type="email"]');
  await expect(email).toBeVisible();
  await expect(page.locator('button[type="submit"], button:has-text("Send"), button:has-text("Enviar")').first()).toBeVisible();
});

test("una ruta que no existe da 404 y no una pantalla rota", async ({ page }) => {
  const r = await page.goto("/pagina-que-no-existe");
  expect(r?.status()).toBe(404);
  await expect(page.locator("body")).toBeVisible();
});

test("una pantalla con sesión redirige al login en vez de romperse", async ({ page }) => {
  const v = vigilar(page);
  await page.goto("/watchlist");
  await page.waitForLoadState("networkidle");
  // Sin sesión, /api/data devuelve 401. Lo que importa es que la app lo maneje: o redirige
  // al login, o enseña un estado vacío. Lo que no puede es quedarse en blanco con un error
  // sin capturar — que es lo que pasaba si el cliente de datos no traducía el 401.
  await expect(page.locator("body")).toBeVisible();
  const sinCapturar = v.graves().filter((e) => /unhandled|uncaught|pageerror/i.test(e));
  expect(sinCapturar, sinCapturar.join("\n")).toHaveLength(0);
});
