// Pro-tier waitlist capture.
//
// The ONLY unauthenticated write endpoint in this proxy, and deliberately so: the whole
// point is capturing visitors who are not logged in when they click "Notify me" on
// /pricing. Everything that would normally be provided by requireUser is replaced here by
// narrower guards:
//   - CORS allowlist (lib/cors.js) — only our own front-ends may call it from a browser.
//   - Per-IP rate limit, FAIL-CLOSED. Everywhere else fail-open is defensible because
//     requireUser still stands behind it; here there is nothing behind it, and each call
//     sends an email to an address the caller chooses. Degrading to "no limit" would hand
//     out an anonymous mail cannon.
//   - Server-side email validation + a unique index on lower(email) in Postgres.
//   - Writes with SUPABASE_SERVICE_KEY so sl_waitlist can stay fully RLS-locked (no anon
//     policy), and the Resend key never reaches the browser.
//   - user_id comes from a VERIFIED token (optionalUser), never from the request body.
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';
import { sendEmail } from '../../../lib/email.js';
import { optionalUser } from '../../../lib/auth.js';

export const runtime = 'edge';

// Intentionally permissive but structural — the goal is to reject typos and junk, not to
// re-implement RFC 5322. Deliverability is proven by the welcome email, not by a regex.
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const MAX_LEN = 254; // RFC 5321 maximum address length

function welcomeHtml() {
  return `<!DOCTYPE html><html><body style="margin:0;background:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:4px">You're on the list</div>
    <div style="font-size:14px;color:#334155;line-height:1.6;margin-top:12px">
      Thanks for your interest in Scora Pro. The core engine — macro regime, the validated
      allocator, stock and cross-asset analysis — stays <strong>free forever</strong>;
      Pro will only ever add convenience (higher limits, alerts, exports), never the analysis itself.
    </div>
    <div style="font-size:14px;color:#334155;line-height:1.6;margin-top:12px">
      We'll email you once — when there's something real to try. No newsletter.
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-top:20px;line-height:1.6">
      Scora Research is an educational tool and is not investment advice.
    </div>
  </div></body></html>`;
}

export async function POST(request) {
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  // No user id to key the limiter on, so use the client IP. Vercel always sets
  // x-forwarded-for; the 'unknown' fallback shares one bucket, which is the safe direction
  // (stricter, never more permissive).
  //
  // failClosed: with no requireUser behind it, a degraded limiter would leave an anonymous
  // unlimited endpoint that also sends an email per call. Refusing beats spamming.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const rl = await checkRateLimit('waitlist', ip, 5, 3600, request, { failClosed: true });
  if (rl) return rl;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!email || email.length > MAX_LEN || !EMAIL.test(email)) {
    return json({ error: 'Enter a valid email address.' }, 400);
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('waitlist: Supabase env missing');
    return json({ error: 'Waitlist is not configured yet.' }, 503);
  }

  // Identity comes from a VERIFIED token or not at all. body.userId is deliberately
  // ignored: it is an unauthenticated claim, and the column is a FK to auth.users, so a
  // forged-but-nonexistent uuid would also fail the insert and surface as a 502 to a
  // legitimate visitor. Logged-out signups simply carry a null user_id, as designed.
  const user = await optionalUser(request);

  const row = {
    email,
    tier: typeof body?.tier === 'string' ? body.tier.slice(0, 32) : 'pro',
    source: typeof body?.source === 'string' ? body.source.slice(0, 32) : 'pricing',
    referrer: typeof body?.referrer === 'string' ? body.referrer.slice(0, 200) : null,
    user_id: user?.id ?? null,
  };

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/sl_waitlist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      // Signing up twice must not look like a failure to the person doing it.
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    // 409 shouldn't reach here given ignore-duplicates, but treat it as success anyway:
    // from the visitor's point of view they are on the list either way.
    if (res.status === 409) return json({ ok: true, already: true }, 200);
    console.error('waitlist insert failed:', res.status, await res.text().catch(() => ''));
    return json({ error: 'Could not save your email. Try again in a moment.' }, 502);
  }

  // Best-effort welcome. No-ops until RESEND_KEY + a verified sending domain exist
  // (Fase 1) — the signup itself must never depend on email working.
  await sendEmail({ to: email, subject: "You're on the Scora Pro waitlist", html: welcomeHtml() })
    .catch(() => {});

  return json({ ok: true }, 200);
}

export async function OPTIONS(request) {
  return preflight(request, 'POST, OPTIONS');
}
