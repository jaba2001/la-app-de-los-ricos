import { createClient } from '@supabase/supabase-js';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { corsHeaders } from './cors.js';

let _client = null;
function client() {
  if (_client) return _client;
  _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return _client;
}

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

const AUD = 'authenticated';

let _jwks = null;
function jwks() {
  if (_jwks) return _jwks;
  if (!process.env.SUPABASE_URL) return null;
  // jose cachea el juego de claves por módulo (una descarga por isolate, no por petición)
  // y lo refresca solo cuando aparece un `kid` que no conoce.
  _jwks = createRemoteJWKSet(new URL(`${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  return _jwks;
}

let _secret = null;
function hsSecret() {
  if (_secret !== null) return _secret;
  const raw = process.env.SUPABASE_JWT_SECRET;
  _secret = raw ? new TextEncoder().encode(raw) : false;
  return _secret;
}

/** ¿Se puede verificar sin red? Falso ⇒ los llamantes usan `getUser`. */
export function localVerifyAvailable() {
  return Boolean(hsSecret() || process.env.SUPABASE_URL);
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

  // El ALGORITMO DE LA CABECERA decide con qué clave hay que comprobar la firma, y se lee
  // antes de verificar nada. No es confiar en el token: es enrutar. Un HS256 se comprueba
  // SOLO con el secreto compartido y un ES/RS SOLO con el JWKS — nunca se prueba el otro
  // camino si el primero falla. Intentarlo era el bug que encontró la prueba: un token con
  // firma falsa se iba a buscar claves por la red y, si esa descarga fallaba, volvía como
  // «no he podido comprobarlo» en vez de como inválido.
  let alg;
  try {
    ({ alg } = decodeProtectedHeader(token));
  } catch {
    return null; // ni siquiera es un JWT
  }
  if (!alg || alg === 'none') return null;

  const issuer = process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/auth/v1` : undefined;
  const opts = { audience: AUD, ...(issuer ? { issuer } : {}) };

  if (alg.startsWith('HS')) {
    const secret = hsSecret();
    if (!secret) return undefined; // no configurado: que lo resuelva la red
    try {
      const { payload } = await jwtVerify(token, secret, { ...opts, algorithms: [alg] });
      return payloadToUser(payload);
    } catch {
      return null;
    }
  }

  const keys = jwks();
  if (!keys) return undefined;
  try {
    const { payload } = await jwtVerify(token, keys, { ...opts, algorithms: [alg] });
    return payloadToUser(payload);
  } catch (e) {
    // Un fallo al DESCARGAR el juego de claves no es un token inválido: es una avería de
    // red. Distinguirlo importa, porque denegar aquí dejaría la app entera fuera durante
    // un incidente de Supabase; devolver `undefined` hace que el llamante lo reintente por
    // el camino de red, que es el comportamiento de antes.
    const code = String(e?.code || '');
    if (code === 'ERR_JWKS_NO_MATCHING_KEY' || code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JWKS_INVALID' || /fetch|network/i.test(String(e?.message || ''))) {
      return undefined;
    }
    return null;
  }
}

/** Claims → la forma mínima de usuario que consumen las rutas (`user.id`, `user.email`). */
function payloadToUser(payload) {
  if (!payload?.sub) return null;
  return {
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

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  try {
    const { data, error } = await client().auth.getUser(token);
    return error ? null : (data?.user ?? null);
  } catch {
    return null;
  }
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

  // Fail closed: without Supabase credentials we cannot validate anything, so every
  // request must be rejected rather than fall through to an unauthenticated handler.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('requireUser: SUPABASE_URL/SUPABASE_ANON_KEY missing — denying all requests');
    return { user: null, error: deny(request, 'Server misconfigured: auth unavailable', 503) };
  }
  const { data, error } = await client().auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: deny(request, 'Invalid token') };
  }
  return { user: data.user, error: null };
}
