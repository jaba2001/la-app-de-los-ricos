// La caché del esquema caduca y se recupera de un fallo (AUDIT_REPORT M-6).
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/esquema.test.mjs
//
// Dos fallos que solo se ven en producción:
//   · se leía una vez por instancia y para siempre: una columna nueva era "no permitida"
//     hasta que Cloud Run reciclara la instancia
//   · si la PRIMERA lectura fallaba, la promesa rechazada se quedaba guardada y /api/data
//     daba 503 para siempre, aunque la base ya hubiera vuelto
// Se salta sin Postgres.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const admin = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await admin.connect(); }
catch { console.log(`\n○ esquema: SALTADO — no hay Postgres en ${host}:${port}`); process.exit(0); }

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// ── 1. Recuperarse de una primera lectura fallida ───────────────────────────────────
// Se apunta el pool a un puerto donde no hay nadie, se falla, y luego se arregla el destino.
process.env.PGHOST = "127.0.0.1"; process.env.PGPORT = "1";
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";
const mod = await import("../lib/server/data/pool.ts");
// Cuántas veces se pregunta DE VERDAD a la base. Con el fallo antiguo, la segunda llamada no
// preguntaba: devolvía la promesa rechazada guardada, con el mismo mensaje de conexión.
let consultas = 0;
{ const p = mod.pool(); const q = p.query.bind(p); p.query = (...a) => { consultas++; return q(...a); }; }
let primero = null;
try { await mod.esquema(); primero = "ok"; } catch { primero = "falló"; }
check("sin base, la primera lectura falla", primero, "falló");
// La base "vuelve". El pool es de módulo y ya apunta al puerto malo, así que el destino bueno
// se prueba con una instancia nueva del módulo (otra URL de caché).
process.env.PGPORT = String(port); process.env.PGHOST = host;
const mod2 = await import(`../lib/server/data/pool.ts?vuelta=${Date.now()}`);
let segundo = null;
try { const e = await mod2.esquema(); segundo = e.sl_watchlist ? "ok" : "sin tablas"; } catch { segundo = "falló"; }
check("cuando la base vuelve, se lee (no se queda pegado al fallo)", segundo, "ok");

// Y dentro del MISMO módulo: el fallo anterior no puede quedar guardado.
try { await mod.esquema(); } catch { /* sigue sin base: lo que importa es si lo intentó */ }
check("el mismo módulo vuelve a preguntar a la base (no devuelve la promesa rechazada)", consultas, 2);

// ── 2. Caducidad: una columna nueva aparece sin reiniciar ────────────────────────────
mod2._ttlEsquema(50);
await admin.query("alter table sl_watchlist drop column if exists columna_nueva");
const antes = await mod2.esquema();
check("antes de la migración no está", antes.sl_watchlist.has("columna_nueva"), false);
await admin.query("alter table sl_watchlist add column columna_nueva text");
await new Promise((r) => setTimeout(r, 80));
const despues = await mod2.esquema();
check("pasada la caducidad, la columna nueva se reconoce", despues.sl_watchlist.has("columna_nueva"), true);
await admin.query("alter table sl_watchlist drop column columna_nueva");

// ── 3. Con una foto previa, un fallo de relectura no tumba la app ───────────────────
{
  const conFoto = await import(`../lib/server/data/pool.ts?foto=${Date.now()}`);
  await conFoto.esquema();                 // foto buena
  conFoto._ttlEsquema(0);                  // la siguiente llamada relee
  await conFoto.pool().end();              // y la base "cae"
  let r = null;
  try { const e = await conFoto.esquema(); r = e.sl_watchlist ? "sirve la foto anterior" : "?"; } catch { r = "falló"; }
  check("si la relectura falla, se sirve la foto anterior", r, "sirve la foto anterior");
}

await mod2.pool().end();
await admin.end();
console.log(bad ? `\n✗ esquema: ${bad} fallo(s) de ${total}` : `\n✓ esquema: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
