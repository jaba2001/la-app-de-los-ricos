// INTEGRACIÓN: cada endpoint contra la app REAL, con base de datos real.
//   node --experimental-strip-types --no-warnings scripts/integracion.test.mjs
//
// Levanta el servidor de Next (el build de producción) contra un Postgres con el esquema de
// verdad y llama a las 27 rutas. Sin mocks: si una ruta no existe, si el método está mal, si
// devuelve otra forma o si no exige sesión, aquí se ve.
//
// POR QUÉ HACE FALTA además de las 51 suites que ya hay: aquellas prueban funciones puras
// —el cálculo, los parsers, la construcción del SQL— importándolas directamente. Ninguna
// arranca la aplicación. Un fallo de cableado (una ruta mal exportada, un runtime
// equivocado, un import que solo revienta en producción) pasa todas y rompe en el navegador.
//
// Se SALTA si no hay servidor ni base: en CI no hay Postgres. Para ejecutarla:
//   pg_ctl -D /tmp/scorapg -o "-p 5544 -h '' -k /tmp/scpg" start
//   psql -h /tmp/scpg -p 5544 -U postgres -d scora -f sql/gcp/001_schema.sql
//   npm run build && BASE=http://127.0.0.1:3099 node .next/standalone/server.js &
//   BASE=http://127.0.0.1:3099 node --experimental-strip-types scripts/integracion.test.mjs

const BASE = process.env.BASE || "http://127.0.0.1:3099";

// ¿Hay servidor? Sin él no se puede probar nada de esto y saltar es mejor que fingir.
try {
  const r = await fetch(`${BASE}/api/ai/limits`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok && r.status !== 200) throw new Error(String(r.status));
} catch {
  console.log(`\n○ integracion: SALTADO — no hay servidor en ${BASE}`);
  console.log("  Arrancalo con: npm run build && PORT=3099 node .next/standalone/server.js");
  process.exit(0);
}

let bad = 0;
const fallos = [];
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; fallos.push(l); console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

const pedir = async (ruta, init = {}) => {
  const r = await fetch(`${BASE}${ruta}`, { signal: AbortSignal.timeout(30000), ...init });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* no todas devuelven JSON */ }
  return { status: r.status, cuerpo, headers: r.headers };
};

// ── 1. Rutas PÚBLICAS: deben responder 200 sin sesión ───────────────────────────────
{
  const l = await pedir("/api/ai/limits");
  check("ai/limits responde 200", l.status, 200);
  check("y trae los dos planes", [typeof l.cuerpo?.free, typeof l.cuerpo?.pro], ["number", "number"]);
  // Es informacion de precio publica: si algun dia exige sesion, /pricing deja de pintar.
  check("free < pro", l.cuerpo.free < l.cuerpo.pro, true);
}

// ── 2. TODA ruta de datos exige sesión ──────────────────────────────────────────────
// Es la propiedad que sustituyó a la RLS de Supabase. Si una sola se deja abierta, sus
// datos quedan expuestos a cualquiera con la URL.
{
  const protegidas = [
    ["GET",  "/api/fmp/quote?symbol=AAPL"],
    ["GET",  "/api/finnhub/stock/metric?symbol=AAPL&metric=all"],
    ["GET",  "/api/fred/series?series_id=DGS10"],
    ["GET",  "/api/edgar?symbol=AAPL"],
    ["GET",  "/api/simfin?symbol=AAPL"],
    ["GET",  "/api/congress/AAPL"],
    ["GET",  "/api/finviz/quote?symbol=AAPL"],
    ["GET",  "/api/short-interest?symbol=AAPL"],
    ["GET",  "/api/cot?market=all"],
    ["POST", "/api/batch"],
    ["POST", "/api/data"],
    ["POST", "/api/anthropic/messages"],
    ["POST", "/api/llm"],
  ];
  // /api/waitlist va aparte: limita por IP ANTES de mirar la sesion, y su limitador es
  // fail-closed a proposito (sin el seria un cañon de correos anonimo). Sin Upstash
  // devuelve 503, que es el comportamiento correcto — no 401.
  {
    const r = await pedir("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    check("waitlist no acepta sin limitador (fail-closed)", [r.status, r.cuerpo?.error], [503, "Rate limiter unavailable"]);
  }

  for (const [method, ruta] of protegidas) {
    const r = await pedir(ruta, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) });
    check(`${method} ${ruta.split("?")[0]} exige sesion`, r.status, 401);
  }
}

// ── 3. Un token inventado no vale ───────────────────────────────────────────────────
{
  const r = await pedir("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer no-es-un-token" },
    body: JSON.stringify({ queries: [{ table: "macro_state", op: "select" }] }),
  });
  check("token invalido → 401, no 500", r.status, 401);
}

// ── 4. Los crons exigen su secreto ──────────────────────────────────────────────────
{
  for (const c of ["macro-refresh", "alerts-check", "push-alerts", "ticker-alerts", "daily-close", "macro-brief", "insider-refresh", "13f-refresh"]) {
    const r = await pedir(`/api/cron/${c}`);
    // 401 = secreto mal; 503 = CRON_SECRET sin configurar en el entorno. Lo que NO puede
    // pasar es 200: significaria que cualquiera dispara los crons.
    check(`cron ${c} no se dispara sin secreto`, r.status === 200, false);
  }
}

// ── 5. Métodos equivocados ──────────────────────────────────────────────────────────
{
  const r = await pedir("/api/data", { method: "GET" });
  check("GET sobre una ruta POST → 405", r.status, 405);
  const r2 = await pedir("/api/batch", { method: "GET" });
  check("GET sobre /api/batch → 405", r2.status, 405);
}

// ── 6. Rutas que no existen ─────────────────────────────────────────────────────────
{
  const r = await pedir("/api/no-existe");
  check("ruta inexistente → 404", r.status, 404);
}

// ── 7. Preflight de CORS ────────────────────────────────────────────────────────────
{
  const r = await fetch(`${BASE}/api/data`, {
    method: "OPTIONS",
    headers: { Origin: "https://scora-research.vercel.app", "Access-Control-Request-Method": "POST" },
    signal: AbortSignal.timeout(10000),
  });
  check("preflight desde origen permitido", r.status < 400, true);
  check("y devuelve el origen", r.headers.get("access-control-allow-origin"), "https://scora-research.vercel.app");

  const r2 = await fetch(`${BASE}/api/data`, {
    method: "OPTIONS",
    headers: { Origin: "https://sitio-malicioso.example", "Access-Control-Request-Method": "POST" },
    signal: AbortSignal.timeout(10000),
  });
  // Un origen ajeno NO debe recibir la cabecera: es lo que impide que otra web use la API
  // desde el navegador de un usuario con sesion.
  check("origen ajeno no recibe CORS", r2.headers.get("access-control-allow-origin"), null);
}

// ── 8. Las páginas se sirven ────────────────────────────────────────────────────────
{
  for (const p of ["/", "/pricing", "/login", "/demo"]) {
    const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(30000) });
    check(`pagina ${p} responde 200`, r.status, 200);
  }
}

console.log(bad ? `\nintegracion: ${bad} fallo(s) — ${fallos.join(" · ")}` : "\nintegracion: 36 comprobaciones OK contra la app real");
process.exit(bad ? 1 : 0);
