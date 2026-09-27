// El webhook de Stripe de punta a punta: evento firmado → ruta real → fila en Postgres.
//   PGHOST=127.0.0.1 PGPORT=5544 node --experimental-strip-types --no-warnings scripts/stripewebhook.test.mjs
//
// POR QUÉ EXISTE. stripe.test.mjs prueba la firma y el codificado, pero nadie llamaba a la
// ruta. Y la ruta exigía que client_reference_id fuera un UUID —el id de Supabase—, cuando
// ahora es el uid de Identity Platform (28 caracteres alfanuméricos). Todo pago se descartaba
// con un 200 y un console.error: quien pagaba se quedaba sin Pro y Stripe no reintentaba.
//
// La API de Stripe se sustituye por un fetch falso que devuelve la suscripción; la base es
// real. Sin Postgres se salta.
import { createHmac } from "node:crypto";
import pg from "pg";

const host = process.env.PGHOST || "/tmp/scpg";
const port = Number(process.env.PGPORT || 5544);
const probe = new pg.Client({ host, port, user: "postgres", database: "scora" });
try { await probe.connect(); await probe.end(); }
catch {
  console.log(`\n○ stripewebhook: SALTADO — no hay Postgres en ${host}:${port}`);
  process.exit(0);
}
Object.assign(process.env, { PGHOST: host, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "scora",
  STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_prueba" });

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// Stripe falso: solo se le pide GET-como-POST de subscriptions/<id>.
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.stripe.com/v1/subscriptions/")) {
    return new Response(JSON.stringify({ id: "sub_1", status: "active", customer: "cus_1",
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_1" } }] } }), { status: 200 });
  }
  return fetchReal(url, init);
};

const { POST } = await import("../app/api/stripe/webhook/route.js");
const { pool } = await import("../lib/server/data/pool.ts");
const db = pool();
await db.query("truncate sl_subscriptions, sl_stripe_events");

let n = 0;
const entrega = async (type, object) => {
  const cuerpo = JSON.stringify({ id: `evt_${++n}`, type, created: Math.floor(Date.now() / 1000) + n, data: { object } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${cuerpo}`).digest("hex");
  const r = await POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: cuerpo,
    headers: { "stripe-signature": `t=${t},v1=${v1}` } }));
  return r.status;
};
const fila = async () => (await db.query("select user_id, stripe_customer_id, status from sl_subscriptions")).rows;

// Un uid de Identity Platform real tiene esta forma.
const UID = "Xy7Qk2mN9pL4rT6vB8cD1eF3gH5j";
check("checkout.session.completed → 200", await entrega("checkout.session.completed",
  { id: "cs_1", client_reference_id: UID, customer: "cus_1", subscription: "sub_1" }), 200);
check("con un uid de Identity Platform, la suscripción queda registrada", await fila(),
  [{ user_id: UID, stripe_customer_id: "cus_1", status: "active" }]);

// Lo que llega de fuera sigue validándose: un id con caracteres raros no se escribe.
await db.query("truncate sl_subscriptions");
check("id con caracteres raros → se ignora (200, sin reintento)", await entrega("checkout.session.completed",
  { id: "cs_2", client_reference_id: "x' or 1=1 --", customer: "cus_2", subscription: "sub_1" }), 200);
check("y no crea fila", await fila(), []);

// Las actualizaciones por cliente siguen llegando a la fila.
await entrega("checkout.session.completed", { id: "cs_3", client_reference_id: UID, customer: "cus_1", subscription: "sub_1" });
check("subscription.deleted → 200", await entrega("customer.subscription.deleted",
  { id: "sub_1", status: "active", customer: "cus_1", items: { data: [] } }), 200);
check("y la deja cancelada", (await fila())[0]?.status, "canceled");

await db.query("truncate sl_subscriptions, sl_stripe_events");
await db.end();
console.log(bad ? `\n✗ stripewebhook: ${bad} fallo(s) de ${total}` : `\n✓ stripewebhook: ${total} comprobaciones OK contra Postgres real`);
process.exit(bad ? 1 : 0);
