import Anthropic from '@anthropic-ai/sdk';
import { requireUser } from '../../../lib/server/auth.js';
import { checkRateLimit, clientIp } from '../../../lib/server/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/server/cors.js';
import { checkDailyQuota } from '../../../lib/server/quota.js';
import { isPro } from '../../../lib/server/entitlements.js';
import { registrarAuditoria } from '../../../lib/server/auditoriaIA.js';
import { sbFetch } from '../../../lib/server/data/postgrest.js';
import { leerPeticion, modeloAsistente, parametrosClaude, tickerDeRuta, tarjetasParaRuta } from '../../../lib/server/asistente.js';

// El asistente de pantalla (components/ScreenAssistant.tsx). Lo que se valida y lo que se
// manda a Claude está en lib/server/asistente.js; aquí solo el orden de las comprobaciones,
// que es el mismo que en /api/anthropic/messages, y el streaming.
//
// RESPONDE EN STREAMING, una línea JSON por evento (NDJSON):
//   {"type":"text","text":"…"}     un trozo de la respuesta
//   {"type":"done","grounded":…}   el final, con el resultado del filtro de grounding
//   {"type":"refusal"}             el modelo (y su respaldo) declinaron la pregunta
//   {"type":"error","message":"…"} algo falló después de empezar
// En un chat esperar la respuesta entera son 5-15 s mirando un spinner; así se empieza a leer
// en uno. Y un evento final permite pasar el grounding, que solo se puede comprobar al acabar.

// RUNTIME NODE: la cuota y la suscripción consultan Cloud SQL, cuyo driver necesita sockets.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// La página viaja con hasta 4 gráficos en PNG (~520 KB cada uno como mucho) además del texto.
// El tope se mide sobre el cuerpo leído, no sobre Content-Length (lo pone el cliente).
const MAX_BODY_BYTES = 3 * 1024 * 1024;

const MENSAJE_FALLO = 'The assistant could not answer. Please try again.';

// Las tarjetas de conocimiento de Scora (kb_cards): una docena de filas que cambian a mano, así
// que se leen como mucho cada 10 minutos por instancia. Si la base falla, el guía responde sin
// ellas —con su conocimiento general y la página— en vez de no responder.
const TARJETAS_TTL = 10 * 60_000;
let _tarjetas = { hasta: 0, filas: [] };
async function tarjetasDeScora() {
  if (Date.now() < _tarjetas.hasta) return _tarjetas.filas;
  try {
    const r = await sbFetch('kb_cards?select=topic,claim,source,tags,weight');
    const filas = r.ok ? await r.json() : null;
    if (Array.isArray(filas)) _tarjetas = { hasta: Date.now() + TARJETAS_TTL, filas };
    else console.error('assistant: kb_cards no disponible', r.status);
  } catch (e) {
    console.error('assistant: kb_cards', e?.message || e);
  }
  return _tarjetas.filas;
}

/** Un mensaje para el usuario sin detalles internos; el detalle va al log. */
function mensajeDeError(e) {
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is busy right now. Try again in a minute.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service. Check your connection and try again.';
  if (e instanceof Anthropic.APIError && e.status >= 500) return 'The AI service is having trouble. Try again in a minute.';
  return MENSAJE_FALLO;
}

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request, { strict: true }); if (authErr) return authErr;
  const rl = await checkRateLimit('assistant', user.id, 5, 60, request); if (rl) return rl;
  // Segunda dimensión por IP, como en la ruta de Anthropic: registrarse es gratis, así que el
  // límite por usuario solo no acota el gasto.
  const rlIp = await checkRateLimit('assistant-ip', clientIp(request), 20, 60, request); if (rlIp) return rlIp;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  if (!process.env.ANTHROPIC_KEY) return json({ error: 'Server misconfigured: ANTHROPIC_KEY missing' }, 500);
  const modelo = modeloAsistente();
  if (modelo.error) return json({ error: `Server misconfigured: ${modelo.error}` }, 500);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large', limit_bytes: MAX_BODY_BYTES }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const leida = leerPeticion(body);
  if (leida.error) return json({ error: leida.error }, 400);
  const { peticion } = leida;

  // Cuota diaria compartida con el resto de la IA de la app: cada pregunta cuenta como una
  // llamada. Después de validar (una petición mal formada no gasta el día de nadie) y antes de
  // llamar a Anthropic, que es lo que cuesta dinero.
  const pro = await isPro(user.id);
  const q = await checkDailyQuota(user.id, pro, request);
  if (q.limited) return q.limited;

  const tarjetas = tarjetasParaRuta(await tarjetasDeScora(), peticion.pagina.path);
  const cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
  const params = parametrosClaude(modelo, peticion, tarjetas);
  // Si el usuario cierra el panel o la pestaña, se corta también la llamada a Anthropic: lo que
  // ya no va a leer nadie no hay por qué seguir pagándolo.
  const stream = cliente.beta.messages.stream(params, { signal: request.signal });

  const codificador = new TextEncoder();
  const cuerpo = new ReadableStream({
    async start(controller) {
      const enviar = (obj) => controller.enqueue(codificador.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') enviar({ type: 'text', text: ev.delta.text });
        }
        const final = await stream.finalMessage();
        // Con `fallbacks`, un rechazo a media respuesta lo continúa el modelo de respaldo en el
        // mismo stream; "refusal" al final significa que declinó toda la cadena. Lo ya enviado
        // es parcial y el cliente lo descarta.
        if (final.stop_reason === 'refusal') {
          enviar({ type: 'refusal' });
        } else {
          const texto = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
          const { pagina, mensajes } = peticion;
          const pregunta = mensajes[mensajes.length - 1].content;
          // El grounding se comprueba contra lo que el modelo tenía delante: la página, la
          // selección, las tarjetas de Scora y la propia pregunta (si el usuario escribe «¿y si
          // fuera un 5 %?», ese 5 no es inventado). Mismo registro que el resto de la IA.
          const auditoria = await registrarAuditoria({
            userId: user.id,
            model: final.model,
            prompt: pregunta,
            texto,
            usageRaw: final.usage,
            meta: {
              module: 'screen-assistant',
              ticker: tickerDeRuta(pagina.path),
              sources: [pagina.path],
              dataBlock: [pagina.texto, pagina.seleccion, ...tarjetas.map((c) => c.claim), pregunta].filter(Boolean).join('\n'),
            },
          });
          enviar({
            type: 'done',
            grounded: auditoria.grounded,
            violations: auditoria.violations,
            logged: auditoria.registrado,
            truncated: final.stop_reason === 'max_tokens',
          });
        }
      } catch (e) {
        if (!request.signal.aborted) {
          console.error('assistant:', e?.status ?? '', e?.message || e);
          enviar({ type: 'error', message: mensajeDeError(e) });
        }
      }
      try { controller.close(); } catch { /* el cliente ya se fue */ }
    },
    cancel() { stream.abort(); },
  });

  return new Response(cuerpo, {
    status: 200,
    headers: corsHeaders(request, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      // no-transform: sin él, la compresión de `next start` puede retener los trozos hasta
      // juntar bastantes, y el streaming deja de serlo.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'X-Scora-Quota-Limit': String(q.limit),
      'X-Scora-Quota-Remaining': String(Math.max(0, q.limit - q.used)),
      'X-Scora-Plan': pro ? 'pro' : 'free',
    }),
  });
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
