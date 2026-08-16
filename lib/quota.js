// Cuota DIARIA de llamadas a la IA. Es lo que hace que Pro signifique algo.
//
// QUÉ PROBLEMA RESUELVE, Y POR QUÉ NO BASTABA EL LIMITADOR QUE YA HABÍA:
// checkRateLimit acota la RÁFAGA (5/min por usuario). Eso frena un bucle descontrolado,
// pero no acota el GASTO: 5 por minuto sostenidos son 7.200 llamadas al día. La factura de
// Anthropic no depende del ritmo sino del total, así que el techo de coste hay que ponerlo
// por día. Y de paso es lo único que diferencia Free de Pro: /pricing anunciaba "1 análisis
// diario" que nunca se aplicó en ningún sitio.
//
// POR QUÉ SE CUENTAN TODAS LAS LLAMADAS Y NO SOLO LOS "ANÁLISIS PROFUNDOS":
// el tipo de llamada (`module`: stock-thesis, news-relevance…) lo declara el cliente, y
// cualquier cosa que declare el cliente se puede falsificar — bastaría mandar
// module:"news-relevance" para saltarse un límite puesto sobre "stock-thesis". Lo que el
// servidor sí puede contar sin que nadie mienta es cuántas veces ha llamado. Además todas
// las llamadas de IA de la app las dispara el usuario con un botón (ninguna se ejecuta sola
// al cargar una página, verificado), así que contar peticiones cuenta intenciones: nadie
// gasta cuota por navegar.
//
// LOS LÍMITES SE CONFIGURAN POR ENTORNO, a propósito. El número correcto depende de cuántos
// usuarios activos haya y del presupuesto de API del mes, y hoy no hay datos de uso de los
// que deducirlo (ai_audit_log tiene 4 filas). Ajustarlo tiene que ser cambiar una variable,
// no desplegar.
import { Redis } from '@upstash/redis';
import * as Sentry from '@sentry/nextjs';
import { corsHeaders } from './cors.js';

