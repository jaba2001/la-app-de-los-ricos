// El cron de alertas macro de punta a punta: FRED falso → ruta real → Postgres → correo.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/alertascron.test.mjs
//
// POR QUÉ EXISTE. La lista de suscriptores se leía con un fetch() directo a
// `${SUPABASE_URL}/rest/v1/sl_alert_prefs`. Sin Supabase la URL era "undefined/rest/v1/…",
// el fetch lanzaba, el error acababa en `email: { error }` de la respuesta del cron y ningún
// suscriptor recibía nunca una alerta macro. Las demás lecturas del mismo fichero ya iban por
// sbFetch, por eso las pruebas de postgrest no lo veían.
//
// FRED y Resend son falsos; la base es real. Sin Postgres se salta.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ alertascron: SALTADO — no hay Postgres en ${host}:${port}`);
  process.exit(0);
}
Object.assign(process.env, { PGHOST: host, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "scora",
  CRON_SECRET: "secreto", FRED_KEY: "k", RESEND_KEY: "re_prueba" });
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// FRED: el HY OAS salta 80 pb en un día (dispara credit_blowout); WALCL plano (no dispara).
const correos = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.stlouisfed.org/")) {
    const hy = u.includes("BAMLH0A0HYM2");
    const observations = hy
      ? [{ date: "2026-09-26", value: "4.10" }, { date: "2026-09-25", value: "3.30" }]
      : [0, 1, 2, 3, 4].map((i) => ({ date: `2026-09-2${i}`, value: "7000000" }));
    return new Response(JSON.stringify({ observations }), { status: 200 });
  }
  if (u === "https://api.resend.com/emails") { correos.push(JSON.parse(init.body).to); return new Response("{}", { status: 200 }); }
  return fetchReal(url, init);
};

const { GET } = await import("../app/api/cron/alerts-check/route.js");
const { pool } = await import("../lib/server/data/pool.ts");
const db = pool();
await db.query("truncate alerts_log, sl_alert_prefs");
await db.query(`insert into sl_alert_prefs (user_id, email, macro_alerts) values
  ('ana', 'ana@x.com', true), ('beni', 'beni@x.com', false)`);

const corre = async () => {
  const r = await GET(new Request("http://x/api/cron/alerts-check", { headers: { Authorization: "Bearer secreto" } }));
  return { status: r.status, cuerpo: await r.json() };
};

{
  const { status, cuerpo } = await corre();
  check("el cron responde 200", status, 200);
  check("inserta la alerta de crédito", cuerpo.inserted, 1);
  check("el correo no falla", cuerpo.email?.error ?? null, null);
  check("se envía solo a quien tiene alertas macro activadas", correos, ["ana@x.com"]);
  check("la alerta queda en alerts_log, sin usuario (es de sistema)",
    (await db.query("select alert_type, user_id from alerts_log")).rows, [{ alert_type: "credit_blowout", user_id: null }]);
}
{
  correos.length = 0;
  const { cuerpo } = await corre();
  check("la misma alerta en 24 h no se repite", cuerpo.inserted, 0);
  check("ni se vuelve a mandar el correo", correos, []);
}

await db.query("truncate alerts_log, sl_alert_prefs");
await db.end();
console.log(bad ? `\n✗ alertascron: ${bad} fallo(s) de ${total}` : `\n✓ alertascron: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
