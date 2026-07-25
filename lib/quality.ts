// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTING QUALITY & CREDIT RISK — the classic, free-from-financials scores:
//   • Altman Z / Z'' — distress/bankruptcy.
//   • Accruals ratio (Sloan) — earnings quality.
//   • DuPont (3- and 5-factor) — ROE decomposition.
//   • Merton / KMV distance-to-default + PD — structural credit risk (uses equity vol).
//   • Piotroski F-score (9 tests) — fundamental strength.
//   • Beneish M-score (8 vars) — earnings-manipulation flag.
// All pure & headless (type-only imports) so the app AND the backtest share one code path.
// These are shown in the UI and MEASURED in the backtest; they do NOT feed calcScores.total
// until their IC is validated (the honest, anti-circular gate).
// ─────────────────────────────────────────────────────────────────────────────

const pos = (x: number | null | undefined): x is number => x != null && isFinite(x) && x > 0;
const num = (x: number | null | undefined): x is number => x != null && isFinite(x);

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). Local copy → no coupling. */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// ── Altman Z-score ─────────────────────────────────────────────────────────────
export type ZBand = "safe" | "grey" | "distress";
export interface AltmanResult { z: number; band: ZBand; model: "Z" | "Z''"; }

export interface AltmanInputs {
  workingCapital: number | null;   // current assets − current liabilities
  retainedEarnings: number | null;
  ebit: number | null;
  marketCap: number | null;        // market value of equity
  bookEquity: number | null;       // for Z'' (uses book equity)
  totalLiabilities: number | null;
  sales: number | null;
  totalAssets: number | null;
  serviceOrFinancial?: boolean;    // → use Z'' (no sales term, book equity)
}

export function altmanZ(inp: AltmanInputs): AltmanResult | null {
  const { totalAssets: ta } = inp;
  if (!pos(ta)) return null;
  const X1 = num(inp.workingCapital) ? inp.workingCapital / ta : 0;
  const X2 = num(inp.retainedEarnings) ? inp.retainedEarnings / ta : 0;
  const X3 = num(inp.ebit) ? inp.ebit / ta : 0;

  if (inp.serviceOrFinancial) {
    // Z'' for non-manufacturers / emerging markets — book equity, no sales term.
    if (!pos(inp.totalLiabilities)) return null;
    const X4 = num(inp.bookEquity) ? inp.bookEquity / inp.totalLiabilities : 0;
    const z = 3.25 + 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
    const band: ZBand = z > 2.6 ? "safe" : z >= 1.1 ? "grey" : "distress";
    return { z: Math.round(z * 100) / 100, band, model: "Z''" };
  }
  if (!pos(inp.totalLiabilities)) return null;
  const X4 = num(inp.marketCap) ? inp.marketCap / inp.totalLiabilities : 0;
  const X5 = num(inp.sales) ? inp.sales / ta : 0;
  const z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5;
  const band: ZBand = z > 2.99 ? "safe" : z >= 1.81 ? "grey" : "distress";
  return { z: Math.round(z * 100) / 100, band, model: "Z" };
}

// ── Accruals (Sloan) ───────────────────────────────────────────────────────────
export interface AccrualsResult { ratio: number; quality: "high" | "medium" | "low"; }
/** Cash-flow accruals = (NetIncome − CFO) / TotalAssets. Higher = more accrual-driven
 *  (lower earnings quality; the Sloan accruals anomaly). */
export function accrualsRatio(netIncome: number | null, operatingCashFlow: number | null, totalAssets: number | null): AccrualsResult | null {
  if (!num(netIncome) || !num(operatingCashFlow) || !pos(totalAssets)) return null;
  const ratio = (netIncome - operatingCashFlow) / totalAssets;
  const quality = ratio < 0.05 ? "high" : ratio < 0.10 ? "medium" : "low";
  return { ratio: Math.round(ratio * 1000) / 1000, quality };
}

