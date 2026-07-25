// ─────────────────────────────────────────────────────────────────────────────
// SEC EDGAR — point-in-time fundamentals (free, no API key, no limits).
//
// One companyfacts call per company (all XBRL tags at once) → disk-cached, so a
// 500-name universe is ~500 downloads done once. To score as of a past date we use
// ONLY facts with filed<=asOf (native point-in-time, zero look-ahead). Flow items
// (revenue, income, D&A…) are summed over the 4 most-recent discrete quarters known
// by asOf (TTM); balance-sheet instants take the latest value as-of.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const UA = "Scora Research contact@scora.app";
const DIR = join(dirname(fileURLToPath(import.meta.url)), ".cache");
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, cacheFile, ttlDays = 30) {
  const path = join(DIR, cacheFile);
  if (existsSync(path)) {
    const age = (Date.now() - Number(readFileSync(path + ".t", "utf8").trim())) / 86400000;
    if (age < ttlDays) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { /* refetch */ } }
  }
  await sleep(90); // SEC fair-access (<10 req/s)
  let j = null;
  try { const r = await fetch(url, { headers: { "User-Agent": UA } }); j = r.ok ? await r.json() : null; } catch { j = null; }
  if (j) { writeFileSync(path, JSON.stringify(j)); writeFileSync(path + ".t", String(Date.now())); }
  return j;
}

/** ticker → zero-padded 10-digit CIK (free SEC map, cached in-process + disk). */
export async function tickerToCik(ticker) {
  if (!mem.has("__map")) {
    const j = await getJSON("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", 7);
    const m = {};
    if (j) for (const k in j) m[j[k].ticker.toUpperCase()] = String(j[k].cik_str).padStart(10, "0");
    mem.set("__map", m);
  }
  return mem.get("__map")[ticker.toUpperCase()] ?? null;
}

async function companyFacts(cik) {
  const key = `facts_${cik}`;
  if (mem.has(key)) return mem.get(key);
  const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, `CIK${cik}.json`);
  mem.set(key, j);
  return j;
}

/** SIC code → Scora sector (from submissions endpoint, cached). */
export async function sicSector(cik) {
  const j = await getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, `sub${cik}.json`);
  const sic = j?.sic ? Number(j.sic) : null;
  if (sic == null) return "";
  // Coarse SIC-range → Scora sector map (matches SECTOR_PE_BM keys in scoring.ts).
  if (sic >= 6000 && sic <= 6199) return "Financial Services";
  if (sic >= 6200 && sic <= 6399) return "Financial Services";
  if (sic >= 6400 && sic <= 6499) return "Financial Services";
  if (sic >= 6500 && sic <= 6599) return "Real Estate";
  if (sic >= 2833 && sic <= 2836) return "Healthcare";
  if (sic >= 8000 && sic <= 8099) return "Healthcare";
  if (sic >= 3570 && sic <= 3579) return "Technology";
  if (sic >= 3670 && sic <= 3679) return "Technology";
  if (sic >= 7370 && sic <= 7379) return "Technology";
  if (sic === 3571 || sic === 3572 || sic === 3576 || sic === 3577 || sic === 3674) return "Technology";
  if (sic >= 1300 && sic <= 1399) return "Energy";
  if (sic >= 2900 && sic <= 2999) return "Energy";
  if (sic >= 2800 && sic <= 2899) return "Materials";
  if (sic >= 1000 && sic <= 1099) return "Materials";
  if (sic >= 4800 && sic <= 4899) return "Communication Services";
  if (sic >= 2000 && sic <= 2199) return "Consumer Defensive";
  if (sic >= 2080 && sic <= 2099) return "Consumer Defensive";
  if (sic >= 5400 && sic <= 5499) return "Consumer Defensive";
  if (sic >= 5200 && sic <= 5999) return "Consumer Cyclical";
  if (sic >= 3700 && sic <= 3799) return "Consumer Cyclical";
  if (sic >= 4000 && sic <= 4799) return "Industrials";
  if (sic >= 3400 && sic <= 3569) return "Industrials";
  if (sic >= 4900 && sic <= 4999) return "Utilities";
  return "";
}

function facts(fj, tag, taxonomy = "us-gaap") {
  return fj?.facts?.[taxonomy]?.[tag]?.units ?? null;
}

/** Discrete ~quarter facts known by asOf, newest end first, deduped by period end. */
function quarters(units, asOf, unit = "USD") {
  const arr = units?.[unit];
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
function instant(units, asOf, unit = "USD") {
  const arr = units?.[unit];
  if (!Array.isArray(arr)) return null;
  const rows = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf);
  if (!rows.length) return null;
  rows.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  return rows[0].val;
}

