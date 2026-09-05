import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/cors.js';

export const runtime = 'edge';

const VALID_SERIES = /^[A-Z0-9_]{2,30}$/;

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('fred', user.id, 10, 60, request); if (rl) return rl;
  const json = (obj, status) => new Response(JSON.stringify(obj), {
    status, headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
  });

  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');

  if (!seriesId || !VALID_SERIES.test(seriesId)) {
    return json({ error: 'Invalid series_id' }, 400);
  }

  if (!process.env.FRED_KEY) {
    return json({ error: 'Server misconfigured: FRED_KEY missing' }, 500);
  }

  const upstream = new URL('https://api.stlouisfed.org/fred/series/observations');
  upstream.searchParams.set('series_id', seriesId);
  upstream.searchParams.set('file_type', 'json');
  upstream.searchParams.set('api_key', process.env.FRED_KEY);

  const optional = ['limit', 'sort_order', 'units', 'frequency', 'observation_start', 'observation_end'];
  for (const opt of optional) {
    const v = url.searchParams.get(opt);
    if (v) upstream.searchParams.set(opt, v);
  }

  const res = await fetch(upstream.toString(), { headers: { 'Accept': 'application/json' } });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    }),
  });
}

export async function OPTIONS(request) {
  return preflight(request);
}
