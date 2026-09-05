export interface OHLCV {
  open: number; high: number; low: number; close: number; volume: number;
}
export interface SqueezePt {
  sqzOn: boolean; sqzOff: boolean; noSqz: boolean; val: number | null;
}
export interface ADXPt {
  adx: number | null; plusDI: number | null; minusDI: number | null;
}
export interface VPBucket {
  lo: number; hi: number; mid: number; vol: number; isPOC: boolean; inVA: boolean;
}
export interface VolumeProfile {
  buckets: VPBucket[]; pocMid: number; vaHigh: number; vaLow: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function smaOf(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  for (let i = period - 1; i < arr.length; i++) {
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += arr[j];
    out[i] = s / period;
  }
  return out;
}

function emaOf(arr: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array(arr.length).fill(NaN);
  if (arr.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += arr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
  return out;
}

function windowStdDev(arr: number[], from: number, len: number): number {
  const slice = arr.slice(Math.max(0, from), from + len);
  if (slice.length < 2) return 0;
  const m = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length);
}

function wilderRunning(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  if (arr.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += arr[i];
  out[period - 1] = sum;
  for (let i = period; i < arr.length; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
  return out;
}

function wilderEMAof(arr: number[], period: number): number[] {
  const out = new Array(arr.length).fill(NaN);
  let start = 0;
  while (start < arr.length && isNaN(arr[start])) start++;
  if (start + period > arr.length) return out;
  let sum = 0, cnt = 0;
  for (let i = start; i < start + period; i++) { if (!isNaN(arr[i])) { sum += arr[i]; cnt++; } }
  if (cnt < period) return out;
  out[start + period - 1] = sum / period;
  for (let i = start + period; i < arr.length; i++) {
    if (!isNaN(arr[i]) && !isNaN(out[i - 1])) out[i] = (out[i - 1] * (period - 1) + arr[i]) / period;
  }
  return out;
}

function linReg(arr: number[], idx: number, len: number): number | null {
  if (idx < len - 1) return null;
  const start = idx - len + 1;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < len; i++) {
    const v = arr[start + i];
    if (isNaN(v)) return null;
    sx += i; sy += v; sxy += i * v; sx2 += i * i;
  }
  const d = len * sx2 - sx * sx;
  if (d === 0) return null;
  const m = (len * sxy - sx * sy) / d;
  const b = (sy - m * sx) / len;
  return m * (len - 1) + b;
}

// ── Squeeze Momentum (LazyBear TTM_Squeeze port) ─────────────────────────────

export function computeSqueeze(
  data: OHLCV[], bbLen = 20, kcLen = 20, kcMult = 1.5, momLen = 12
): SqueezePt[] {
  const closes = data.map(d => d.close);
  const highs  = data.map(d => d.high);
  const lows   = data.map(d => d.low);

  const bbMid   = smaOf(closes, bbLen);
  const kcMid   = emaOf(closes, kcLen);
  const tr      = data.map((d, i) => {
    if (i === 0) return d.high - d.low;
    const pc = data[i - 1].close;
    return Math.max(d.high - d.low, Math.abs(d.high - pc), Math.abs(d.low - pc));
  });
  const smoothATR = emaOf(tr, kcLen);

  const delta = data.map((_, i) => {
    if (isNaN(bbMid[i])) return NaN;
    let hh = -Infinity, ll = Infinity;
    for (let j = Math.max(0, i - kcLen + 1); j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j]  < ll) ll = lows[j];
    }
    return closes[i] - (hh + ll + bbMid[i] * 2) / 4;
  });

  return data.map((_, i) => {
    const bM = bbMid[i], kM = kcMid[i], atr = smoothATR[i];
    if (isNaN(bM) || isNaN(kM) || isNaN(atr)) return { sqzOn: false, sqzOff: false, noSqz: true, val: null };
    const bStd = windowStdDev(closes, i - bbLen + 1, bbLen);
    const bbU  = bM + 2 * bStd, bbL = bM - 2 * bStd;
    const kcU  = kM + kcMult * atr, kcL = kM - kcMult * atr;
    const sqzOn  = bbU < kcU && bbL > kcL;
    const sqzOff = !sqzOn && (bbU >= kcU || bbL <= kcL);
    const val    = linReg(delta, i, momLen);
    return { sqzOn, sqzOff, noSqz: !sqzOn && !sqzOff, val };
  });
}