// Try every tag, keep the window whose latest quarter is the MOST RECENT (tags change
// over time — banks especially — and stale tags must never beat current data).
function flowTTM(fj, tags, asOf, skip = 0) {
  let best = null;
  for (const t of tags) {
    const q = quarters(facts(fj, t), asOf);
    if (q.length >= skip + 4) {
      const s = q.slice(skip, skip + 4);
      const cand = { val: s.reduce((a, x) => a + x.val, 0), latestFiled: s[0].filed, latestEnd: s[0].end };
      if (!best || cand.latestEnd > best.latestEnd) best = cand;
    }
  }
  return best;
}
function instTag(fj, tags, asOf, taxonomy = "us-gaap", unit = "USD") {
  for (const t of tags) { const v = instant(facts(fj, t, taxonomy), asOf, unit); if (v != null) return v; }
  return null;
}

// Sum instant share CLASSES at the latest filing (Google/Meta report A+C separately),
// deduping identical duplicate contexts by value. Returns null if none.
function sumInstantShares(units, asOf) {
  const arr = units?.shares;
  if (!Array.isArray(arr)) return null;
  const elig = arr.filter((x) => !x.start && x.filed <= asOf && x.end <= asOf);
  if (!elig.length) return null;
  const maxEnd = elig.reduce((m, x) => (x.end > m ? x.end : m), "");
  const atEnd = elig.filter((x) => x.end === maxEnd);
  const lf = atEnd.reduce((m, x) => (x.filed > m ? x.filed : m), "");
  const seen = new Set(); let sum = 0;
  for (const x of atEnd.filter((x) => x.filed === lf)) { const k = String(x.val); if (seen.has(k)) continue; seen.add(k); sum += x.val; }
  return sum || null;
}

/** Shares outstanding as-of: cover-page classes → weighted-avg diluted/basic → us-gaap classes. */
function sharesAsOf(fj, asOf) {
  const dei = sumInstantShares(facts(fj, "EntityCommonStockSharesOutstanding", "dei"), asOf);
  if (dei) return dei;
  for (const tag of ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]) {
    const q = quarters(facts(fj, tag), asOf, "shares");
    if (q.length) return q[0].val;
  }
  return sumInstantShares(facts(fj, "CommonStockSharesOutstanding"), asOf);
}

const REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "InterestAndDividendIncomeOperating"];
const NI = ["NetIncomeLoss"];
const GP = ["GrossProfit"];
const COST = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"];
const OI = ["OperatingIncomeLoss"];
const DA = ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"];
const INT = ["InterestExpense", "InterestExpenseDebt", "InterestAndDebtExpense"];
const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
const CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];

/** Full point-in-time fundamentals for `cik` as known on `asOf` (YYYY-MM-DD). */
export async function fundamentalsAsOf(cik, asOf) {
  const fj = await companyFacts(cik);
  if (!fj) return null;
  const F = (tags, skip = 0) => flowTTM(fj, tags, asOf, skip);
  const I = (tags, tax, unit) => instTag(fj, tags, asOf, tax, unit);

  const rev = F(REV), revP = F(REV, 4), ni = F(NI), niP = F(NI, 4);
  let gp = F(GP);
  const cost = F(COST);
  if (gp == null && rev != null && cost != null) gp = { val: rev.val - cost.val };
  const oi = F(OI), da = F(DA), intp = F(INT), ocf = F(OCF), capex = F(CAPEX);

  const equity = I(["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]);
  const ltd = I(["LongTermDebtNoncurrent", "LongTermDebt"]);
  const ltdC = I(["LongTermDebtCurrent", "DebtCurrent"]);

  return {
    revTTM: rev?.val ?? null, revPrevTTM: revP?.val ?? null,
    niTTM: ni?.val ?? null, niPrevTTM: niP?.val ?? null,
    gpTTM: gp?.val ?? null, oiTTM: oi?.val ?? null,
    daTTM: da?.val ?? null, interestTTM: intp?.val != null ? Math.abs(intp.val) : null,
    ocfTTM: ocf?.val ?? null, capexTTM: capex?.val != null ? Math.abs(capex.val) : null,
    assets: I(["Assets"]), equity,
    curA: I(["AssetsCurrent"]), curL: I(["LiabilitiesCurrent"]),
    cash: I(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
    debt: (ltd ?? 0) + (ltdC ?? 0),
    // Fase 7 additions for the quality/credit rankers (Altman Z, DuPont 5-factor).
    retainedEarnings: I(["RetainedEarningsAccumulatedDeficit"]),
    pretaxIncome: F(["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"])?.val ?? null,
    shares: sharesAsOf(fj, asOf),
    asOfLatestFiling: rev?.latestFiled ?? ni?.latestFiled ?? null,
  };
}
