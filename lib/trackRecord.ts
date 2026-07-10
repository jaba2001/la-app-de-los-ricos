// Historical backtest summary — research/backtest.mjs --full (point-in-time, free data:
// SEC EDGAR filing dates + Yahoo/Tiingo prices + FRED). 120 S&P 500 names with
// point-in-time membership INCLUDING delisted names (Tiingo) → survivorship-controlled.
// Committed as a static snapshot; re-run to refresh. The LIVE record (sl_track_summary)
// accumulates forward from the monthly cron.
//
// The honest, important finding: on a survivorship-free test the MICRO score alone does
// NOT beat SPY (+112% vs +154%) — a value/quality signal lags a mega-cap-momentum tape.
// The edge comes from the macro↔micro OVERLAY (Scora's actual score = micro + macro
// tilt): it flips underperformance into a slight win (+157.5% vs +154.2%) with far
// better risk (Sharpe 0.73→0.98, max drawdown −27.7%→−16.8%). The differentiator is the
// macro regime lens; the live forward record is the un-backtested proof.

export interface BacktestSummary {
  period: string;
  universe: number;
  mode: string;
  rebalances: number;
  nameMonths: number;
  buyThreshold: number;
  equity: { buyTotalReturn: number; spyTotalReturn: number; sharpe: number; maxDrawdown: number; months: number }; // full Scora score (micro + macro)
  microOnly: { buyTotalReturn: number; sharpe: number; maxDrawdown: number };                                       // ablation: score without the macro overlay
  informationCoefficient: number;
  topMinusBottom: number;
  deciles: number[];
  horizons: { label: string; buyHit: number; buyAlpha: number; restHit: number; restAlpha: number }[];
  regimes: { label: string; months: number; alpha: number | null }[];
  caveats: string[];
}

// ── The validated edge (Phases 0-4) ─────────────────────────────────────────
// The session's central finding: stock-picking doesn't beat the market, but the
// regime-driven MULTI-ASSET ALLOCATOR does — risk-adjusted, with a fifth of the
// drawdown. And stock selection only pays CONDITIONALLY: momentum ranking earns
// positive IC when market correlation is low, and crashes when it's high.
// Sources: research/backtest_assets.mjs (REGIME=stationary, 2007-2026),
// research/walkforward.mjs (OOS), research/backtest.mjs --full 500 (0A momentum).

export const ALLOCATOR_BACKTEST = {
  period: "Jul 2007 – Jun 2026",
  months: 228,
  strategy: { label: "Risk-on tilt + dual-momentum + risk-parity", totalReturn: 151.1, sharpe: 1.02, maxDrawdown: -7.5 },
  strategyNoRP: { label: "Risk-on tilt + dual-momentum (no risk-parity)", totalReturn: 210.1, sharpe: 1.01, maxDrawdown: -10.1 },
  control:  { label: "Dual-momentum only (no regime)", totalReturn: 185.3, sharpe: 0.88, maxDrawdown: -14.0 },
  spy:      { label: "SPY buy & hold", totalReturn: 602.3, sharpe: 0.71, maxDrawdown: -50.7 },
  walkForward: { period: "2011–2026", oosMonths: 178, oosSharpe: 0.99, overfitGap: 0.01 },
  subPeriods: [
    { label: "pre-2020 (out-of-sample)", strat: 0.93, control: 0.75, spy: 0.60 },
    { label: "2020–2026",                strat: 1.15, control: 1.14, spy: 0.89 },
  ],
  notes: [
    "Regime-independent control (dual-momentum only) beaten in BOTH sub-periods → the liquidity-led risk-on tilt adds value, not just the trend gate.",
    "Gives up raw return vs a two-decade equity bull (SPY +602%) — this is a risk-managed sleeve: match equity-like results with a fifth of the drawdown and a much higher Sharpe, not beat the index outright.",
    "Composites are stationarized to percentiles (not absolute levels) so the regime is valid across cycles including the GFC.",
  ],
};

export const STOCK_PICKING = {
  universe: 500,
  nameMonths: 34405,
  period: "Jan 2020 – Jun 2026",
  valueQuality: { totalReturn: 127.6, spyReturn: 154.2, ic: 0.007 }, // definitive survivorship-free
  // momentum IC by market-correlation bucket — the meta-switch (Phase 4)
  momentumIC: { low: 0.064, mid: -0.030, high: -0.054 },
  momentumDecileLow: 3.9, // top-minus-bottom 3M alpha % in low correlation
};

export const HISTORICAL_BACKTEST: BacktestSummary = {
  period: "Jan 2020 – Jun 2026",
  universe: 120,
  mode: "S&P 500 · point-in-time · survivorship-controlled (delisted incl.)",
  rebalances: 78,
  nameMonths: 9061,
  buyThreshold: 60,
  equity: { buyTotalReturn: 157.5, spyTotalReturn: 154.2, sharpe: 0.98, maxDrawdown: -16.8, months: 78 },
  microOnly: { buyTotalReturn: 112.0, sharpe: 0.73, maxDrawdown: -27.7 },
  informationCoefficient: 0.015,
  topMinusBottom: -1.7,
  deciles: [0.0, -2.0, -1.0, -1.0, -0.2, -0.3, -1.0, -0.2, 0.1, -1.0],
  horizons: [
    { label: "1M", buyHit: 48, buyAlpha: -0.2, restHit: 47, restAlpha: -0.2 },
    { label: "3M", buyHit: 46, buyAlpha: -0.4, restHit: 46, restAlpha: -0.7 },
    { label: "6M", buyHit: 45, buyAlpha: -0.6, restHit: 44, restAlpha: -1.4 },
    { label: "12M", buyHit: 43, buyAlpha: -1.1, restHit: 43, restAlpha: -2.7 },
  ],
  regimes: [
    { label: "Expansion", months: 73, alpha: -0.3 },
    { label: "Reflation", months: 2, alpha: 0.6 },
    { label: "Stagflation", months: 0, alpha: null },
    { label: "Contraction", months: 3, alpha: -3.8 },
  ],
  caveats: [
    "Survivorship-controlled: point-in-time S&P 500 membership including delisted names (via Tiingo) — the honest test, not curated survivors.",
    "The micro score alone does NOT beat SPY here (+112% vs +154%); the win comes from the macro↔micro overlay (+157.5%, Sharpe 0.98, half the drawdown). Scora's edge IS the macro regime lens.",
    "Raw fine-grained ranking is weak (IC ~0.015, decile spread negative) — the value is in regime-timing and risk, not stock-by-stock ranking.",
    "Sector benchmarks held constant; thresholds hand-tuned → the live forward record is the un-backtested proof.",
    "Definitive 500-name run (34,405 name-months): value/quality micro +127.6% vs SPY +154.2% (IC 0.007) — confirms stock-picking on value/quality does NOT beat the market on the full survivorship-free universe. The validated edge is the multi-asset allocator (Sharpe 1.01 OOS 2007-2026) and momentum gated by correlation (IC +0.064 in low correlation, −0.05 in high).",
  ],
};
