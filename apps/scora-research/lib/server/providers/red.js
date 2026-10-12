// Un reintento ante un fallo de RED al hablar con un proveedor.
//
// POR QUÉ (12-10-2026). En el recorrido con Playwright, la cotización de IWM salió con 502
// «fetch failed»: undici perdió la conexión una vez y Finnhub respondía bien un segundo
// después. Sin reintento, un parpadeo de red deja un hueco en la pantalla del usuario.
//
// Solo se reintenta cuando fetch LANZA (no hubo respuesta). Una respuesta HTTP de error —429,
// 402, 500— es una respuesta: repetirla gastaría cuota y escondería el motivo real.

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ intentos?: number, esperaMs?: number, fetch?: typeof fetch }} [op]
 */
export async function fetchConReintento(url, init, { intentos = 2, esperaMs = 300, fetch: f = fetch } = {}) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    try {
      return await f(url, init);
    } catch (e) {
      ultimo = e;
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, esperaMs * (i + 1)));
    }
  }
  throw ultimo;
}
