// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TIMEFRAME CONTEXT (2026-07-11) — the honest, measured version of the "top-down
// multi-timeframe" idea. NOT three competing scores and NOT a new alpha engine (measured:
// multi-timeframe confluence does not add cross-sectional alpha, short-term momentum
// reverses — research/multitimeframe_lab.mjs). Instead: ONE Scora Score, wrapped in THREE
// CONTEXTUAL READS that each answer a different question at a different speed, so the user
// sees whether a name is a STRUCTURAL buy, a LEADER that's overbought, or a BOUNCE against
// the macro. This is execution discipline + explainability, and it operationalises Scora's
// real differentiator: the macro regime → which SECTORS and FACTORS have tailwinds.
//
//   MONTHLY (structural / macro) — "Should I own this at all now?"  The regime tailwind for
//     this name's SECTOR and its FACTOR/style. Slow-moving. This is the GATE. It encodes the
//     MEASURED regime→factor rotation (research/regime_sector_lab.mjs): growth leads in
//     expansion/reflation, value leads in contraction/neutral; cyclicals in reflation,
//     defensives in contraction. THIS is "macro predicts which stocks lead", done at the
//     level where it actually works (baskets), not single-name timing.
//   WEEKLY (trend) — "Is it in a real uptrend and LEADING its peers?"  12-1m momentum +
//     relative strength vs its sector and the S&P. Medium-moving.
//   DAILY (timing) — "Good entry, or am I chasing?"  A REVERSION/overbought filter (RSI +
//     distance from the 200-day), NOT a momentum-continuation score (short-term momentum
//     reverses). HIGH = oversold/pulled-back (good entry); LOW = overbought/extended.
//
// Pure module (no imports beyond a type) so the backtest/red-team can exercise it headless.
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeId = "expansion" | "reflation" | "stagflation" | "contraction" | "neutral";

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

// ── MEASURED regime→factor rotation (regime_sector_lab.mjs, avg fwd-1m excess vs SPY) ──
// +1 favored / −1 disfavored / 0 neutral, per style, by regime. The growth↔value cyclicality
// is the cleanest macro→equity signal in the data; the rest are directional and small.
const REGIME_FACTOR: Record<RegimeId, { growth: number; value: number; momentum: number; quality: number; size: number }> = {
  expansion:   { growth: +1, value: -1, momentum:  0, quality:  0, size: -1 },
  reflation:   { growth: +1, value: -1, momentum: +1, quality:  0, size:  0 },
  stagflation: { growth: +1, value: -1, momentum:  0, quality: +1, size: -1 },
  contraction: { growth: -1, value: +1, momentum:  0, quality: +1, size:  0 },
  neutral:     { growth: -1, value: +1, momentum:  0, quality: -1, size:  0 },
};

// Sector orientation (which broad bucket a sector belongs to). Accepts FMP + GICS spellings.
const GROWTH_SECTORS = new Set(["Technology", "Consumer Cyclical", "Communication Services", "Real Estate"]);
const DEFENSIVE_SECTORS = new Set(["Utilities", "Consumer Defensive", "Healthcare"]);
const CYCLICAL_SECTORS = new Set(["Energy", "Materials", "Basic Materials", "Industrials", "Financials", "Financial Services"]);

export interface TimeframeInput {
  regime: RegimeId | string | null;
  riskOn: number | null;                 // 0-100
  sector: string | null;
  // the name's style profile (from calcFactorTilts, each 0-20); dominant style drives factor-fit
  factorTilts?: { value: number; growth: number; momentum: number; quality: number; size: number } | null;
  mom12_1: number | null;                // % (weekly/trend)
  rsVsSector: number | null;             // relative strength vs sector ETF, % points (weekly)
  rsVsSpy: number | null;                // relative strength vs SPY, % points (weekly)
  rsi14: number | null;                  // 0-100 (daily/timing)
  pctFrom200dma: number | null;          // (price/sma200 − 1)×100 (daily/timing)
}

