// El cron del cierre diario de punta a punta: Yahoo falso → ruta real → Postgres.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/cierrecron.test.mjs
//
// POR QUÉ EXISTE. El régimen anterior se buscaba pidiendo "las dos filas más recientes" de
// macro_state, que tiene UNA (CHECK id = 1). prevMacro salía siempre null y el informe
// nunca anunciaba un cambio de régimen, que es su titular más importante. dailyclose.test
// prueba buildDailyClose con prevMacro ya dado; nadie probaba de dónde salía.
//
// Yahoo es falso; la base es real. Sin Postgres se salta.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ cierrecron: SALTADO — no hay Postgres en ${host}:${port}`);
  process.exit(0);
}
Object.assign(process.env, { PGHOST: host, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "scora", CRON_SECRET: "secreto" });

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

const cierre = Math.floor(Date.parse("2026-09-25T20:00:00Z") / 1000);
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://query1.finance.yahoo.com/")) {
    return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 101, chartPreviousClose: 100, regularMarketTime: cierre } }] } }), { status: 200 });
  }
  return fetchReal(url, init);
};

const { GET } = await import("../app/api/cron/daily-close/route.js");
const { pool } = await import("../lib/server/data/pool.ts");
const db = pool();
const macroAntes = (await db.query("select * from macro_state where id = 1")).rows[0] ?? null;
await db.query("truncate macro_state_history, sl_daily_close");
await db.query("delete from macro_state");
await db.query("insert into macro_state (id, snapshot_date, regime_id) values (1, '2026-09-25', 'expansion')");
await db.query(`insert into macro_state_history (snapshot_date, regime_id) values
  ('2026-09-23', 'expansion'), ('2026-09-24', 'contraction'), ('2026-09-25', 'expansion')`);

const corre = async () => (await GET(new Request("http://x/api/cron/daily-close", { headers: { Authorization: "Bearer secreto" } }))).json();
{
  const r = await corre();
  check("el cron escribe el informe", [r.ok, r.date], [true, "2026-09-25"]);
  check("detecta el cambio contraction → expansion", r.regimeChanged, true);
  const { rows } = await db.query("select payload from sl_daily_close where close_date = '2026-09-25'");
  check("y el informe guardado lo dice", [rows[0]?.payload?.regime?.previousId, rows[0]?.payload?.regime?.id], ["contraction", "expansion"]);
}
{
  await db.query("update macro_state_history set regime_id = 'expansion' where snapshot_date = '2026-09-24'");
  check("sin cambio real → no lo anuncia", (await corre()).regimeChanged, false);
}

await db.query("truncate macro_state_history, sl_daily_close");
await db.query("delete from macro_state");
if (macroAntes) {
  const cols = Object.keys(macroAntes);
  await db.query(`insert into macro_state (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => macroAntes[c]));
}
await db.end();
console.log(bad ? `\n✗ cierrecron: ${bad} fallo(s) de ${total}` : `\n✓ cierrecron: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
