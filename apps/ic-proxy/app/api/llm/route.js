// Free-tier LLM passthrough with FALLBACK. Same auth + rate-limit posture as
// /api/anthropic/messages, but routes to a free provider (Groq or Gemini) and normalizes
// the reply to Anthropic's { content:[{type:'text',text}] } shape so the client parses it
// unchanged. Supports a fallback chain: it tries LLM_PROVIDER first and, if that provider
// errors or is rate-limited, automatically retries with LLM_FALLBACK. The app's grounding
// gate keeps a weaker free model safe, so Scora runs its whole AI layer at €0.
//   Env: LLM_PROVIDER=gemini|groq, LLM_FALLBACK=groq|gemini (optional),
//        GEMINI_KEY, GROQ_KEY, optional GEMINI_MODEL / GROQ_MODEL.
import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit, clientIp } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';
import { checkDailyQuota } from '../../../lib/quota.js';
import { isPro } from '../../../lib/entitlements.js';

export const runtime = 'edge';
const MAX_BODY_BYTES = 50 * 1024;
const DEFAULT_MODEL = { groq: 'llama-3.3-70b-versatile', gemini: 'gemini-2.0-flash' };

// Call one provider. Returns the text, or throws an Error (missing key / http / empty) so
// the fallback chain can move on.
async function callProvider(name, prompt, maxTokens) {
  if (name === 'groq') {
    if (!process.env.GROQ_KEY) throw new Error('GROQ_KEY missing');
    const model = process.env.GROQ_MODEL || DEFAULT_MODEL.groq;
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`groq ${r.status}: ${j?.error?.message || 'error'}`);
    const text = j?.choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error('groq empty response');
    return text;
  }
  if (name === 'gemini') {
    if (!process.env.GEMINI_KEY) throw new Error('GEMINI_KEY missing');
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL.gemini;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`gemini ${r.status}: ${j?.error?.message || 'error'}`);
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!text) throw new Error('gemini empty response');
    return text;
  }
  throw new Error(`unknown provider "${name}"`);
}

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request, { strict: true }); if (authErr) return authErr;
  const rl = await checkRateLimit('llm', user.id, 5, 60, request); if (rl) return rl;
  // Segunda dimensión por IP: el límite por usuario no acota el gasto porque
  // registrarse es gratis. Aquí los proveedores son gratuitos, pero tienen cuota y
  // agotarla deja la app sin capa de IA para todos.
  const rlIp = await checkRateLimit('llm-ip', clientIp(request), 20, 60, request); if (rlIp) return rlIp;
  const json = (obj, status) => jsonFor(request, obj, status);

  // Measure the parsed body, not Content-Length: that header is caller-controlled and
  // absent on chunked uploads, so trusting it let an unbounded payload through.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large', limit_bytes: MAX_BODY_BYTES }, 413);

  let body;
  try { body = JSON.parse(raw); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  // Number.isFinite rejects NaN/Infinity (typeof NaN === 'number' would pass); floor ≥1
  // so a 0/negative value can't reach the providers as an invalid request.
  if (!Number.isFinite(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 4096) return json({ error: 'max_tokens must be a number in [1, 4096]' }, 400);
  if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'messages array required' }, 400);

  const maxTokens = Math.floor(Math.min(4096, body.max_tokens));
  const prompt = body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n').trim();
  if (!prompt) return json({ error: 'empty prompt' }, 400);

  // Misma cuota diaria que la ruta de Anthropic, aunque aquí los proveedores sean gratis.
  // Dos motivos:
  //   · Su plan gratuito tiene un tope por CLAVE, compartido entre todos los usuarios: sin
  //     límite por persona, uno solo puede dejar la app sin IA para los demás.
  //   · Si esta ruta no tuviera cuota, cambiar LLM_PROVIDER dejaría a Pro sin nada que
  //     ofrecer. El nivel del plan no puede depender de qué proveedor esté configurado.
  const pro = await isPro(user.id);
  const q = await checkDailyQuota(user.id, pro, request);
  if (q.limited) return q.limited;

  // Build the provider chain: primary, then optional fallback (deduped).
  const primary = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const fallback = (process.env.LLM_FALLBACK || '').toLowerCase();
  const chain = fallback && fallback !== primary ? [primary, fallback] : [primary];

  let text = null, used = null, lastErr = null;
  for (const p of chain) {
    try { text = await callProvider(p, prompt, maxTokens); used = p; break; }
    catch (e) { lastErr = e; }
  }
  if (text == null) return json({ error: lastErr?.message || 'All LLM providers failed' }, 502);

  // Normalize to Anthropic shape so the client parses it identically.
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], provider: used }), {
    status: 200,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'X-Scora-Quota-Limit': String(q.limit),
      'X-Scora-Quota-Remaining': String(Math.max(0, q.limit - q.used)),
      'X-Scora-Plan': pro ? 'pro' : 'free',
    }),
  });
}

function jsonFor(request, obj, status) {
  return new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
