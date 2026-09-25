import { assertCron } from '../../../../lib/server/cron.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

// RUNTIME NODE, no edge. Esta ruta habla con Cloud SQL y el driver de Postgres necesita
// sockets de Node — en edge el build falla con "Can't resolve 'fs'". Con Supabase no pasaba
// porque se hablaba por HTTP, que edge sí sabe hacer. Es el precio de tener la base dentro
// de la red privada en vez de detrás de una API pública, y para un cron da igual.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FUNDS = [
  { cik: '0001067983', name: 'Berkshire Hathaway' },
  { cik: '0001649339', name: 'Scion Asset Management' },
  { cik: '0001336528', name: 'Pershing Square' },
  { cik: '0001656456', name: 'Appaloosa LP' },
  { cik: '0001167483', name: 'Tiger Global' },
  { cik: '0001037389', name: 'Renaissance Technologies' },
  { cik: '0001350694', name: 'Bridgewater Associates' },
];

// The information-table XML filename varies by filer (infotable.xml,
// form13fInfoTable.xml, or an accession-based name). Discover it from the
// filing's index.json instead of assuming a fixed name.
async function fetchInfoTableXml(cikInt, accNo) {
  const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNo}`;
  const headers = { 'User-Agent': 'IC-Suite/2.0 contact@example.com' };
  try {
    const idx = await fetch(`${base}/index.json`, { headers }).then(r => r.json());
    const names = (idx?.directory?.item || [])
      .map(it => it.name)
      .filter(n => /\.xml$/i.test(n) && !/primary_doc\.xml$/i.test(n));
    // Prefer an obvious info-table name; else try each non-primary XML.
    names.sort((a, b) => {
      const score = n => (/info.?table|13f.*table|table/i.test(n) ? 0 : 1);
      return score(a) - score(b);
    });
    for (const name of names) {
      const xml = await fetch(`${base}/${name}`, { headers }).then(r => r.text());
      if (/<(?:\w+:)?infoTable>/i.test(xml)) return xml;
    }
  } catch {}
  // Fallback: known fixed names.
  for (const name of ['infotable.xml', 'form13fInfoTable.xml']) {
    try {
      const xml = await fetch(`${base}/${name}`, { headers }).then(r => r.text());
      if (/<(?:\w+:)?infoTable>/i.test(xml)) return xml;
    } catch {}
  }
  return '';
}

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;

  const allRows = [];
  const errors = [];
  const fundCounts = {};

  for (const fund of FUNDS) {
    try {
      const startLen = allRows.length;
      // Fetch latest filing metadata from SEC EDGAR
      const browseUrl = `https://data.sec.gov/submissions/CIK${fund.cik}.json`;
      const meta = await fetch(browseUrl, {
        headers: { 'User-Agent': 'IC-Suite/2.0 contact@example.com' },
      }).then(r => r.json());

      // Find most recent 13F-HR filing
      const recent = meta.filings.recent;
      const idx = recent.form.findIndex(f => f === '13F-HR');
      if (idx < 0) { errors.push(`${fund.name}: no 13F-HR found`); continue; }

      const accNo = recent.accessionNumber[idx].replace(/-/g, '');
      const filingDate = recent.filingDate[idx];
      const cikInt = parseInt(fund.cik, 10);

      // Download the information-table XML (filename auto-discovered).
      const infoXml = await fetchInfoTableXml(cikInt, accNo);
      if (!infoXml) { errors.push(`${fund.name}: infotable not found`); continue; }

      // Parse <infoTable> blocks (tolerate namespace prefixes like <ns1:infoTable>
      // — Bridgewater filings use them and we'd get 0 rows without this).
      const re = /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g;
      const get = (block, tag) => (new RegExp(`<(?:\\w+:)?${tag}>([^<]+)</(?:\\w+:)?${tag}>`).exec(block) || [])[1] || '';
      // Aggregate per-issuer WITHIN this fund (collapses multiple share-class /
      // lot rows for the same name), then keep TOP 25 by market value.
      // Why: RenTech alone has 3,200+ micro-positions that drown out the
      // conviction signal; we want each fund's top bets, not their whole book.
      const byIssuer = new Map();
      let m;
      while ((m = re.exec(infoXml)) !== null) {
        const nameOfIssuer = get(m[1], 'nameOfIssuer').trim();
        const shares = parseInt(get(m[1], 'sshPrnamt') || '0', 10);
        // SEC 13F value field is WHOLE DOLLARS post-2023 (no *1000).
        const value = parseFloat(get(m[1], 'value') || '0');
        if (!nameOfIssuer || !shares) continue;
        const ex = byIssuer.get(nameOfIssuer);
        if (ex) {
          ex.shares_held += shares;
          ex.market_value_usd += value;
        } else {
          byIssuer.set(nameOfIssuer, {
            fund_cik: fund.cik,
            fund_name: fund.name,
            filing_date: filingDate,
            ticker: nameOfIssuer,
            shares_held: shares,
            market_value_usd: value,
            delta_vs_prior_q: null,
            action: 'HOLD',
          });
        }
      }
      const top = [...byIssuer.values()]
        .sort((a, b) => b.market_value_usd - a.market_value_usd)
        .slice(0, 25);
      for (const row of top) allRows.push(row);
      fundCounts[fund.name] = top.length;
    } catch (e) {
      errors.push(`${fund.name}: ${e.message}`);
    }
  }

  // Aggregate duplicate (fund_cik, filing_date, ticker) keys BEFORE upsert.
  // A fund can hold the same issuer across multiple infoTable rows (share
  // classes / lots / put-call). PostgREST ON CONFLICT rejects a batch that
  // touches the same key twice ("command cannot affect row a second time"),
  // so we collapse them by summing shares + market value.
  const byKey = new Map();
  for (const r of allRows) {
    const k = `${r.fund_cik}|${r.filing_date}|${r.ticker}`;
    const prev = byKey.get(k);
    if (prev) {
      prev.shares_held += r.shares_held;
      prev.market_value_usd += r.market_value_usd;
    } else {
      byKey.set(k, { ...r });
    }
  }
  const deduped = [...byKey.values()];

  // Upsert to Supabase using service role (bypasses RLS)
  const sbResp = await sbFetch(`smart_money_13f?on_conflict=fund_cik,filing_date,ticker`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(deduped),
    }
  );

  const sbBody = sbResp.ok ? undefined : await sbResp.text();

  return new Response(
    JSON.stringify({
      parsed: allRows.length,
      inserted: deduped.length,
      funds: fundCounts,
      supabase_status: sbResp.status,
      supabase_error: sbBody,
      errors: errors.length ? errors : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
