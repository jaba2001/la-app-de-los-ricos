// Free-tier LLM passthrough. Same auth + rate-limit posture as /api/anthropic/messages,
// but routes to a FREE provider (Groq or Gemini) chosen by env, and normalizes the reply
// to Anthropic's { content:[{type:'text',text}] } shape so the client parses it unchanged.
// This is the "ralph" swap: the app's grounding gate makes a weaker free model safe, so
// Scora runs the AI layer at €0. Set LLM_PROVIDER=groq|gemini + the matching key + LLM_MODEL.
import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';

export const runtime = 'edge';
const MAX_BODY_BYTES = 50 * 1024;

const DEFAULT_MODEL = { groq: 'llama-3.3-70b-versatile', gemini: 'gemini-2.0-flash' };

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('llm', user.id, 5, 60); if (rl) return rl;

  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (cl > MAX_BODY_BYTES) return json({ error: 'Payload too large', limit_bytes: MAX_BODY_BYTES }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  if (typeof body.max_tokens !== 'number' || body.max_tokens > 4096) return json({ error: 'max_tokens missing or >4096' }, 400);
  if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: 'messages array required' }, 400);

  const provider = (process.env.LLM_PROVIDER || 'groq').toLowerCase();
  const maxTokens = Math.min(4096, body.max_tokens);
  // Our prompts are a single user turn; flatten defensively.
  const prompt = body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n').trim();
  if (!prompt) return json({ error: 'empty prompt' }, 400);

  try {
    let text = '';
    if (provider === 'groq') {
      if (!process.env.GROQ_KEY) return json({ error: 'Server misconfigured: GROQ_KEY missing' }, 500);
      const model = process.env.LLM_MODEL || DEFAULT_MODEL.groq;
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_KEY}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await r.json();
      if (!r.ok) return json({ error: j?.error?.message || 'Groq error', status: r.status }, r.status);
      text = j?.choices?.[0]?.message?.content ?? '';
    } else if (provider === 'gemini') {
      if (!process.env.GEMINI_KEY) return json({ error: 'Server misconfigured: GEMINI_KEY missing' }, 500);
      const model = process.env.LLM_MODEL || DEFAULT_MODEL.gemini;
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }),
      });
      const j = await r.json();
      if (!r.ok) return json({ error: j?.error?.message || 'Gemini error', status: r.status }, r.status);
      text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    } else {
      return json({ error: `Unknown LLM_PROVIDER "${provider}"` }, 500);
    }
    if (!text) return json({ error: 'Empty LLM response' }, 502);
    // Normalize to Anthropic shape so the client parses it identically.
    return json({ content: [{ type: 'text', text }] }, 200);
  } catch (e) {
    return json({ error: e?.message || 'LLM request failed' }, 502);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } });
}
