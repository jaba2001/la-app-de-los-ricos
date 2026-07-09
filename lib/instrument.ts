// ─────────────────────────────────────────────────────────────────────────────
// Instrument classifier (Phase 1) — routes the stock page to the right analysis by
// asset class. A metal, a bond ETF or a broad ETF is NOT valued with P/E or ROE; it's
// read by momentum + regime + its own macro drivers. The Nav search already routes any
// ticker to /stock/{ticker}; this decides which panel that page shows.
// ─────────────────────────────────────────────────────────────────────────────

export type InstrumentType = "equity" | "bond-etf" | "metal" | "commodity" | "broad-etf" | "sector-etf";

// A macro driver for the instrument's tilt. `good` = the direction that is favorable for
// the instrument; `field` = the macro_state column to read (string; read defensively).
export interface MacroDriver { label: string; good: "low" | "high"; field: string; unit?: string; }

export interface Instrument {
  type: InstrumentType;
  isEquity: boolean;
  label: string;      // "Gold", "Long Treasuries", "Broad equity ETF"…
  assetClass: string; // "Metals" · "Fixed income" · "Commodities" · "Equity index" · "Sector equity"
  drivers: MacroDriver[];
  note: string;
}

// ── curated maps (ticker → subtype) ──────────────────────────────────────────
const GOLD = new Set(["GLD","IAU","GLDM","SGOL","BAR","AAAU","OUNZ","IAUM"]);
const SILVER = new Set(["SLV","SIVR"]);
const PLATINUM = new Set(["PPLT"]); const PALLADIUM = new Set(["PALL"]);
const COPPER = new Set(["CPER","COPX"]);
const PRECIOUS = new Set(["DBP","GLTR"]);
const MINERS = new Set(["GDX","GDXJ","SIL","SILJ","REMX","NUGT"]); // equity ETFs, metal-driven

const OIL = new Set(["USO","BNO","USL","OILK","DBO"]);
const GAS = new Set(["UNG","UGA","BOIL","KOLD"]);
const AGS = new Set(["DBA","CORN","WEAT","SOYB","CANE","NIB","JO"]);
const BASE = new Set(["DBB"]);
const BROAD_COMMOD = new Set(["DBC","PDBC","GSG","DJP","COMT","USCI","FTGC","BCI"]);

const TREASURY = new Set(["SHY","IEI","IEF","TLT","TLH","GOVT","VGSH","VGIT","VGLT","EDV","SCHO","SCHR","SPTL","SPTS","GBIL","BIL","SGOV","SHV","USFR"]);
const IG_CREDIT = new Set(["LQD","VCIT","VCSH","IGIB","SPIB","IGSB","USIG"]);
const HY_CREDIT = new Set(["HYG","JNK","SHYG","USHY","SPHY","ANGL","FALN"]);
const TIPS = new Set(["TIP","VTIP","SCHP","STIP","LTPZ"]);
const AGG_BOND = new Set(["AGG","BND","BNDX","IUSB","BIV","BLV","BSV","FBND","SPAB"]);
const MUNI = new Set(["MUB","VTEB","TFI","HYD","SUB"]);
const EM_BOND = new Set(["EMB","PCY","EMLC","VWOB"]);
const MBS = new Set(["MBB","VMBS","SPMB"]);

const SP = new Set(["SPY","VOO","IVV","SPLG","RSP","SPMO"]);
const NDX = new Set(["QQQ","QQQM","QQQE"]);
const DOW = new Set(["DIA"]);
const SMALL = new Set(["IWM","IJR","VB","VTWO","SCHA"]);
const TOTAL = new Set(["VTI","ITOT","SCHB"]);
const GLOBAL = new Set(["VT","ACWI","URTH"]);
const INTL = new Set(["VEA","EFA","IEFA","SCHF","VXUS","IXUS","SPDW"]);
const EM = new Set(["VWO","EEM","IEMG","SPEM","SCHE"]);

const SECTOR = new Set(["XLK","XLF","XLE","XLV","XLI","XLP","XLY","XLB","XLU","XLRE","XLC","VGT","VFH","VDE","VHT","VIS","VDC","VCR","VAW","VPU","SMH","SOXX","ARKK","URA","ICLN","TAN","XBI","IBB","KRE","ITB","JETS","XME","XOP","VNQ","IYR","KWEB","FDN","IGV","HACK","BOTZ","LIT","XHB","XRT","OIH","FCG","PAVE","IHI","XAR"]);

// driver presets
const D_GOLD: MacroDriver[] = [{label:"Real 10y yield",good:"low",field:"real_yield_10y",unit:"%"},{label:"US Dollar (DXY)",good:"low",field:"dxy"},{label:"Liquidity cycle",good:"high",field:"liquidity_cycle"}];
const D_METAL: MacroDriver[] = [{label:"Real 10y yield",good:"low",field:"real_yield_10y",unit:"%"},{label:"US Dollar (DXY)",good:"low",field:"dxy"}];
const D_COPPER: MacroDriver[] = [{label:"Recession risk",good:"low",field:"recession_prob"},{label:"US Dollar (DXY)",good:"low",field:"dxy"}];
const D_COMMOD: MacroDriver[] = [{label:"Core PCE (inflation)",good:"high",field:"core_pce_yoy",unit:"%"},{label:"US Dollar (DXY)",good:"low",field:"dxy"}];
const D_OIL: MacroDriver[] = [{label:"WTI level",good:"high",field:"wti_level"},{label:"Core PCE (inflation)",good:"high",field:"core_pce_yoy",unit:"%"}];
const D_TREASURY: MacroDriver[] = [{label:"10y yield (falling helps)",good:"low",field:"dgs10",unit:"%"},{label:"Recession risk (bid for duration)",good:"high",field:"recession_prob"}];
const D_HY: MacroDriver[] = [{label:"HY credit spread",good:"low",field:"hy_oas",unit:"bp"},{label:"Recession risk",good:"low",field:"recession_prob"}];
const D_IG: MacroDriver[] = [{label:"10y yield (falling helps)",good:"low",field:"dgs10",unit:"%"},{label:"Credit spread (BBB)",good:"low",field:"bbb_oas",unit:"bp"}];
const D_TIPS: MacroDriver[] = [{label:"Breakeven inflation",good:"high",field:"breakeven_10y",unit:"%"},{label:"Real 10y yield",good:"low",field:"real_yield_10y",unit:"%"}];
const D_RISK: MacroDriver[] = [{label:"Liquidity cycle",good:"high",field:"liquidity_cycle"},{label:"Recession risk",good:"low",field:"recession_prob"}];

