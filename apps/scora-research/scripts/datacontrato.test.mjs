// CONTRATO de /api/data: el cliente de las pantallas (lib/dataQuery.ts) contra el servidor
// (lib/server/data/ejecutar.ts → query.ts → Postgres), sin HTTP ni token de por medio.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/datacontrato.test.mjs
//
// datacliente.test.mjs prueba el cliente con un transporte falso y aislamiento.test.mjs el SQL
// que construye el servidor. Ninguna de las dos veía que lo que el cliente MANDA y lo que el
// servidor ENTIENDE no casaban (AUDIT_REPORT M-1, M-2):
//   · `.not(col, "is", null)` viajaba como `neq null` → `col <> NULL` → cero filas siempre.
//   · `{ count: "exact" }` devolvía el rowCount de la página: 1000 sobre 1500.
// Aquí el transporte es el camino real del servidor, así que esas costuras se ven.
//
// La parte sin base (el cliente rechaza una negación que no sabe traducir) corre siempre; la
// de Postgres se salta sin base, igual que postgrest.test.mjs.
import pg from "pg";
import { datos, setTransporte } from "../lib/dataQuery.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// ── Sin base ────────────────────────────────────────────────────────────────────────
{
  let lanzo = false;
  try { datos.from("sl_analyses").select("sector").not("sector", "eq", "x"); } catch { lanzo = true; }
  check("una negación que no es `is null` lanza en el cliente, no se traduce mal", lanzo, true);
}

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ datacontrato: parte con base SALTADA — no hay Postgres en ${host}:${port}`);
  console.log(bad ? `\n✗ datacontrato: ${bad} fallo(s) de ${total}` : `\n✓ datacontrato: ${total} comprobaciones OK (sin base)`);
  process.exit(bad ? 1 : 0);
}
process.env.PGHOST = host; process.env.PGPORT = String(port);
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";

const { pool, esquema } = await import("../lib/server/data/pool.ts");
const { ejecutarConsulta } = await import("../lib/server/data/ejecutar.ts");
const db = pool();
const esq = await esquema();

// El transporte hace lo mismo que app/api/data/route.ts con cada consulta del lote. El
// usuario lo fija la prueba, como lo fijaría el token verificado.
let usuario = "ana";
setTransporte(async (queries) => ({
  results: await Promise.all(queries.map((q) =>
    ejecutarConsulta(db, q, usuario, esq).catch((e) => ({ error: e.message })))),
}));

await db.query("truncate sl_analyses, sl_cohort, sl_watchlist, macro_state_history");

// ── M-1 · .not(col, "is", null) ─────────────────────────────────────────────────────
await db.query(`insert into sl_analyses (user_id, ticker, analysis_date, sector) values
  ('ana', 'AAPL', '2026-09-20', 'Technology'), ('ana', 'AAPL', '2026-09-25', null)`);
{
  // La consulta exacta de app/stock/[ticker]/page.tsx: el último sector conocido del ticker.
  const { data, error } = await datos.from("sl_analyses").select("sector")
    .eq("ticker", "AAPL").not("sector", "is", null)
    .order("analysis_date", { ascending: false }).limit(1).maybeSingle();
  check(".not(sector is null) sin error", error, null);
  check(".not(sector is null) encuentra el último sector conocido", data?.sector, "Technology");
}

// ── M-2 · count exact ───────────────────────────────────────────────────────────────
await db.query(`insert into sl_cohort (score_date, ticker)
  select date '2020-01-01' + i, 'T' || i from generate_series(1, 1500) i`);
{
  const soloNumero = await datos.from("sl_cohort").select("id", { count: "exact", head: true });
  check("count exact + head: el total real, no el de la página", soloNumero.count, 1500);
  check("count exact + head: sin filas", soloNumero.data, []);
  const pagina = await datos.from("sl_cohort").select("id", { count: "exact" }).limit(10);
  check("count exact con limit: 10 filas", pagina.data?.length, 10);
  check("count exact con limit: total 1500", pagina.count, 1500);
  const sinCount = await datos.from("sl_cohort").select("id").limit(5);
  check("sin pedir count, no se devuelve", sinCount.count, null);
}

// El recuento respeta el filtro de usuario, igual que las filas.
await db.query(`insert into sl_watchlist (user_id, ticker) values ('ana','AAPL'), ('ana','MSFT'), ('beni','TSLA')`);
{
  usuario = "ana";
  const r = await datos.from("sl_watchlist").select("id", { count: "exact", head: true });
  check("count de una tabla privada cuenta solo las filas del usuario", r.count, 2);
  usuario = "beni";
  const b = await datos.from("sl_watchlist").select("ticker");
  check("y las filas también", b.data?.map((x) => x.ticker), ["TSLA"]);
  usuario = "ana";
}

// ── C-3, visto desde el cliente ─────────────────────────────────────────────────────
await db.query("insert into macro_state_history (snapshot_date) values ('2026-09-27')");
{
  const { data } = await datos.from("macro_state_history").select("snapshot_date").limit(1).single();
  check("una columna date llega al cliente como YYYY-MM-DD", data?.snapshot_date, "2026-09-27");
}

// ── M-8 · ignoreDuplicates: el registro inmutable no se sobrescribe ─────────────────
// app/stock/[ticker] sella UNA nota por ticker y día en sl_score_log con ignoreDuplicates. El
// servidor ignoraba el campo y hacía DO UPDATE: re-analizar el mismo día cambiaba la nota
// sellada, que es justo lo que el registro existe para impedir.
await db.query("delete from sl_score_log where user_id = 'ana'");
{
  usuario = "ana";
  const sella = (score) => datos.from("sl_score_log").upsert(
    { ticker: "AAPL", score_date: "2026-09-27", score_total: score },
    { onConflict: "user_id,ticker,score_date", ignoreDuplicates: true });
  await sella(70);
  const segunda = await sella(10);
  check("re-sellar el mismo día no da error", segunda.error, null);
  const { rows } = await db.query("select score_total from sl_score_log where user_id = 'ana'");
  check("se conserva la PRIMERA nota sellada", rows.map((r) => Number(r.score_total)), [70]);
  // Y un upsert normal sí sigue PISANDO (no se ha roto el caso general): las preferencias de
  // alertas se guardan así.
  await db.query("delete from sl_alert_prefs where user_id = 'ana'");
  await datos.from("sl_alert_prefs").upsert({ email: "a@x.com", macro_alerts: true }, { onConflict: "user_id" });
  await datos.from("sl_alert_prefs").upsert({ email: "a@x.com", macro_alerts: false }, { onConflict: "user_id" });
  check("un upsert sin ignoreDuplicates sigue actualizando",
    (await db.query("select macro_alerts from sl_alert_prefs where user_id = 'ana'")).rows.map((r) => r.macro_alerts), [false]);
  await db.query("delete from sl_alert_prefs where user_id = 'ana'");
}
await db.query("delete from sl_score_log where user_id = 'ana'");

await db.query("truncate sl_analyses, sl_cohort, sl_watchlist, macro_state_history");
await db.end();
console.log(bad ? `\n✗ datacontrato: ${bad} fallo(s) de ${total}` : `\n✓ datacontrato: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
