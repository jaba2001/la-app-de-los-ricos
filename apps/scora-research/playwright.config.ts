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
  // Levanta el servidor si no hay uno ya escuchando. Sin esto, `npm run verify` fallaba con
  // ECONNREFUSED en cualquier maquina donde no se hubiera arrancado a mano — o sea, en
  // cualquiera menos la mia. `reuseExistingServer` deja seguir usando el que ya este
  // arrancado durante el desarrollo, que es mas rapido.
  //
  // Necesita `npm run build` antes: sirve la salida de produccion, no el modo desarrollo,
  // porque es la que se despliega y la que incrusta las NEXT_PUBLIC_*.
  webServer: {
    command: "node .next/standalone/server.js",
    url: process.env.BASE || "http://127.0.0.1:3099",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      PORT: "3099",
      PGHOST: process.env.PGHOST || "/tmp/scpg",
      PGPORT: process.env.PGPORT || "5544",
      PGUSER: process.env.PGUSER || "postgres",
      PGDATABASE: process.env.PGDATABASE || "scora",
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || "scora-509716",
    },
  },
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
