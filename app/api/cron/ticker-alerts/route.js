// Cron: per-ticker price alerts (P0-4). Reads active price_above/price_below rows from
// sl_alerts (service key → bypasses RLS), fetches live FMP quotes for the distinct tickers,
// and Web-Pushes the OWNER of each triggered alert (push_subscriptions.user_id). Dedupe:
// an alert that fired in the last 24h is skipped (last_triggered_at). Node runtime (web-push
// needs Node crypto). Free: FMP quote + self-generated VAPID. Env: CRON_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_KEY, FMP_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const DAY_MS = 86400000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fetchQuote(ticker) {
  try {
    const u = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(ticker)}&apikey=${process.env.FMP_KEY}`;
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const arr = await r.json();
    const px = Array.isArray(arr) && arr[0] ? Number(arr[0].price) : null;
    return Number.isFinite(px) ? px : null;
  } catch { return null; }
}

function triggered(kind, threshold, price) {
  if (price == null || threshold == null) return false;
  if (kind === "price_above") return price >= threshold;
  if (kind === "price_below") return price <= threshold;
  return false;
}

export async function GET(request) {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) return json({ error: "Unauthorized" }, 401);
  if (!KEY || !SB) return json({ error: "Supabase not configured" }, 500);
  if (!process.env.FMP_KEY) return json({ error: "FMP_KEY missing" }, 500);
  const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  if (pushReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@scora.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  // 1) active price alerts
  const alertsRes = await fetch(`${SB}/rest/v1/sl_alerts?active=eq.true&kind=in.(price_above,price_below)&select=id,user_id,ticker,kind,threshold,last_triggered_at,one_shot`, { headers: sbHeaders });
  if (!alertsRes.ok) return json({ error: "sl_alerts read failed", status: alertsRes.status }, 500);
  const alerts = await alertsRes.json();
  if (!Array.isArray(alerts) || alerts.length === 0) return json({ ok: true, checked: 0, sent: 0 });

  // 2) skip alerts fired in the last 24h, then price the distinct tickers once each
  const now = Date.now();
  const fresh = alerts.filter(a => !a.last_triggered_at || (now - new Date(a.last_triggered_at).getTime()) > DAY_MS);
  const tickers = [...new Set(fresh.map(a => String(a.ticker).toUpperCase()))];
  const prices = {};
  await Promise.all(tickers.map(async t => { prices[t] = await fetchQuote(t); }));

  // 3) evaluate + deliver
  const subsCache = {};
  async function subsFor(userId) {
    if (subsCache[userId]) return subsCache[userId];
    const r = await fetch(`${SB}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`, { headers: sbHeaders });
    const s = r.ok ? await r.json() : [];
    return (subsCache[userId] = Array.isArray(s) ? s : []);
  }

  let sent = 0, fired = 0;
  const errors = [];
  for (const a of fresh) {
    const price = prices[String(a.ticker).toUpperCase()];
    if (!triggered(a.kind, a.threshold != null ? Number(a.threshold) : null, price)) continue;
    fired++;

    // mark fired (so the next run dedupes even if push isn't configured yet). one-shot alerts
    // auto-pause (active=false) so they never re-fire; recurring ones re-arm after 24h.
    await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${a.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ last_triggered_at: new Date().toISOString(), last_value: price, ...(a.one_shot ? { active: false } : {}) }),
    }).catch(() => {});

    if (!pushReady) continue;
    const dir = a.kind === "price_above" ? "rose above" : "fell below";
    const payload = JSON.stringify({
      title: `Scora — ${a.ticker} ${dir} $${Number(a.threshold).toFixed(2)}`,
      body: `${a.ticker} is at $${price.toFixed(2)}. Your ${a.kind.replace("_", " ")} alert fired.`,
      url: `/stock/${a.ticker}`, tag: `scora-alert-${a.ticker}`,
    });
    const subs = await subsFor(a.user_id);
    await Promise.all(subs.map(async s => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; }
      catch (e) { errors.push(`${a.ticker}:${e?.statusCode ?? e?.message ?? "push failed"}`); }
    }));
  }

  return json({ ok: true, checked: fresh.length, priced: tickers.length, fired, sent, pushReady, errors: errors.slice(0, 5) });
}
