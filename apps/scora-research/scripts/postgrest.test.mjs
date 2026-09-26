// El traductor de PostgREST a SQL (lib/server/data/postgrest.js).
//   PGHOST=/tmp/scpg PGPORT=5544 node --experimental-strip-types --no-warnings scripts/postgrest.test.mjs
//
// POR QUÉ EXISTE: 34 llamadas de los crons y del webhook de Stripe pasan por aquí. Traducen
// filtros que deciden A QUIÉN se le manda una alerta y QUÉ suscripción está activa. Un `in.()`
// mal interpretado no rompe nada: manda avisos a quien no toca, o deja de mandarlos.
//
// Se ejecuta contra Postgres de verdad porque lo que importa no es que el SQL "parezca"
// correcto, sino que devuelva las filas correctas. Se salta si no hay base.
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const probe = new pg.Client({ host, port: Number(process.env.PGPORT || 5544), user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch { console.log(`\n○ postgrest: SALTADO — no hay Postgres en ${host}`); process.exit(0); }

process.env.PGHOST = host; process.env.PGPORT = String(process.env.PGPORT || 5544);
process.env.PGUSER = "postgres"; process.env.PGDATABASE = "scora";
const { sbFetch } = await import("../lib/server/data/postgrest.js");
const { pool } = await import("../lib/server/data/pool.ts");

let bad = 0;
const check = (l, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const filas = async (url, init) => { const r = await sbFetch(url, init); return r.ok ? await r.json() : { error: true, status: r.status }; };

const p = pool();
await p.query("truncate sl_alerts, push_subscriptions cascade");
const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";

// ── INSERT ──────────────────────────────────────────────────────────────────────────
await filas("sl_alerts", { method: "POST", body: JSON.stringify([
  { user_id: U1, ticker: "AAPL", kind: "price_above", threshold: 200, active: true },
  { user_id: U1, ticker: "MSFT", kind: "price_below", threshold: 300, active: true },
  { user_id: U2, ticker: "TSLA", kind: "crossed_sma150", active: false },
]) });
check("insert de 3", (await filas("sl_alerts?select=id")).length, 3);

// ── Los filtros que usan los crons de verdad ────────────────────────────────────────
check("eq.true",
  (await filas("sl_alerts?active=eq.true&select=ticker")).map(r => r.ticker).sort(), ["AAPL", "MSFT"]);
check("in.(a,b) — el filtro de ticker-alerts",
  (await filas("sl_alerts?kind=in.(price_above,price_below)&select=ticker")).map(r => r.ticker).sort(), ["AAPL", "MSFT"]);
check("in.() con un solo valor",
  (await filas("sl_alerts?kind=in.(crossed_sma150)&select=ticker")).map(r => r.ticker), ["TSLA"]);
check("eq sobre uuid",
  (await filas(`sl_alerts?user_id=eq.${U2}&select=ticker`)).map(r => r.ticker), ["TSLA"]);
check("gte numérico",
  (await filas("sl_alerts?threshold=gte.250&select=ticker")).map(r => r.ticker), ["MSFT"]);
check("is.null — el guardián de alerts_log",
  (await filas("sl_alerts?threshold=is.null&select=ticker")).map(r => r.ticker), ["TSLA"]);
check("eq.false (booleano, no la cadena 'false')",
  (await filas("sl_alerts?active=eq.false&select=ticker")).map(r => r.ticker), ["TSLA"]);
check("order + limit",
  (await filas("sl_alerts?select=ticker&order=ticker.desc&limit=1")).map(r => r.ticker), ["TSLA"]);
check("select de varias columnas",
  Object.keys((await filas("sl_alerts?select=ticker,kind&limit=1"))[0]).sort(), ["kind", "ticker"]);

// ── PATCH: marcar una alerta como disparada ─────────────────────────────────────────
{
  const id = (await filas("sl_alerts?ticker=eq.AAPL&select=id"))[0].id;
  await filas(`sl_alerts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ active: false }) });
  check("patch aplicado", (await filas(`sl_alerts?id=eq.${id}&select=active`))[0].active, false);
  check("y NO toca a los demas", (await filas("sl_alerts?ticker=eq.MSFT&select=active"))[0].active, true);
}

// ── UPSERT (on_conflict) ────────────────────────────────────────────────────────────
{
  const sub = { endpoint: "https://push/1", user_id: U1, p256dh: "k", auth: "a" };
  await filas("push_subscriptions?on_conflict=endpoint", { method: "POST", body: JSON.stringify(sub) });
  await filas("push_subscriptions?on_conflict=endpoint", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ ...sub, p256dh: "k2" }) });
  const r = await filas("push_subscriptions?select=endpoint,p256dh");
  check("upsert no duplica", r.length, 1);
  check("y pisa el valor con merge-duplicates", r[0].p256dh, "k2");

  // Sin la cabecera Prefer, un conflicto NO debe pisar.
  await filas("push_subscriptions?on_conflict=endpoint", { method: "POST", body: JSON.stringify({ ...sub, p256dh: "k3" }) });
  check("sin Prefer, el conflicto no pisa", (await filas("push_subscriptions?select=p256dh"))[0].p256dh, "k2");
}

// ── DELETE ──────────────────────────────────────────────────────────────────────────
await filas("push_subscriptions?endpoint=eq.https://push/1", { method: "DELETE" });
check("delete", (await filas("push_subscriptions?select=endpoint")).length, 0);

// ── Guardas ─────────────────────────────────────────────────────────────────────────
check("PATCH sin filtros se rechaza",
  (await filas("sl_alerts", { method: "PATCH", body: JSON.stringify({ active: false }) })).error, true);
check("DELETE sin filtros se rechaza", (await filas("sl_alerts", { method: "DELETE" })).error, true);
check("tabla con nombre invalido", (await filas('sl_alerts";drop table sl_alerts;--?select=id')).error, true);
check("operador inventado", (await filas("sl_alerts?ticker=raro.AAPL&select=id")).error, true);
check("las alertas siguen ahi tras los intentos", (await filas("sl_alerts?select=id")).length, 3);

await p.end();
console.log(bad ? `\npostgrest: ${bad} fallo(s)` : "\npostgrest: 20 comprobaciones OK contra Postgres real");
process.exit(bad ? 1 : 0);
