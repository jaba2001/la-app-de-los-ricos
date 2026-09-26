// Portal de cliente de Stripe: cambiar tarjeta, ver facturas, cancelar.
//
// POR QUÉ ESTO EXISTE ANTES QUE CUALQUIER PANTALLA DE FACTURACIÓN PROPIA:
// sin portal, "quiero cancelar" es un email que hay que atender a mano, y una cancelación
// que tarda en atenderse acaba en una disputa de tarjeta. La disputa cuesta comisión, y
// unas cuantas ponen la cuenta de Stripe bajo revisión. Delegar en su portal cuesta esta
// ruta de treinta líneas y elimina esa clase entera de problema.
//
// El cliente NO manda su customer id: se busca por el user del token. Si viniera del
// cuerpo, cualquiera podría pedir el portal de otra persona y ver sus facturas.
import { requireUser } from '../../../../lib/server/auth.js';
import { checkRateLimit } from '../../../../lib/server/ratelimit.js';
import { corsHeaders, preflight, allowOrigin } from '../../../../lib/server/cors.js';
import { stripeApi, stripeEnabled } from '../../../../lib/server/stripe.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

// RUNTIME NODE, no edge. Esta ruta habla con Cloud SQL y el driver de Postgres necesita
// sockets de Node — en edge el build falla con "Can't resolve 'fs'". Con Supabase no pasaba
// porque se hablaba por HTTP, que edge sí sabe hacer. Es el precio de tener la base dentro
// de la red privada en vez de detrás de una API pública, y para un cron da igual.
export const runtime = 'nodejs';

const FALLBACK_APP = 'https://scora-research.vercel.app';

export async function POST(request) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  if (!stripeEnabled()) return json({ error: 'Payments are not enabled yet.' }, 503);

  const { user, error: authErr } = await requireUser(request, { strict: true });
  if (authErr) return authErr;

  const rl = await checkRateLimit('stripe-portal', user.id, 20, 3600, request);
  if (rl) return rl;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('stripe portal: Supabase env missing');
    return json({ error: 'Billing is unavailable right now.' }, 503);
  }

  try {
    // Identidad de facturación derivada del token, nunca de la petición.
    const q = `sl_subscriptions` +
      `?user_id=eq.${user.id}&select=stripe_customer_id`;
    const res = await sbFetch(q, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) throw new Error(`lookup ${res.status}`);

    const rows = await res.json().catch(() => []);
    const customerId = rows?.[0]?.stripe_customer_id;
    // 404 y no 500: quien nunca ha pagado no tiene portal, y eso no es un error del sistema.
    if (!customerId) return json({ error: 'No billing account yet.' }, 404);

    const session = await stripeApi('billing_portal/sessions', {
      customer: customerId,
      // Misma regla que en checkout: el destino sale del allowlist ya validado, no del cuerpo.
      return_url: `${allowOrigin(request) || process.env.APP_URL || FALLBACK_APP}/pricing`,
    });

    if (!session?.url) return json({ error: 'Could not open the billing portal.' }, 502);
    return json({ url: session.url }, 200);
  } catch (e) {
    console.error('stripe portal:', e?.message ?? e);
    return json({ error: 'Could not open the billing portal.' }, 502);
  }
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
