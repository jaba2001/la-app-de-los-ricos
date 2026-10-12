// Inicia sesión UNA vez con el usuario de pruebas y guarda el estado para las pruebas con sesión.
//
// POR QUÉ ASÍ. El login de la app es por enlace mágico, que exige un buzón: imposible en una
// prueba. Pero Identity Platform tiene el proveedor de correo activo, y el usuario de pruebas
// (e2e@scora.test) tiene contraseña. Se inicia sesión por la API REST pública —la misma que usa
// el SDK por dentro— y se deja la sesión en IndexedDB con el formato exacto del SDK de Firebase
// (@firebase/auth: base `firebaseLocalStorageDb`, clave `firebase:authUser:<apiKey>:[DEFAULT]`).
// Desde ahí la app arranca con sesión como si el usuario hubiera pulsado el enlace: el token es
// real, lo firma Google y el servidor lo verifica contra su JWKS, sin atajos en el código.
//
//   E2E_EMAIL=e2e@scora.test E2E_PASSWORD=… NEXT_PUBLIC_FIREBASE_API_KEY=… npx playwright test
import { test as setup, expect } from "@playwright/test";

export const ESTADO = "e2e/.auth/usuario.json";

setup("iniciar sesión con el usuario de pruebas", async ({ page }) => {
  const email = process.env.E2E_EMAIL, password = process.env.E2E_PASSWORD;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  setup.skip(!email || !password || !apiKey, "faltan E2E_EMAIL, E2E_PASSWORD o NEXT_PUBLIC_FIREBASE_API_KEY");

  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  expect(j.idToken, `login del usuario de pruebas: ${j.error?.message ?? r.status}`).toBeTruthy();

  const ahora = Date.now();
  const usuario = {
    uid: j.localId, email: j.email, emailVerified: true, isAnonymous: false,
    displayName: j.displayName || undefined,
    providerData: [{ providerId: "password", uid: j.email, email: j.email, displayName: null, phoneNumber: null, photoURL: null }],
    stsTokenManager: { refreshToken: j.refreshToken, accessToken: j.idToken, expirationTime: ahora + Number(j.expiresIn) * 1000 },
    createdAt: String(ahora), lastLoginAt: String(ahora),
    apiKey, appName: "[DEFAULT]",
  };

  await page.goto("/login");
  await page.evaluate(async ({ clave, valor }) => {
    await new Promise<void>((ok, mal) => {
      const req = indexedDB.open("firebaseLocalStorageDb", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("firebaseLocalStorage", { keyPath: "fbase_key" });
      req.onerror = () => mal(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction("firebaseLocalStorage", "readwrite");
        tx.objectStore("firebaseLocalStorage").put({ fbase_key: clave, value: valor });
        tx.oncomplete = () => { req.result.close(); ok(); };
        tx.onerror = () => mal(tx.error);
      };
    });
  }, { clave: `firebase:authUser:${apiKey}:[DEFAULT]`, valor: usuario });

  // La prueba de que funciona: con sesión, la barra enseña «Account» y «Sign out».
  await page.goto("/macro");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
  await page.context().storageState({ path: ESTADO, indexedDB: true });
});
