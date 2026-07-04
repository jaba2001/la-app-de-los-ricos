// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR — point-in-time fundamentals (free, no API key, no limits).
//
// The whole credibility of the backtest hinges on this: to score a stock as of a
// past date `asOf`, we use ONLY the XBRL facts that had already been FILED by then
// (`filed <= asOf`). EDGAR tags every fact with its filing date, so this is native
// point-in-time — no look-ahead. Flow items (revenue, net income) are summed over
// the 4 most-recent discrete quarters known by `asOf` (TTM); stock items (assets,
// equity) take the latest value as-of. Fair-access: send a User-Agent, throttle.
// ─────────────────────────────────────────────────────────────────────────────

const UA = "Scora Research contact@scora.app";
const SEC = "https://data.sec.gov";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

/** ticker → zero-padded 10-digit CIK (from the free SEC map). */
export async function tickerToCik(ticker) {
  if (!cache.has("__map")) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": UA } });
    const j = await r.json();
    const m = {};
    for (const k in j) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, "0");
    cache.set("__map", m);
  }
  return cache.get("__map")[ticker.toUpperCase()] ?? null;
}

/** Fetch one XBRL concept (cached). taxonomy = "us-gaap" | "dei". */
async function concept(cik, taxonomy, tag) {
  const key = `${cik}/${taxonomy}/${tag}`;
  if (cache.has(key)) return cache.get(key);
  await sleep(90); // stay well under SEC's 10 req/s fair-access limit
  let j = null;
  try {
    const r = await fetch(`${SEC}/api/xbrl/companyconcept/CIK${cik}/${taxonomy}/${tag}.json`, { headers: { "User-Agent": UA } });
    j = r.ok ? await r.json() : null;
  } catch { j = null; }
  cache.set(key, j);
  return j;
}

/** Discrete ~quarter facts (80–100 day span) known by asOf, newest end first, deduped by period. */
function quarters(j, asOf, unit = "USD") {
  const arr = j?.units?.[unit];
  if (!Array.isArray(arr)) return [];
  const q = arr.filter((x) => {
    if (!x.start || x.filed > asOf) return false;
    const days = (new Date(x.end) - new Date(x.start)) / 86400000;
    return days >= 80 && days <= 100;
  });
  const byEnd = new Map();
  for (const x of q) { const e = byEnd.get(x.end); if (!e || x.filed > e.filed) byEnd.set(x.end, x); }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
}

/** Latest instant (balance-sheet) value with end<=asOf and filed<=asOf. */
function instant(j, asOf, unit = "USD") {
  const arr = j?.units?.[unit];
  if (!Array.isArray(arr)) return null;
  const rows = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf);
  if (!rows.length) return null;
  rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return rows[0].val;
}

async function flowTTM(cik, tags, asOf, skip = 0) {
  // Try every tag and keep the one whose window is the MOST RECENT — companies switch
  // XBRL tags over time (banks especially), and an old tag with stale quarters must
  // not win over a newer tag with current data.
  let best = null;
  for (const t of tags) {
    const q = quarters(await concept(cik, "us-gaap", t), asOf);
    if (q.length >= skip + 4) {
      const slice = q.slice(skip, skip + 4);
      const cand = { val: slice.reduce((s, x) => s + x.val, 0), latestFiled: slice[0].filed, latestEnd: slice[0].end };
      if (!best || cand.latestEnd > best.latestEnd) best = cand;
    }
  }
  return best;
}
async function instTag(cik, tags, asOf, taxonomy = "us-gaap", unit = "USD") {
  for (const t of tags) { const v = instant(await concept(cik, taxonomy, t), asOf, unit); if (v != null) return v; }
  return null;
}

const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
  "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating"]; // last two: banks
const NI  = ["NetIncomeLoss"];
const GP  = ["GrossProfit"];
const OI  = ["OperatingIncomeLoss"];

/** Full point-in-time fundamentals bundle for `cik` as known on `asOf` (YYYY-MM-DD). */
export async function fundamentalsAsOf(cik, asOf) {
  const revNow  = await flowTTM(cik, REV, asOf, 0);
  const revPrev = await flowTTM(cik, REV, asOf, 4);
  const niNow   = await flowTTM(cik, NI, asOf, 0);
  const niPrev  = await flowTTM(cik, NI, asOf, 4);
  const gpNow   = await flowTTM(cik, GP, asOf, 0);
  const oiNow   = await flowTTM(cik, OI, asOf, 0);

  const assets = await instTag(cik, ["Assets"], asOf);
  const equity = await instTag(cik, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"], asOf);
  const curA   = await instTag(cik, ["AssetsCurrent"], asOf);
  const curL   = await instTag(cik, ["LiabilitiesCurrent"], asOf);
  const cash   = await instTag(cik, ["CashAndCashEquivalentsAtCarryingValue"], asOf);
  const ltd    = await instTag(cik, ["LongTermDebtNoncurrent", "LongTermDebt"], asOf);
  const ltdC   = await instTag(cik, ["LongTermDebtCurrent", "DebtCurrent"], asOf);
  const shares = await instTag(cik, ["EntityCommonStockSharesOutstanding"], asOf, "dei", "shares");

  return {
    revTTM: revNow?.val ?? null,
    revPrevTTM: revPrev?.val ?? null,
    niTTM: niNow?.val ?? null,
    niPrevTTM: niPrev?.val ?? null,
    gpTTM: gpNow?.val ?? null,
    oiTTM: oiNow?.val ?? null,
    assets, equity, curA, curL, cash,
    debt: (ltd ?? 0) + (ltdC ?? 0),
    shares,
    asOfLatestFiling: revNow?.latestFiled ?? niNow?.latestFiled ?? null,
    asOfLatestPeriod: revNow?.latestEnd ?? niNow?.latestEnd ?? null,
  };
}
