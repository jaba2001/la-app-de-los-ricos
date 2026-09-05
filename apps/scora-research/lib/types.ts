/* ── Macro State (from Supabase macro_state table) ── */
export interface MacroState {
  id: number;
  snapshot_date: string;
  updated_at: string;
  /* Composites */
  liquidity_cycle: number | null;
  recession_prob: number | null;
  credit_stress: number | null;
  geopolitical_risk: number | null;
  housing_stress: number | null;
  /* Liquidity-led risk-on gauge (0-100) for the multi-asset allocator. Optional: when
     the cron doesn't populate it, the app derives it from the composites above. */
  risk_on?: number | null;
  /* Stationary drivers of risk_on (0-100 percentiles) — for the Regime Radar. */
  risk_on_lcc?: number | null; // liquidity impulse (higher = expanding)
  risk_on_rpc?: number | null; // recession risk (higher = worse)
  risk_on_csc?: number | null; // financial stress (higher = worse)
  /* CBOE 3-month implied correlation (^COR3M) — stock-picking regime for the momentum
     micro score (Phase 4). Low = dispersion (selection pays); high = macro tape. */
  implied_corr?: number | null;
  /* Regime */
  regime_id: string | null;
  regime_label: string | null;
  cartera_quadrant: string | null;
  ic_score: number | null;
  /* Rates */
  dgs2: number | null;
  dgs10: number | null;
  dgs30: number | null;
  term_premium_10y: number | null;
  curve_steepener: string | null;
  net_liquidity_t: number | null;
  net_liquidity_dir: string | null;
  /* Fed & macro */
  fed_room: string | null;
  core_pce_yoy: number | null;
  unrate: number | null;
  oil_shock: string | null;
  wti_level: number | null;
  wti_chg_1m: number | null;
  buffett_indicator: number | null;
  expected_return_10y: number | null;
  cape?: number | null; // Shiller CAPE — secular valuation (Phase 5, Secular Clock)
  /* Sentiment */
  fear_greed: number | null;
  fear_greed_rating: string | null;
  sentiment_signal: string | null;
  put_call_ratio: number | null;
  global_liquidity_dir: string | null;
  /* Meltup / bubble (optional) */
  meltup_score?: number | null;
  bubble_debt?: number | null;
  bubble_ai?: number | null;
  /* MOVE / VIX */
  move_index?: number | null;
  vix?: number | null;
  /* Extended Rates */
  dgs1?: number | null;
  dgs5?: number | null;
  t10y3m?: number | null;
  real_yield_10y?: number | null;
  breakeven_10y?: number | null;
  skew_index?: number | null;
  stlfsi4?: number | null;
  ovx?: number | null;
  fedfunds?: number | null;
  /* Extended Credit */
  hy_oas?: number | null;
  hy_bb_oas?: number | null;
  hy_ccc_oas?: number | null;
  bbb_oas?: number | null;
  hy_oas_momentum?: number | null;
  ted_spread?: number | null;
  c_and_i_loans?: number | null;
  credit_card_delinq?: number | null;
  nfci?: number | null;
  /* Extended Macro Signals */
  t10y2y?: number | null;
  sahm_rule?: number | null;
  umcsent?: number | null;
  sofr?: number | null;
  wresbal?: number | null;
  mortgage_rate?: number | null;
  case_shiller_yoy?: number | null;
  /* Extended FX & Commodities */
  dxy?: number | null;
  usdjpy?: number | null;
  /* Extended Labor & Inflation */
  icsa?: number | null;
  payems?: number | null;
  core_cpi_yoy?: number | null;
  /* Extended Liquidity */
  walcl?: number | null;
  rrpontsyd?: number | null;
  m2_growth?: number | null;
  /* Extended Housing */
  house_starts?: number | null;
  home_sales?: number | null;
  building_permits?: number | null;
  median_home_price_chg?: number | null;
  /* Extended Commodities */
  gold_price?: number | null;
  brent?: number | null;
  /* Sentiment & Research Gate */
  boj_assets?: number | null;
  claims_trend?: string | null;
  profits_trend?: string | null;
  recession_gate_active?: boolean | null;
  credit_private_proxy?: number | null;
  credit_divergence?: boolean | null;
  /* Dalio Debt Cycle */
  dalio_stage?: number | null;
  /* A2/A3 — micro→macro breadth (the bottom-up arrow) + the confirmation/divergence loop */
  breadth_200dma?: number | null;
  breadth_50dma?: number | null;
  breadth_mom?: number | null;
  breadth_1m?: number | null;
  breadth_updated_at?: string | null;
  regime_confirmation?: string | null;
}

