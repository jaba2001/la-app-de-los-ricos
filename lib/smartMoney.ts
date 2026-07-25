// Smart Money signal — turns the insider / 13-F / Congress data the app ALREADY fetches
// into TradeVision-style actionable buckets + a single net bullish/bearish read.
// Pure & data-only (no new network calls, no paid feed): honest "smart money" on free data.

export interface SmartMoneyHighlight {
  label: string;
  detail: string;
  tone: "pos" | "neg" | "neu";
}

export interface SmartMoneySignal {
  netScore: number;                 // -100 (bearish) … +100 (bullish)
  label: "Bullish" | "Neutral" | "Bearish";
  color: string;                    // css var for the label
  conviction: "High" | "Medium" | "Low";
  insider: {
    buyCount: number;
    sellCount: number;
    netShares: number;              // signed
    netUsd: number | null;          // signed, only when transactionPrice present
    distinctBuyers: number;
    clusterBuy: boolean;            // ≥3 distinct insiders bought → strong signal
  };
  congress: { buyCount: number; sellCount: number };
  highlights: SmartMoneyHighlight[];
  sampleSize: number;               // total transactions considered (drives conviction)
}

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Non-open-market SEC transaction codes that are NOT conviction signals and must be excluded
// from the "smart money" read: A=grant/award, M=option exercise, F=tax withholding in shares,
// G=gift, C=conversion, D=disposition to issuer, X=option exercise, W=inheritance, etc.
const NON_MARKET_CODES = new Set(["A", "M", "F", "G", "C", "D", "X", "W", "I", "J", "L", "Z"]);

/**
 * Open-market buy/sell classification for the SIGNAL. Only true open-market purchases (code P)
 * and sales (code S) count — grants, option exercises, gifts and tax-withholding are excluded
 * because they carry no directional conviction. Falls back to transaction-type text ONLY when
 * no code is present and the text is unambiguous (and not an option/grant/award).
 */
function insiderKind(t: Row): "buy" | "sell" | null {
  const code = ((t.transactionCode as string) ?? "").toUpperCase().trim();
  if (code === "P") return "buy";
  if (code === "S") return "sell";
  if (code && NON_MARKET_CODES.has(code)) return null;      // explicit non-market → ignore
  if (code) return null;                                     // any other known code → ignore
  // No code: use text only if unambiguous and not an option/grant/award/gift.
  const type = ((t.transactionType as string) ?? "").toLowerCase();
  if (/(option|exercise|grant|award|gift|convert|withhold)/.test(type)) return null;
  if (type.includes("purchase") || type.includes("buy")) return "buy";
  if (type.includes("sale") || type.includes("sell")) return "sell";
  return null;
}

