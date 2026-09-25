// ¿Este usuario ha pagado? Versión de SERVIDOR — la que decide de verdad.
//
// El equivalente del front (lib/entitlements.ts) decide qué se ENSEÑA. Esto
// decide qué se PERMITE. Todo lo que cueste dinero al ejecutarse —una llamada al modelo, un
// envío— tiene que pasar por aquí, porque la comprobación del navegador se salta con las
// herramientas de desarrollo en diez segundos.
//
// QUIÉN LO LLAMA: las dos rutas de IA —app/api/anthropic/messages y app/api/llm—, y solo
// ellas, porque son las que cuestan dinero al ejecutarse. Lo que devuelve elige el tramo de
// cuota diaria en lib/quota.js: AI_DAILY_FREE o AI_DAILY_PRO. El límite por minuto que ya
// existía acota la ráfaga; la cuota diaria acota el gasto, y es la única diferencia real
// entre Free y Pro — la promesa de "1 análisis al día" de /pricing se aplica aquí.
//
// Se consulta en CADA petición y no se cachea: una suscripción cancelada debe dejar de dar
// acceso en el acto, y una lectura a Supabase no se nota al lado de una llamada al modelo.
import { PRO_STATUSES } from './stripe.js';

/**
 * @returns {Promise<boolean>} true solo si hay una suscripción vigente.
 *
 * CONTRATO DE FALLO — degrada a NO-PRO, al revés que cache.js y ratelimit.js.
 * Allí, fail-open significa "haz el trabajo igualmente", que es inofensivo. Aquí, fail-open
 * significaría dar acceso ilimitado a todo el mundo mientras Supabase esté caído: justo el
 * agujero que un atacante provocaría a propósito si pudiera. Degradar a no-pro deja al
 * cliente de pago con el mismo servicio que un usuario gratuito durante la avería —
 * molesto, pero acotado y reversible— en lugar de regalar la parte cara del producto.
 */
export async function isPro(userId) {
  if (!userId) return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return false;

  try {
    const q = `${process.env.SUPABASE_URL}/rest/v1/sl_subscriptions` +
      `?user_id=eq.${encodeURIComponent(userId)}&select=status,current_period_end`;
    const res = await fetch(q, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!res.ok) return false;

    const rows = await res.json().catch(() => []);
    const sub = rows?.[0];
    if (!sub || !PRO_STATUSES.has(sub.status)) return false;

    // Cancelado pero con periodo pagado por delante: sigue teniendo acceso hasta que venza.
    if (sub.current_period_end && Date.parse(sub.current_period_end) < Date.now()) return false;
    return true;
  } catch {
    return false; // ver contrato de fallo arriba
  }
}
