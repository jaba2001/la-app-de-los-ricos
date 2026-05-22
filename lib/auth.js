import { createClient } from '@supabase/supabase-js';

let _client = null;
function client() {
  if (_client) return _client;
  _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  return _client;
}

export async function requireUser(request) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { user: null, error: new Response(JSON.stringify({error:'Missing Authorization header'}), {status:401, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}) };
  }
  const token = auth.slice(7);
  const { data, error } = await client().auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: new Response(JSON.stringify({error:'Invalid token'}), {status:401, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}) };
  }
  return { user: data.user, error: null };
}
