// ─────────────────────────────────────────────────────────────────────────────
// Research report engine (Phase 4) — the institutional initiation note. Reuses the
// production DCF machinery (computeWACC + runDCF from reverseDcf.ts) and adds the
// differentiator: the TERMINAL-MULTIPLE HINGE. A 10-year DCF's value is dominated by
// its terminal value, and TV depends entirely on one unprovable assumption. So we
// compute it BOTH ways — Gordon perpetuity (2.5%) and exit-at-today's-EV/EBITDA — and
// show the two intrinsic values and the gap between them, rather than averaging a
// false-precision single number. Plus DuPont ROE and a margin trend. All from data the
// stock page already fetched (income, balance, cash flow, quote) — zero extra calls.
// ─────────────────────────────────────────────────────────────────────────────
import { computeWACC, runDCF } from "./reverseDcf";

export interface ValuationInputs {
  currentPrice: number;
  revenueTTM: number;      // $
  fcfMarginTTM: number;    // decimal
  ebitdaTTM: number;       // $ (for the exit-multiple terminal)
  netDebt: number;         // $
  sharesOut: number;       // #
  beta: number;
  rfRate: number;          // % (dgs10)
  creditStress: number | null;
  currentEvEbitda: number | null; // exit multiple = today's EV/EBITDA (conservative "exit at current multiple")
  g1: number;              // near-term growth Y1-5 (%) — from analyst estimates if available
  g2: number;              // decel growth Y6-10 (%)
}

export interface ValuationResult {
  wacc: number;
  dcfGordon: number | null;      // intrinsic $/share, Gordon 2.5% terminal
  dcfExit: number | null;        // intrinsic $/share, exit-multiple terminal
  hingeGapPct: number | null;    // % gap between the two terminal methods (of the lower)
  gordonUpside: number | null;   // % vs current price
  exitUpside: number | null;
}

const GORDON_TERM_GR = 2.5;

/** Present value of the 10-year FCF stream + the projected year-10 EBITDA, for the exit path. */
function projectExit(revenueTTM: number, fcfMargin: number, ebitdaMargin: number, g1: number, g2: number, wacc: number) {
  let rev = revenueTTM, pvFcf = 0, ebitda10 = 0;
  for (let yr = 1; yr <= 10; yr++) {
    const g = (yr <= 5 ? g1 : g2) / 100;
    rev *= 1 + g;
    pvFcf += (rev * fcfMargin) / Math.pow(1 + wacc / 100, yr);
    if (yr === 10) ebitda10 = rev * ebitdaMargin;
  }
  return { pvFcf, ebitda10 };
}

export function forwardValuation(inp: ValuationInputs): ValuationResult {
  const wacc = computeWACC(inp.rfRate, inp.beta, inp.creditStress);
  const valid = inp.revenueTTM > 0 && inp.fcfMarginTTM > 0 && inp.sharesOut > 0 && inp.currentPrice > 0;

  // (a) Gordon perpetuity terminal — reuse the exact production DCF (single code path).
  const dcfGordon = valid ? runDCF(inp.revenueTTM, inp.fcfMarginTTM, inp.netDebt, inp.sharesOut, inp.g1, inp.g2, wacc, GORDON_TERM_GR) : null;

  // (b) Exit-multiple terminal — TV = projected year-10 EBITDA × today's EV/EBITDA.
  let dcfExit: number | null = null;
  if (valid && inp.currentEvEbitda != null && inp.currentEvEbitda > 0 && inp.ebitdaTTM > 0) {
    const ebitdaMargin = inp.ebitdaTTM / inp.revenueTTM;
    const { pvFcf, ebitda10 } = projectExit(inp.revenueTTM, inp.fcfMarginTTM, ebitdaMargin, inp.g1, inp.g2, wacc);
    const tvExit = ebitda10 * inp.currentEvEbitda;          // enterprise terminal value
    const pvTv = tvExit / Math.pow(1 + wacc / 100, 10);
    const equity = pvFcf + pvTv - inp.netDebt;
    dcfExit = equity > 0 ? equity / inp.sharesOut : 0;
  }

  const gordonUpside = dcfGordon != null ? ((dcfGordon - inp.currentPrice) / inp.currentPrice) * 100 : null;
  const exitUpside = dcfExit != null ? ((dcfExit - inp.currentPrice) / inp.currentPrice) * 100 : null;
  const hingeGapPct = dcfGordon != null && dcfExit != null && Math.min(dcfGordon, dcfExit) > 0
    ? (Math.abs(dcfGordon - dcfExit) / Math.min(dcfGordon, dcfExit)) * 100
    : null;

  return {
    wacc: Number(wacc.toFixed(1)),
    dcfGordon: dcfGordon != null ? Number(dcfGordon.toFixed(2)) : null,
    dcfExit: dcfExit != null ? Number(dcfExit.toFixed(2)) : null,
    hingeGapPct: hingeGapPct != null ? Number(hingeGapPct.toFixed(0)) : null,
    gordonUpside: gordonUpside != null ? Number(gordonUpside.toFixed(0)) : null,
    exitUpside: exitUpside != null ? Number(exitUpside.toFixed(0)) : null,
  };
}

