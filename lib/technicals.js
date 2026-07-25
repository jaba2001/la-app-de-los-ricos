// Minimal technical signals for the ticker-alerts cron (server-side, JS). Mirrors the shapes in
// scora-research/lib/technicalIndicators.ts (smaLast / trendStage / detectBaseBreakout) closely
// enough to evaluate crossed_sma150 / base_breakout / stage_change alerts. data = array of
// { high, low, close, volume } ordered OLDEST→NEWEST.

export function smaLast(values, period) {
  if (values.length < period || period <= 0) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

/** True the day the close crosses UP through its 150-day SMA (below yesterday → at/above today). */
export function crossedUpSma150(data) {
  const closes = data.map((d) => d.close);
  if (closes.length < 151) return false;
  const smaToday = smaLast(closes, 150);
  const smaPrev = smaLast(closes.slice(0, closes.length - 1), 150);
  if (smaToday == null || smaPrev == null) return false;
  const today = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  return prev < smaPrev && today >= smaToday;
}

/** Trend stage 1-4 + aboveSma150, from the 150-day SMA and its 20-bar slope. */
export function trendStage(data, smaPeriod = 150, slopeLookback = 20) {
  const closes = data.map((d) => d.close);
  const sma = smaLast(closes, smaPeriod);
  const price = closes.length ? closes[closes.length - 1] : NaN;
  const above = sma != null && price > sma;
  let slopePct = null;
  if (closes.length >= smaPeriod + slopeLookback) {
    const now = smaLast(closes, smaPeriod);
    const prev = smaLast(closes.slice(0, closes.length - slopeLookback), smaPeriod);
    slopePct = prev > 0 ? ((now - prev) / prev) * 100 : null;
  }
  const RISE = 0.5, FALL = -0.5;
  let stage;
  if (sma == null) stage = above ? 2 : 1;
  else if (above && (slopePct == null || slopePct > RISE)) stage = 2;
  else if (!above && (slopePct == null || slopePct < FALL)) stage = 4;
  else if (above) stage = 3;
  else stage = 1;
  return { stage, aboveSma150: above };
}

/** Confirmed base breakout: tight base over `lookback`, last close breaks the base high on ≥volMult
 *  average volume, and price is above the 150-day SMA. */
export function baseBreakoutConfirmed(data, lookback = 30, rangeMax = 0.25, volMult = 2) {
  if (data.length < lookback + 1) return false;
  const base = data.slice(data.length - lookback - 1, data.length - 1);
  const last = data[data.length - 1];
  const baseHigh = Math.max(...base.map((b) => b.high));
  const baseLow = Math.min(...base.map((b) => b.low));
  const rangePct = baseLow > 0 ? baseHigh / baseLow - 1 : null;
  const avgVol = base.reduce((s, b) => s + b.volume, 0) / base.length;
  const volRatio = avgVol > 0 ? last.volume / avgVol : null;
  const sma150 = smaLast(data.map((d) => d.close), 150);
  const aboveTrend = sma150 != null && last.close > sma150;
  const isTight = rangePct != null && rangePct <= rangeMax;
  return isTight && last.close > baseHigh && volRatio != null && volRatio >= volMult && aboveTrend;
}
