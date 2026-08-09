// Short interest / short float — FREE sources (FMP/Finnhub gate these behind paid plans).
//
// Primary: NASDAQ's public quote API returns the official bi-monthly short interest
// (shares short + days to cover). Unofficial like the Finviz scrape, so it may be
// blocked from some datacenter IPs — we degrade gracefully.
// Fallback: FINRA's Reg SHO daily short-volume file (official public CDN, won't block)
// gives today's short-volume ratio (shortVol/totalVol) — a different but legitimate
// short-side pressure gauge. Returned as `shortVolumeRatio` when NASDAQ is unavailable.
//
// Returns {} on total failure so the caller shows "—" exactly as before (no regression).
import { requireUser } from '../../../lib/auth.js';
import { checkRateLimit } from '../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../lib/cors.js';

export const runtime = 'edge';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fromNasdaq(symbol) {
  const res = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/short-interest?assetClass=stocks`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Origin': 'https://www.nasdaq.com', 'Referer': 'https://www.nasdaq.com/' },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const rows = body?.data?.shortInterestTable?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  const sharesShort = Number(String(r.interest ?? '').replace(/,/g, '')) || null;
  const daysToCover = r.daysToCover != null && r.daysToCover !== '' ? Number(r.daysToCover) : null;
  const m = String(r.settlementDate ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const settlementDate = m ? `${m[3]}-${m[1]}-${m[2]}` : null;
  if (sharesShort == null && daysToCover == null) return null;
  return { sharesShort, daysToCover, settlementDate, source: 'nasdaq' };
}

async function fromFinra(symbol) {
  const pad = (n) => String(n).padStart(2, '0');
  // FINRA publishes with a ~1-day lag on trading days; walk back until a file exists.
  for (let i = 1; i <= 6; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
    let res;
    try { res = await fetch(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`); } catch { continue; }
    if (!res.ok) continue;
    const text = await res.text();
    const line = text.split('\n').find(l => l.startsWith(`${ymd}|${symbol}|`));
    if (!line) continue;
    const p = line.split('|');
    const shortVol = Number(p[2]), totalVol = Number(p[4]);
    if (!(totalVol > 0)) return null;
    return { shortVolumeRatio: shortVol / totalVol, shortVolumeDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`, source: 'finra' };
  }
  return null;
}

function json(request, obj, status, ttl) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders(request, {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
    }),
  });
}

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request); if (authErr) return authErr;
  const rl = await checkRateLimit('shortint', user.id, 20, 60, request); if (rl) return rl;

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!symbol || !/^[A-Z.\-]{1,10}$/.test(symbol)) return json(request, { error: 'Invalid symbol' }, 400, 0);

  let data = null;
  try { data = await fromNasdaq(symbol); } catch { /* fall through to FINRA */ }
  if (!data) { try { data = await fromFinra(symbol); } catch { /* give up gracefully */ } }
  // 6h cache; short interest only updates bi-monthly so this is very safe.
  return json(request, data ?? {}, 200, 21600);
}

export async function OPTIONS(request) {
  return preflight(request);
}
