// Cron: refresca el régimen macro server-side y hace upsert en `macro_state`.
//
// Por qué existe: el régimen macro (composites LCC/CSC/RPC/GRC/HSC + tilt) lo
// computa hoy SOLO la web de IC DataLayer cuando alguien pulsa "↻ Cargar Datos".
// Si nadie la abre, `macro_state` se queda rancio y el Macro Tilt de StockLens
// lee un régimen viejo. Este cron computa el mismo régimen 1×/día (solo FRED,
// público/gratis) para que StockLens siempre lea un régimen fresco.
//
// La lógica de cómputo vive en lib/macro.js, portada VERBATIM desde
// IC-DataLayer/IC_DataLayer_v2.js (classifyRegime + computeCompositeScores).
// El upsert escribe las columnas del row que arma lib/macro.js (incluido
// `ic_score`, calculado server-side desde los composites), conflict key `id`
// (fila única id=1). Es idempotente: misma clave → actualiza, no duplica. Las
// columnas que NO van en el row (p. ej. breadth_*, escritas por el cron diario
// de scora) quedan intactas gracias a merge-duplicates. Mismo patrón de
// auth/Supabase que los crons `13f-refresh` y `alerts-check`.
import { buildMacroState } from '../../../../lib/server/macro.js';
import { assertCron } from '../../../../lib/server/cron.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

// RUNTIME NODE, no edge. Esta ruta habla con Cloud SQL y el driver de Postgres necesita
// sockets de Node — en edge el build falla con "Can't resolve 'fs'". Con Supabase no pasaba
// porque se hablaba por HTTP, que edge sí sabe hacer. Es el precio de tener la base dentro
// de la red privada en vez de detrás de una API pública, y para un cron da igual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;

  if (!process.env.FRED_KEY) {
    return new Response(JSON.stringify({ error: 'FRED_KEY missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let built;
  try {
    // Finnhub key (optional) powers the A4 private-credit proxy; absent → null.
    // (FMP's /stable/quote rejects BIZD/BKLN under our plan, so we use Finnhub.)
    built = await buildMacroState(process.env.FRED_KEY, { finnhubKey: process.env.FINNHUB_KEY });
  } catch (e) {
    return new Response(JSON.stringify({ error: `compute failed: ${e.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { row, errors, seriesFetched } = built;

  // Upsert a Supabase con service role (bypassa RLS). Conflict key = id (fila
  // única id=1). merge-duplicates → actualiza esa fila, no inserta otra.
  const sbResp = await sbFetch(`macro_state?on_conflict=id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    }
  );

  const sbBody = sbResp.ok ? undefined : await sbResp.text();

  // Append today's snapshot to history (best-effort — never blocks/breaks the macro_state
  // upsert above, which remains the source of truth StockLens reads). Powers the
  // Historical Analog feature's future "your own history" comparison once enough rows
  // accumulate; today it's a thin daily log of just the 5 composites + regime + ic_score + vix.
  if (sbResp.ok) {
    try {
      await sbFetch(`macro_state_history?on_conflict=snapshot_date`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            snapshot_date: row.snapshot_date,
            liquidity_cycle: row.liquidity_cycle,
            credit_stress: row.credit_stress,
            recession_prob: row.recession_prob,
            geopolitical_risk: row.geopolitical_risk,
            housing_stress: row.housing_stress,
            regime_id: row.regime_id,
            ic_score: row.ic_score,
            vix: row.vix,
          }),
        }
      );
    } catch (e) { /* best-effort; macro_state write already succeeded, never fail the request for this */ }
  }

  return new Response(
    JSON.stringify({
      ok: sbResp.ok,
      wrote: sbResp.ok ? row : undefined,
      seriesFetched,
      db_status: sbResp.status,
      db_error: sbBody,
      fred_errors: errors.length ? errors : undefined,
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
