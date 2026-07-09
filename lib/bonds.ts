// ─────────────────────────────────────────────────────────────────────────────
// Fixed-income math (Phase 5) — the "DCF of bonds". Exact bullet-bond pricing, yield
// solving, modified duration and convexity, plus a fair-yield built from Scora's own
// Treasury curve (FRED dgs1/2/5/10/30, already in macro_state) + a credit spread. Ties
// fixed income to the validated macro engine: the same regime signals that drive the
// allocator (recession risk, curve, liquidity) set the expected direction of rates, and
// duration + convexity turn that into an expected total return. Free end-to-end (FRED
// curve + Yahoo ETF price). Individual corporate bonds by CUSIP would need paid data.
// ─────────────────────────────────────────────────────────────────────────────
import type { MacroState } from "./types";

const FREQ = 2; // semi-annual coupons (US convention)

/** Clean price of a bullet bond (face 100). coupon & ytm in %/yr, maturity in years. */
export function bondPrice(couponPct: number, ytmPct: number, years: number, face = 100): number {
  const n = Math.max(1, Math.round(years * FREQ));
  const c = (couponPct / 100 / FREQ) * face;
  const y = ytmPct / 100 / FREQ;
  let pv = 0;
  for (let t = 1; t <= n; t++) pv += c / Math.pow(1 + y, t);
  pv += face / Math.pow(1 + y, n);
  return pv;
}

