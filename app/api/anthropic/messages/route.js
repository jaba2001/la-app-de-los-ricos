import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';

export const runtime = 'edge';

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
]);

const MAX_BODY_BYTES = 50 * 1024; // 50 KB

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('anthropic', user.id, 5, 60); if (rl) return rl;
  if (!process.env.ANTHROPIC_KEY) {
    return new Response(JSON.stringify({error:'Server misconfigured: ANTHROPIC_KEY missing'}), {status:500, headers:{'Content-Type':'application/json'}});
  }

  const cl = parseInt(request.headers.get('content-length') || '0', 10);
  if (cl > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({error:'Payload too large', limit_bytes: MAX_BODY_BYTES}), {status:413, headers:{'Content-Type':'application/json'}});
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({error:'Invalid JSON'}), {status:400, headers:{'Content-Type':'application/json'}}); }

  if (!ALLOWED_MODELS.has(body.model)) {
    return new Response(JSON.stringify({error:'Model not allowed', allowed: [...ALLOWED_MODELS]}), {status:400, headers:{'Content-Type':'application/json'}});
  }
  if (typeof body.max_tokens !== 'number' || body.max_tokens > 4096) {
    return new Response(JSON.stringify({error:'max_tokens missing or >4096'}), {status:400, headers:{'Content-Type':'application/json'}});
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({error:'messages array required'}), {status:400, headers:{'Content-Type':'application/json'}});
  }

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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }});
}
