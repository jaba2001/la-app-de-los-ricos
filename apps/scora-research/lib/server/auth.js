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
// expira, aunque el usuario cierre sesión o se le revoque el acceso antes. La red lo habría
// detectado en el acto; la firma no. Los access tokens de Supabase duran 1 h por defecto,
// así que esa es la ventana. Se acepta para las rutas de DATOS —solo leen datos de mercado
// que son iguales para todo el mundo— y NO se acepta donde se gasta dinero: las rutas de IA
// y de Stripe piden `strict: true` y siguen preguntando a Supabase (ver requireUser). Ahí
// la latencia da igual (son pocas llamadas) y la revocación tiene que ser inmediata.
//
// SI NO HAY NADA CONFIGURADO, no se rompe: sin JWT secret ni SUPABASE_URL se cae al camino
// de red de siempre. Desplegar esto sin tocar variables de entorno no cambia el
// comportamiento; la mejora se activa al añadir SUPABASE_JWT_SECRET (o sola, vía JWKS).

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
 * @param opts.strict  Salta la verificación local y pregunta SIEMPRE a Supabase. Para las
 *   rutas que gastan dinero (IA, Stripe): ahí una sesión revocada tiene que dejar de valer
 *   en el acto, y el viaje de red no se nota porque son pocas llamadas.
 */
export async function requireUser(request, opts = {}) {
  const token = bearer(request);
  if (!token) {
    return { user: null, error: deny(request, 'Missing Authorization header') };
  }

  if (!opts.strict) {
    const local = await verifyTokenLocally(token);
    if (local) return { user: local, error: null };
    if (local === null) return { user: null, error: deny(request, 'Invalid token') };
    // `undefined` ⇒ no se pudo comprobar sin red; sigue al camino de siempre.
  }

  // Fail closed: si no se puede comprobar, se deniega. Antes habia un camino de red a
  // Supabase como respaldo; con Identity Platform la firma se verifica sin red, asi que no
  // poder verificar significa que falta configuracion y denegar es lo correcto.
  console.error('requireUser: GCP_PROJECT_ID sin configurar — denegando todo');
  return { user: null, error: deny(request, 'Server misconfigured: auth unavailable', 503) };
}
