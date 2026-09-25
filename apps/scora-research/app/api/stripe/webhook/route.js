// Webhook de Stripe — la única vía por la que alguien pasa a ser Pro.
//
// Todo lo que decide un permiso entra por aquí, verificado criptográficamente. La app
// nunca cree al cliente cuando dice haber pagado: lee sl_subscriptions, y en esa tabla solo
// escribe esta ruta (ver el modelo de seguridad en sql/2026-08-11_sl_subscriptions.sql).
//
// SIN CORS Y SIN RATE LIMIT, y en ambos casos por una razón, no por olvido:
//   - CORS: lo llama Stripe servidor-a-servidor, jamás un navegador. Una cabecera
//     Access-Control-Allow-Origin aquí no protegería nada y sugeriría que sí.
//   - Rate limit: el limitador de este proxy es fail-open, así que en una caída de Redis
//     dejaría pasar todo igualmente; y si fuese fail-closed, un pico de reintentos legítimo
//     de Stripe se rechazaría solo. La barrera real es la firma, que se comprueba ANTES de
//     tocar la base de datos: una avalancha sin firma cuesta un HMAC por petición y no
//     llega nunca a Supabase.
//
// Los reintentos son parte del contrato de Stripe: si esto devuelve 5xx, la misma entrega
// vuelve. Por eso un fallo transitorio de Supabase responde 500 (que reintente) y un evento
// que no sabemos manejar responde 200 (que no reintente eternamente algo que ignoramos).
import { verifyWebhook, stripeApi, stripeEnabled } from '../../../../lib/server/stripe.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

// RUNTIME NODE, no edge. Esta ruta habla con Cloud SQL y el driver de Postgres necesita
// sockets de Node — en edge el build falla con "Can't resolve 'fs'". Con Supabase no pasaba
// porque se hablaba por HTTP, que edge sí sabe hacer. Es el precio de tener la base dentro
// de la red privada en vez de detrás de una API pública, y para un cron da igual.
export const runtime = 'nodejs';

const SB = () => process.env.SUPABASE_URL;
const KEY = () => process.env.SUPABASE_SERVICE_KEY;

const sbHeaders = (extra = {}) => ({
  'Content-Type': 'application/json',
  apikey: KEY(),
  Authorization: `Bearer ${KEY()}`,
  ...extra,
});

/** Un uuid de verdad. client_reference_id lo elegimos nosotros, pero llega desde fuera. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const iso = (unixSec) =>
  Number.isFinite(unixSec) && unixSec > 0 ? new Date(unixSec * 1000).toISOString() : null;

/**
 * Registra el evento. Devuelve false si ya lo habíamos visto.
 *
 * Se hace ANTES de actuar: si se hiciera después, un fallo entre la acción y el registro
 * dejaría el evento sin marcar y se reaplicaría en el reintento — que es justo el caso que
 * esta tabla existe para evitar.
 */
async function claimEvent(id, type) {
  const res = await sbFetch(`sl_stripe_events`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ event_id: id, type }),
  });
  if (res.ok) return true;
  if (res.status === 409) return false; // duplicado: ya procesado
  throw new Error(`claimEvent ${res.status} ${await res.text().catch(() => '')}`);
}

/**
 * Suelta la marca cuando el procesado falla después de haberla puesto.
 *
 * Sin esto, la reserva se convierte en una trampa: el evento queda marcado, el reintento de
 * Stripe sale por el camino de "duplicado" y el cambio de estado se pierde para siempre —
 * alguien que ha pagado se queda sin Pro y ningún reintento lo arregla. Reaplicar es
 * inofensivo (el upsert y el update condicional son idempotentes), así que ante la duda
 * vale mucho más volver a procesar que perder el evento.
 */
