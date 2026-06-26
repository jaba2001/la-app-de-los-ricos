import { requireUser }    from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';

// Public datasets — no API key required (STOCK Act disclosures)
const SENATE_URL = 'https://senate-stock-watcher-data.s3-us-east-2.amazonaws.com/aggregate/all_transactions.json';
const HOUSE_URL  = 'https://house-stock-watcher-data.s3-us-east-2.amazonaws.com/data/all_transactions.json';

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

function normTicker(raw) {
  return String(raw || '').replace(/^[$]/, '').toUpperCase().trim();
}

export async function GET(request, { params }) {
  const { user, error: authErr } = await requireUser(request);
  if (authErr) return authErr;

  const rl = await checkRateLimit('congress', user.id, 20, 60);
  if (rl) return rl;

  const ticker = (params.ticker || '').toUpperCase().replace(/[^A-Z.\-]/g, '');
  if (!ticker || ticker.length > 8) {
    return new Response(JSON.stringify({ error: 'Invalid ticker' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const trades = [];

  const fetchWithTimeout = (url, ms = 8000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal, next: { revalidate: 43200 } })
      .finally(() => clearTimeout(timer));
  };

  const [senateRes, houseRes] = await Promise.allSettled([
    fetchWithTimeout(SENATE_URL),
    fetchWithTimeout(HOUSE_URL),
  ]);

  if (senateRes.status === 'fulfilled' && senateRes.value.ok) {
    try {
      const all = await senateRes.value.json();
      for (const r of Array.isArray(all) ? all : []) {
        if (normTicker(r.ticker) !== ticker) continue;
        const date = normalizeDate(r.transaction_date);
        if (!date || date < cutoff) continue;
        trades.push({
          date,
          name:    r.senator || 'Unknown',
          party:   r.party || '',
          chamber: 'Senate',
          type:    (r.type || '').toLowerCase(),
          amount:  r.amount || '',
          disclosure_date: normalizeDate(r.disclosure_date),
        });
      }
    } catch {}
  }

  if (houseRes.status === 'fulfilled' && houseRes.value.ok) {
    try {
      const all = await houseRes.value.json();
      for (const r of Array.isArray(all) ? all : []) {
        if (normTicker(r.ticker) !== ticker) continue;
        const date = normalizeDate(r.transaction_date);
        if (!date || date < cutoff) continue;
        trades.push({
          date,
          name:    r.representative || 'Unknown',
          party:   r.party || '',
          chamber: 'House',
          type:    (r.type || '').toLowerCase(),
          amount:  r.amount || '',
          disclosure_date: normalizeDate(r.disclosure_date),
        });
      }
    } catch {}
  }

  trades.sort((a, b) => b.date.localeCompare(a.date));

  return new Response(JSON.stringify(trades.slice(0, 30)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600, s-maxage=43200',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
