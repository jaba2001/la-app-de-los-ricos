// Cron: detecta gatillos macro de Cartera V2.0 y escribe en alerts_log.
//   - credit_blowout  : HY OAS (BAMLH0A0HYM2) sube ≥ 50 bps en 1 día.
//   - qt_acceleration : WALCL baja ≥ $150 B en 4 semanas.
// Las alertas se insertan con user_id NULL (system-wide; la RLS deja que
// cualquier usuario autenticado las vea). Dedupe: no re-emite el mismo
// alert_type si ya hay uno en las últimas 24h.
import { sendEmail, alertEmailHtml } from '../../../../lib/server/email.js';
import { assertCron, pgv } from '../../../../lib/server/cron.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

// RUNTIME NODE, no edge. Esta ruta habla con Cloud SQL y el driver de Postgres necesita
// sockets de Node — en edge el build falla con "Can't resolve 'fs'". Con Supabase no pasaba
// porque se hablaba por HTTP, que edge sí sabe hacer. Es el precio de tener la base dentro
// de la red privada en vez de detrás de una API pública, y para un cron da igual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FRED = (s) =>
  `https://api.stlouisfed.org/fred/series/observations?series_id=${s}&api_key=${process.env.FRED_KEY}&file_type=json&sort_order=desc&limit=30`;

async function fetchObs(seriesId) {
  const r = await fetch(FRED(seriesId));
  if (!r.ok) throw new Error(`FRED ${seriesId} HTTP ${r.status}`);
  const d = await r.json();
  return (d.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ d: o.date, v: parseFloat(o.value) }));
}

async function alreadyAlertedToday(alertType) {
  const since = new Date(Date.now() - 86400000).toISOString();
  const url = `${process.env.SUPABASE_URL}/rest/v1/alerts_log?alert_type=eq.${pgv(alertType)}&triggered_at=gte.${pgv(since)}&user_id=is.null&select=id&limit=1`;
  const r = await sbFetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!r.ok) return false;
  const arr = await r.json();
  return Array.isArray(arr) && arr.length > 0;
}