/** Solve YTM (%) from a clean price via bisection. */
export function bondYTM(price: number, couponPct: number, years: number, face = 100): number | null {
  if (price <= 0) return null;
  let lo = 0.01, hi = 40;
  const f = (y: number) => bondPrice(couponPct, y, years, face) - price;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (Math.abs(fm) < 1e-6) return mid;
    if (f(lo) * fm < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface BondMetrics { price: number; macaulay: number; modified: number; convexity: number; }

/** Price + Macaulay/modified duration (years) + convexity for a bullet bond. */
export function bondMetrics(couponPct: number, ytmPct: number, years: number, face = 100): BondMetrics {
  const n = Math.max(1, Math.round(years * FREQ));
  const c = (couponPct / 100 / FREQ) * face;
  const y = ytmPct / 100 / FREQ;
  let price = 0, dur = 0, conv = 0;
  for (let t = 1; t <= n; t++) {
    const cf = t === n ? c + face : c;
    const disc = cf / Math.pow(1 + y, t);
    price += disc;
    dur += t * disc;
    conv += t * (t + 1) * cf / Math.pow(1 + y, t + 2);
  }
  const macaulay = dur / price / FREQ;               // years
  const modified = macaulay / (1 + y);               // years
  const convexity = conv / price / (FREQ * FREQ);    // per (1.00) yield, annualized
  return { price, macaulay, modified, convexity };
}

/** Total price change (%) for a yield shift (in percentage points), 2nd-order. */
export function priceChangePct(modified: number, convexity: number, dYieldPct: number): number {
  const dy = dYieldPct / 100;
  return (-modified * dy + 0.5 * convexity * dy * dy) * 100;
}

// ── Treasury curve from macro_state (FRED) + interpolation ───────────────────────────
export interface CurvePoint { t: number; y: number; }

export function treasuryCurve(m: MacroState | null): CurvePoint[] {
  if (!m) return [];
  const r = m as unknown as Record<string, unknown>;
  const pts: CurvePoint[] = [];
  const add = (t: number, key: string) => { const v = r[key]; const y = Number(v); if (v != null && !isNaN(y)) pts.push({ t, y }); };
  add(1, "dgs1"); add(2, "dgs2"); add(5, "dgs5"); add(10, "dgs10"); add(30, "dgs30");
  return pts.sort((a, b) => a.t - b.t);
}

/** Linear-interpolate (flat-extrapolate) the Treasury yield (%) at a given maturity. */
export function curveYield(curve: CurvePoint[], years: number): number | null {
  if (!curve.length) return null;
  if (years <= curve[0].t) return curve[0].y;
  if (years >= curve[curve.length - 1].t) return curve[curve.length - 1].y;
  for (let i = 1; i < curve.length; i++) {
    if (years <= curve[i].t) {
      const a = curve[i - 1], b = curve[i];
      return a.y + ((b.y - a.y) * (years - a.t)) / (b.t - a.t);
    }
  }
  return curve[curve.length - 1].y;
}

// ── Bond-ETF metadata — modelled as a synthetic par bond at its avg maturity + spread ──
// avgMaturity/spread are stable structural properties (issuer fact sheets). Fair value =
// build a par bond at [curve(avgMaturity) + spread] and read its duration/convexity — so
// the numbers move with the live FRED curve and the macro spread, not a stale snapshot.
export interface BondEtfMeta { label: string; category: "Treasury" | "IG credit" | "High yield" | "TIPS" | "Aggregate"; avgMaturity: number; spreadField?: "hy_oas" | "bbb_oas" | null; baseSpreadBp: number; }

export const BOND_ETFS: Record<string, BondEtfMeta> = {
  TLT:  { label: "20+yr Treasuries",  category: "Treasury", avgMaturity: 26, spreadField: null, baseSpreadBp: 0 },
  EDV:  { label: "25+yr STRIPS",      category: "Treasury", avgMaturity: 25, spreadField: null, baseSpreadBp: 0 },
  TLH:  { label: "10-20yr Treasuries",category: "Treasury", avgMaturity: 15, spreadField: null, baseSpreadBp: 0 },
  IEF:  { label: "7-10yr Treasuries",  category: "Treasury", avgMaturity: 8.5, spreadField: null, baseSpreadBp: 0 },
  IEI:  { label: "3-7yr Treasuries",   category: "Treasury", avgMaturity: 4.5, spreadField: null, baseSpreadBp: 0 },
  GOVT: { label: "Broad Treasuries",   category: "Treasury", avgMaturity: 8, spreadField: null, baseSpreadBp: 0 },
  SHY:  { label: "1-3yr Treasuries",   category: "Treasury", avgMaturity: 2, spreadField: null, baseSpreadBp: 0 },
  SGOV: { label: "0-3mo Treasuries",   category: "Treasury", avgMaturity: 0.25, spreadField: null, baseSpreadBp: 0 },
  BIL:  { label: "1-3mo T-Bills",      category: "Treasury", avgMaturity: 0.15, spreadField: null, baseSpreadBp: 0 },
  LQD:  { label: "IG corporate",       category: "IG credit", avgMaturity: 13, spreadField: "bbb_oas", baseSpreadBp: 0 },
  VCIT: { label: "IG interm. corp",    category: "IG credit", avgMaturity: 7, spreadField: "bbb_oas", baseSpreadBp: 0 },
  VCSH: { label: "IG short corp",      category: "IG credit", avgMaturity: 3, spreadField: "bbb_oas", baseSpreadBp: 0 },
  HYG:  { label: "High yield",         category: "High yield", avgMaturity: 5, spreadField: "hy_oas", baseSpreadBp: 0 },
  JNK:  { label: "High yield",         category: "High yield", avgMaturity: 5.5, spreadField: "hy_oas", baseSpreadBp: 0 },
  TIP:  { label: "TIPS",               category: "TIPS", avgMaturity: 7, spreadField: null, baseSpreadBp: 0 },
  AGG:  { label: "US Aggregate",       category: "Aggregate", avgMaturity: 8.5, spreadField: "bbb_oas", baseSpreadBp: 40 },
  BND:  { label: "US Aggregate",       category: "Aggregate", avgMaturity: 8.7, spreadField: "bbb_oas", baseSpreadBp: 40 },
};

export interface BondEtfModel { meta: BondEtfMeta; baseYield: number; spreadBp: number; metrics: BondMetrics; curveAt: number; }

/** Build the synthetic-par-bond model for a bond ETF from the live curve + macro spread. */
export function bondEtfModel(ticker: string, macro: MacroState | null): BondEtfModel | null {
  const meta = BOND_ETFS[ticker.toUpperCase()];
  if (!meta) return null;
  const curve = treasuryCurve(macro);
  const curveAt = curveYield(curve, meta.avgMaturity);
  if (curveAt == null) return null;
  const spreadRaw = meta.spreadField ? Number((macro as unknown as Record<string, unknown>)?.[meta.spreadField]) : 0;
  const spreadBp = (meta.spreadField && !isNaN(spreadRaw) ? spreadRaw : 0) + meta.baseSpreadBp;
  const baseYield = curveAt + spreadBp / 100;
  // par bond → coupon = ytm = baseYield, so price ≈ 100; duration/convexity are the ETF's.
  const metrics = bondMetrics(baseYield, baseYield, meta.avgMaturity);
  return { meta, baseYield, spreadBp, metrics, curveAt };
}

// ── Regime → expected rate direction (ties fixed income to the macro engine) ─────────
export interface RateView { bias: "lower" | "higher" | "neutral"; bps: number; reasons: string[]; }

/** Scora's regime read → an expected 12m move in the 10y yield (bps) + why. Descriptive,
 *  not a promise: recession risk and an inverted curve bias rates DOWN (duration helps);
 *  strong liquidity/reflation biases them UP. */
export function regimeRateView(m: MacroState | null): RateView {
  if (!m) return { bias: "neutral", bps: 0, reasons: ["macro not available"] };
  let bps = 0; const reasons: string[] = [];
  const rec = Number(m.recession_prob);
  const curve = Number(m.t10y3m);
  const riskOn = Number(m.risk_on);
  if (!isNaN(rec)) { if (rec > 40) { bps -= 40; reasons.push(`recession risk ${rec.toFixed(0)} → cuts likely`); } else if (rec < 15) { bps += 10; reasons.push(`low recession risk ${rec.toFixed(0)}`); } }
  if (!isNaN(curve)) { if (curve < 0) { bps -= 25; reasons.push(`inverted curve (10y-3m ${curve.toFixed(2)}) → easing ahead`); } else if (curve > 1.5) { bps += 10; reasons.push(`steep curve ${curve.toFixed(2)}`); } }
  if (!isNaN(riskOn)) { if (riskOn > 65) { bps += 15; reasons.push(`strong liquidity/risk-on ${riskOn.toFixed(0)} → upward pressure`); } else if (riskOn < 40) { bps -= 15; reasons.push(`weak liquidity ${riskOn.toFixed(0)}`); } }
  const bias = bps <= -20 ? "lower" : bps >= 20 ? "higher" : "neutral";
  if (!reasons.length) reasons.push("no strong rate signal");
  return { bias, bps, reasons };
}