// ── ADX + ±DI (Wilder, period=14) ───────────────────────────────────────────

export function computeADX(data: OHLCV[], period = 14): ADXPt[] {
  const n   = data.length;
  const tr  = new Array(n).fill(0);
  const pdm = new Array(n).fill(0);
  const ndm = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const { high, low } = data[i];
    const pH = data[i - 1].high, pL = data[i - 1].low, pC = data[i - 1].close;
    tr[i]  = Math.max(high - low, Math.abs(high - pC), Math.abs(low - pC));
    const up = high - pH, dn = pL - low;
    pdm[i] = up > 0 && up > dn ? up : 0;
    ndm[i] = dn > 0 && dn > up ? dn : 0;
  }

  const smTR  = wilderRunning(tr,  period);
  const smPDM = wilderRunning(pdm, period);
  const smNDM = wilderRunning(ndm, period);

  const dx = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    const t = smTR[i];
    if (!t || isNaN(t)) continue;
    const pDI = 100 * smPDM[i] / t, nDI = 100 * smNDM[i] / t;
    const s = pDI + nDI;
    dx[i] = s > 0 ? 100 * Math.abs(pDI - nDI) / s : 0;
  }

  const adxArr = wilderEMAof(dx, period);

  return data.map((_, i) => {
    const t = smTR[i];
    if (i < period * 2 - 1 || isNaN(t) || !t) return { adx: null, plusDI: null, minusDI: null };
    return {
      adx:     isNaN(adxArr[i]) ? null : adxArr[i],
      plusDI:  100 * smPDM[i] / t,
      minusDI: 100 * smNDM[i] / t,
    };
  });
}

// ── Volume Profile (24 buckets, 70% VA) ──────────────────────────────────────

export function computeVolumeProfile(data: OHLCV[], buckets = 24): VolumeProfile {
  if (!data.length) return { buckets: [], pocMid: 0, vaHigh: 0, vaLow: 0 };
  const allHigh = Math.max(...data.map(d => d.high));
  const allLow  = Math.min(...data.map(d => d.low));
  const range   = allHigh - allLow || 1;
  const sz      = range / buckets;
  const vols    = new Array(buckets).fill(0);

  for (const d of data) {
    const mid = (d.high + d.low + d.close) / 3;
    const idx = Math.min(buckets - 1, Math.floor((mid - allLow) / sz));
    vols[idx] += d.volume;
  }

  const pocIdx = vols.indexOf(Math.max(...vols));
  const total  = vols.reduce((a, b) => a + b, 0);
  const target = total * 0.7;

  let lo = pocIdx, hi = pocIdx, cum = vols[pocIdx];
  while (cum < target && (lo > 0 || hi < buckets - 1)) {
    const addLo = lo > 0           ? vols[lo - 1] : -1;
    const addHi = hi < buckets - 1 ? vols[hi + 1] : -1;
    if (addLo >= addHi && lo > 0)            { lo--; cum += vols[lo]; }
    else if (addHi >= 0 && hi < buckets - 1) { hi++; cum += vols[hi]; }
    else break;
  }

  const bkts: VPBucket[] = vols.map((vol, i) => ({
    lo:    allLow + i * sz,
    hi:    allLow + (i + 1) * sz,
    mid:   allLow + (i + 0.5) * sz,
    vol,
    isPOC: i === pocIdx,
    inVA:  i >= lo && i <= hi,
  }));

  return { buckets: bkts, pocMid: bkts[pocIdx].mid, vaHigh: bkts[hi].hi, vaLow: bkts[lo].lo };
}

// ── Divergence Detection ──────────────────────────────────────────────────────

export interface Divergence {
  type: "bullish" | "bearish";
  dateIdx: number;
  label: string;
}

