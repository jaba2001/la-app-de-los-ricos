// El cron de alertas por ticker de punta a punta: FMP falso → ruta real → Postgres.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/tickeralertascron.test.mjs
//
// POR QUÉ EXISTE. Al migrar a Cloud SQL se cambiaron los fetch() por sbFetch() a ciegas y
// las dos llamadas a FMP (cotización e histórico) cayeron también: sbFetch leía la URL de FMP
// como nombre de tabla, devolvía 500, el precio salía null y NINGUNA alerta de precio ni
// técnica se disparaba. El cron respondía 200 con `fired: 0`, así que nada lo delataba.
//
// FMP es falso; la base es real. Sin Postgres se salta.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ tickeralertascron: SALTADO — no hay Postgres en ${host}:${port}`);
  process.exit(0);
}
Object.assign(process.env, { PGHOST: host, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "scora",
  CRON_SECRET: "secreto", FMP_KEY: "k" });
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://financialmodelingprep.com/stable/quote")) {
    return new Response(JSON.stringify([{ symbol: "AAPL", price: 250 }]), { status: 200 });
  }
  if (u.startsWith("https://financialmodelingprep.com/")) return new Response("[]", { status: 200 });
  return fetchReal(url, init);
};

const { GET } = await import("../app/api/cron/ticker-alerts/route.js");
const { pool } = await import("../lib/server/data/pool.ts");
const db = pool();
await db.query("truncate sl_alerts");
await db.query(`insert into sl_alerts (user_id, ticker, kind, threshold, active, one_shot) values
  ('ana', 'AAPL', 'price_above', 200, true, true), ('ana', 'AAPL', 'price_below', 100, true, false)`);

const r = await GET(new Request("http://x/api/cron/ticker-alerts", { headers: { Authorization: "Bearer secreto" } }));
const cuerpo = await r.json();
check("el cron responde 200", r.status, 200);
check("cotiza el ticker", cuerpo.priced, 1);
check("dispara la alerta de AAPL > 200 (cotiza a 250)", cuerpo.fired, 1);
const filas = (await db.query("select kind, active, last_value, last_triggered_at is not null as marcada from sl_alerts order by kind")).rows;
check("la de precio por debajo no se toca", filas.find((f) => f.kind === "price_below"), { kind: "price_below", active: true, last_value: null, marcada: false });
check("la disparada queda marcada, con el precio, y pausada (one_shot)", filas.find((f) => f.kind === "price_above"),
  { kind: "price_above", active: false, last_value: "250", marcada: true });

await db.query("truncate sl_alerts");
await db.end();
console.log(bad ? `\n✗ tickeralertascron: ${bad} fallo(s) de ${total}` : `\n✓ tickeralertascron: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
