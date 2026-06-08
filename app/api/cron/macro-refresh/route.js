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
// El upsert escribe las MISMAS columnas que escribe IC DataLayer (origin
// ≈ línea 4707), conflict key `id` (fila única id=1). Es idempotente: misma
// clave → actualiza, no duplica. NO escribe `ic_score` (el writer de la web
// tampoco lo hace; queda intacto). Mismo patrón de auth/Supabase que los crons
// `13f-refresh` y `alerts-check`.
import { buildMacroState } from '../../../../lib/macro.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!process.env.FRED_KEY) {
    return new Response(JSON.stringify({ error: 'FRED_KEY missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let built;
  try {
    built = await buildMacroState(process.env.FRED_KEY);
  } catch (e) {
    return new Response(JSON.stringify({ error: `compute failed: ${e.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { row, errors, seriesFetched } = built;

  // Upsert a Supabase con service role (bypassa RLS). Conflict key = id (fila
  // única id=1). merge-duplicates → actualiza esa fila, no inserta otra.
  const sbResp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/macro_state?on_conflict=id`,
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

  return new Response(
    JSON.stringify({
      ok: sbResp.ok,
      wrote: sbResp.ok ? row : undefined,
      seriesFetched,
      supabase_status: sbResp.status,
      supabase_error: sbBody,
      fred_errors: errors.length ? errors : undefined,
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