// ── DuPont ROE decomposition ─────────────────────────────────────────────────────
export interface DupontResult {
  netMargin: number; assetTurnover: number; equityMultiplier: number; roe3: number;
  taxBurden: number | null; interestBurden: number | null; operatingMargin: number | null; roe5: number | null;
}
export interface DupontInputs {
  netIncome: number | null; sales: number | null; totalAssets: number | null; totalEquity: number | null;
  pretaxIncome?: number | null; ebit?: number | null;
}
export function dupont(inp: DupontInputs): DupontResult | null {
  if (!num(inp.netIncome) || !pos(inp.sales) || !pos(inp.totalAssets) || !pos(inp.totalEquity)) return null;
  const netMargin = inp.netIncome / inp.sales;
  const assetTurnover = inp.sales / inp.totalAssets;
  const equityMultiplier = inp.totalAssets / inp.totalEquity;
  const roe3 = netMargin * assetTurnover * equityMultiplier;
  let taxBurden: number | null = null, interestBurden: number | null = null, operatingMargin: number | null = null, roe5: number | null = null;
  if (num(inp.pretaxIncome) && inp.pretaxIncome !== 0 && pos(inp.ebit)) {
    taxBurden = inp.netIncome / inp.pretaxIncome;
    interestBurden = inp.pretaxIncome / inp.ebit;
    operatingMargin = inp.ebit / inp.sales;
    roe5 = taxBurden * interestBurden * operatingMargin * assetTurnover * equityMultiplier;
  }
  const r = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    netMargin: r(netMargin)!, assetTurnover: r(assetTurnover)!, equityMultiplier: r(equityMultiplier)!, roe3: r(roe3)!,
    taxBurden: r(taxBurden), interestBurden: r(interestBurden), operatingMargin: r(operatingMargin), roe5: r(roe5),
  };
}

// ── Merton / KMV distance-to-default + PD (naive Bharath-Shumway) ─────────────────
export interface MertonResult { distanceToDefault: number; pd: number; assetVol: number; }
export interface MertonInputs {
  marketCap: number | null;     // equity value E
  totalDebt: number | null;     // default point F
  equityVol: number | null;     // annualized σ_E (from returns)
  riskFreePct: number | null;   // % (e.g., 4.2)
  years?: number;               // horizon (default 1)
}
export function mertonPD(inp: MertonInputs): MertonResult | null {
  const E = inp.marketCap, F = inp.totalDebt, sE = inp.equityVol;
  if (!pos(E) || !num(F) || F <= 0 || !pos(sE)) return null;
  const T = inp.years ?? 1;
  const rf = (num(inp.riskFreePct) ? inp.riskFreePct : 4) / 100;
  const V = E + F;                                   // naive asset value
  const sV = (E / V) * sE + (F / V) * (0.05 + 0.25 * sE); // naive asset vol
  if (!pos(sV)) return null;
  const dd = (Math.log(V / F) + (rf - 0.5 * sV * sV) * T) / (sV * Math.sqrt(T));
  const pd = normCdf(-dd);
  return { distanceToDefault: Math.round(dd * 100) / 100, pd: Math.round(pd * 10000) / 10000, assetVol: Math.round(sV * 1000) / 1000 };
}

/** Expected credit loss = PD × EAD × LGD (LGD = 1 − recovery). */
export function expectedCreditLoss(pd: number, ead: number, lgd = 0.6): number {
  return pd * ead * lgd;
}

// ── Piotroski F-score (0-9) ──────────────────────────────────────────────────────
export interface PiotroskiInputs {
  roa: number | null; roaPrev: number | null;
  cfo: number | null; netIncome: number | null; totalAssets: number | null;
  leverage: number | null; leveragePrev: number | null;     // LTD / assets
  currentRatio: number | null; currentRatioPrev: number | null;
  shares: number | null; sharesPrev: number | null;
  grossMargin: number | null; grossMarginPrev: number | null;
  assetTurnover: number | null; assetTurnoverPrev: number | null;
}
export interface PiotroskiResult { score: number; max: number; }
/** F-score over the tests for which both current & prior data exist (max scales down). */
export function piotroskiF(inp: PiotroskiInputs): PiotroskiResult | null {
  const tests: (boolean | null)[] = [
    num(inp.roa) ? inp.roa > 0 : null,                                        // 1 ROA>0
    num(inp.cfo) ? inp.cfo > 0 : null,                                        // 2 CFO>0
    num(inp.roa) && num(inp.roaPrev) ? inp.roa > inp.roaPrev : null,          // 3 ΔROA>0
    num(inp.cfo) && num(inp.netIncome) ? inp.cfo > inp.netIncome : null,      // 4 accrual: CFO>NI
    num(inp.leverage) && num(inp.leveragePrev) ? inp.leverage < inp.leveragePrev : null,   // 5 leverage down
    num(inp.currentRatio) && num(inp.currentRatioPrev) ? inp.currentRatio > inp.currentRatioPrev : null, // 6 liquidity up
    num(inp.shares) && num(inp.sharesPrev) ? inp.shares <= inp.sharesPrev * 1.001 : null,   // 7 no dilution
    num(inp.grossMargin) && num(inp.grossMarginPrev) ? inp.grossMargin > inp.grossMarginPrev : null,     // 8 margin up
    num(inp.assetTurnover) && num(inp.assetTurnoverPrev) ? inp.assetTurnover > inp.assetTurnoverPrev : null, // 9 turnover up
  ];
  const present = tests.filter((t) => t !== null) as boolean[];
  if (present.length === 0) return null;
  return { score: present.filter(Boolean).length, max: present.length };
}