// ── Football field — a range per valuation method, for the horizontal bar chart ──────
export interface FieldRange { label: string; lo: number; hi: number; mid?: number; kind: "dcf" | "analyst" | "market"; }

/** Assemble the valuation ranges. Uses only values the page already has. */
export function footballField(v: ValuationResult, currentPrice: number, analyst: { low: number | null; mean: number | null; high: number | null }, week52: { low: number | null; high: number | null }): FieldRange[] {
  const out: FieldRange[] = [];
  if (v.dcfGordon != null && v.dcfExit != null) {
    const lo = Math.min(v.dcfGordon, v.dcfExit), hi = Math.max(v.dcfGordon, v.dcfExit);
    out.push({ label: "DCF (terminal hinge)", lo, hi, kind: "dcf" });
  } else if (v.dcfGordon != null) {
    out.push({ label: "DCF (Gordon)", lo: v.dcfGordon * 0.9, hi: v.dcfGordon * 1.1, mid: v.dcfGordon, kind: "dcf" });
  }
  if (analyst.low != null && analyst.high != null) out.push({ label: "Analyst targets", lo: analyst.low, hi: analyst.high, mid: analyst.mean ?? undefined, kind: "analyst" });
  if (week52.low != null && week52.high != null) out.push({ label: "52-week range", lo: week52.low, hi: week52.high, mid: currentPrice, kind: "market" });
  return out;
}

// ── DuPont ROE decomposition — ROE = net margin × asset turnover × equity multiplier ──
export interface DuPont { roe: number | null; netMargin: number | null; assetTurnover: number | null; equityMultiplier: number | null; }

export function dupont(niTTM: number | null, revenueTTM: number | null, totalAssets: number | null, equity: number | null): DuPont {
  const netMargin = niTTM != null && revenueTTM ? niTTM / revenueTTM : null;
  const assetTurnover = revenueTTM != null && totalAssets ? revenueTTM / totalAssets : null;
  const equityMultiplier = totalAssets != null && equity ? totalAssets / equity : null;
  const roe = netMargin != null && assetTurnover != null && equityMultiplier != null ? netMargin * assetTurnover * equityMultiplier : null;
  return { roe, netMargin, assetTurnover, equityMultiplier };
}

// ── Bubble/boom gauge — is the price running ahead of fundamental (EPS) growth? ──────
// PEG-style read: price change vs EPS growth. >2 = price outrunning growth (froth),
// <0.5 = growth outrunning price (value). Honest, coarse — one signal, not a verdict.
export function bubbleGauge(priceChange1y: number | null, epsGrowth: number | null): { ratio: number | null; label: string; color: string } {
  if (priceChange1y == null || epsGrowth == null || Math.abs(epsGrowth) < 1) return { ratio: null, label: "n/a", color: "var(--sr-text-3)" };
  const ratio = priceChange1y / epsGrowth;
  if (ratio > 2) return { ratio, label: "Price outrunning growth", color: "var(--sr-neg)" };
  if (ratio < 0.5 && ratio > 0) return { ratio, label: "Growth outrunning price", color: "var(--sr-pos)" };
  if (ratio <= 0) return { ratio, label: "Price falling vs growth", color: "var(--sr-warn)" };
  return { ratio, label: "Price ~ tracking growth", color: "var(--sr-text-2)" };
}
