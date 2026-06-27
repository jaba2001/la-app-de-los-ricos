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
  curve_steepener: number | null;
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
  netDebtEbitda?: number | null;
  regime?: string | null;
  marketCap?: number | null;
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
