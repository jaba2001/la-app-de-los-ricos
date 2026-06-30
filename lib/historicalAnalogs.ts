/**
 * Curated library of historical macro regimes/episodes used by the Historical Analog
 * feature (lib/historicalMatch.ts) to compare today's macro_state composites against
 * past periods and surface "what happened then / what followed" context.
 *
 * Composite values below are historically-informed estimates calibrated to match
 * classifyRegime()'s thresholds (ic-proxy/lib/macro.js) for the assigned regime — not
 * recomputed from archived FRED data. Treat as directional/educational, not as precise
 * backtested figures.
 *
 * Sector names match the SECTOR_ETF / SECTOR_PE_BM keys in lib/scoring.ts so the macro<->
 * micro cross-reference in historicalMatch.ts is a plain set-membership check.
 *
 * If this library needs to grow large or be edited outside a deploy (e.g. by a non-engineer),
 * promote it to a Supabase table with the same shape — all consumers import only
 * HISTORICAL_ANALOGS from this one file, so the swap is isolated here.
 */

export interface HistoricalAnalog {
  id: string;
  label: string;
  dateRange: string;
  regimeId: "expansion" | "reflation" | "stagflation" | "contraction" | "neutral";
  composites: {
    liquidity_cycle: number;
    credit_stress: number;
    recession_prob: number;
    geopolitical_risk: number;
    housing_stress: number;
  };
  narrative: {
    trigger: string;
    context: string;
    whatHappenedNext: string;
  };
  marketImpact: {
    spyDrawdownPct: number | null;
    durationMonths: number | null;
    recoveryMonths: number | null;
  };
  sectorImpact: {
    outperformers: string[];
    underperformers: string[];
  };
}

