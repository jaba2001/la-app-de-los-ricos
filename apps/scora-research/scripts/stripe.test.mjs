// Tests de la verificación de firma de Stripe. Puros, sin credenciales ni red.
// Run: node scripts/stripe.test.mjs
//
// Esto es lo que separa "Stripe nos dijo que pagó" de "alguien dijo que pagó". Si
// verifyWebhook acepta algo que no debe, el resultado no es un bug de UI: es una
// suscripción gratis para cualquiera que encuentre la URL. De ahí que los casos que más se
// cuidan aquí sean los NEGATIVOS — cuerpo alterado, secreto equivocado, firma reutilizada.
import { createHmac } from "node:crypto";
import { verifyWebhook, stripeEnabled, stripeIsTestMode, PRO_STATUSES, encodeForm } from "../lib/server/stripe.js";

let passed = 0, failed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };

const SECRET = "whsec_test_0123456789abcdef";
const BODY = JSON.stringify({
  id: "evt_1", type: "customer.subscription.updated", created: 1754900000,
  data: { object: { id: "sub_1", status: "active", customer: "cus_1" } },
});

/** Firma como lo hace Stripe: HMAC-SHA256 sobre `${t}.${body}`. */
function sign(body, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

// ── Camino feliz ────────────────────────────────────────────────────────────────
{
  const r = await verifyWebhook(BODY, sign(BODY, SECRET), SECRET);
  ok(!r.error, `una firma válida se acepta (${r.error ?? "ok"})`);
  ok(r.event?.id === "evt_1", "devuelve el evento ya parseado");
  ok(r.event?.data?.object?.status === "active", "el objeto anidado llega intacto");
}

// ── Rechazos: cada uno es un agujero distinto ───────────────────────────────────
{
  // Cuerpo alterado tras firmar — el ataque obvio: cambiar el status a 'active'.
  const tampered = BODY.replace('"status":"active"', '"status":"canceled"');
  const r = await verifyWebhook(tampered, sign(BODY, SECRET), SECRET);
  ok(!!r.error, "un cuerpo alterado se rechaza aunque la firma esté bien formada");
}
{
  const r = await verifyWebhook(BODY, sign(BODY, "whsec_otro_secreto"), SECRET);
  ok(!!r.error, "una firma hecha con otro secreto se rechaza");
}
{
  // Replay: firma auténtica capturada hace una hora.
  const old = Math.floor(Date.now() / 1000) - 3600;
  const r = await verifyWebhook(BODY, sign(BODY, SECRET, old), SECRET);
  ok(/tolerance/.test(r.error ?? ""), `una firma de hace una hora se rechaza (${r.error})`);
}
{
  // Reloj adelantado: un t muy futuro también queda fuera de tolerancia.
  const future = Math.floor(Date.now() / 1000) + 3600;
  const r = await verifyWebhook(BODY, sign(BODY, SECRET, future), SECRET);
  ok(/tolerance/.test(r.error ?? ""), "un timestamp muy futuro se rechaza");
}
{
  const r = await verifyWebhook(BODY, sign(BODY, SECRET, Math.floor(Date.now() / 1000) - 120), SECRET);
  ok(!r.error, "dentro de la ventana (2 min) sí se acepta");
}
{
  const r = await verifyWebhook(BODY, null, SECRET);
  ok(!!r.error, "sin cabecera de firma se rechaza");
}
{
  const r = await verifyWebhook(BODY, sign(BODY, SECRET), null);
  ok(!!r.error, "sin secreto configurado se rechaza (no se acepta 'a lo abierto')");
}
{
  const r = await verifyWebhook(BODY, "no-es-una-cabecera", SECRET);
  ok(/malformed/.test(r.error ?? ""), "una cabecera con basura se rechaza");
}
{
  const t = Math.floor(Date.now() / 1000);
  const r = await verifyWebhook(BODY, `t=${t}`, SECRET);
  ok(/malformed/.test(r.error ?? ""), "una cabecera con t pero sin v1 se rechaza");
}
{
  const r = await verifyWebhook(BODY, `t=no-es-un-numero,v1=abc`, SECRET);
  ok(!!r.error, "un timestamp no numérico se rechaza");
}
{
  // Longitud correcta pero contenido falso: cubre el camino de timingSafeEqual donde las
  // longitudes coinciden y hay que comparar de verdad.
  const t = Math.floor(Date.now() / 1000);
  const r = await verifyWebhook(BODY, `t=${t},v1=${"a".repeat(64)}`, SECRET);
  ok(!!r.error, "un hex del largo correcto pero falso se rechaza");
}

// ── Rotación de secreto: Stripe manda varias v1 y basta con que una cuadre ──────
{
  const t = Math.floor(Date.now() / 1000);
  const good = createHmac("sha256", SECRET).update(`${t}.${BODY}`).digest("hex");
  const r = await verifyWebhook(BODY, `t=${t},v1=${"b".repeat(64)},v1=${good}`, SECRET);
  ok(!r.error, "con varias v1 basta que una sea válida (rotación de secreto)");
}
{
  const t = Math.floor(Date.now() / 1000);
  const r = await verifyWebhook(BODY, `t=${t},v1=${"b".repeat(64)},v1=${"c".repeat(64)}`, SECRET);
  ok(!!r.error, "varias v1 todas inválidas se rechazan");
}

// ── Interruptor general ─────────────────────────────────────────────────────────
{
  const saveKey = process.env.STRIPE_SECRET_KEY, saveHook = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET;
  ok(stripeEnabled() === false, "sin env vars, Stripe queda inerte");

  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  ok(stripeEnabled() === false, "con la clave pero sin el secreto del webhook, sigue inerte");

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_123";
  ok(stripeEnabled() === true, "con ambas, se activa");
  ok(stripeIsTestMode() === true, "sk_test_ se reconoce como modo prueba");

  process.env.STRIPE_SECRET_KEY = "sk_live_123";
  ok(stripeIsTestMode() === false, "sk_live_ no es modo prueba");

  if (saveKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = saveKey;
  if (saveHook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saveHook;
}

// ── Qué estados dan acceso ──────────────────────────────────────────────────────
ok(PRO_STATUSES.has("active") && PRO_STATUSES.has("trialing"), "active y trialing dan acceso");
ok(PRO_STATUSES.has("past_due"), "past_due mantiene acceso durante los reintentos de cobro");
ok(!PRO_STATUSES.has("canceled") && !PRO_STATUSES.has("unpaid"), "canceled y unpaid no dan acceso");
ok(!PRO_STATUSES.has("incomplete"), "incomplete (checkout a medias) no da acceso");

// ── Codificación de parámetros ──────────────────────────────────────────────────
// Stripe rechaza lo mal formado con "Received unknown parameter", sin decir cuál ni dónde.
// Estas comprobaciones convierten ese rato de depuración en un fallo con nombre.
{
  // URLSearchParams escapa los corchetes; se descodifica para comparar lo que Stripe lee.
  const dec = (s) => decodeURIComponent(s);

  ok(dec(encodeForm({ mode: "subscription" })) === "mode=subscription", "un par plano se codifica tal cual");

  const flat = dec(encodeForm({ "line_items[0][price]": "price_1", "line_items[0][quantity]": 1 }));
  ok(flat === "line_items[0][price]=price_1&line_items[0][quantity]=1",
    `una clave con corchetes ya escritos se respeta (${flat})`);

  const nested = dec(encodeForm({ subscription_data: { metadata: { supabase_user_id: "u1" } } }));
  ok(nested === "subscription_data[metadata][supabase_user_id]=u1",
    `un objeto anidado se aplana a corchetes (${nested})`);

  const arr = dec(encodeForm({ line_items: [{ price: "price_1", quantity: 2 }] }));
  ok(arr === "line_items[0][price]=price_1&line_items[0][quantity]=2",
    `un array usa su índice como clave (${arr})`);

  ok(encodeForm({ a: 1, b: null, c: undefined }) === "a=1", "null y undefined se omiten, no se mandan como texto");
  ok(dec(encodeForm({ allow_promotion_codes: true })) === "allow_promotion_codes=true", "los booleanos se serializan");

  // Una URL de retorno lleva ':' y '/' — tienen que ir escapados o Stripe recibe otra cosa.
  const url = encodeForm({ success_url: "https://scora.app/pricing?checkout=success" });
  ok(url.includes("https%3A%2F%2F") && url.includes("%3Fcheckout%3Dsuccess"),
    `las URLs se escapan enteras, incluida la query (${url})`);
}

console.log(failed === 0
  ? `\n✓ stripe: ${passed} passed, 0 failed\n`
  : `\n✗ stripe: ${passed} passed, ${failed} failed\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n`);
process.exit(failed ? 1 : 0);