export function detectDivergences(
  prices: number[],
  sqzMom: (number | null)[],
  pivotLen = 5,
): Divergence[] {
  const n = prices.length;
  if (n < pivotLen * 4) return [];
  const divs: Divergence[] = [];

  const lows: number[] = [];
  for (let i = pivotLen; i < n - pivotLen; i++) {
    let ok = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j !== i && prices[j] <= prices[i]) { ok = false; break; }
    }
    if (ok) lows.push(i);
  }
  for (let k = 1; k < lows.length; k++) {
    const [i1, i2] = [lows[k - 1], lows[k]];
    if (i2 - i1 < pivotLen * 2) continue;
    const m1 = sqzMom[i1], m2 = sqzMom[i2];
    if (m1 == null || m2 == null) continue;
    if (prices[i2] < prices[i1] && m2 > m1)
      divs.push({ type: "bullish", dateIdx: i2, label: "Bullish Div" });
  }

  const highs: number[] = [];
  for (let i = pivotLen; i < n - pivotLen; i++) {
    let ok = true;
    for (let j = i - pivotLen; j <= i + pivotLen; j++) {
      if (j !== i && prices[j] >= prices[i]) { ok = false; break; }
    }
    if (ok) highs.push(i);
  }
  for (let k = 1; k < highs.length; k++) {
    const [i1, i2] = [highs[k - 1], highs[k]];
    if (i2 - i1 < pivotLen * 2) continue;
    const m1 = sqzMom[i1], m2 = sqzMom[i2];
    if (m1 == null || m2 == null) continue;
    if (prices[i2] > prices[i1] && m2 < m1)
      divs.push({ type: "bearish", dateIdx: i2, label: "Bearish Div" });
  }

  return divs;
}

// ── TL Confluence signals ─────────────────────────────────────────────────────

export interface TLSignals {
  emaLong:   boolean; emaShort:  boolean;
  adxActive: boolean; adxRising: boolean;
  sqzLong:   boolean; sqzShort:  boolean; sqzLoaded: boolean;
  vpAbove:   boolean; vpBelow:   boolean;
}
export interface TLResult {
  signals:      TLSignals;
  longSignals:  number;
  shortSignals: number;
  bias:         string;
  biasColor:    string;
  stopLong:     number;
  stopShort:    number;
  riskLong:     number;
  riskShort:    number;
  tp1Long:      number;
  tp1Short:     number;
  gate:         string;
  gateColor:    string;
  adxVal:       number | null;
  plusDI:       number | null;
  minusDI:      number | null;
  sqzVal:       number | null;
  pocMid:       number;
  vaHigh:       number;
  vaLow:        number;
}