export const HISTORICAL_ANALOGS: HistoricalAnalog[] = [
  {
    id: "gfc-2008",
    label: "2008 Global Financial Crisis",
    dateRange: "Sep 2008 – Mar 2009",
    regimeId: "contraction",
    composites: { liquidity_cycle: 25, credit_stress: 92, recession_prob: 85, geopolitical_risk: 35, housing_stress: 88 },
    narrative: {
      trigger: "Lehman Brothers collapse exposed systemic leverage in mortgage-backed securities and the shadow banking system.",
      context: "A housing bubble built over years of subprime lending unwound rapidly once securitized credit froze. Interbank lending seized up, money-market funds broke the buck, and the Fed/Treasury moved to emergency liquidity facilities and bank recapitalization.",
      whatHappenedNext: "Equities bottomed in March 2009 after a ~55% peak-to-trough drawdown. The subsequent recovery was slow and multi-year, but laid the groundwork for the longest bull market on record once QE took hold.",
    },
    marketImpact: { spyDrawdownPct: -55, durationMonths: 17, recoveryMonths: 49 },
    sectorImpact: {
      outperformers: ["Utilities", "Consumer Defensive", "Healthcare"],
      underperformers: ["Financials", "Consumer Cyclical", "Real Estate"],
    },
  },
  {
    id: "eurozone-2011",
    label: "2011 Eurozone Debt Crisis",
    dateRange: "Jul 2011 – Oct 2011",
    regimeId: "stagflation",
    composites: { liquidity_cycle: 45, credit_stress: 70, recession_prob: 55, geopolitical_risk: 45, housing_stress: 40 },
    narrative: {
      trigger: "Sovereign-debt fears around Greece, Portugal, Ireland, Italy and Spain raised the risk of a Eurozone banking/currency crisis.",
      context: "Contagion concerns spread to European banks holding peripheral sovereign debt; the US lost its AAA credit rating from S&P in the same window, compounding risk-off sentiment globally.",
      whatHappenedNext: "ECB's later 'whatever it takes' commitment (2012) eventually calmed the crisis. US equities recovered within months — sharp but contained relative to 2008.",
    },
    marketImpact: { spyDrawdownPct: -19, durationMonths: 3, recoveryMonths: 5 },
    sectorImpact: {
      outperformers: ["Utilities", "Consumer Defensive"],
      underperformers: ["Financials", "Industrials"],
    },
  },
  {
    id: "taper-tantrum-2013",
    label: "2013 Taper Tantrum",
    dateRange: "May 2013 – Sep 2013",
    regimeId: "reflation",
    composites: { liquidity_cycle: 55, credit_stress: 35, recession_prob: 25, geopolitical_risk: 25, housing_stress: 30 },
    narrative: {
      trigger: "Fed Chair Bernanke signaled the central bank could begin tapering QE asset purchases sooner than markets expected.",
      context: "This was a rates/liquidity-expectations shock rather than a credit or recession event — the real economy was fine, but bond markets repriced the path of future Fed policy violently.",
      whatHappenedNext: "Equities wobbled but stayed resilient (single-digit drawdown); the real damage was concentrated in long-duration bonds and emerging markets, which saw sharp capital outflows.",
    },
    marketImpact: { spyDrawdownPct: -6, durationMonths: 2, recoveryMonths: 2 },
    sectorImpact: {
      outperformers: ["Financials", "Energy"],
      underperformers: ["Real Estate", "Utilities"],
    },
  },
  {
    id: "china-oil-2015",
    label: "2015–16 China Devaluation & Oil Crash",
    dateRange: "Aug 2015 – Feb 2016",
    regimeId: "stagflation",
    composites: { liquidity_cycle: 48, credit_stress: 55, recession_prob: 45, geopolitical_risk: 40, housing_stress: 30 },
    narrative: {
      trigger: "China's surprise yuan devaluation rattled global growth expectations just as oil prices collapsed on oversupply (shale boom + OPEC non-cuts).",
      context: "Fears of a China-led global slowdown combined with energy-sector credit stress (high-yield energy bonds sold off sharply) to produce a broad but ultimately contained risk-off episode.",
      whatHappenedNext: "Markets stabilized once oil bottomed (~$26/bbl, Feb 2016) and Chinese policymakers signaled support; no US recession materialized.",
    },
    marketImpact: { spyDrawdownPct: -13, durationMonths: 6, recoveryMonths: 4 },
    sectorImpact: {
      outperformers: ["Consumer Cyclical", "Technology"],
      underperformers: ["Energy", "Materials"],
    },
  },
  {
    id: "q4-2018",
    label: "2018 Q4 Selloff",
    dateRange: "Oct 2018 – Dec 2018",
    regimeId: "contraction",
    composites: { liquidity_cycle: 30, credit_stress: 50, recession_prob: 50, geopolitical_risk: 40, housing_stress: 35 },
    narrative: {
      trigger: "The Fed continued hiking and running QT into visible signs of slowing global growth and an escalating US-China trade war.",
      context: "Markets priced in a policy mistake — tightening into a slowdown — amplified by thin December liquidity and systematic/quant deleveraging.",
      whatHappenedNext: "The Fed pivoted dovish in January 2019 (the 'Powell pivot'), and equities staged a fast V-shaped recovery.",
    },
    marketImpact: { spyDrawdownPct: -19, durationMonths: 3, recoveryMonths: 4 },
    sectorImpact: {
      outperformers: ["Utilities", "Consumer Defensive"],
      underperformers: ["Technology", "Consumer Cyclical"],
    },
  },
  {
    id: "covid-2020",
    label: "2020 COVID Crash",
    dateRange: "Feb 2020 – Mar 2020",
    regimeId: "contraction",
    composites: { liquidity_cycle: 20, credit_stress: 80, recession_prob: 95, geopolitical_risk: 60, housing_stress: 25 },
    narrative: {
      trigger: "Global COVID-19 lockdowns triggered an abrupt, simultaneous demand and supply shock across the entire economy.",
      context: "This was the fastest bear market on record — a liquidity and growth shock hitting at once. The Fed and Treasury responded within weeks with emergency rate cuts, unlimited QE, and direct fiscal support, an unusually fast liquidity reversal.",
      whatHappenedNext: "Markets bottomed in just over a month and staged the fastest recovery on record, fueled by emergency liquidity and fiscal stimulus — note the liquidity composite would have V-shaped given the speed of the Fed's response.",
    },
    marketImpact: { spyDrawdownPct: -34, durationMonths: 1, recoveryMonths: 5 },
    sectorImpact: {
      outperformers: ["Technology", "Healthcare"],
      underperformers: ["Energy", "Financials", "Real Estate"],
    },
  },
  {
    id: "inflation-surge-2021",
    label: "2021–22 Inflation Surge",
    dateRange: "Early 2021 – Mid 2022",
    regimeId: "reflation",
    composites: { liquidity_cycle: 60, credit_stress: 35, recession_prob: 30, geopolitical_risk: 45, housing_stress: 45 },
    narrative: {
      trigger: "Post-COVID fiscal stimulus, supply-chain disruption, and pent-up demand combined to push inflation to 40-year highs.",
      context: "The Fed initially characterized inflation as 'transitory' before reversing course; this period bridges an easy-liquidity reflation regime into the tightening cycle that followed.",
      whatHappenedNext: "Energy and commodities surged on the inflation/supply story while long-duration growth equities began derating as real yields rose — the bridge into the 2022 bear market.",
    },
    marketImpact: { spyDrawdownPct: null, durationMonths: null, recoveryMonths: null },
    sectorImpact: {
      outperformers: ["Energy", "Materials"],
      underperformers: ["Technology", "Communication Services"],
    },
  },
  {
    id: "rate-hike-bear-2022",
    label: "2022 Rate-Hike Bear Market",
    dateRange: "Jan 2022 – Oct 2022",
    regimeId: "stagflation",
    composites: { liquidity_cycle: 22, credit_stress: 55, recession_prob: 50, geopolitical_risk: 55, housing_stress: 60 },
    narrative: {
      trigger: "The Fed launched its fastest hiking cycle in decades to fight persistent inflation, simultaneously running aggressive QT.",
      context: "Liquidity contracted sharply (LCC collapsing) while inflation stayed elevated — the textbook stagflationary backdrop. Russia's invasion of Ukraine in February added a geopolitical/energy shock on top.",
      whatHappenedNext: "Equities bottomed in October 2022 once inflation showed signs of peaking and the market began pricing a slower hiking pace; Energy was the only S&P sector to post a positive return for the full year.",
    },
    marketImpact: { spyDrawdownPct: -25, durationMonths: 9, recoveryMonths: 9 },
    sectorImpact: {
      outperformers: ["Energy"],
      underperformers: ["Technology", "Communication Services"],
    },
  },
  {
    id: "svb-2023",
    label: "2023 SVB / Regional Banking Crisis",
    dateRange: "Mar 2023 – May 2023",
    regimeId: "neutral",
    composites: { liquidity_cycle: 50, credit_stress: 65, recession_prob: 40, geopolitical_risk: 30, housing_stress: 35 },
    narrative: {
      trigger: "Silicon Valley Bank's collapse — driven by unrealized losses on long-duration bonds amid rapid rate hikes plus a concentrated, uninsured deposit base — triggered a regional-bank confidence crisis.",
      context: "Unlike 2008, this was a narrow, contained credit-stress spike within an otherwise neutral-to-expansion macro backdrop: the broader economy and large-bank balance sheets were not impaired the way they were in the GFC.",
      whatHappenedNext: "Swift FDIC/Fed intervention (Bank Term Funding Program) contained contagion. The selloff was sharp but narrow — regional banks were hit hard while mega-cap tech, helped by an emerging AI narrative and flight-to-quality flows, kept rising. A useful 'false-alarm vs. 2008' contrast case despite surface similarity.",
    },
    marketImpact: { spyDrawdownPct: -8, durationMonths: 1, recoveryMonths: 2 },
    sectorImpact: {
      outperformers: ["Technology", "Communication Services"],
      underperformers: ["Financials", "Real Estate"],
    },
  },
  {
    id: "ai-melt-up-2023-24",
    label: "2023–24 AI-Led Melt-Up",
    dateRange: "2023 – 2024",
    regimeId: "expansion",
    composites: { liquidity_cycle: 65, credit_stress: 25, recession_prob: 20, geopolitical_risk: 35, housing_stress: 35 },
    narrative: {
      trigger: "Generative-AI capex and earnings momentum (led by a handful of mega-cap names) drove a narrow but powerful equity rally as inflation cooled and rate-cut expectations built.",
      context: "A genuinely benign expansion regime — included deliberately so the analog library isn't structurally skewed toward only ever surfacing crisis comparisons. Liquidity conditions eased, credit stayed calm, and recession fears receded even as leadership concentrated heavily in Technology and Communication Services.",
      whatHappenedNext: "Index-level gains were strong but narrow; breadth lagged the headline indices, a dynamic worth flagging whenever this regime is the closest match.",
    },
    marketImpact: { spyDrawdownPct: null, durationMonths: null, recoveryMonths: null },
    sectorImpact: {
      outperformers: ["Technology", "Communication Services"],
      underperformers: ["Utilities", "Real Estate"],
    },
  },
];