/** Congress amount ranges arrive as "$1,001 - $15,000"; take the upper bound as scale. */
function parseAmountUpper(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const nums = v.replace(/[,$]/g, "").match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function computeSmartMoneySignal(insiders: Row[], congress: Row[]): SmartMoneySignal {
  // ── Insiders ──────────────────────────────────────────────────────────
  let buyCount = 0, sellCount = 0, netShares = 0, netUsd = 0, sawPrice = false;
  const distinctBuyerSet = new Set<string>();
  let largestBuy: { name: string; usd: number | null; shares: number } | null = null;
  let largestSell: { name: string; usd: number | null; shares: number } | null = null;

  for (const t of insiders) {
    const kind = insiderKind(t);
    if (!kind) continue;                 // skip grants / option exercises / gifts / etc.
    const isBuy = kind === "buy";
    const shares = Math.abs(num(t.change) ?? num(t.share) ?? 0);
    const price = num(t.transactionPrice);
    const usd = price != null ? shares * price : null;
    if (usd != null) { sawPrice = true; netUsd += isBuy ? usd : -usd; }
    netShares += isBuy ? shares : -shares;
    const name = ((t.reportingName ?? t.name) as string) ?? "insider";
    if (isBuy) {
      buyCount++;
      distinctBuyerSet.add(name.toLowerCase());
      if (!largestBuy || (usd ?? shares) > (largestBuy.usd ?? largestBuy.shares)) largestBuy = { name, usd, shares };
    } else {
      sellCount++;
      if (!largestSell || (usd ?? shares) > (largestSell.usd ?? largestSell.shares)) largestSell = { name, usd, shares };
    }
  }
  const distinctBuyers = distinctBuyerSet.size;
  const clusterBuy = distinctBuyers >= 3;

  // ── Congress ──────────────────────────────────────────────────────────
  let cBuy = 0, cSell = 0;
  let largestCongress: { amount: number; type: string } | null = null;
  for (const t of congress) {
    const type = (((t.type ?? t.transactionType) as string) ?? "").toLowerCase();
    const isBuy = type.includes("purchase") || type.includes("buy");
    const isSell = type.includes("sale") || type.includes("sell");
    if (isBuy) cBuy++; else if (isSell) cSell++; else continue;
    const amt = parseAmountUpper(t.amount);
    if (amt != null && (!largestCongress || amt > largestCongress.amount)) {
      largestCongress = { amount: amt, type: isBuy ? "purchase" : "sale" };
    }
  }

  // ── Net score (-100…100) ──────────────────────────────────────────────
  const insiderTotal = buyCount + sellCount;
  let insiderRaw = 0;
  if (insiderTotal > 0) {
    insiderRaw = ((buyCount - sellCount) / insiderTotal) * 55;
    if (clusterBuy) insiderRaw += 20;
    if (sawPrice) insiderRaw += Math.sign(netUsd) * 10;
  }
  const congressTotal = cBuy + cSell;
  const congressRaw = congressTotal > 0 ? ((cBuy - cSell) / congressTotal) * 35 : 0;
  const netScore = Math.round(clamp(insiderRaw + congressRaw, -100, 100));

  const label: SmartMoneySignal["label"] = netScore >= 25 ? "Bullish" : netScore <= -25 ? "Bearish" : "Neutral";
  const color = netScore >= 25 ? "var(--sr-pos)" : netScore <= -25 ? "var(--sr-neg)" : "var(--sr-text-3)";

  const sampleSize = insiderTotal + congressTotal;
  const conviction: SmartMoneySignal["conviction"] =
    sampleSize >= 8 && Math.abs(netScore) >= 40 ? "High" :
    sampleSize >= 3 && Math.abs(netScore) >= 20 ? "Medium" : "Low";

  // ── Buckets / highlights ──────────────────────────────────────────────
  const fmtUsd = (u: number) => u >= 1e6 ? `$${(u / 1e6).toFixed(1)}M` : u >= 1e3 ? `$${(u / 1e3).toFixed(0)}K` : `$${u.toFixed(0)}`;
  const highlights: SmartMoneyHighlight[] = [];

  if (clusterBuy) highlights.push({ label: "Cluster buy", tone: "pos", detail: `${distinctBuyers} distinct insiders bought — the strongest open-market signal.` });
  if (largestBuy) highlights.push({ label: "Top insider buy", tone: "pos", detail: `${largestBuy.name} — ${largestBuy.usd != null ? fmtUsd(largestBuy.usd) : `${largestBuy.shares.toLocaleString()} sh`}.` });
  if (largestSell) highlights.push({ label: "Top insider sell", tone: "neg", detail: `${largestSell.name} — ${largestSell.usd != null ? fmtUsd(largestSell.usd) : `${largestSell.shares.toLocaleString()} sh`}.` });
  if (largestCongress) highlights.push({ label: "Congress activity", tone: largestCongress.type === "purchase" ? "pos" : "neg", detail: `Largest disclosure ≈ ${fmtUsd(largestCongress.amount)} ${largestCongress.type}.` });
  if (highlights.length === 0) highlights.push({ label: "No smart-money signal", tone: "neu", detail: "No recent insider or congressional activity for this name." });

  return {
    netScore, label, color, conviction,
    insider: { buyCount, sellCount, netShares, netUsd: sawPrice ? netUsd : null, distinctBuyers, clusterBuy },
    congress: { buyCount: cBuy, sellCount: cSell },
    highlights,
    sampleSize,
  };
}
