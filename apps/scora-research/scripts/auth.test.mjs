// Verificación del token de sesión (lib/server/auth.js), ahora contra Identity Platform.
//   node --experimental-strip-types --no-warnings scripts/auth.test.mjs
//
// CAMBIO DE PROVEEDOR: antes eran tokens de Supabase firmados en HS256 con un secreto
// compartido; ahora son de Identity Platform, RS256 y firmados por Google con claves
// rotativas. No hay secreto que guardar, y la firma se sigue comprobando sin salir a la red.
//
// Lo que más se prueba es el RECHAZO, porque el riesgo de un verificador no es que tumbe
// tokens buenos —eso se ve enseguida— sino que acepte uno malo, y eso no se ve nunca.
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";

const PROYECTO = "scora-509716";
process.env.GCP_PROJECT_ID = PROYECTO;
const { verifyTokenLocally, localVerifyAvailable, _usarJwks } = await import("../lib/server/auth.js");

// Un par de claves de mentira que hace de Google para la prueba.
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey); jwk.kid = "prueba"; jwk.alg = "RS256"; jwk.use = "sig";
_usarJwks(createLocalJWKSet({ keys: [jwk] }));
// Y otra distinta, para el token de un emisor que no es quien dice ser.
const otra = await generateKeyPair("RS256");

let bad = 0;
const check = (l, got, want) => {
  if (!Object.is(got, want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${got}\n      want: ${want}`); }
};

const firma = async (claims = {}, { key = privateKey, alg = "RS256", exp = "1h" } = {}) => {
  let t = new SignJWT({ email: "a@b.c", auth_time: 1700000000, ...claims })
    .setProtectedHeader({ alg, kid: "prueba" })
    .setSubject(claims.sub ?? "uid28caracteresDeIdentityPl")
    .setIssuedAt()
    .setAudience(claims.aud ?? PROYECTO)
    .setIssuer(claims.iss ?? `https://securetoken.google.com/${PROYECTO}`);
  if (exp) t = t.setExpirationTime(exp);
  return t.sign(key);
};

// ── Camino feliz ────────────────────────────────────────────────────────────────────
{
  const u = await verifyTokenLocally(await firma());
  check("token valido → uid", u?.id, "uid28caracteresDeIdentityPl");
  check("token valido → email", u?.email, "a@b.c");
  check("hay verificacion", localVerifyAvailable(), true);
}

// ── Rechazos ────────────────────────────────────────────────────────────────────────
check("firmado por otro", await verifyTokenLocally(await firma({}, { key: otra.privateKey })), null);
check("caducado", await verifyTokenLocally(await firma({}, { exp: "-1h" })), null);
check("audiencia de otro proyecto", await verifyTokenLocally(await firma({ aud: "otro-proyecto" })), null);
check("emisor equivocado", await verifyTokenLocally(await firma({ iss: "https://securetoken.google.com/ajeno" })), null);
check("basura", await verifyTokenLocally("no-es-un-jwt"), null);
check("vacio", await verifyTokenLocally(""), null);

// `auth_time` solo lo llevan los tokens de sesion de Identity Platform. Sin el, podria
// colarse un token de cuenta de servicio del MISMO proyecto, que pasa audiencia y emisor.
{
  const sinAuthTime = await new SignJWT({ email: "a@b.c" })
    .setProtectedHeader({ alg: "RS256", kid: "prueba" })
    .setSubject("x").setAudience(PROYECTO).setIssuer(`https://securetoken.google.com/${PROYECTO}`)
    .setIssuedAt().setExpirationTime("1h").sign(privateKey);
  check("sin auth_time → no es sesion de usuario", await verifyTokenLocally(sinAuthTime), null);
}

// Un token sin `sub` no identifica a nadie.
{
  const sinSub = await new SignJWT({ email: "a@b.c", auth_time: 1700000000 })
    .setProtectedHeader({ alg: "RS256", kid: "prueba" })
    .setAudience(PROYECTO).setIssuer(`https://securetoken.google.com/${PROYECTO}`)
    .setIssuedAt().setExpirationTime("1h").sign(privateKey);
  check("sin sub", await verifyTokenLocally(sinSub), null);
}

// alg:none, el ataque clasico. Y HS256: si se aceptara, la clave publica de Google —que es
// publica— serviria de secreto para firmar tokens propios.
{
  const none = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.' +
    Buffer.from(JSON.stringify({ sub: "x", aud: PROYECTO, iss: `https://securetoken.google.com/${PROYECTO}`, exp: 4102444800, auth_time: 1 })).toString("base64url") + '.';
  check("alg:none", await verifyTokenLocally(none), null);
  const { generateSecret, SignJWT: S2 } = await import("jose");
  const sec = await generateSecret("HS256");
  const hs = await new S2({ auth_time: 1 }).setProtectedHeader({ alg: "HS256" })
    .setSubject("x").setAudience(PROYECTO).setIssuer(`https://securetoken.google.com/${PROYECTO}`)
    .setIssuedAt().setExpirationTime("1h").sign(sec);
  check("HS256 rechazado (solo RS256)", await verifyTokenLocally(hs), null);
}

// ── Sin configurar: "no he podido comprobarlo", que NO es "invalido" ────────────────
{
  delete process.env.GCP_PROJECT_ID; delete process.env.GOOGLE_CLOUD_PROJECT;
  const fresh = await import(`../lib/server/auth.js?nocfg=${Date.now()}`);
  check("sin proyecto → undefined", await fresh.verifyTokenLocally(await firma()), undefined);
  check("sin proyecto → no disponible", fresh.localVerifyAvailable(), false);
  process.env.GCP_PROJECT_ID = PROYECTO;
}

console.log(bad ? `\nauth: ${bad} fallo(s)` : "\nauth: 14 comprobaciones OK");
process.exit(bad ? 1 : 0);