let _redis = null;
function redis() {
  if (_redis) return _redis;
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

/**
 * Los valores por defecto salen de la restricción real: el presupuesto de la API es del
 * orden de 10 €/mes. A precio de Haiku 4.5 ($1/MTok entrada, $5/MTok salida) y con los
 * prompts de esta app (unos 5k de entrada, 600-1800 de salida), una llamada cuesta ~$0,01.
 * Es decir: unas 1.100 llamadas al mes en total, ~37 al día ENTRE TODOS los usuarios.
 *
 * Con eso, 5/día por usuario gratuito es un tope que permite trabajar de verdad sobre una
 * empresa (tesis + veredicto + noticias + resultados) y a la vez aguanta unos cuantos
 * usuarios activos antes de comerse el presupuesto. En cuanto haya usuarios reales, el
 * número correcto se lee de ai_audit_log y se ajusta con la variable de entorno.
 */
export function dailyLimit(isProUser) {
  const raw = isProUser ? process.env.AI_DAILY_PRO : process.env.AI_DAILY_FREE;
  const n = Number(raw);
  // Se exige un entero positivo: un '0' o un 'abc' en la variable dejaría el producto
  // inutilizable (o abierto) sin que nada lo avise. Ante un valor inválido, el defecto.
  if (Number.isInteger(n) && n > 0) return n;
  return isProUser ? 100 : 5;
}

/**
 * Día natural en UTC.
 *
 * UTC y no la zona del usuario: la zona la manda el cliente y por tanto se puede falsear
 * para estrenar cuota cuando convenga. El coste es que a algunos les cambia el contador a
 * media tarde; a cambio, el contador no se puede manipular. Se dice en el mensaje de error
 * para que no parezca un fallo.
 */
function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Segundos que quedan hasta el próximo reinicio, para Retry-After. */
function secondsToReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

let _warned = false;
function degrade(reason) {
  // FAIL-OPEN, igual que ratelimit.js y por el mismo motivo: una caída de Redis no puede
  // dejar el producto sin su función principal. El riesgo asumido es real y conviene
  // nombrarlo — mientras Redis esté caído no hay techo diario, solo el de 5/min que también
  // depende de Redis. Por eso se avisa a Sentry con nivel de error: es la clase de avería
  // que no se nota hasta que llega la factura.
  const msg = `quota: ${reason} — failing open (SIN techo diario)`;
  console.error(msg);
  if (!_warned) {
    _warned = true;
    try { Sentry.captureMessage(msg, { level: 'error', tags: { subsystem: 'quota' } }); } catch { /* nunca romper por telemetría */ }
  }
}

/**
 * Consume una unidad de cuota diaria.
 *
 * @returns {Promise<{limited: Response|null, used: number, limit: number, resetIn: number}>}
 *   `limited` es la respuesta 429 ya construida, o null si puede pasar.
 *
 * Se INCREMENTA antes de llamar al modelo, no después. Contar al terminar significa que N
 * peticiones lanzadas a la vez leen todas el mismo contador y pasan todas: exactamente el
 * patrón que usaría alguien para saltarse el tope. INCR de Redis es atómico, así que
 * incrementar primero cierra esa ventana. El precio es que una llamada que falle en
 * Anthropic gasta cuota igualmente; se prefiere ese error ocasional a un contador burlable.
 */
export async function checkDailyQuota(userId, isProUser, request = null) {
  const limit = dailyLimit(isProUser);

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    degrade('Upstash env missing');
    return { limited: null, used: 0, limit, resetIn: 0 };
  }

  const key = `q:ai:${utcDay()}:${userId}`;
  let used;
  try {
    used = await redis().incr(key);
    // La expiración se pone solo en el primer incremento del día: repetirla en cada llamada
    // desplazaría el vencimiento hacia adelante sin parar. 48 h en vez de 24 da margen a un
    // reloj desviado y no cuesta nada — la clave del día siguiente es otra distinta.
    if (used === 1) await redis().expire(key, 172800);
  } catch (e) {
    degrade(e?.message || String(e));
    return { limited: null, used: 0, limit, resetIn: 0 };
  }

  const resetIn = secondsToReset();
  if (used > limit) {
    const body = {
      error: isProUser
        ? 'Daily AI limit reached. It resets at 00:00 UTC.'
        : 'Daily AI limit reached on the free plan. It resets at 00:00 UTC — or upgrade to Pro for more.',
      limit,
      used: used - 1, // lo consumido ANTES de esta petición rechazada: es lo que el usuario reconoce
      plan: isProUser ? 'pro' : 'free',
      resets_at: new Date(Date.now() + resetIn * 1000).toISOString(),
      upgrade_url: isProUser ? null : '/pricing',
    };
    return {
      limited: new Response(JSON.stringify(body), {
        status: 429,
        headers: corsHeaders(request, {
          'Content-Type': 'application/json',
          'Retry-After': String(resetIn),
          'X-Scora-Quota-Limit': String(limit),
          'X-Scora-Quota-Remaining': '0',
        }),
      }),
      used: used - 1, limit, resetIn,
    };
  }

  return { limited: null, used, limit, resetIn };
}

/**
 * Consulta sin consumir. Para que la interfaz pueda decir "te quedan 3" sin gastar una.
 *
 * Nunca lanza: si no se sabe, se devuelve 0 usadas. Un contador que no se puede leer no
 * debe impedir pintar la pantalla.
 */
export async function peekDailyQuota(userId, isProUser) {
  const limit = dailyLimit(isProUser);
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return { used: 0, limit, remaining: limit };
  }
  try {
    const raw = await redis().get(`q:ai:${utcDay()}:${userId}`);
    const used = Number(raw) || 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  } catch {
    return { used: 0, limit, remaining: limit };
  }
}