async function releaseEvent(id) {
  try {
    await sbFetch(`sl_stripe_events?event_id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
    });
  } catch { /* ya vamos camino de un 500; esto es lo mejor que se puede hacer */ }
}

/** Campos de una suscripción de Stripe → columnas nuestras. */
function subFields(sub, eventAt) {
  return {
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: sub.items?.data?.[0]?.price?.id ?? null,
    // Stripe movió current_period_end al item en versiones recientes de la API; se miran
    // los dos sitios para que la fila no se quede sin fecha según qué versión responda.
    current_period_end: iso(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    last_event_at: eventAt,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Alta o actualización completa. Solo se llega aquí desde checkout.session.completed, que
 * es el único evento que trae a la vez el usuario (client_reference_id) y el cliente de
 * Stripe — la pieza que empareja ambos mundos.
 */
async function upsertSubscription(userId, customerId, sub, eventAt) {
  const row = {
    user_id: userId,
    stripe_customer_id: customerId,
    ...subFields(sub, eventAt),
  };
  const res = await sbFetch(`sl_subscriptions?on_conflict=user_id`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`upsert ${res.status} ${await res.text().catch(() => '')}`);
}

/**
 * Actualiza por cliente de Stripe. Los eventos de suscripción no saben quién es el usuario,
 * solo el customer — de ahí el índice sobre esa columna.
 *
 * El filtro `or=(last_event_at.is.null, last_event_at.lt.X)` es la protección contra
 * desorden: Stripe no garantiza el orden de entrega, así que un `updated` reintentado puede
 * llegar después del `deleted` y resucitar una suscripción cancelada. Al filtrar en el
 * propio UPDATE, el evento viejo no encuentra fila que tocar y se descarta solo, sin
 * leer-comparar-escribir (que tendría carrera entre la lectura y la escritura).
 */
async function updateByCustomer(customerId, patch, eventAt) {
  const q = new URLSearchParams({
    stripe_customer_id: `eq.${customerId}`,
    or: `(last_event_at.is.null,last_event_at.lt.${eventAt})`,
  });
  const res = await sbFetch(`sl_subscriptions?${q}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`update ${res.status} ${await res.text().catch(() => '')}`);
}

export async function POST(request) {
  // Inerte mientras no esté configurado. 503 y no 404 para que, si algún día se apunta un
  // webhook a un despliegue sin claves, el panel de Stripe lo muestre como error de
  // configuración y no como "esta URL no existe".
  if (!stripeEnabled()) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  // Cuerpo CRUDO: la firma se calcula sobre estos bytes exactos. Parsear antes de verificar
  // rompería el HMAC y, peor, haría trabajo con datos aún no autenticados.
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');

  const { event, error } = await verifyWebhook(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  if (error) {
    // 400, no 500: no queremos que Stripe reintente algo que nunca va a verificar. Y el
    // motivo no vuelve en la respuesta — a quien esté probando firmas no se le da pistas.
    console.warn('stripe webhook rejected:', error);
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Deliberadamente DESPUÉS de verificar la firma: así un sondeo sin credenciales recibe
  // siempre "firma inválida" y no averigua nada sobre cómo está configurado el servidor.
  // Para Stripe da igual el orden — su firma siempre es válida y verá el 503 igualmente.
  if (!SB() || !KEY()) {
    console.error('stripe webhook: Supabase env missing');
    return new Response(JSON.stringify({ error: 'not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }

  const eventAt = iso(event.created) ?? new Date().toISOString();
  const ok = () => new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

  // Solo se suelta la marca si llegamos a ponerla: si claimEvent es quien falla, no hay
  // nada que borrar y un DELETE a ciegas podría cargarse la marca de otra entrega.
  let claimed = false;

  try {
    if (!(await claimEvent(event.id, event.type))) return ok(); // ya procesado
    claimed = true;

    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.client_reference_id;
        const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id;
        const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;

        // Un pago único (mode: 'payment') no crea suscripción: no es nuestro caso, se ignora.
        if (!subId) break;
        if (!userId || !UUID.test(userId)) {
          // Sin usuario no hay a quién dar el permiso. Se registra y se devuelve 200: es un
          // fallo de configuración del Payment Link (le falta client_reference_id), y
          // reintentarlo no lo va a arreglar.
          console.error('stripe webhook: checkout sin client_reference_id válido', s.id);
          break;
        }

        // Se relee la suscripción de la API en vez de fiarse del objeto de la sesión: la
        // sesión trae el id, no el estado, y además esto resuelve el desorden de entrega
        // (si el customer.subscription.created llegó antes, aquí obtenemos el estado bueno).
        const sub = await stripeApi(`subscriptions/${subId}`, {});
        await upsertSubscription(userId, customerId, sub, eventAt);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        if (!customerId) break;
        // `deleted` no siempre trae status 'canceled' en el objeto; el tipo de evento es la
        // señal fiable de que se acabó.
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
        // Si no existe fila para este customer no se crea nada: sin checkout.session.completed
        // no sabemos de qué usuario es, y una fila sin user_id no serviría para nada.
        await updateByCustomer(customerId, { ...subFields(sub, eventAt), status }, eventAt);
        break;
      }

      default:
        // Todo lo demás se acepta sin hacer nada. Stripe manda muchos tipos de evento y
        // devolver un error por los que no nos interesan solo genera reintentos.
        break;
    }
    return ok();
  } catch (e) {
    // 500 → Stripe reintenta, y el reintento SÍ va a reprocesar porque acabamos de soltar
    // la marca. Es el comportamiento correcto ante un fallo transitorio de Supabase o de la
    // API de Stripe: el estado acaba cuadrando en cuanto el servicio se recupere.
    if (claimed) await releaseEvent(event.id);
    console.error('stripe webhook error:', e?.message ?? e);
    return new Response(JSON.stringify({ error: 'processing failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
