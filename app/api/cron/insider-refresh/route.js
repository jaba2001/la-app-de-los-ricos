export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('Unauthorized', { status: 401 });

  let html = '';
  try {
    const res = await fetch(
      'https://openinsider.com/screener?s=&o=&pl=&ph=&ll=&lh=&fd=730&xp=1&sic1=-1&sicl=100&sich=9999&grp=0&sortcol=11&cnt=50&page=1',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IC-Suite/2.0)' } }
    );
    html = await res.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'scrape failed: ' + e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const rows = [];
  let m, rank = 0;

  while ((m = rowRe.exec(html)) !== null) {
    const cells = [];
    let mc;
    while ((mc = cellRe.exec(m[1])) !== null)
      cells.push(mc[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length < 8) continue;
    const ticker = cells[3];
    if (!/^[A-Z.\-]{1,6}$/.test(ticker)) continue;
    const value = parseFloat((cells[cells.length - 2] || '').replace(/[\$,]/g, '')) || 0;
    if (value <= 0) continue;
    rank++;
    rows.push({
      month: new Date().toISOString().slice(0, 7) + '-01',
      rank,
      ticker,
      sector: null,
      net_insider_buying_usd: value,
      num_insiders: 1,
      score: Math.min(100, Math.log10(value) * 20),
    });
    if (rank >= 50) break;
  }

  const sbResp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/smart_money_top_buyers?on_conflict=month,rank`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );

  return new Response(
    JSON.stringify({ scraped: rows.length, supabase_status: sbResp.status }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
