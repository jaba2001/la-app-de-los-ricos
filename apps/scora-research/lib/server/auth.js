import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { corsHeaders } from './cors.js';

function deny(request, message, status = 401) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });
}

// ── Verificación LOCAL del token ─────────────────────────────────────────────────────
//
// POR QUÉ EXISTE: `supabase.auth.getUser(token)` es un viaje de red a Supabase, y se hacía
// UNA VEZ POR PETICIÓN. La página de un ticker dispara 33 peticiones al proxy, así que un
// solo análisis revalidaba el mismo token 33 veces seguidas contra el mismo servidor. El
// token ya viene firmado: comprobar la firma aquí no necesita a nadie.
//
// EL COSTE HONESTO DE ESTO: un token verificado localmente sigue siendo válido hasta que
// expira, aunque el usuario cierre sesión o se le revoque el acceso antes. Los tokens de
// Identity Platform duran 1 h, así que esa es la ventana, y hoy vale para TODAS las rutas:
// las de IA y Stripe piden `strict: true`, pero desde la migración no hay camino de red que
// lo refuerce (ver requireUser y AUDIT_REPORT C-1).
//
// SIN GCP_PROJECT_ID no se puede comprobar la audiencia, y se deniega todo con 503.

// Identity Platform firma los tokens con RS256 y claves rotativas de Google, publicadas en
// un JWKS. No hay secreto compartido que guardar: se comprueba la firma contra la clave
// publica que corresponda al `kid` del token.
//
//   emisor    : https://securetoken.google.com/<proyecto>
//   audiencia : <proyecto>
//
// Con Supabase era HS256 con un secreto del proyecto. El cambio es a mejor: sin secreto que
// pueda filtrarse, y la verificacion sigue siendo local — que era el objetivo de todo esto.
const PROYECTO = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const EMISOR = PROYECTO ? `https://securetoken.google.com/${PROYECTO}` : undefined;

let _jwks = null;

/**
 * Solo para pruebas: sustituye el juego de claves de Google por uno local, para poder
 * firmar un token valido y comprobar el camino feliz. Sin esta costura la prueba solo
 * podria comprobar rechazos — y el rechazo es la mitad del contrato, no todo.
 */
export function _usarJwks(j) { _jwks = j; }

function jwks() {
  if (_jwks) return _jwks;
  // jose cachea el juego de claves por modulo: una descarga por isolate, no por peticion,
  // y solo lo refresca cuando aparece un `kid` desconocido (es decir, cuando Google rota).
  _jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
  return _jwks;
}

/** ¿Hay configuracion para verificar? Sin proyecto no se puede comprobar la audiencia. */
export function localVerifyAvailable() {
  return Boolean(PROYECTO);
}

/**
 * Verifica la firma y las claims del token sin salir a la red.
 *
 * @returns el usuario ({id, email, …}) si el token es válido,
 *          `null` si es inválido (firma mala, caducado, audiencia incorrecta),
 *          `undefined` si NO SE PUDO comprobar (sin configuración) — que no es lo mismo:
 *          el llamante debe entonces caer al camino de red en vez de denegar.
 */
export async function verifyTokenLocally(token) {
  if (!token) return null;
  if (!PROYECTO) return undefined;   // sin configurar: que lo decida el llamante

  let alg;
  try { ({ alg } = decodeProtectedHeader(token)); } catch { return null; }
  // Identity Platform firma en RS256. Un token que diga otra cosa no es suyo.
  if (alg !== 'RS256') return null;

  try {
    const { payload } = await jwtVerify(token, jwks(), {
      audience: PROYECTO,
      issuer: EMISOR,
      algorithms: ['RS256'],
    });
    // `auth_time` existe en los tokens de Identity Platform y no en otros de Google: sirve
    // para no aceptar, por ejemplo, un token de servicio del mismo proyecto.
    if (payload.auth_time == null) return null;
    return payloadToUser(payload);
  } catch (e) {
    // Un fallo al DESCARGAR las claves no es un token invalido: es una averia de red. Se
    // distingue porque denegar aqui dejaria a todo el mundo fuera durante un incidente.
    const code = String(e?.code || '');
    if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JWKS_INVALID' || /fetch|network/i.test(String(e?.message || ''))) {
      return undefined;
    }
    return null;
  }
}

/** Claims → la forma mínima de usuario que consumen las rutas (`user.id`, `user.email`). */
function payloadToUser(payload) {
  if (!payload?.sub) return null;
  return {
    // `sub` es el uid de Identity Platform (28 caracteres), no un uuid como en Supabase.
    id: payload.sub,
    email: payload.email ?? null,
    role: payload.role ?? null,
    app_metadata: payload.app_metadata ?? {},
    user_metadata: payload.user_metadata ?? {},
  };
}

function bearer(request) {
  const auth = request.headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

/**
 * Best-effort identity for routes that are open to logged-out visitors.
 *
 * Returns the user when a valid token is present, null otherwise — never an error. Use it
 * so a public route can ATTRIBUTE a row to an account without ever trusting an id supplied
 * in the request body: a client-declared user id is an unauthenticated claim, not identity.
 */
export async function optionalUser(request) {
  const token = bearer(request);
  if (!token) return null;

  const local = await verifyTokenLocally(token);
  if (local !== undefined) return local; // válido o inválido, ya está decidido

  // Sin verificacion local no hay camino alternativo: antes se preguntaba a Supabase, y
  // Google no ofrece equivalente (ni hace falta: la firma se comprueba sin red).
  return null;
}

/**
 * @param opts.strict  Lo piden las rutas que gastan dinero (IA, Stripe). Con Supabase
 *   significaba "pregunta siempre a la red", para que una sesión revocada dejara de valer en
 *   el acto. Esa llamada desapareció con la migración y `strict` se quedó cayendo directo en
 *   "denegar todo": las cuatro rutas devolvían 503 a cualquier usuario (AUDIT_REPORT C-1).
 *   Hoy verifica la firma igual que el resto. La revocación inmediata necesitaría consultar
 *   `tokensValidAfterTime` con el Admin SDK; hasta entonces, la ventana es la vida del token
 *   de Identity Platform (1 h). Se conserva el parámetro para no perder qué rutas lo piden.
 */
export async function requireUser(request, opts = {}) {
  const token = bearer(request);
  if (!token) {
    return { user: null, error: deny(request, 'Missing Authorization header') };
  }

  const local = await verifyTokenLocally(token);
  if (local) return { user: local, error: null };
  if (local === null) return { user: null, error: deny(request, 'Invalid token') };

  // `undefined`: no se pudo comprobar. O falta GCP_PROJECT_ID o no se pudieron descargar las
  // claves de Google. En los dos casos se deniega, y el log dice cuál de los dos es.
  console.error(localVerifyAvailable()
    ? `requireUser: no se pudieron obtener las claves de Google — denegando${opts.strict ? ' (strict)' : ''}`
    : 'requireUser: GCP_PROJECT_ID sin configurar — denegando todo');
  return { user: null, error: deny(request, 'Server misconfigured: auth unavailable', 503) };
}
