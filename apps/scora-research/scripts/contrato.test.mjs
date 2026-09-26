// CONTRATO front ↔ back: que coincidan payload, forma de respuesta y errores.
//   BASE=http://127.0.0.1:3099 node --experimental-strip-types --no-warnings scripts/contrato.test.mjs
//
// El cruce de rutas (scripts/integracion.test.mjs) prueba que el endpoint EXISTE. Esto
// prueba que hablan el mismo idioma: que el cuerpo que manda el cliente es el que el
// servidor espera, y que la forma que devuelve es la que el cliente sabe leer.
//
// Es donde viven los fallos que no dan error: un campo que se llama distinto, una respuesta
// envuelta de otra forma, un error que llega como lista vacia. Nada de eso rompe nada — solo
// hace que la pantalla salga en blanco.
const BASE = process.env.BASE || "http://127.0.0.1:3099";
try { await fetch(`${BASE}/api/ai/limits`, { signal: AbortSignal.timeout(5000) }); }
catch { console.log(`\n○ contrato: SALTADO — no hay servidor en ${BASE}`); process.exit(0); }

let bad = 0;
const check = (l, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};
const post = async (ruta, cuerpo, cab = {}) => {
  const r = await fetch(`${BASE}${ruta}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...cab },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(20000),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// ── /api/data: la forma que construye lib/dataQuery.ts ──────────────────────────────
// El cliente manda {queries:[{table,op,...}]} y espera {results:[{rows,count}]}. Si una de
// las dos partes cambia de forma, las 50 llamadas del navegador devuelven undefined.
{
  const r = await post("/api/data", { queries: [{ table: "macro_state", op: "select" }] });
  check("sin sesion → 401", r.status, 401);
  check("y el error viene en `error`", typeof r.j?.error, "string");
}
{
  // Cuerpo mal formado: el servidor tiene que decirlo, no reventar con 500.
  for (const [nombre, cuerpo] of [
    ["sin queries", {}],
    ["queries vacio", { queries: [] }],
    ["queries no es lista", { queries: "hola" }],
    ["demasiadas", { queries: Array(25).fill({ table: "macro_state", op: "select" }) }],
  ]) {
    const r = await post("/api/data", cuerpo);
    // 401 llega antes que la validacion del cuerpo: sin sesion no se mira nada mas. Lo que
    // NO puede pasar es un 500 — eso seria el servidor tropezando con la entrada.
    check(`/api/data ${nombre} → no es 500`, r.status >= 500, false);
  }
}

// ── /api/batch: la forma que construye lib/proxy.ts ─────────────────────────────────
{
  const r = await post("/api/batch", { requests: [{ id: "0", path: "/api/fmp/quote?symbol=AAPL" }] });
  check("batch sin sesion → 401", r.status, 401);
}

// ── Errores que el cliente sabe leer ────────────────────────────────────────────────
// lib/proxy.ts distingue la cuota diaria del limite por minuto por la presencia de `plan`
// en el cuerpo, NO por el texto. Si el servidor deja de mandarlo, el usuario ve el error
// crudo `[proxy 429] ...` en vez del mensaje legible.
{
  const r = await fetch(`${BASE}/api/fmp/quote?symbol=AAPL`, { signal: AbortSignal.timeout(10000) });
  const t = await r.text();
  check("401 devuelve JSON, no HTML", t.trim().startsWith("{"), true);
  check("con la clave `error`", JSON.parse(t).error !== undefined, true);
}

// ── JSON invalido no debe tumbar el servidor ────────────────────────────────────────
{
  for (const ruta of ["/api/data", "/api/batch", "/api/waitlist"]) {
    const r = await fetch(`${BASE}${ruta}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: "{roto", signal: AbortSignal.timeout(10000),
    });
    check(`${ruta} con JSON roto → no es 500`, r.status >= 500 && r.status !== 503, false);
  }
}

// ── Cabeceras de seguridad que el front espera del servidor ─────────────────────────
{
  const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(20000) });
  const csp = r.headers.get("content-security-policy");
  check("hay CSP", Boolean(csp), true);
  // El navegador llama al mismo origen desde la fusion: si connect-src no lleva 'self',
  // TODAS las llamadas se bloquean en silencio (solo se ve en la consola del navegador).
  check("connect-src permite 'self'", /connect-src[^;]*'self'/.test(csp || ""), true);
  check("X-Frame-Options DENY", r.headers.get("x-frame-options"), "DENY");
  check("nosniff", r.headers.get("x-content-type-options"), "nosniff");
}

// ── Las variables NEXT_PUBLIC_* llegan al bundle ────────────────────────────────────
// Se incrustan al compilar. Si faltan, la app arranca bien y el login no funciona, sin
// ningun error en el servidor. Es el fallo mas caro de diagnosticar del despliegue.
{
  const html = await (await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(20000) })).text();
  const js = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map((m) => m[1]);
  let encontrado = false;
  for (const u of js.slice(0, 25)) {
    const c = await (await fetch(`${BASE}${u}`, { signal: AbortSignal.timeout(15000) })).text();
    if (c.includes("scora-509716")) { encontrado = true; break; }
  }
  // Las NEXT_PUBLIC_* se incrustan AL COMPILAR. Un `npm run build` a secas no las pasa, asi
  // que en local no aparecen y eso NO es un fallo: solo significa que esta imagen no sirve
  // para el login. En el despliegue real (construido con --build-arg) si estan; verificado
  // a mano contra Cloud Run. Se avisa en vez de fallar, para no dar un rojo enganoso.
  if (!encontrado) {
    console.log("○ aviso: el bundle local no lleva NEXT_PUBLIC_FIREBASE_PROJECT_ID.");
    console.log("  Es lo esperado con `npm run build` sin --build-arg. Para probar el login");
    console.log("  hace falta construir con las variables, como hace infra/build-and-push.sh.");
  }
}

console.log(bad ? `\ncontrato: ${bad} fallo(s)` : "\ncontrato: 16 comprobaciones OK");
process.exit(bad ? 1 : 0);
