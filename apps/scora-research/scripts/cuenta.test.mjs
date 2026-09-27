// Borrar una cuenta borra TODOS sus datos, y solo los suyos (AUDIT_REPORT A-6).
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/cuenta.test.mjs
//
// Sin las claves ajenas en cascada de Supabase, borrar la identidad dejaba huérfanas las filas
// del usuario en 13 tablas. La lista de tablas se comprueba contra el esquema real: una tabla
// nueva con `user_id` que no entre en la lista es un borrado incompleto que nadie vería.
//
// La parte sin base (la lista cubre las privadas de policy.ts) corre siempre.
import pg from "pg";
import { TABLAS_DE_USUARIO, SuscripcionActiva } from "../lib/server/cuenta.js";
import { POLICY } from "../lib/server/data/policy.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// ── Sin base ────────────────────────────────────────────────────────────────────────
{
  const privadas = Object.entries(POLICY).filter(([t, p]) => p.scope === "user" && t !== "sl_analyses_latest").map(([t]) => t);
  check("toda tabla privada de policy.ts se borra", privadas.filter((t) => !TABLAS_DE_USUARIO.includes(t)), []);
}

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); }
catch {
  console.log(`\n○ cuenta: parte con base SALTADA — no hay Postgres en ${host}:${port}`);
  console.log(bad ? `\n✗ cuenta: ${bad} fallo(s) de ${total}` : `\n✓ cuenta: ${total} comprobaciones OK (sin base)`);
  process.exit(bad ? 1 : 0);
}

// Contra el ESQUEMA REAL: toda tabla con una columna user_id tiene que estar en la lista.
{
  const { rows } = await probe.query(`select table_name::text t from information_schema.columns
    where table_schema = 'public' and column_name = 'user_id'
      and table_name in (select table_name from information_schema.tables where table_type = 'BASE TABLE' and table_schema = 'public')`);
  check("toda tabla del esquema con user_id está en la lista", rows.map((r) => r.t).filter((t) => !TABLAS_DE_USUARIO.includes(t)).sort(), []);
}
await probe.end();

process.env.PGHOST = host; process.env.PGPORT = String(port);
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";
const { pool } = await import("../lib/server/data/pool.ts");
const { borrarDatosDeUsuario } = await import("../lib/server/cuenta.js");
const db = pool();
await db.query(`truncate ${TABLAS_DE_USUARIO.join(", ")}`);

// Una fila por tabla para cada uno de los dos usuarios.
async function sembrar(uid, correo) {
  await db.query("insert into ai_audit_log (user_id, module, output) values ($1, 'm', 'o')", [uid]);
  await db.query("insert into alerts_log (user_id, alert_type, message) values ($1, 't', 'm')", [uid]).catch(() => {});
  await db.query("insert into sl_alert_prefs (user_id, email, macro_alerts) values ($1, $2, true)", [uid, correo]);
  await db.query("insert into sl_alerts (user_id, ticker, kind) values ($1, 'AAPL', 'price_above')", [uid]);
  await db.query("insert into sl_analyses (user_id, ticker, analysis_date) values ($1, 'AAPL', '2026-09-20')", [uid]);
  await db.query("insert into sl_journal (user_id, ticker, side, shares, price, trade_date) values ($1, 'AAPL', 'buy', 1, 100, '2026-09-01')", [uid]);
  await db.query("insert into sl_watchlist (user_id, ticker) values ($1, 'AAPL')", [uid]);
  await db.query("insert into stock_snapshot (user_id, ticker, snapshot_date, data) values ($1, 'AAPL', '2026-09-20', '{}')", [uid]);
  await db.query("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')", [uid, `https://push/${uid}`]);
}
const cuenta = async (uid) => {
  let n = 0;
  for (const t of TABLAS_DE_USUARIO) n += (await db.query(`select count(*)::int n from "${t}" where user_id = $1`, [uid])).rows[0].n;
  return n;
};
await sembrar("ana", "ana@x.com");
await sembrar("beni", "beni@x.com");
// Un alta en la lista de espera hecha SIN sesión: solo la delata el correo.
await db.query("insert into sl_waitlist (email, tier, source) values ('ANA@x.com', 'pro', 'pricing'), ('beni@x.com', 'pro', 'pricing')");

const antesAna = await cuenta("ana"), antesBeni = await cuenta("beni");
check("hay datos sembrados para los dos", antesAna > 5 && antesBeni > 5, true);

// Una suscripción viva bloquea el borrado, y no se borra NADA.
await db.query("insert into sl_subscriptions (user_id, stripe_customer_id, status, current_period_end) values ('ana', 'cus_a', 'active', now() + interval '10 days')");
{
  let bloqueo = false;
  try { await borrarDatosDeUsuario(db, "ana", "ana@x.com"); } catch (e) { bloqueo = e instanceof SuscripcionActiva; }
  check("suscripción activa → se niega", bloqueo, true);
  check("y no se borró nada (transacción)", await cuenta("ana"), antesAna + 1);
}

// Cancelada: ya se puede.
await db.query("update sl_subscriptions set status = 'canceled' where user_id = 'ana'");
const borradas = await borrarDatosDeUsuario(db, "ana", "ana@x.com");
check("a Ana no le queda ni una fila", await cuenta("ana"), 0);
check("su alta sin sesión en la lista de espera, también (por correo, sin distinguir mayúsculas)",
  (await db.query("select count(*)::int n from sl_waitlist where lower(email) = 'ana@x.com'")).rows[0].n, 0);
check("Beni conserva todo", await cuenta("beni"), antesBeni);
check("Beni sigue en la lista de espera", (await db.query("select count(*)::int n from sl_waitlist where email = 'beni@x.com'")).rows[0].n, 1);
check("el recuento devuelto cubre las 13 tablas", Object.keys(borradas).length, 13);
check("borrar otra vez no falla (idempotente)", Object.values(await borrarDatosDeUsuario(db, "ana", "ana@x.com")).reduce((s, n) => s + n, 0), 0);

await db.query(`truncate ${TABLAS_DE_USUARIO.join(", ")}`);
await db.end();
console.log(bad ? `\n✗ cuenta: ${bad} fallo(s) de ${total}` : `\n✓ cuenta: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