/* ── Stock Analysis (from Supabase sl_analyses) ── */
export interface StockAnalysis {
  id: number;
  user_id: string;
  ticker: string;
  analysis_date: string;
  score_total: number;
  score_val: number;
  score_hlth: number;
  score_mom: number;
  score_growth: number;
  rating: string;
  macro_tilt: number;
  sector: string | null;
  reverse_dcf?: Record<string, unknown> | null;
  // Valuation multiples (P1-8) — optional; populated on analyze, null for older rows.
  pe?: number | null;
  ev_ebitda?: number | null;
  pfcf?: number | null;
  roic?: number | null;       // percent
  fcf_yield?: number | null;  // percent
}

/* ── Score inputs / outputs ── */
export interface ScoreInputs {
  pe?: number | null;
  pb?: number | null;
  evEbitda?: number | null;
  pfcf?: number | null;
  debtEquity?: number | null;
  currentRatio?: number | null;
  interestCoverage?: number | null;
  priceChange1M?: number | null;
  priceChange3M?: number | null;
  priceChange6M?: number | null;
  revenueGrowth?: number | null;
  epsGrowth?: number | null;
  grossMargin?: number | null;
  roic?: number | null;
  roe?: number | null;
  roa?: number | null;          // return on assets % — used for financial-sector health
  netMargin?: number | null;    // net profit margin % — used for financial-sector health
  grossProfitability?: number | null; // gross profit / total assets % (Novy-Marx) — the most regime-robust quality signal (measured: best Sharpe across all backtest windows, qgv_lab.mjs)
  netDebtEbitda?: number | null;
  regime?: string | null;
  sector?: string | null;
  marketCap?: number | null;
  /** Reverse DCF signals — optional, integrated into value score when available */
  impliedGrowthCagr?: number | null;
  tvShare?: number | null;
  /** FCF quality signals — optional, from cashFlow + income statement */
  capexToRevenue?: number | null;  // |CapEx| / Revenue TTM — lower = higher quality (Uber/Airbnb model)
  fcfYield?: number | null;        // FCF TTM / marketCap — cleaner than P/E
  fcfGrowthYoy?: number | null;    // FCF TTM YoY growth % — for divergence signal
  /** Finviz signals — optional, all fields gracefully degrade when null */
  shortFloat?: number | null;
  instTrans?: number | null;
  insiderTrans?: number | null;
  relVolume?: number | null;
  forwardPe?: number | null;
  epsQoQ?: number | null;
  salesQoQ?: number | null;
  operatingMargin?: number | null;
}

/* ── Reverse DCF result (stored in sl_analyses.reverse_dcf JSONB) ── */
export interface ReverseDCFSnapshot {
  impliedGrowthCagr: number;
  conventionalValue: number;
  upside: number;
  tvShare: number;
  realityBand: 'achievable' | 'ambitious' | 'very_aggressive';
  wacc: number;
  rfRate: number;
  computedAt: string;
}

export interface Scores {
  value: number;
  health: number;
  momentum: number;
  growth: number;
  total: number;
}

/* ── Watchlist ── */
export interface WatchlistItem {
  id: number;
  user_id: string;
  ticker: string;
  added_at: string;
}

/* ── Macro Tilt (computed) ── */
export interface MacroTilt {
  tilt: number;
  regime: string;
  quadrant: string;
  reasons: string[];
  updatedAt: string;
}

/* ── Finviz snapshot data ── */
export interface FinvizData {
  shortFloat: number | null;
  shortRatio: number | null;
  insiderOwn: number | null;
  insiderTrans: number | null;
  instOwn: number | null;
  instTrans: number | null;
  relVolume: number | null;
  atr: number | null;
  volatility14d: number | null;
  forwardPe: number | null;
  peg: number | null;
  ps: number | null;
  pc: number | null;
  evSales: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  roa: number | null;
  roe: number | null;
  epsQoQ: number | null;
  salesQoQ: number | null;
  epsNextY: number | null;
  epsNext5Y: number | null;
  salesGrowth3Y: number | null;
  perf3Y: number | null;
  perf5Y: number | null;
  perfYear: number | null;
  recom: number | null;
  targetPrice: number | null;
  betaFv: number | null;
  grossMarginFv: number | null;
  /** Short-side pressure gauge from FINRA Reg SHO daily (shortVol/totalVol), when NASDAQ short interest is unavailable. */
  shortVolumeRatio?: number | null;
}
