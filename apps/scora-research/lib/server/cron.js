// Shared guard for the Vercel cron routes.
//
// These routes run with SUPABASE_SERVICE_KEY (bypasses RLS) and can send push
// notifications to every user, so the check must fail CLOSED: the previous inline
// comparison against `Bearer ${process.env.CRON_SECRET}` authenticated the literal
// string "Bearer undefined" whenever the env var was missing from a deployment.

/** Length-checked constant-time string compare (leaks length only, which is fine here). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns an error Response when the caller is not the cron, or null when it is. */
export function assertCron(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('cron: CRON_SECRET not configured — refusing to run');
    return new Response(JSON.stringify({ error: 'Cron not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!safeEqual(request.headers.get('Authorization') || '', `Bearer ${secret}`)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

/** PostgREST filter value escaping — never interpolate raw values into the query string. */
export const pgv = (v) => encodeURIComponent(String(v));