export interface TimeframeRead { score: number; label: string; reasons: string[]; }
export interface Timeframes {
  monthly: TimeframeRead;   // macro/structural tailwind
  weekly: TimeframeRead;    // trend + relative strength
  daily: TimeframeRead;     // entry timing (reversion)
  confluence: "structural-buy" | "leader-extended" | "bounce-vs-macro" | "improving" | "avoid" | "mixed";
  convictionMult: number;   // 0.6–1.0
  summary: string;
}

// MONTHLY — macro/regime tailwind for the name's sector + factor. The differentiator.
function monthlyRead(inp: TimeframeInput): TimeframeRead {
  const reasons: string[] = [];
  const ro = inp.riskOn ?? 50;
  let s = 50 + (ro - 50) * 0.5; // liquidity-led backdrop, ±25
  reasons.push(`Risk-on ${ro.toFixed(0)}/100 backdrop`);
  const rg = (inp.regime && (inp.regime as string) in REGIME_FACTOR) ? (inp.regime as RegimeId) : null;

  // Sector fit (risk-on lifts growth/cyclicals; risk-off lifts defensives).
  if (inp.sector) {
    if (ro >= 55) {
      if (GROWTH_SECTORS.has(inp.sector)) { s += 10; reasons.push(`Risk-on favors ${inp.sector} (growth sector)`); }
      else if (CYCLICAL_SECTORS.has(inp.sector)) { s += 6; reasons.push(`Risk-on lifts ${inp.sector} (cyclical)`); }
      else if (DEFENSIVE_SECTORS.has(inp.sector)) { s -= 6; reasons.push(`${inp.sector} lags in a risk-on tape`); }
    } else if (ro < 45) {
      if (DEFENSIVE_SECTORS.has(inp.sector)) { s += 10; reasons.push(`${inp.sector} is defensive in risk-off`); }
      else if (GROWTH_SECTORS.has(inp.sector)) { s -= 10; reasons.push(`${inp.sector} (growth) headwind in risk-off`); }
      else if (CYCLICAL_SECTORS.has(inp.sector)) { s -= 6; reasons.push(`${inp.sector} (cyclical) soft in risk-off`); }
    }
  }

  // FACTOR fit — the measured regime→style rotation. The name's dominant style vs what the
  // regime rewards (growth in expansion/reflation, value in contraction, etc.).
  const ft = inp.factorTilts;
  if (rg && ft) {
    const fav = REGIME_FACTOR[rg];
    const styles: [keyof typeof fav, number][] = [["growth", ft.growth], ["value", ft.value], ["momentum", ft.momentum], ["quality", ft.quality], ["size", ft.size]];
    const dom = styles.slice().sort((a, b) => b[1] - a[1])[0];
    const domFav = fav[dom[0]];
    if (dom[1] > 0 && domFav !== 0) {
      s += domFav * 8;
      reasons.push(`${dom[0][0].toUpperCase() + dom[0].slice(1)}-leaning name ${domFav > 0 ? "has a" : "faces a"} macro ${domFav > 0 ? "tailwind" : "headwind"} in ${rg} (measured factor rotation)`);
    }
  }
  s = clamp(s);
  const label = s >= 62 ? "Macro tailwind" : s >= 45 ? "Neutral backdrop" : "Macro headwind";
  return { score: Math.round(s), label, reasons };
}

// WEEKLY — 12-1m trend + relative strength vs sector and the S&P.
function weeklyRead(inp: TimeframeInput): TimeframeRead {
  const reasons: string[] = [];
  let s = 50;
  if (inp.mom12_1 != null) {
    const m = inp.mom12_1;
    s += m > 30 ? 22 : m > 10 ? 15 : m > 0 ? 6 : m > -15 ? -8 : -20;
    reasons.push(`12-1m momentum ${m >= 0 ? "+" : ""}${m.toFixed(0)}%`);
  }
  if (inp.rsVsSector != null) { s += inp.rsVsSector > 0 ? 8 : -8; reasons.push(`${inp.rsVsSector >= 0 ? "Leads" : "Lags"} its sector (${inp.rsVsSector >= 0 ? "+" : ""}${inp.rsVsSector.toFixed(0)}pp)`); }
  if (inp.rsVsSpy != null) { s += inp.rsVsSpy > 0 ? 8 : -8; reasons.push(`${inp.rsVsSpy >= 0 ? "Outpaces" : "Trails"} the S&P (${inp.rsVsSpy >= 0 ? "+" : ""}${inp.rsVsSpy.toFixed(0)}pp)`); }
  s = clamp(s);
  const label = s >= 62 ? "Strong uptrend · leader" : s >= 45 ? "Neutral trend" : "Downtrend · laggard";
  return { score: Math.round(s), label, reasons };
}