async function insertAlert(row) {
  const r = await sbFetch(`alerts_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) return { ok: false, status: r.status, body: await r.text() };
  return { ok: true };
}

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;

  const checks = [];
  const toInsert = [];
  const errors = [];

  // 1) HY OAS — +50 bps en 1 día
  try {
    const obs = await fetchObs('BAMLH0A0HYM2');
    if (obs.length >= 2) {
      const [today, prev] = obs;
      const deltaBps = (today.v - prev.v) * 100;
      checks.push({ type: 'credit_blowout', today: today.v, prev: prev.v, delta_bps: +deltaBps.toFixed(1) });
      if (deltaBps >= 50 && !(await alreadyAlertedToday('credit_blowout'))) {
        toInsert.push({
          alert_type: 'credit_blowout',
          threshold: 50,
          actual_value: +deltaBps.toFixed(2),
          message: `⚠️ HY OAS +${deltaBps.toFixed(0)}bps en 1 día (${prev.v.toFixed(2)} → ${today.v.toFixed(2)}, ${prev.d} → ${today.d}). Trigger: +50bps/día.`,
        });
      }
    }
  } catch (e) {
    errors.push(`credit_blowout: ${e.message}`);
  }

  // 2) WALCL — −$150 B en 4 semanas
  try {
    const obs = await fetchObs('WALCL');
    if (obs.length >= 5) {
      const today = obs[0];
      const fourW = obs[4];
      const deltaB = (today.v - fourW.v) / 1000; // FRED WALCL en millones → billones
      checks.push({ type: 'qt_acceleration', today_b: +(today.v / 1000).toFixed(0), fourW_b: +(fourW.v / 1000).toFixed(0), delta_b: +deltaB.toFixed(1) });
      if (deltaB <= -150 && !(await alreadyAlertedToday('qt_acceleration'))) {
        toInsert.push({
          alert_type: 'qt_acceleration',
          threshold: -150,
          actual_value: +deltaB.toFixed(2),
          message: `📉 Balance Fed −$${Math.abs(deltaB).toFixed(0)}B en 4 semanas (${(fourW.v / 1000).toFixed(0)}B → ${(today.v / 1000).toFixed(0)}B). Trigger: −$150B/4sem.`,
        });
      }
    }
  } catch (e) {
    errors.push(`qt_acceleration: ${e.message}`);
  }

  // 3) credit_divergence (A4) — estrés de crédito oculto: HY público sigue tight
  // pero el proxy privado (BIZD/BKLN) se debilita. La señal la computa el cron
  // macro-refresh y la cachea en macro_state (credit_divergence + proxy). Aquí
  // solo la leemos y emitimos alerta si está activa (0 fetches de mercado extra).
  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/macro_state?id=eq.1&select=credit_divergence,credit_private_proxy,credit_stress&limit=1`;
    const r = await sbFetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (r.ok) {
      const arr = await r.json();
      const m = Array.isArray(arr) ? arr[0] : null;
      if (m) {
        checks.push({ type: 'credit_divergence', active: !!m.credit_divergence, proxy: m.credit_private_proxy });
        if (m.credit_divergence === true && !(await alreadyAlertedToday('credit_divergence'))) {
          toInsert.push({
            alert_type: 'credit_divergence',
            threshold: 0,
            actual_value: m.credit_private_proxy != null ? +Number(m.credit_private_proxy).toFixed(2) : null,
            message: `🕳️ Divergencia de crédito: HY público tight (CSC ${m.credit_stress != null ? Math.round(m.credit_stress) : '—'}) pero proxy privado BIZD/BKLN débil (${m.credit_private_proxy != null ? Number(m.credit_private_proxy).toFixed(2) + '%' : 'n/d'}). Posible estrés de crédito oculto.`,
          });
        }
      }
    } else {
      errors.push(`credit_divergence: macro_state HTTP ${r.status}`);
    }
  } catch (e) {
    errors.push(`credit_divergence: ${e.message}`);
  }

  // Insertar (uno por uno; pocas alertas a la vez)
  const insertResults = [];
  for (const a of toInsert) {
    const res = await insertAlert(a);
    insertResults.push({ alert_type: a.alert_type, ...res });
  }

  // ── Email the newly-inserted alerts to opted-in subscribers ────────────────
  // Only messages that were actually inserted this run (dedup already prevents
  // re-emailing the same alert within 24h). No-ops when RESEND_KEY is unset.
  let email = undefined;
  const freshMessages = toInsert
    .filter((_, i) => insertResults[i]?.ok)
    .map((a) => a.message);
  if (freshMessages.length > 0) {
    try {
      const subUrl = `${process.env.SUPABASE_URL}/rest/v1/sl_alert_prefs?macro_alerts=eq.true&select=email&limit=1000`;
      const sr = await fetch(subUrl, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      });
      const subs = sr.ok ? await sr.json() : [];
      const recipients = Array.isArray(subs)
        ? [...new Set(subs.map((s) => s.email).filter((e) => e && e.includes('@')))]
        : [];
      const html = alertEmailHtml(freshMessages, new Date().toISOString().slice(0, 10));
      const subject = `Scora macro alert: ${toInsert.map((a) => a.alert_type).join(', ')}`;
      let sent = 0, skipped = 0;
      const emailErrors = [];
      // Send individually so recipients aren't exposed to each other.
      for (const to of recipients) {
        const r = await sendEmail({ to, subject, html });
        if (r.ok) sent++;
        else if (r.skipped) skipped++;
        else emailErrors.push(`${to}: ${r.status ?? r.error ?? 'fail'}`);
      }
      email = { recipients: recipients.length, sent, skipped, errors: emailErrors.length ? emailErrors : undefined };
    } catch (e) {
      email = { error: e.message };
    }
  }

  return new Response(
    JSON.stringify({
      checks,
      candidates: toInsert.length,
      inserted: insertResults.filter((r) => r.ok).length,
      insertResults: insertResults.length ? insertResults : undefined,
      email,
      errors: errors.length ? errors : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
