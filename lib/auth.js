import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from './cors.js';

let _client = null;
function client() {
  if (_client) return _client;
  _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return _client;
}

function deny(request, message, status = 401) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });
}

/**
 * Best-effort identity for routes that are open to logged-out visitors.
 *
 * Returns the user when a valid token is present, null otherwise — never an error. Use it
 * so a public route can ATTRIBUTE a row to an account without ever trusting an id supplied
 * in the request body: a client-declared user id is an unauthenticated claim, not identity.
 */
export async function optionalUser(request) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const { data, error } = await client().auth.getUser(auth.slice(7));
    return error ? null : (data?.user ?? null);
  } catch {
    return null;
  }
}

export async function requireUser(request) {
  // Fail closed: without Supabase credentials we cannot validate anything, so every
  // request must be rejected rather than fall through to an unauthenticated handler.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('requireUser: SUPABASE_URL/SUPABASE_ANON_KEY missing — denying all requests');
    return { user: null, error: deny(request, 'Server misconfigured: auth unavailable', 503) };
  }
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { user: null, error: deny(request, 'Missing Authorization header') };
  }
  const token = auth.slice(7);
  const { data, error } = await client().auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: deny(request, 'Invalid token') };
  }
  return { user: data.user, error: null };
}