// DAILY — entry TIMING as a reversion filter (short-term momentum reverses, so we do NOT
// reward recent strength). HIGH = oversold/pulled-back (good entry); LOW = overbought/chasing.
function dailyRead(inp: TimeframeInput): TimeframeRead {
  const reasons: string[] = [];
  let s = 50;
  if (inp.rsi14 != null) {
    const r = inp.rsi14;
    if (r < 30) { s += 22; reasons.push(`RSI ${r.toFixed(0)} — oversold, good entry`); }
    else if (r < 45) { s += 10; reasons.push(`RSI ${r.toFixed(0)} — pulled back`); }
    else if (r > 75) { s -= 22; reasons.push(`RSI ${r.toFixed(0)} — overbought, you're chasing`); }
    else if (r > 62) { s -= 10; reasons.push(`RSI ${r.toFixed(0)} — extended`); }
    else reasons.push(`RSI ${r.toFixed(0)} — neutral`);
  }
  if (inp.pctFrom200dma != null) {
    const d = inp.pctFrom200dma;
    if (d > 20) { s -= 10; reasons.push(`${d.toFixed(0)}% above the 200-day — stretched`); }
    else if (d < -10 && d > -25) { s += 6; reasons.push(`Below the 200-day — potential value entry (confirm the trend)`); }
  }
  s = clamp(s);
  const label = s >= 60 ? "Good entry" : s >= 42 ? "Fair entry" : "Chasing · wait for a pullback";
  return { score: Math.round(s), label, reasons };
}

/** Combine the three reads into a confluence verdict + conviction modulator. The MONTHLY
 *  read gates: a high weekly/daily against a macro headwind is a BOUNCE, not a buy. */
export function timeframeReads(inp: TimeframeInput): Timeframes {
  const monthly = monthlyRead(inp), weekly = weeklyRead(inp), daily = dailyRead(inp);
  const macroUp = monthly.score >= 55, macroDown = monthly.score < 45;
  const trendUp = weekly.score >= 55, trendDown = weekly.score < 45;
  const goodEntry = daily.score >= 55, chasing = daily.score < 42;

  let confluence: Timeframes["confluence"], convictionMult: number, summary: string;
  if (macroUp && trendUp && !chasing) { confluence = "structural-buy"; convictionMult = 1.0; summary = "Structural buy — macro tailwind, real uptrend, and not overbought."; }
  else if (macroUp && trendUp && chasing) { confluence = "leader-extended"; convictionMult = 0.85; summary = "Leader, but extended — the macro and trend agree; wait for a pullback to enter."; }
  else if (macroDown && (trendUp || goodEntry)) { confluence = "bounce-vs-macro"; convictionMult = 0.6; summary = "Bounce against the macro — the backdrop is a headwind; treat strength as temporary."; }
  else if (macroUp && trendDown && goodEntry) { confluence = "improving"; convictionMult = 0.8; summary = "Improving setup — macro tailwind and an oversold entry, but the trend hasn't turned yet."; }
  else if (macroDown && trendDown) { confluence = "avoid"; convictionMult = 0.6; summary = "Avoid — macro headwind and a downtrend; no confluence."; }
  else { confluence = "mixed"; convictionMult = 0.75; summary = "Mixed — the timeframes disagree; lower conviction."; }

  return { monthly, weekly, daily, confluence, convictionMult, summary };
}
