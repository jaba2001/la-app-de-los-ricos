// Cron: detecta gatillos macro de Cartera V2.0 y escribe en alerts_log.
//   - credit_blowout  : HY OAS (BAMLH0A0HYM2) sube ≥ 50 bps en 1 día.
//   - qt_acceleration : WALCL baja ≥ $150 B en 4 semanas.
// Las alertas se insertan con user_id NULL (system-wide; la RLS deja que
// cualquier usuario autenticado las vea). Dedupe: no re-emite el mismo
// alert_type si ya hay uno en las últimas 24h.
export const runtime = 'edge';
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
  const url = `${process.env.SUPABASE_URL}/rest/v1/alerts_log?alert_type=eq.${alertType}&triggered_at=gte.${since}&user_id=is.null&select=id&limit=1`;
  const r = await fetch(url, {
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
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/alerts_log`, {
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
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

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

  // Insertar (uno por uno; pocas alertas a la vez)
  const insertResults = [];
  for (const a of toInsert) {
    insertResults.push({ alert_type: a.alert_type, ...(await insertAlert(a)) });
  }

  return new Response(
    JSON.stringify({
      checks,
      candidates: toInsert.length,
      inserted: insertResults.filter((r) => r.ok).length,
      insertResults: insertResults.length ? insertResults : undefined,
      errors: errors.length ? errors : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
