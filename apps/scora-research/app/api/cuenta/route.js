// DELETE /api/cuenta — borra todos los datos del usuario que llama (AUDIT_REPORT A-6).
//
// La identidad sale del token y de nada más: no se acepta un id en la petición, porque
// permitirlo sería dejar que cualquiera borrase la cuenta de otro. La lógica y la lista de
// tablas viven en lib/server/cuenta.js, que tiene su prueba contra Postgres.
//
// Después de esto el navegador borra la identidad en Identity Platform (deleteUser).
import { requireUser } from '../../../lib/server/auth.js';
import { checkRateLimit } from '../../../lib/server/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/server/cors.js';
import { pool } from '../../../lib/server/data/pool.ts';
import { borrarDatosDeUsuario, SuscripcionActiva } from '../../../lib/server/cuenta.js';

// Postgres necesita sockets de Node.
export const runtime = 'nodejs';

export async function DELETE(request) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  const { user, error: authErr } = await requireUser(request, { strict: true });
  if (authErr) return authErr;
  const rl = await checkRateLimit('cuenta-borrar', user.id, 5, 3600, request);
  if (rl) return rl;

  try {
    const borradas = await borrarDatosDeUsuario(pool(), user.id, user.email);
    // Rastro de la operación, sin datos personales: cuándo y cuántas filas, no quién.
    const total = Object.values(borradas).reduce((s, n) => s + n, 0);
    console.info(`cuenta borrada: ${total} filas en ${Object.keys(borradas).length} tablas`);
    return json({ ok: true, borradas }, 200);
  } catch (e) {
    if (e instanceof SuscripcionActiva) return json({ error: e.message, code: 'subscription_active' }, 409);
    console.error('borrar cuenta:', e?.message || e);
    return json({ error: 'Could not delete your data. Nothing was deleted; try again.' }, 500);
  }
}

export async function OPTIONS(request) {
  return preflight(request, 'DELETE, OPTIONS');
}