function has(sym: string, ...sets: Set<string>[]) { return sets.some((s) => s.has(sym)); }

/** Classify a ticker (+ optional FMP profile) into an instrument. Default = equity. */
export function classifyInstrument(ticker: string, profile?: { isEtf?: boolean; sector?: string; industry?: string } | null): Instrument {
  const t = (ticker || "").toUpperCase();

  // Metals
  if (GOLD.has(t)) return I("metal","Gold","Metals",D_GOLD,"Gold — a real-yield / dollar / liquidity play. Read by momentum and its macro drivers, not fundamentals.");
  if (SILVER.has(t)) return I("metal","Silver","Metals",D_METAL,"Silver — precious metal with an industrial leg.");
  if (PLATINUM.has(t)) return I("metal","Platinum","Metals",D_METAL,"Platinum — precious/industrial metal.");
  if (PALLADIUM.has(t)) return I("metal","Palladium","Metals",D_METAL,"Palladium — auto-catalyst metal.");
  if (COPPER.has(t)) return I("metal","Copper","Metals",D_COPPER,"Copper — the growth/reflation barometer ('Dr. Copper').");
  if (PRECIOUS.has(t)) return I("metal","Precious basket","Metals",D_METAL,"Diversified precious metals.");
  if (MINERS.has(t)) return I("sector-etf","Mining equities","Sector equity",D_GOLD,"Miners — leveraged equity play on the underlying metal.");

  // Commodities
  if (OIL.has(t)) return I("commodity","Crude oil","Commodities",D_OIL,"Oil — energy/inflation exposure.");
  if (GAS.has(t)) return I("commodity","Natural gas","Commodities",D_COMMOD,"Natural gas — highly seasonal energy commodity.");
  if (AGS.has(t)) return I("commodity","Agriculture","Commodities",D_COMMOD,"Ags — inflation-sensitive soft commodities.");
  if (BASE.has(t)) return I("commodity","Base metals","Commodities",D_COPPER,"Base metals — growth-sensitive.");
  if (BROAD_COMMOD.has(t)) return I("commodity","Broad commodities","Commodities",D_COMMOD,"Diversified commodity basket — reflation / inflation hedge.");

  // Fixed income
  if (TREASURY.has(t)) return I("bond-etf","Treasuries","Fixed income",D_TREASURY,"Treasury ETF — duration play; rallies when rates fall / in recession.");
  if (IG_CREDIT.has(t)) return I("bond-etf","IG credit","Fixed income",D_IG,"Investment-grade credit — duration + a modest spread.");
  if (HY_CREDIT.has(t)) return I("bond-etf","High yield","Fixed income",D_HY,"High-yield credit — risk-on; hurt by widening spreads / recession.");
  if (TIPS.has(t)) return I("bond-etf","TIPS","Fixed income",D_TIPS,"Inflation-protected Treasuries — real-yield play.");
  if (AGG_BOND.has(t)) return I("bond-etf","Aggregate bonds","Fixed income",D_TREASURY,"Broad aggregate bond — duration + credit blend.");
  if (MUNI.has(t)) return I("bond-etf","Munis","Fixed income",D_TREASURY,"Municipal bonds — tax-exempt duration.");
  if (EM_BOND.has(t)) return I("bond-etf","EM bonds","Fixed income",D_HY,"Emerging-market debt — risk-on, dollar-sensitive.");
  if (MBS.has(t)) return I("bond-etf","Mortgage-backed","Fixed income",D_TREASURY,"MBS — rate-sensitive with prepayment risk.");

  // Broad equity indices
  if (has(t,SP,NDX,DOW,SMALL,TOTAL)) return I("broad-etf","Broad US equity","Equity index",D_RISK,"Broad US equity index — read by momentum + the regime, not fundamentals.");
  if (has(t,GLOBAL,INTL,EM)) return I("broad-etf","International equity","Equity index",D_RISK,"International/EM equity — dollar- and regime-sensitive.");

  // Sector / theme ETFs
  if (SECTOR.has(t)) return I("sector-etf","Sector / theme ETF","Sector equity",D_RISK,"Sector/theme ETF — momentum + regime; the winning sleeve rotates.");

  // Generic ETF from profile (unknown ticker but flagged as ETF)
  if (profile?.isEtf) return I("broad-etf","ETF","Equity index",D_RISK,"ETF — read by momentum + the regime.");

  // Default: single stock
  return { type:"equity", isEquity:true, label:"Equity", assetClass:"Single stock", drivers:[], note:"" };
}

function I(type: InstrumentType, label: string, assetClass: string, drivers: MacroDriver[], note: string): Instrument {
  return { type, isEquity:false, label, assetClass, drivers, note };
}
