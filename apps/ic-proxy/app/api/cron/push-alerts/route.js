// Cron: send Web Push regime alerts (B6 delivery). Reads the live macro_state, decides if
// there's a NEW actionable event (a breadth divergence or a risk-off shift), and if so pushes
// a notification to every stored subscription. Deduped via push_alert_state so the same event
// isn't re-sent every run. Node runtime (web-push needs Node crypto). Free: VAPID is a
// self-generated keypair, no third-party service. Env: CRON_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import webpush from "web-push";
import { assertCron } from '../../../../lib/cron.js';
import { macroAlertFor } from '../../../../lib/macroAlerts.js';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// La decisión de qué se notifica vive en lib/macroAlerts.js — pura y con tests
// (scripts/macroalerts.test.mjs). Estaba aquí inline y sin cobertura, aunque decide lo que
// se manda a todas las suscripciones a la vez.

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;
  if (!KEY || !SB) return json({ error: "Supabase not configured" }, 500);
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return json({ ok: true, skipped: "VAPID not configured" }, 200);

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@scora.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  // current macro state + last sent key + last observed regime
  const [msRes, stRes] = await Promise.all([
    fetch(`${SB}/rest/v1/macro_state?id=eq.1&select=risk_on,breadth_200dma,regime_confirmation,regime_id`, { headers: sbHeaders }),
    fetch(`${SB}/rest/v1/push_alert_state?id=eq.1&select=last_confirmation,last_regime`, { headers: sbHeaders }),
  ]);
  const macro = (await msRes.json())?.[0];
  const state = (await stRes.json())?.[0] ?? {};
  const last = state.last_confirmation ?? null;
  const lastRegime = state.last_regime ?? null;
  if (!macro) return json({ error: "no macro_state" }, 500);

  const alert = macroAlertFor(macro, lastRegime);
  // Always record the current key so a future re-entry re-triggers; only SEND on a new actionable key.
  // `last_regime` se guarda SIEMPRE, dispare o no: es la referencia con la que se detecta
  // la transición siguiente, y en la primera pasada es lo único que se hace (siembra).
  await fetch(`${SB}/rest/v1/push_alert_state?id=eq.1`, {
    method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ last_confirmation: alert.key, last_regime: alert.regime ?? lastRegime, last_sent: new Date().toISOString() }),
  });

  if (alert.key === "ok" || alert.key === last) return json({ ok: true, sent: 0, state: alert.key, regime: alert.regime, seeded: lastRegime == null, note: alert.key === last ? "unchanged" : "not actionable" }, 200);

  // fetch all subscriptions and push
  const subs = await (await fetch(`${SB}/rest/v1/push_subscriptions?select=endpoint,p256dh,auth`, { headers: sbHeaders })).json();
  const payload = JSON.stringify({ title: alert.title, body: alert.body, url: "/macro", tag: "scora-regime" });
  let sent = 0; const dead = [];
  await Promise.all((subs || []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; }
    catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
  }));
  // prune expired subscriptions
  for (const ep of dead) await fetch(`${SB}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: "DELETE", headers: sbHeaders });

  return json({ ok: true, state: alert.key, sent, pruned: dead.length, subs: (subs || []).length }, 200);
}

function json(obj, status) { return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }); }