export function computeTLResult(
  prices:   number[],
  emaFast:  number[],
  emaSlow:  number[],
  rawHist:  Array<{ high: number; low: number; price: number; emaFast: number | null; emaSlow: number | null; }>,
  sqzData:  SqueezePt[],
  adxData:  ADXPt[],
  vp:       VolumeProfile,
  icScore:  number | null,
): TLResult | null {
  if (!rawHist.length || !sqzData.length || !adxData.length) return null;

  const last    = rawHist[rawHist.length - 1];
  const lastSqz = sqzData[sqzData.length - 1];
  const lastADX = adxData[adxData.length - 1];
  const lastEFast = emaFast[emaFast.length - 1];
  const lastESlow = emaSlow[emaSlow.length - 1];
  const price   = last.price;

  const emaLong  = !isNaN(lastEFast) && !isNaN(lastESlow) && lastEFast > lastESlow;
  const emaShort = !isNaN(lastEFast) && !isNaN(lastESlow) && lastEFast < lastESlow;
  const adxActive = lastADX.adx != null && lastADX.adx > 23;
  const adxRising = adxData.length >= 2 && lastADX.adx != null && (adxData[adxData.length - 2].adx ?? 0) < lastADX.adx;
  const sqzLong  = lastSqz.sqzOff && lastSqz.val != null && lastSqz.val > 0;
  const sqzShort = lastSqz.sqzOff && lastSqz.val != null && lastSqz.val < 0;
  const sqzLoaded = lastSqz.sqzOn;
  const vpAbove  = vp.pocMid > 0 && price > vp.pocMid;
  const vpBelow  = vp.pocMid > 0 && price < vp.pocMid;

  const longSignals  = [emaLong,  adxActive, sqzLong,  vpAbove].filter(Boolean).length;
  const shortSignals = [emaShort, adxActive, sqzShort, vpBelow].filter(Boolean).length;

  let bias = "NEUTRAL", biasColor = "var(--sr-text-3)";
  if      (longSignals  >= 3) { bias = "LONG";       biasColor = "var(--sr-pos)"; }
  else if (shortSignals >= 3) { bias = "SHORT";      biasColor = "var(--sr-neg)"; }
  else if (longSignals === 2 && longSignals > shortSignals)  { bias = "LEAN LONG";  biasColor = "#34D399"; }
  else if (shortSignals === 2 && shortSignals > longSignals) { bias = "LEAN SHORT"; biasColor = "#FB923C"; }

  const recent20  = rawHist.slice(-20);
  const swingLow  = Math.min(...recent20.map(d => d.low));
  const swingHigh = Math.max(...recent20.map(d => d.high));
  const stopLong  = Math.min(!isNaN(lastESlow) ? lastESlow * 0.993 : Infinity, swingLow * 0.995);
  const stopShort = Math.max(!isNaN(lastESlow) ? lastESlow * 1.007 : -Infinity, swingHigh * 1.005);
  const riskLong  = price > 0 && stopLong < price  ? ((price - stopLong)  / price) * 100 : 0;
  const riskShort = price > 0 && stopShort > price ? ((stopShort - price) / price) * 100 : 0;
  const tp1Long   = price + 2 * (price - stopLong);
  const tp1Short  = price - 2 * (stopShort - price);

  let gate = "No confluence yet — wait for a defined setup", gateColor = "var(--sr-text-3)";
  if      (longSignals  >= 3 && icScore != null && icScore >= 65) { gate = "✓ Entry confirmed — IC positive + 3/4 TL LONG";            gateColor = "var(--sr-pos)"; }
  else if (shortSignals >= 3 && icScore != null && icScore <= 35) { gate = "✓ SHORT entry — IC AVOID + 3/4 TL SHORT";                 gateColor = "var(--sr-neg)"; }
  else if (longSignals  >= 3 && icScore != null && icScore <= 35) { gate = "⚡ CONFLICT — TL LONG but fundamentals AVOID";            gateColor = "var(--sr-warn)"; }
  else if (shortSignals >= 3 && icScore != null && icScore >= 65) { gate = "⚡ CONFLICT — TL SHORT but fundamentals BUY";             gateColor = "var(--sr-warn)"; }
  else if (longSignals  >= 2 && icScore != null && icScore >= 65) { gate = "⏳ Waiting — strong fundamentals, awaiting TL LONG";       gateColor = "#34D399"; }
  else if (shortSignals >= 2 && icScore != null && icScore <= 35) { gate = "⏳ Waiting — weak fundamentals, TL SHORT building";        gateColor = "#FB923C"; }

  return {
    signals: { emaLong, emaShort, adxActive, adxRising, sqzLong, sqzShort, sqzLoaded, vpAbove, vpBelow },
    longSignals, shortSignals, bias, biasColor,
    stopLong, stopShort, riskLong, riskShort, tp1Long, tp1Short,
    gate, gateColor,
    adxVal: lastADX.adx, plusDI: lastADX.plusDI, minusDI: lastADX.minusDI,
    sqzVal: lastSqz.val,
    pocMid: vp.pocMid, vaHigh: vp.vaHigh, vaLow: vp.vaLow,
  };
}

// ── 150-day trend line · stage classification · base breakout ─────────────────
// A long-term trend layer on top of the confluence engine above. The 150-day SMA is
// the canonical intermediate-term trend line; its 20-bar slope + the price's position
// relative to it classify a name into one of four trend stages, and a tight-base
// breakout on expanding volume is the classic accumulation entry. All pure & headless.

