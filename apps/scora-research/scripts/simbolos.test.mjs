// Qué tickers deja pasar el servidor hacia FMP y Finnhub (AUDIT_REPORT M-4).
//   node --experimental-strip-types --no-warnings scripts/simbolos.test.mjs
//
// El buscador del Nav ofrece valores internacionales con su bandera (.HK, .T, .SI…), y muchos
// son NUMÉRICOS: 0700.HK es Tencent, 7203.T es Toyota. El servidor exigía `^[A-Z.\-]{1,15}$`
// y los rechazaba con 400 "Invalid symbol" antes de preguntar a nadie: el usuario elegía un
// resultado del propio buscador y la ficha salía vacía.
//
// Sin FMP_KEY ni FINNHUB_KEY a propósito: un símbolo que pasa la validación llega a
// "Server misconfigured" (500), uno que no pasa se queda en 400. Así no sale nada a la red.
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";

process.env.GCP_PROJECT_ID = "scora-509716";
delete process.env.FMP_KEY; delete process.env.FINNHUB_KEY;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;

const { _usarJwks } = await import("../lib/server/auth.js");
const { serve: fmp } = await import("../lib/server/providers/fmp.js");
const { serve: finnhub } = await import("../lib/server/providers/finnhub.js");

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey); jwk.kid = "k"; jwk.alg = "RS256";
_usarJwks(createLocalJWKSet({ keys: [jwk] }));
const token = await new SignJWT({ auth_time: 1700000000 }).setProtectedHeader({ alg: "RS256", kid: "k" })
  .setSubject("uid").setAudience("scora-509716").setIssuer("https://securetoken.google.com/scora-509716")
  .setIssuedAt().setExpirationTime("1h").sign(privateKey);

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (got !== want) { bad++; console.log(`FAIL  ${l}\n      got:  ${got}\n      want: ${want}`); }
};
const pide = (url) => new Request(url, { headers: { Authorization: `Bearer ${token}` } });
const estadoFmp = async (s) => (await fmp(pide(`http://x/api/fmp/quote?symbol=${encodeURIComponent(s)}`), { params: { path: ["quote"] } })).status;
const estadoFh = async (s) => (await finnhub(pide(`http://x/api/finnhub/quote?symbol=${encodeURIComponent(s)}`), { params: { path: ["quote"] } })).status;

// Pasan la validación (500 = llegó a pedir la clave del proveedor).
for (const s of ["AAPL", "BRK.B", "BF-B", "0700.HK", "7203.T", "D05.SI", "005930.KS"]) {
  check(`fmp acepta ${s}`, await estadoFmp(s), 500);
  check(`finnhub acepta ${s}`, await estadoFh(s), 500);
}
// Siguen rechazándose (400): minúsculas, espacios, separadores de URL, demasiado largo.
for (const s of ["aapl", "AAPL US", "AAPL&apikey=x", "AAPL/../x", "A".repeat(16)]) {
  check(`fmp rechaza ${JSON.stringify(s)}`, await estadoFmp(s), 400);
  check(`finnhub rechaza ${JSON.stringify(s)}`, await estadoFh(s), 400);
}

console.log(bad ? `\n✗ simbolos: ${bad} fallo(s) de ${total}` : `\n✓ simbolos: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
