// ─────────────────────────────────────────────────────────────────────────────
// VALUATION LAB (Fase 2) — deepens the Valuation tab beyond the reverse-DCF:
//   • WACC bridge — CAPM cost of equity + after-tax cost of debt, weighted by cap structure.
//   • Forward DCF sensitivity matrix — fair value/share over a WACC × growth grid (reuses runDCF).
//   • Sector-relative comps — sector median multiple × company metric → fair-value range.
// Pure & headless. Reuses reverseDcf.runDCF + scoring sector benchmarks (one code path).
// ─────────────────────────────────────────────────────────────────────────────
import { runDCF, ERP_BASE } from "./reverseDcf.ts";
import { SECTOR_PE_BM, SECTOR_EV_BM } from "./scoring.ts";

const pos = (x: number | null | undefined): x is number => x != null && isFinite(x) && x > 0;
const num = (x: number | null | undefined): x is number => x != null && isFinite(x);

// ── WACC bridge ──────────────────────────────────────────────────────────────
export interface WaccBridge {
  costOfEquity: number;       // % (CAPM)
  costOfDebtAfterTax: number; // %
  weightEquity: number;       // 0-1
  weightDebt: number;         // 0-1
  wacc: number;               // %
}
export interface WaccInputs {
  rf: number | null; beta: number | null; erp?: number; taxRate?: number;
  marketCap: number | null; totalDebt: number | null; interestExpense: number | null;
}
export function waccBridge(inp: WaccInputs): WaccBridge | null {
  const E = inp.marketCap, D = num(inp.totalDebt) && inp.totalDebt > 0 ? inp.totalDebt : 0;
  if (!pos(E)) return null;
  const rf = num(inp.rf) ? inp.rf : 4.2;
  const beta = num(inp.beta) ? inp.beta : 1.0;
  const erp = inp.erp ?? ERP_BASE;
  const tax = inp.taxRate ?? 0.21;
  const ke = rf + beta * erp;
  const kdPre = D > 0 && num(inp.interestExpense) && inp.interestExpense > 0 ? (inp.interestExpense / D) * 100 : 0;
  const kd = kdPre * (1 - tax);
  const V = E + D;
  const we = E / V, wd = D / V;
  const wacc = we * ke + wd * kd;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { costOfEquity: r(ke), costOfDebtAfterTax: r(kd), weightEquity: r(we), weightDebt: r(wd), wacc: r(wacc) };
}

// ── Forward DCF sensitivity matrix ───────────────────────────────────────────
export interface DcfMatrixInputs { revenueTTM: number; fcfMarginTTM: number; netDebt: number; sharesOut: number; termGr?: number; }
export interface DcfMatrix { waccs: number[]; growths: number[]; grid: (number | null)[][]; }
/** Fair value / share over a WACC (rows) × Y1-5 growth (cols) grid. Y6-10 growth = g/2 (same
 *  deceleration as the reverse DCF). null cell = model undefined (wacc ≤ terminal growth). */
export function dcfMatrix(inp: DcfMatrixInputs, waccs: number[], growths: number[]): DcfMatrix | null {
  if (!pos(inp.revenueTTM) || !pos(inp.sharesOut) || !pos(inp.fcfMarginTTM)) return null;
  const termGr = inp.termGr ?? 3;
  const grid = waccs.map((w) => growths.map((g) => {
    const v = runDCF(inp.revenueTTM, inp.fcfMarginTTM, inp.netDebt, inp.sharesOut, g, g / 2, w, termGr);
    return v == null ? null : Math.round(v * 100) / 100;
  }));
  return { waccs, growths, grid };
}

// ── Sector-relative comps ────────────────────────────────────────────────────
export interface CompsResult { peBased: number | null; evBased: number | null; low: number | null; mid: number | null; high: number | null; sectorPe: number | null; sectorEv: number | null; }
export interface CompsInputs { sector: string | null; eps: number | null; ebitda: number | null; netDebt: number | null; sharesOut: number | null; }
/** Fair value/share from the sector's median P/E (× EPS) and EV/EBITDA (× EBITDA → equity). */
export function sectorComps(inp: CompsInputs): CompsResult | null {
  const sectorPe = inp.sector ? SECTOR_PE_BM[inp.sector] ?? null : null;
  const sectorEv = inp.sector ? SECTOR_EV_BM[inp.sector] ?? null : null;
  const peBased = pos(sectorPe) && pos(inp.eps) ? sectorPe * inp.eps : null;
  const evBased = pos(sectorEv) && pos(inp.ebitda) && pos(inp.sharesOut)
    ? (sectorEv * inp.ebitda - (num(inp.netDebt) ? inp.netDebt : 0)) / inp.sharesOut
    : null;
  const vals = [peBased, evBased].filter((v): v is number => v != null && v > 0);
  if (vals.length === 0 && sectorPe == null && sectorEv == null) return null;
  const r = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    peBased: r(peBased), evBased: r(evBased),
    low: vals.length ? r(Math.min(...vals)) : null,
    mid: vals.length ? r(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    high: vals.length ? r(Math.max(...vals)) : null,
    sectorPe, sectorEv,
  };
}
