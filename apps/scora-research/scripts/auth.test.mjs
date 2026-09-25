// Verificación local del token (lib/server/auth.js).
//   node scripts/auth.test.mjs
//
// POR QUÉ EXISTE: `getUser()` era un viaje de red por petición, y la página de un ticker
// hace 33. Ahora la firma se comprueba en el proceso. El riesgo de un cambio así no es que
// deje pasar tokens buenos, sino que deje pasar tokens MALOS, así que lo que más se prueba
// aquí es el rechazo: firma ajena, caducado, audiencia equivocada, emisor equivocado.
//
// La tercera respuesta posible —`undefined`, "no he podido comprobarlo"— es la que evita
// que una avería de Supabase tumbe la app: el llamante cae al camino de red de siempre en
// vez de denegar. Distinguirla de `null` (token inválido) es la parte delicada.
import { SignJWT } from 'jose';

const SECRET = 'un-secreto-de-pruebas-suficientemente-largo-1234567890';
const URL_BASE = 'https://proyecto.supabase.co';
const key = new TextEncoder().encode(SECRET);

process.env.SUPABASE_JWT_SECRET = SECRET;
process.env.SUPABASE_URL = URL_BASE;

const { verifyTokenLocally, localVerifyAvailable } = await import('../lib/server/auth.js');

let bad = 0;
const check = (label, got, want) => {
  const ok = Object.is(got, want);
  if (!ok) { bad++; console.log(`FAIL  ${label}\n      got:  ${got}\n      want: ${want}`); }
};

const sign = async (claims = {}, { secret = key, expires = '1h' } = {}) => {
  let t = new SignJWT({ email: 'a@b.c', role: 'authenticated', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub ?? 'user-123')
    .setIssuedAt()
    .setAudience(claims.aud ?? 'authenticated')
    .setIssuer(claims.iss ?? `${URL_BASE}/auth/v1`);
  if (expires) t = t.setExpirationTime(expires);
  return t.sign(secret);
};

// ── Camino feliz ────────────────────────────────────────────────────────────────────
const good = await verifyTokenLocally(await sign());
check('token valido → id', good?.id, 'user-123');
check('token valido → email', good?.email, 'a@b.c');
check('hay verificacion local', localVerifyAvailable(), true);

// ── Rechazos: lo que de verdad importa ──────────────────────────────────────────────
const otra = new TextEncoder().encode('otro-secreto-distinto-pero-igual-de-largo-000');
check('firmado con otra clave', await verifyTokenLocally(await sign({}, { secret: otra })), null);
check('caducado', await verifyTokenLocally(await sign({}, { expires: '-1h' })), null);
check('audiencia equivocada', await verifyTokenLocally(await sign({ aud: 'otra-cosa' })), null);
check('emisor equivocado', await verifyTokenLocally(await sign({ iss: 'https://malo.example/auth/v1' })), null);
check('basura', await verifyTokenLocally('no-es-un-jwt'), null);
check('vacio', await verifyTokenLocally(''), null);

// Un token sin `sub` no identifica a nadie: no puede pasar como usuario.
const sinSub = await new SignJWT({ email: 'a@b.c' })
  .setProtectedHeader({ alg: 'HS256' })
  .setAudience('authenticated').setIssuer(`${URL_BASE}/auth/v1`)
  .setIssuedAt().setExpirationTime('1h').sign(key);
check('sin sub', await verifyTokenLocally(sinSub), null);

// El algoritmo "none" es el ataque clásico contra verificadores de JWT.
const alg_none = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
  Buffer.from(JSON.stringify({ sub: 'atacante', aud: 'authenticated', iss: `${URL_BASE}/auth/v1`, exp: 4102444800 })).toString('base64url') + '.';
check('alg:none', await verifyTokenLocally(alg_none), null);

// ── Sin configuración: "no he podido comprobarlo", NO "invalido" ────────────────────
{
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_URL;
  const fresh = await import(`../lib/server/auth.js?nocfg=${Date.now()}`);
  check('sin config → undefined', await fresh.verifyTokenLocally(await sign()), undefined);
  check('sin config → no disponible', fresh.localVerifyAvailable(), false);
  process.env.SUPABASE_JWT_SECRET = SECRET;
  process.env.SUPABASE_URL = URL_BASE;
}

console.log(bad ? `\nauth: ${bad} fallo(s)` : '\nauth: 13 comprobaciones OK');
process.exit(bad ? 1 : 0);
