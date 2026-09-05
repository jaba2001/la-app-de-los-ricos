import { requireUser } from '../../../../lib/auth.js';
import { checkRateLimit } from '../../../../lib/ratelimit.js';
import { corsHeaders, preflight } from '../../../../lib/cors.js';
import { cacheKey, cacheGet, cacheSet } from '../../../../lib/cache.js';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'edge';

const CACHE_TTL = 21600; // 6 hours

/** Convert Finviz percentage string to decimal. "0.98%" → 0.0098, "-" → null */
function pctToDecimal(s) {
  if (!s || s === '-' || s === '—' || s.trim() === '') return null;
  const n = parseFloat(s.replace('%', '').trim());
  return isNaN(n) ? null : n / 100;
}

/** Parse a raw value string — strip %, convert to number or null */
function toNum(s) {
  if (!s || s === '-' || s === '—' || s.trim() === '') return null;
  const stripped = s.replace('%', '').replace(',', '').trim();
  const n = parseFloat(stripped);
  return isNaN(n) ? null : n;
}

function parseFinvizHtml(html) {
  const result = {};

  // Primary regex: <b>LABEL</b></td>...<td ...>VALUE
  const re1 = /<b>([^<]{1,40})<\/b><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  const pairs = [];
  let m;
  while ((m = re1.exec(html)) !== null) {
    const label = m[1].trim();
    const value = m[2].replace(/<[^>]+>/g, '').trim();
    pairs.push([label, value]);
  }

  // Fallback: broader match
  if (pairs.length < 5) {
    const re2 = /<td[^>]*>\s*<b>([^<]+)<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
    while ((m = re2.exec(html)) !== null) {
      const label = m[1].trim();
      const value = m[2].replace(/<[^>]+>/g, '').trim();
      pairs.push([label, value]);
    }
  }

  let epsNextYSeen = 0; // track which "EPS next Y" row we're on

  for (const [label, value] of pairs) {
    switch (label) {
      case 'Short Float':      result.shortFloat      = pctToDecimal(value); break;
      case 'Short Ratio':      result.shortRatio      = toNum(value);        break;
      case 'Insider Own':      result.insiderOwn      = pctToDecimal(value); break;
      case 'Insider Trans':    result.insiderTrans    = pctToDecimal(value); break;
      case 'Inst Own':         result.instOwn         = pctToDecimal(value); break;
      case 'Inst Trans':       result.instTrans       = pctToDecimal(value); break;
      case 'Rel Volume':       result.relVolume       = toNum(value);        break;
      case 'ATR':              result.atr             = toNum(value);        break;
      case 'Volatility': {
        // "1.72% 1.84%" — take first number
        const first = value.split(' ')[0];
        result.volatility14d = pctToDecimal(first);
        break;
      }
      case 'Fwd P/E':          result.forwardPe       = toNum(value);        break;
      case 'PEG':              result.peg             = toNum(value);        break;
      case 'P/S':              result.ps              = toNum(value);        break;
      case 'P/C':              result.pc              = toNum(value);        break;
      case 'P/FCF':            result.pfcf_fv         = toNum(value);       break;
      case 'EV/Sales':         result.evSales         = toNum(value);       break;
      case 'Oper. Margin':     result.operatingMargin = pctToDecimal(value); break;
      case 'Profit Margin':    result.profitMargin    = pctToDecimal(value); break;
      case 'ROA':              result.roa             = pctToDecimal(value); break;
      case 'ROE':              result.roe             = pctToDecimal(value); break;
      case 'EPS Q/Q':          result.epsQoQ          = pctToDecimal(value); break;
      case 'Sales Q/Q':        result.salesQoQ        = pctToDecimal(value); break;
      case 'EPS next Y': {
        // First occurrence may be $ value, second is % growth estimate
        epsNextYSeen++;
        if (value.includes('%') || epsNextYSeen === 2) {
          result.epsNextY = pctToDecimal(value);
        }
        break;
      }
      case 'EPS next 5Y':      result.epsNext5Y       = pctToDecimal(value); break;
      case 'Sales past 3Y':    result.salesGrowth3Y   = pctToDecimal(value); break;
      case 'Perf Year':        result.perfYear        = pctToDecimal(value); break;
      case 'Perf 3Y':          result.perf3Y          = pctToDecimal(value); break;
      case 'Perf 5Y':          result.perf5Y          = pctToDecimal(value); break;
      case 'Recom':            result.recom           = toNum(value);        break;
      case 'Target Price':     result.targetPrice     = toNum(value);        break;
      case 'Beta':             result.betaFv          = toNum(value);        break;
      case 'Gross Margin':     result.grossMarginFv   = pctToDecimal(value); break;
    }
  }

  return result;
}

export async function GET(request) {
  const { user, error: authErr } = await requireUser(request);
  if (authErr) return authErr;
  // Scrapes finviz.com HTML: unbounded calls risk getting the egress IP blocked, so this
  // is throttled tighter than the JSON APIs. 6h cache means the UI barely notices.
  const rl = await checkRateLimit('finviz', user.id, 15, 60, request);
  if (rl) return rl;

  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');

  if (!symbol || !/^[A-Z.\-]{1,15}$/.test(symbol)) {
    return new Response(JSON.stringify({ error: 'Invalid symbol' }), {
      status: 400,
      headers: corsHeaders(request, { 'Content-Type': 'application/json' }),
    });
  }

  // Cache first — this route scrapes HTML and is the one most likely to get the egress
  // IP blocked, so every avoided upstream call is worth more here than anywhere else.
  const key = cacheKey('finviz', 'quote', url.searchParams);
  const hit = await cacheGet(key);
  if (hit) {
    return new Response(hit.body, {
      status: hit.status,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        'X-Scora-Cache': 'HIT',
      }),
    });
  }

  try {
    const finvizUrl = `https://finviz.com/quote.ashx?t=${symbol}`;
    const res = await fetch(finvizUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finviz.com/',
      },
    });

    if (!res.ok) {
      // Finviz blocked or unavailable — return empty gracefully
      return new Response('{}', {
        status: 200,
        headers: corsHeaders(request, {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        }),
      });
    }

    const html = await res.text();
    const data = parseFinvizHtml(html);
    const fields = Object.keys(data).length;

    // This route parses HTML with regexes against a site we don't control. When Finviz
    // changes its markup the parser doesn't throw — it returns {} and the analysis simply
    // scores with less data. That silent degradation is the same failure mode as the FMP
    // field rename that already bit this project once, so make it loud.
    //
    // Threshold is ZERO fields, deliberately: ETFs and ADRs legitimately return only a
    // handful of fundamentals, so any "too few fields" rule would cry wolf. Zero is
    // unambiguous. htmlChars separates the two causes — short means we were served a
    // block/captcha page, long means the markup changed.
    if (fields === 0) {
      try {
        Sentry.captureMessage('finviz parse returned no fields — markup change or block page', {
          level: 'warning',
          tags: { subsystem: 'finviz-scrape' },
          extra: { symbol, htmlChars: html.length },
        });
      } catch { /* never break the response */ }
    }

    const body = JSON.stringify(data);
    // Never cache a degraded parse: 6 h of {} would freeze the outage in place long
    // after Finviz recovered.
    if (fields > 0) await cacheSet(key, { status: 200, body }, CACHE_TTL);

    return new Response(body, {
      status: 200,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        'X-Scora-Cache': 'MISS',
      }),
    });
  } catch {
    // Network error — return empty gracefully, never fail the analysis
    return new Response('{}', {
      status: 200,
      headers: corsHeaders(request, {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      }),
    });
  }
}

export async function OPTIONS(request) {
  return preflight(request);
}
