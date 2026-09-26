import { requireUser } from '../../../../lib/server/auth.js';
import { checkRateLimit, clientIp } from '../../../../lib/server/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/server/cors.js';
import { checkDailyQuota } from '../../../../lib/server/quota.js';
import { isPro } from '../../../../lib/server/entitlements.js';

// RUNTIME NODE, no edge. Esta ruta comprueba la suscripcion (lib/server/entitlements.js) y
// eso ahora consulta Cloud SQL, cuyo driver necesita sockets de Node. Con Supabase la
// comprobacion era una llamada HTTP, que edge si sabe hacer.
export const runtime = 'nodejs';

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
]);

const MAX_BODY_BYTES = 50 * 1024; // 50 KB

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request, { strict: true }); if (authErr) return authErr;
  const rl = await checkRateLimit('anthropic', user.id, 5, 60, request); if (rl) return rl;
  // Segunda dimensión, por IP. Esta es la única ruta que cuesta dinero de verdad
  // (Anthropic), y el límite por usuario no acota el gasto: registrarse es gratis, así
  // que N cuentas dan N veces la cuota. 20/min deja holgura a varias personas tras un
  // mismo NAT y aun así pone techo a una granja de cuentas.
  const rlIp = await checkRateLimit('anthropic-ip', clientIp(request), 20, 60, request); if (rlIp) return rlIp;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  if (!process.env.ANTHROPIC_KEY) {
    return json({ error: 'Server misconfigured: ANTHROPIC_KEY missing' }, 500);
  }

  // Read the body as text first and measure it. Content-Length is caller-controlled and
  // absent on chunked uploads, so trusting it let an unbounded payload through — and
  // input tokens are billed even though max_tokens caps only the output.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large', limit_bytes: MAX_BODY_BYTES }, 413);
  }

  let body;
  try { body = JSON.parse(raw); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  if (!ALLOWED_MODELS.has(body.model)) {
    return json({ error: 'Model not allowed', allowed: [...ALLOWED_MODELS] }, 400);
  }
  // Number.isFinite rejects NaN/Infinity (typeof NaN === 'number' would pass).
  if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 4096) {
    return json({ error: 'max_tokens must be a number in [1, 4096]' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'messages array required' }, 400);
  }

  // Cuota diaria. DESPUÉS de validar el cuerpo: una petición malformada no debe gastar el
  // día de nadie. Y antes de llamar a Anthropic, que es lo que cuesta dinero.
  //
  // Los límites por minuto de arriba acotan la ráfaga; esto acota el TOTAL, que es lo que
  // determina la factura — 5/min sostenidos serían 7.200 llamadas diarias. Es además la
  // única diferencia real entre Free y Pro.
  const pro = await isPro(user.id);
  const q = await checkDailyQuota(user.id, pro, request);
  if (q.limited) return q.limited;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      // Se devuelve el estado de la cuota en la propia respuesta para que la interfaz
      // pueda avisar ("te queda 1") sin una segunda petición — y sobre todo para que el
      // usuario no descubra el límite solo al chocarse con él.
      'X-Scora-Quota-Limit': String(q.limit),
      'X-Scora-Quota-Remaining': String(Math.max(0, q.limit - q.used)),
      'X-Scora-Plan': pro ? 'pro' : 'free',
    }),
  });
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
