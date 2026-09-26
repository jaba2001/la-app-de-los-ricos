// Playwright — pruebas de extremo a extremo en navegador real, SIN mocks de la API.
//
// Apunta a un servidor ya arrancado (no lo levanta él) porque este proyecto necesita una
// base de datos con el esquema aplicado, y arrancar eso desde aquí escondería en qué punto
// falla si algo va mal.
//
//   BASE=http://127.0.0.1:3099 npx playwright test
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Sin reintentos: un test que pasa al segundo intento oculta una carrera, y esta suite
  // existe precisamente para encontrarlas.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE || "http://127.0.0.1:3099",
    // La app hace decenas de llamadas por pantalla y algunas salen a proveedores externos.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
