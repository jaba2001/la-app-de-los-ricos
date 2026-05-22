export const runtime = 'edge';

const VALID_SERIES = /^[A-Z0-9_]{2,30}$/;

export async function GET(request) {
  const url = new URL(request.url);
  const seriesId = url.searchParams.get('series_id');

  if (!seriesId || !VALID_SERIES.test(seriesId)) {
    return new Response(JSON.stringify({error:'Invalid series_id'}), {status:400, headers:{'Content-Type':'application/json'}});
  }

  if (!process.env.FRED_KEY) {
    return new Response(JSON.stringify({error:'Server misconfigured: FRED_KEY missing'}), {status:500, headers:{'Content-Type':'application/json'}});
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
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }});
}
