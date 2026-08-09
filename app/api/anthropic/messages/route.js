import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/cors.js';

export const runtime = 'edge';

const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
]);

const MAX_BODY_BYTES = 50 * 1024; // 50 KB

export async function POST(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('anthropic', user.id, 5, 60, request); if (rl) return rl;
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
    headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
