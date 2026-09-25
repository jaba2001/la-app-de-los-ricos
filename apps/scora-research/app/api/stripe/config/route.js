// ¿Están los pagos activos? Lo pregunta el front para decidir entre "Upgrade" y la lista
// de espera.
//
// POR QUÉ UNA RUTA Y NO UNA NEXT_PUBLIC_STRIPE_ENABLED:
// una variable en el front es una segunda copia de la verdad. En cuanto se active Stripe en
// el proxy y se olvide el redeploy del front (o al revés), el usuario ve un botón de pagar
// que devuelve 503, o sigue viendo la lista de espera con los pagos ya en marcha. Aquí solo
// hay una fuente: la configuración real del servidor que va a cobrar.
//
// No revela nada: solo si hay claves puestas y si son de prueba. Sin claves, sin ids, sin
// precios.
import { corsHeaders, preflight } from '../../../../lib/server/cors.js';
import { stripeEnabled, stripeIsTestMode, stripeApi } from '../../../../lib/server/stripe.js';

export const runtime = 'edge';

/**
 * El importe se LEE de Stripe, no se escribe en el front.
 *
 * Es la diferencia entre "la página dice 9 € y te cobran 9 €" y descubrir, tres meses
 * después de subir el precio en el panel, que la página seguía anunciando el viejo. Anunciar
 * un importe y cobrar otro no es un bug de maquetación: en la UE es publicidad engañosa, y
 * el cliente tiene razón cuando reclama.
 */
async function livePrice() {
  try {
    const p = await stripeApi(`prices/${process.env.STRIPE_PRICE_ID}`, {});
    if (typeof p?.unit_amount !== 'number' || !p?.currency) return null;
    return {
      // En céntimos, como lo da Stripe: formatear es cosa del front, que sabe el idioma.
      unit_amount: p.unit_amount,
      currency: p.currency,
      interval: p.recurring?.interval ?? null, // 'month' | 'year'
    };
  } catch {
    // Si Stripe no responde, se sigue enseñando el botón sin importe antes que romper la
    // página: el precio definitivo se ve en el checkout, que es el que cobra.
    return null;
  }
}

export async function GET(request) {
  // Se necesita el precio además de las claves: con Stripe configurado pero sin
  // STRIPE_PRICE_ID el checkout falla, así que enseñar el botón sería mentir.
  const enabled = stripeEnabled() && !!process.env.STRIPE_PRICE_ID;
  const price = enabled ? await livePrice() : null;

  return new Response(
    JSON.stringify({ enabled, test_mode: enabled && stripeIsTestMode(), price }),
    {
      status: 200,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        // Corto a propósito: el día que se activen los pagos, la app no debe tardar una hora
        // en enterarse por una caché.
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      }),
    }
  );
}

export async function OPTIONS(request) {
  return preflight(request, 'GET, OPTIONS');
}
