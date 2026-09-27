// El rol de la app puede trabajar con filas y NO puede romper el esquema (AUDIT_REPORT A-5).
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/rolapp.test.mjs
//
// Aplica sql/gcp/003_rol_app.sql a una base local y se conecta COMO scora_app. Se salta sin
// Postgres. No toca producción: el rol en Cloud SQL se aplica a mano (ver el propio .sql).
import pg from "pg";
import { readFileSync } from "fs";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const admin = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await admin.connect(); }
catch { console.log(`\n○ rolapp: SALTADO — no hay Postgres en ${host}:${port}`); process.exit(0); }

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

await admin.query(readFileSync(new URL("../sql/gcp/003_rol_app.sql", import.meta.url), "utf8"));
// Aplicarlo dos veces no puede fallar: se reaplica tras cada migración.
let reaplicable = true;
try { await admin.query(readFileSync(new URL("../sql/gcp/003_rol_app.sql", import.meta.url), "utf8")); } catch { reaplicable = false; }
check("el script se puede aplicar dos veces", reaplicable, true);

const app = new pg.Client({ host, port, user: "scora_app", database: "scora" });
await app.connect();
const puede = async (sql, params = []) => { try { await app.query(sql, params); return true; } catch { return false; } };

// Lo que la app necesita.
await admin.query("delete from sl_watchlist where user_id = 'rolapp'");
check("SELECT", await puede("select count(*) from macro_state"), true);
check("INSERT (con secuencia)", await puede("insert into sl_watchlist (user_id, ticker) values ('rolapp', 'AAPL')"), true);
check("UPDATE", await puede("update sl_alerts set active = active where false"), true);
check("DELETE", await puede("delete from sl_watchlist where user_id = 'rolapp'"), true);
check("la función de búsqueda", await puede("select * from search_kb_chunks('AAPL', null, 1)"), true);

// Lo que NO debe poder.
check("DROP TABLE → no", await puede("drop table sl_journal"), false);
check("TRUNCATE → no", await puede("truncate sl_watchlist"), false);
check("ALTER TABLE → no", await puede("alter table sl_journal add column x int"), false);
check("CREATE TABLE → no", await puede("create table public.intrusa (id int)"), false);
check("las tablas siguen ahí", (await admin.query("select to_regclass('public.sl_journal') is not null ok")).rows[0].ok, true);

// Una tabla que cree una migración futura (como postgres) nace con permisos para la app.
await admin.query("drop table if exists public.tabla_futura; create table public.tabla_futura (id serial primary key, v text)");
check("tabla nueva: la app puede escribir en ella", await puede("insert into tabla_futura (v) values ('x')"), true);
await admin.query("drop table public.tabla_futura");

await app.end();
await admin.end();
console.log(bad ? `\n✗ rolapp: ${bad} fallo(s) de ${total}` : `\n✓ rolapp: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
