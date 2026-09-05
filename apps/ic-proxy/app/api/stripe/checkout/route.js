// Crea una sesión de Checkout alojada en Stripe y devuelve su URL.
//
// POR QUÉ UNA SESIÓN POR API Y NO UN PAYMENT LINK A SECAS:
// un Payment Link es una URL fija a la que hay que colgarle `?client_reference_id=<uuid>`
// para saber quién paga. Funciona, pero cada compra crea un CLIENTE NUEVO en Stripe. El
// mismo usuario que se da de baja y vuelve acaba con dos clientes, dos historiales de
// facturación y una fila nuestra que apunta solo a uno — y el portal de cliente le enseña
// medio historial. Creando la sesión aquí podemos reutilizar su stripe_customer_id.
//
// La tarjeta se sigue introduciendo en el dominio de Stripe, no en el nuestro: esto crea la
// sesión y redirige. Ningún dato de tarjeta pasa por este código, que es lo que mantiene
// todo el asunto fuera del alcance de PCI.
import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';
import { corsHeaders, preflight, allowOrigin } from '../../../../lib/cors.js';
import { stripeApi, stripeEnabled } from '../../../../lib/stripe.js';

export const runtime = 'edge';

const FALLBACK_APP = 'https://scora-research.vercel.app';

/**
 * A dónde vuelve el usuario tras pagar.
 *
 * Sale de allowOrigin(), que ya valida contra el allowlist, y NUNCA del cuerpo de la
 * petición. Una success_url elegida por quien llama es un open redirect de manual: se
 * monta un checkout real y se devuelve al usuario a un sitio controlado por el atacante,
 * con la credibilidad de venir de un pago legítimo.
 */
function appOrigin(request) {
  return allowOrigin(request) || process.env.APP_URL || FALLBACK_APP;
}

export async function POST(request) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  if (!stripeEnabled() || !process.env.STRIPE_PRICE_ID) {
    // 503 y un mensaje claro: la UI usa esto para saber que todavía toca lista de espera.
    return json({ error: 'Payments are not enabled yet.' }, 503);
  }

  const { user, error: authErr } = await requireUser(request, { strict: true });
  if (authErr) return authErr;

  // Cada llamada crea una sesión en Stripe. Un límite bajo basta: nadie necesita abrir
  // diez checkouts por minuto, y esto evita convertir la ruta en un generador de basura
  // en la cuenta de Stripe.
  const rl = await checkRateLimit('stripe-checkout', user.id, 10, 3600, request);
  if (rl) return rl;

  const origin = appOrigin(request);

  try {
    // Si ya fue cliente, se reutiliza. La lectura va con la service key porque RLS impide
    // (a propósito) que el navegador toque esta tabla, y aquí ya sabemos quién es por token.
    let customerId = null;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const q = `${process.env.SUPABASE_URL}/rest/v1/sl_subscriptions` +
        `?user_id=eq.${user.id}&select=stripe_customer_id`;
      const res = await fetch(q, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      });
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        customerId = rows?.[0]?.stripe_customer_id ?? null;
      }
    }

    const session = await stripeApi('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': process.env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': 1,
      // El puente entre el usuario de Supabase y el cliente de Stripe. Sin esto el webhook
      // recibe un pago y no sabe a quién dárselo.
      client_reference_id: user.id,
      ...(customerId ? { customer: customerId } : { customer_email: user.email }),
      success_url: `${origin}/pricing?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
      // Permite cancelar desde el portal sin escribirnos.
      'subscription_data[metadata][supabase_user_id]': user.id,
      allow_promotion_codes: true,
    });

    if (!session?.url) return json({ error: 'Could not start checkout.' }, 502);
    return json({ url: session.url }, 200);
  } catch (e) {
    // El mensaje de Stripe puede incluir detalles de configuración de la cuenta; se registra
    // pero no se devuelve.
    console.error('stripe checkout:', e?.message ?? e);
    return json({ error: 'Could not start checkout.' }, 502);
  }
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