// ── Beneish M-score (manipulation) ───────────────────────────────────────────────
export interface BeneishInputs {
  receivables: number | null; receivablesPrev: number | null;
  sales: number | null; salesPrev: number | null;
  grossProfit: number | null; grossProfitPrev: number | null;
  totalAssets: number | null; totalAssetsPrev: number | null;
  currentAssets: number | null; currentAssetsPrev: number | null;
  ppe: number | null; ppePrev: number | null;
  depreciation: number | null; depreciationPrev: number | null;
  sga: number | null; sgaPrev: number | null;
  totalDebt: number | null; totalDebtPrev: number | null;
  netIncome: number | null; operatingCashFlow: number | null;
}
export interface BeneishResult { m: number; flag: "likely" | "unlikely"; }
/** 8-variable Beneish M. M > −1.78 → likely manipulator. Returns null if inputs incomplete. */
export function beneishM(i: BeneishInputs): BeneishResult | null {
  const need = [i.receivables, i.receivablesPrev, i.sales, i.salesPrev, i.grossProfit, i.grossProfitPrev,
    i.totalAssets, i.totalAssetsPrev, i.currentAssets, i.currentAssetsPrev, i.ppe, i.ppePrev,
    i.depreciation, i.depreciationPrev, i.sga, i.sgaPrev, i.totalDebt, i.totalDebtPrev, i.netIncome, i.operatingCashFlow];
  if (need.some((x) => !num(x))) return null;
  if (!pos(i.sales) || !pos(i.salesPrev) || !pos(i.totalAssets) || !pos(i.totalAssetsPrev)) return null;
  const DSRI = (i.receivables! / i.sales!) / (i.receivablesPrev! / i.salesPrev!);
  const GMI = (i.grossProfitPrev! / i.salesPrev!) / (i.grossProfit! / i.sales!);
  const aqiNow = 1 - (i.currentAssets! + i.ppe!) / i.totalAssets!;
  const aqiPrev = 1 - (i.currentAssetsPrev! + i.ppePrev!) / i.totalAssetsPrev!;
  const AQI = aqiPrev !== 0 ? aqiNow / aqiPrev : 1;
  const SGI = i.sales! / i.salesPrev!;
  const depNow = i.depreciation! / (i.depreciation! + i.ppe!);
  const depPrev = i.depreciationPrev! / (i.depreciationPrev! + i.ppePrev!);
  const DEPI = depNow !== 0 ? depPrev / depNow : 1;
  const SGAI = (i.sga! / i.sales!) / (i.sgaPrev! / i.salesPrev!);
  const LVGI = (i.totalDebt! / i.totalAssets!) / (i.totalDebtPrev! / i.totalAssetsPrev!);
  const TATA = (i.netIncome! - i.operatingCashFlow!) / i.totalAssets!;
  const m = -4.84 + 0.92 * DSRI + 0.528 * GMI + 0.404 * AQI + 0.892 * SGI + 0.115 * DEPI - 0.172 * SGAI + 4.679 * TATA - 0.327 * LVGI;
  return { m: Math.round(m * 100) / 100, flag: m > -1.78 ? "likely" : "unlikely" };
}

// ── Top-level assembler ──────────────────────────────────────────────────────────
export interface QualityScores {
  altman: AltmanResult | null;
  accruals: AccrualsResult | null;
  dupont: DupontResult | null;
  merton: MertonResult | null;
  piotroski: PiotroskiResult | null;
  beneish: BeneishResult | null;
}
export interface QualityInputs {
  altman?: AltmanInputs;
  accruals?: { netIncome: number | null; operatingCashFlow: number | null; totalAssets: number | null };
  dupont?: DupontInputs;
  merton?: MertonInputs;
  piotroski?: PiotroskiInputs;
  beneish?: BeneishInputs;
}
export function computeQuality(inp: QualityInputs): QualityScores {
  return {
    altman: inp.altman ? altmanZ(inp.altman) : null,
    accruals: inp.accruals ? accrualsRatio(inp.accruals.netIncome, inp.accruals.operatingCashFlow, inp.accruals.totalAssets) : null,
    dupont: inp.dupont ? dupont(inp.dupont) : null,
    merton: inp.merton ? mertonPD(inp.merton) : null,
    piotroski: inp.piotroski ? piotroskiF(inp.piotroski) : null,
    beneish: inp.beneish ? beneishM(inp.beneish) : null,
  };
}
