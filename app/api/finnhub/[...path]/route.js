import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';

export const runtime = 'edge';

const ALLOWED = new Set([
  'quote', 'profile2', 'company-news', 'stock/recommendation',
  'stock/insider-transactions', 'stock/insider-sentiment',
  'stock/earnings', 'calendar/earnings', 'calendar/economic',
  'stock/financials-reported', 'stock/transcripts',
  'stock/short-interest', 'stock/social-sentiment',
  'forex/rates', 'crypto/candle',
]);

export async function GET(request, { params }) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('finnhub', user.id, 10, 60); if (rl) return rl;
  const path = params.path.join('/');
  if (![...ALLOWED].some(p => path === p || path.startsWith(p + '/'))) {
    return new Response(JSON.stringify({error:'Endpoint not allowed', path}), {status:403, headers:{'Content-Type':'application/json'}});
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  if (symbol && !/^[A-Z.\-:]{1,12}$/.test(symbol)) {
    return new Response(JSON.stringify({error:'Invalid symbol'}), {status:400, headers:{'Content-Type':'application/json'}});
  }

  if (!process.env.FINNHUB_KEY) {
    return new Response(JSON.stringify({error:'Server misconfigured: FINNHUB_KEY missing'}), {status:500, headers:{'Content-Type':'application/json'}});
  }

  const upstream = new URL(`https://finnhub.io/api/v1/${path}`);
  for (const [k,v] of url.searchParams) upstream.searchParams.set(k, v);
  upstream.searchParams.set('token', process.env.FINNHUB_KEY);

  const res = await fetch(upstream.toString(), { headers: { 'Accept': 'application/json' } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }});
}
