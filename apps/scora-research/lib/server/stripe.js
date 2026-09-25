// Stripe: verificación de firma de webhooks + cliente REST mínimo.
//
// POR QUÉ NO USAMOS EL SDK `stripe`:
// este proxy habla con Supabase, FMP, Finnhub y FRED con `fetch` crudo, sin SDK de nadie.
// El paquete `stripe` son cientos de kB pensados para Node, y aquí las rutas corren en
// edge. Lo único que necesitamos de él es (a) comprobar un HMAC-SHA256 y (b) hacer dos
// POST form-encoded. Ambas cosas son API pública, estable y documentada de Stripe, y salen
// en menos código del que costaría envolver el SDK — sin arrastrar una dependencia al
// camino crítico del cobro.
//
// CONTRATO DE FALLO — opuesto al de cache.js y ratelimit.js, y a propósito:
// aquellos son FAIL-OPEN porque degradar a "llama al proveedor" es inofensivo. Esto es
// FAIL-CLOSED. Una firma que no se puede verificar es una petición que no sabemos que
// venga de Stripe, y aceptarla significa que cualquiera con la URL del webhook se regala
// una suscripción. Ante la duda: 400, y que Stripe reintente.

/** ¿Está Stripe configurado? Sin esto todo el módulo queda inerte y la app no cambia. */
export function stripeEnabled() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

/** ¿Estamos en las claves de test? Se usa para marcar la UI, no para decidir permisos. */
export function stripeIsTestMode() {
  return (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
}

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Comparación en tiempo constante.
 *
 * Un `a === b` sobre el hex sale antes en el primer byte que difiere, y ese tiempo es
 * medible: filtra el secreto byte a byte. Da igual que sea difícil de explotar sobre la
 * red — el coste de hacerlo bien es este bucle.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

// Ventana anti-replay. 5 min es el valor por defecto de Stripe: suficiente para el desfase
// normal de relojes y sus reintentos, y corto para que un webhook capturado deje de servir.
const TOLERANCE_SEC = 300;

/**
 * Verifica la cabecera `Stripe-Signature` contra el cuerpo CRUDO.
 *
 * `rawBody` tiene que ser el texto exacto que llegó. Si en algún punto se hace
 * JSON.parse y luego JSON.stringify, el HMAC deja de cuadrar por un espacio o un orden de
 * claves distinto — y el fallo se lee como "Stripe manda firmas malas", que es la pista
 * equivocada. Por eso esta función recibe string y nunca un objeto.
 *
 * @returns {Promise<{event: object} | {error: string}>}
 */
export async function verifyWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return { error: 'missing signature header' };
  if (!secret) return { error: 'missing webhook secret' };

  // Formato: "t=1492774577,v1=abc...,v1=def..." — puede haber varias v1 durante una
  // rotación de secreto, y entonces vale con que UNA cuadre.
  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1') signatures.push(v);
  }
  if (!timestamp || !signatures.length) return { error: 'malformed signature header' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { error: 'malformed timestamp' };
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > TOLERANCE_SEC) return { error: `timestamp outside tolerance (${Math.round(age)}s)` };

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) return { error: 'signature mismatch' };

  try {
    return { event: JSON.parse(rawBody) };
  } catch {
    // Firma válida pero cuerpo ilegible no debería pasar nunca; si pasa, no es de Stripe.
    return { error: 'valid signature but unparseable body' };
  }
}

/**
 * Codifica parámetros al formato que espera Stripe: form-urlencoded con notación de
 * corchetes para lo anidado (`line_items[0][price]`), nunca JSON.
 *
 * Se aceptan las dos formas —clave plana con corchetes ya escritos, u objeto anidado—
 * porque para un array corto la clave literal se lee mucho mejor que `{0: {...}}`, y
 * ambas acaban en el mismo string. Está separada de stripeApi para poder probarla sin
 * red: es la única parte con lógica, y un corchete mal puesto se manifiesta como un
 * "parámetro desconocido" de Stripe que no dice dónde está el fallo.
 *
 * Los `null`/`undefined` se OMITEN en lugar de mandarse como texto: Stripe interpreta la
 * cadena "null" como un valor, no como la ausencia de él.
 */
export function encodeForm(params) {
  const form = new URLSearchParams();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      const name = prefix ? `${prefix}[${k}]` : k;
      if (typeof v === 'object') walk(v, name); // arrays incluidos: sus índices son las claves
      else form.set(name, String(v));
    }
  };
  walk(params, '');
  return form.toString();
}

/** POST form-encoded a la API de Stripe. */
export async function stripeApi(path, params = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');

  const form = encodeForm(params);

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-04-30.basil',
    },
    body: form,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`stripe ${path}: ${res.status} ${body?.error?.message || 'unknown error'}`);
  }
  return body;
}

/**
 * Estados que dan acceso Pro.
 *
 * `past_due` SÍ entra: Stripe reintenta el cobro durante días y cortar el acceso al primer
 * fallo de tarjeta castiga al que tiene la tarjeta caducada, no al moroso. Stripe pasará
 * la suscripción a `canceled` o `unpaid` cuando agote los reintentos, y ahí sí se corta.
 * `trialing` entra por definición.
 */
export const PRO_STATUSES = new Set(['active', 'trialing', 'past_due']);