/** Trailing SMA of the last `period` values (values oldest→newest). */
export function smaLast(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

export type TrendStage = 1 | 2 | 3 | 4;
export interface StageResult {
  stage: TrendStage;
  label: string;             // Basing | Advancing | Topping | Declining
  sma150: number | null;
  slopePct: number | null;   // 20-bar % slope of the SMA-150
  aboveSma150: boolean;
}

/** Classify the trend stage from daily OHLCV (oldest→newest) via the 150-day SMA and its slope.
 *  1 Basing · 2 Advancing · 3 Topping · 4 Declining. Degrades to a price-vs-line read when the
 *  history is too short for a slope. */
export function trendStage(data: OHLCV[], smaPeriod = 150, slopeLookback = 20): StageResult {
  const closes = data.map(d => d.close);
  const sma = smaLast(closes, smaPeriod);
  const price = closes.length ? closes[closes.length - 1] : NaN;
  const above = sma != null && price > sma;
  let slopePct: number | null = null;
  if (closes.length >= smaPeriod + slopeLookback) {
    const smaNow = smaLast(closes, smaPeriod)!;
    const smaPrev = smaLast(closes.slice(0, closes.length - slopeLookback), smaPeriod)!;
    slopePct = smaPrev > 0 ? ((smaNow - smaPrev) / smaPrev) * 100 : null;
  }
  const RISE = 0.5, FALL = -0.5;
  let stage: TrendStage;
  if (sma == null) stage = above ? 2 : 1;
  else if (above && (slopePct == null || slopePct > RISE)) stage = 2;
  else if (!above && (slopePct == null || slopePct < FALL)) stage = 4;
  else if (above) stage = 3;
  else stage = 1;
  const LABEL: Record<TrendStage, string> = { 1: "Basing", 2: "Advancing", 3: "Topping", 4: "Declining" };
  return { stage, label: LABEL[stage], sma150: sma, slopePct, aboveSma150: above };
}

export interface BaseBreakout {
  status: "base-breakout" | "in-base" | "none";
  baseHigh: number | null;
  baseLow: number | null;
  rangePct: number | null;     // tightness of the base (high/low − 1)
  volumeRatio: number | null;  // last-bar volume vs the base average
  volumeConfirmed: boolean;    // ratio ≥ volMult
  aboveTrend: boolean;         // last close above the 150-day SMA
}

/** Detect a tight consolidation over the `lookback` bars before the last bar and whether the
 *  last bar breaks above the base high (with volume ≥ volMult× the base average). data oldest→newest. */
export function detectBaseBreakout(data: OHLCV[], lookback = 30, rangeMax = 0.25, volMult = 2): BaseBreakout {
  const none: BaseBreakout = { status: "none", baseHigh: null, baseLow: null, rangePct: null, volumeRatio: null, volumeConfirmed: false, aboveTrend: false };
  if (data.length < lookback + 1) return none;
  const base = data.slice(data.length - lookback - 1, data.length - 1);
  const last = data[data.length - 1];
  const baseHigh = Math.max(...base.map(b => b.high));
  const baseLow  = Math.min(...base.map(b => b.low));
  const rangePct = baseLow > 0 ? baseHigh / baseLow - 1 : null;
  const avgVol = base.reduce((s, b) => s + b.volume, 0) / base.length;
  const volumeRatio = avgVol > 0 ? last.volume / avgVol : null;
  const volumeConfirmed = volumeRatio != null && volumeRatio >= volMult;
  const sma150 = smaLast(data.map(d => d.close), 150);
  const aboveTrend = sma150 != null && last.close > sma150;
  const isTight = rangePct != null && rangePct <= rangeMax;
  let status: BaseBreakout["status"] = "none";
  if (isTight && last.close > baseHigh) status = "base-breakout";
  else if (isTight) status = "in-base";
  return { status, baseHigh, baseLow, rangePct, volumeRatio, volumeConfirmed, aboveTrend };
}
