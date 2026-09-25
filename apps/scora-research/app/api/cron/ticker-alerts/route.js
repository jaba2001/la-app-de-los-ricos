// Cron: per-ticker price alerts (P0-4). Reads active price_above/price_below rows from
// sl_alerts (service key → bypasses RLS), fetches live FMP quotes for the distinct tickers,
// and Web-Pushes the OWNER of each triggered alert (push_subscriptions.user_id). Dedupe:
// an alert that fired in the last 24h is skipped (last_triggered_at). Node runtime (web-push
// needs Node crypto). Free: FMP quote + self-generated VAPID. Env: CRON_SECRET, SUPABASE_URL,
// SUPABASE_SERVICE_KEY, FMP_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
import webpush from "web-push";
import { crossedUpSma150, baseBreakoutConfirmed, trendStage } from "../../../../lib/server/technicals.js";
import { assertCron, pgv } from '../../../../lib/server/cron.js';
import { evaluateAnalysisAlert, ANALYSIS_KINDS } from '../../../../lib/server/alertKinds.js';

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

// EOD history as OHLCV oldest→newest (FMP returns newest-first).
async function fetchHistory(ticker) {
  try {
    const u = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&apikey=${process.env.FMP_KEY}`;
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr
      .map((h) => ({ high: Number(h.high), low: Number(h.low), close: Number(h.close), volume: Number(h.volume) }))
      .filter((b) => Number.isFinite(b.close) && Number.isFinite(b.high) && Number.isFinite(b.low))
      .slice(0, 300)
      .reverse();
  } catch { return []; }
}

const TECH_KINDS = ["crossed_sma150", "base_breakout", "stage_change"];

function triggered(kind, threshold, price) {
  if (price == null || threshold == null) return false;
  if (kind === "price_above") return price >= threshold;
  if (kind === "price_below") return price <= threshold;
  return false;
}

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;
  if (!KEY || !SB) return json({ error: "Supabase not configured" }, 500);
  if (!process.env.FMP_KEY) return json({ error: "FMP_KEY missing" }, 500);
  const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  if (pushReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:alerts@scora.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  // 1) active price alerts
  const alertsRes = await fetch(`${SB}/rest/v1/sl_alerts?active=eq.true&kind=in.(price_above,price_below)&select=id,user_id,ticker,kind,threshold,last_triggered_at,one_shot`, { headers: sbHeaders });
  if (!alertsRes.ok) return json({ error: "sl_alerts read failed", status: alertsRes.status }, 500);
  const alertsRaw = await alertsRes.json();
  // NOTE (2026-08-18): esto hacía `return` cuando no había alertas de PRECIO, lo que se
  // saltaba los bloques técnico y de análisis. Un usuario con solo alertas técnicas nunca
  // recibía nada. Ahora el bloque de precio simplemente se queda vacío y el cron sigue.
  const alerts = Array.isArray(alertsRaw) ? alertsRaw : [];

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
    const r = await fetch(`${SB}/rest/v1/push_subscriptions?user_id=eq.${pgv(userId)}&select=endpoint,p256dh,auth`, { headers: sbHeaders });
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
    await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${pgv(a.id)}`, {
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

  // ── Technical alerts (crossed_sma150 / base_breakout / stage_change) ──────────
  // These need price HISTORY, not a live quote. Fetch EOD once per distinct ticker, compute the
  // signal, and fire. stage_change compares the current stage to the stored last_value; the first
  // observation is recorded without firing.
  let techFired = 0, techPriced = 0;
  const techRes = await fetch(`${SB}/rest/v1/sl_alerts?active=eq.true&kind=in.(${TECH_KINDS.join(",")})&select=id,user_id,ticker,kind,last_triggered_at,last_value,one_shot`, { headers: sbHeaders });
  const techAlerts = techRes.ok ? await techRes.json() : [];
  if (Array.isArray(techAlerts) && techAlerts.length > 0) {
    const techFresh = techAlerts.filter(a => !a.last_triggered_at || (now - new Date(a.last_triggered_at).getTime()) > DAY_MS || a.kind === "stage_change");
    const techTickers = [...new Set(techFresh.map(a => String(a.ticker).toUpperCase()))];
    const hist = {};
    await Promise.all(techTickers.map(async t => { hist[t] = await fetchHistory(t); }));
    techPriced = techTickers.length;

    for (const a of techFresh) {
      const data = hist[String(a.ticker).toUpperCase()] || [];
      if (data.length < 31) continue;

      let fire = false, patch = {}, msg = "";
      if (a.kind === "crossed_sma150") {
        if (crossedUpSma150(data)) { fire = true; msg = "crossed above its 150-day moving average"; }
      } else if (a.kind === "base_breakout") {
        if (baseBreakoutConfirmed(data)) { fire = true; msg = "broke out of its base on expanding volume"; }
      } else if (a.kind === "stage_change") {
        const st = trendStage(data).stage;
        const prev = a.last_value != null ? Number(a.last_value) : null;
        if (prev == null) {
          // first observation → record silently
          await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${pgv(a.id)}`, { method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" }, body: JSON.stringify({ last_value: st }) }).catch(() => {});
          continue;
        }
        if (st !== prev) { fire = true; msg = `changed trend stage (${prev} → ${st})`; patch = { last_value: st }; }
      }
      if (!fire) continue;
      techFired++;

      await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${pgv(a.id)}`, {
        method: "PATCH",
        headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ last_triggered_at: new Date().toISOString(), ...patch, ...(a.one_shot ? { active: false } : {}) }),
      }).catch(() => {});

      if (!pushReady) continue;
      const payload = JSON.stringify({
        title: `Scora — ${a.ticker} ${a.kind === "base_breakout" ? "base breakout" : a.kind === "crossed_sma150" ? "crossed 150-day MA" : "stage change"}`,
        body: `${a.ticker} ${msg}.`,
        url: `/stock/${a.ticker}`, tag: `scora-tech-${a.ticker}`,
      });
      const subs = await subsFor(a.user_id);
      await Promise.all(subs.map(async s => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; }
        catch (e) { errors.push(`${a.ticker}:${e?.statusCode ?? e?.message ?? "push failed"}`); }
      }));
    }
  }

  // ── Analysis alerts (rating_buy / rdcf_cheap) ────────────────────────────────
  // Estos dos se declaraban en la UI pero el cron NUNCA los evaluaba: se creaban y no
  // llegaba push. Se resuelven leyendo `sl_analyses` (el análisis que el propio usuario ya
  // guardó) — cero llamadas a FMP. Se dispara en la TRANSICIÓN y solo si el análisis es
  // reciente; ver lib/alertKinds.js y scripts/alertkinds.test.mjs.
  let anFired = 0, anChecked = 0;
  const anRes = await fetch(`${SB}/rest/v1/sl_alerts?active=eq.true&kind=in.(${ANALYSIS_KINDS.join(",")})&select=id,user_id,ticker,kind,last_triggered_at,last_value,one_shot`, { headers: sbHeaders });
  const anAlerts = anRes.ok ? await anRes.json() : [];
  if (Array.isArray(anAlerts) && anAlerts.length > 0) {
    const anFresh = anAlerts.filter(a => !a.last_triggered_at || (now - new Date(a.last_triggered_at).getTime()) > DAY_MS);
    anChecked = anFresh.length;

    // Un análisis por (usuario, ticker) aunque varias alertas lo compartan.
    const anCache = {};
    async function latestAnalysis(userId, ticker) {
      const key = `${userId}:${ticker}`;
      if (key in anCache) return anCache[key];
      const url = `${SB}/rest/v1/sl_analyses?user_id=eq.${pgv(userId)}&ticker=eq.${pgv(ticker)}&select=rating,reverse_dcf,analysis_date&order=analysis_date.desc&limit=1`;
      const r = await fetch(url, { headers: sbHeaders });
      const rows = r.ok ? await r.json() : [];
      return (anCache[key] = Array.isArray(rows) && rows[0] ? rows[0] : null);
    }

    for (const a of anFresh) {
      const analysis = await latestAnalysis(a.user_id, String(a.ticker).toUpperCase());
      const { fire, nextValue, detail } = evaluateAnalysisAlert(a.kind, a, analysis, now);

      // Sembrar last_value aunque no se dispare: sin la referencia previa nunca se
      // detectaría la transición siguiente.
      if (!fire) {
        // `a.last_value` null debe contar como "sin referencia", no como 0: si no, un
        // upside de exactamente 0 no llegaría a sembrarse y la transición se perdería.
        const prevVal = a.last_value == null ? null : Number(a.last_value);
        if (nextValue != null && prevVal !== nextValue) {
          await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${pgv(a.id)}`, {
            method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({ last_value: nextValue }),
          }).catch(() => {});
        }
        continue;
      }
      anFired++;

      await fetch(`${SB}/rest/v1/sl_alerts?id=eq.${pgv(a.id)}`, {
        method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ last_triggered_at: new Date().toISOString(), last_value: nextValue, ...(a.one_shot ? { active: false } : {}) }),
      }).catch(() => {});

      if (!pushReady) continue;
      const payload = JSON.stringify({
        title: `Scora — ${a.ticker} ${a.kind === "rating_buy" ? "rating turned Buy" : "reverse-DCF says cheap"}`,
        body: `${a.ticker} ${detail}.`,
        url: `/stock/${a.ticker}`, tag: `scora-analysis-${a.ticker}`,
      });
      const subs = await subsFor(a.user_id);
      await Promise.all(subs.map(async s => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); sent++; }
        catch (e) { errors.push(`${a.ticker}:${e?.statusCode ?? e?.message ?? "push failed"}`); }
      }));
    }
  }

  return json({ ok: true, checked: fresh.length, priced: tickers.length, fired, techFired, techPriced, anChecked, anFired, sent, pushReady, errors: errors.slice(0, 5) });
}
