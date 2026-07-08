// ─────────────────────────────────────────────────────────────────────────────
// AI grounding (Phase 6) — the moat. The failure mode of a finance LLM is confident
// hallucination: when it lacks a number it fabricates one, or recalls stale Wall-Street
// consensus. The fix (Karpathy-style grounding, idea #25) is to feed ONLY the real,
// computed values and forbid invention. These builders assemble strictly-grounded
// prompts from Scora's own validated engine (Secular Clock, allocator risk-on, Regime
// Radar composites, stock-picking regime) + per-name data — every figure is real, and
// the model is told to cite only what it's given and to say "not available" otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import type { MacroState } from "./types";
import { secularRegime } from "./secular";
import { stockPickingRegime } from "./microScore";
import { blendWeights, ASSET_META, ALLOC_ASSETS } from "./allocation";

const n = (v: number | null | undefined, unit = "", d = 1) =>
  v == null || (typeof v === "number" && isNaN(v)) ? "not available" : `${(v as number).toFixed(d)}${unit}`;

// The anti-hallucination contract prepended to every grounded prompt.
export const GROUNDING_RULES = `GROUNDING RULES — follow strictly:
- Use ONLY the figures in the DATA block. Never invent, estimate, or recall a number that isn't given.
- When you reference a value, state it exactly as provided (e.g. "risk-on 68").
- If something you'd want is marked "not available", say so plainly — do not fabricate it.
- Ground every claim in a specific provided number. No vague or generic market commentary.
- This is educational analysis, not investment advice. Be concise and concrete.`;

/**
 * Grounded "Scora Brief" — a regime narrator over the validated stack: Secular Clock
 * (Layer 1) → risk-on allocation (Layer 2) → cross-asset context → stock-picking regime.
 * Every number comes from macro_state; the model interprets, it does not source data.
 */
export function buildAllocationBrief(macro: MacroState, kb = ""): string {
  const sec = secularRegime(macro.buffett_indicator ?? null, macro.cape ?? null, macro.expected_return_10y ?? null);
  const pick = stockPickingRegime(macro.implied_corr ?? null);
  const riskOn = macro.risk_on ?? null;
  const w = riskOn != null ? blendWeights(riskOn) : null;
  const weights = w ? ALLOC_ASSETS.map((a) => `${a} ${(w[a] * 100).toFixed(0)}% (${ASSET_META[a].role})`).join(", ") : "not available";

  return `${GROUNDING_RULES}${kb ? "\n\n" + kb : ""}

You are Scora's macro strategist. Write a crisp brief (≈180 words) with exactly these sections:
## Where we are
## What the allocation says
## What would change the view

Base everything strictly on the DATA. Reflect the layered logic: the Secular Clock sets the baseline equity exposure, the risk-on gauge tilts the tactical allocation around it, and the stock-picking regime says whether selecting names pays right now. End with a one-line Confidence: HIGH/MEDIUM/LOW and why.

DATA (as of ${macro.snapshot_date ?? "current"}):

LAYER 1 — SECULAR (long valuation cycle):
- Phase: ${sec.phase} · suggested secular equity baseline ${sec.baselineEquity}%
- Buffett Indicator: ${n(macro.buffett_indicator, "%", 0)} · CAPE: ${n(macro.cape, "", 1)} · expected 10y return: ${n(macro.expected_return_10y, "%", 1)}

LAYER 2 — TACTICAL RISK-ON (liquidity-led, stationary; validated OOS Sharpe 1.01):
- Risk-on gauge: ${n(riskOn, "/100", 0)} (${riskOn == null ? "n/a" : riskOn >= 60 ? "risk-on" : riskOn >= 40 ? "neutral" : "risk-off"})
- Drivers (0-100 percentiles): liquidity impulse ${n(macro.risk_on_lcc, "", 0)}, recession risk ${n(macro.risk_on_rpc, "", 0)}, financial stress ${n(macro.risk_on_csc, "", 0)}
- Pre-momentum tilt weights: ${weights}
- (A 12-1m dual-momentum gate then moves any risk sleeve with negative trend to cash — applied live.)

CROSS-ASSET CONTEXT:
- HY credit OAS: ${n(macro.hy_oas, " bps", 0)} · 10y-3m curve: ${n(macro.t10y3m, "%", 2)} · VIX: ${n(macro.vix, "", 0)} · DXY: ${n(macro.dxy, "", 0)}
- Production regime label: ${macro.regime_label ?? "not available"}

LAYER 4 — STOCK-PICKING REGIME (validated: momentum selection pays when correlation is low):
- Implied correlation (^COR3M): ${n(macro.implied_corr, "", 1)} → ${pick.label} (${pick.detail})`;
}

export interface StockThesisInput {
  ticker: string;
  sector: string | null;
  icScore: number | null;          // macro-tilted total (0-100)
  scores: { value: number; health: number; momentum: number; growth: number } | null;
  trajectory: number | null;        // 0-100 momentum rating
  mom12_1: number | null;           // %
  pe: number | null;
  pb: number | null;
  pfcf: number | null;
  macroTilt: number | null;         // pts
  rating: string | null;
}

/** Grounded per-name thesis — cites only the computed metrics + the live stock-picking regime. */
export function buildStockThesis(s: StockThesisInput, macro: MacroState | null, kb = ""): string {
  const pick = stockPickingRegime(macro?.implied_corr ?? null);
  return `${GROUNDING_RULES}${kb ? "\n\n" + kb : ""}

You are Scora's equity analyst. Write a tight thesis (≈140 words) for ${s.ticker} with exactly:
## Bull points
## Bear points
## Verdict
Cite the exact metrics below. Weight momentum/trajectory more heavily when the stock-picking regime favors selection (low correlation), less when it doesn't. End with: Conviction HIGH/MEDIUM/LOW.

DATA for ${s.ticker} (${s.sector ?? "sector n/a"}):
- Scora score (macro-tilted): ${n(s.icScore, "/100", 0)} · rating: ${s.rating ?? "not available"} · macro tilt: ${s.macroTilt == null ? "not available" : (s.macroTilt >= 0 ? "+" : "") + s.macroTilt + " pts"}
- Sub-scores: value ${n(s.scores?.value, "/25", 0)}, health ${n(s.scores?.health, "/30", 0)}, momentum ${n(s.scores?.momentum, "/25", 0)}, growth ${n(s.scores?.growth, "/20", 0)}
- Trajectory (momentum) rating: ${n(s.trajectory, "/100", 0)} · 12-1m momentum: ${n(s.mom12_1, "%", 0)}
- Valuation: P/E ${n(s.pe, "", 1)} · P/B ${n(s.pb, "", 1)} · P/FCF ${n(s.pfcf, "", 1)}

STOCK-PICKING REGIME (market-wide): implied correlation ${n(macro?.implied_corr, "", 1)} → ${pick.label}. ${pick.detail}`;
}

/**
 * Grounded earnings-call TONE analysis (idea #14) — scores management confidence, Q&A
 * evasiveness and guidance tone from a transcript. The grounding is strict: the model
 * analyzes ONLY the supplied text and must back every judgment with a direct quote from
 * it — no outside knowledge of the company, no invented figures. Research (MarketSenseAI
 * and NLP-of-earnings-calls literature) links call tone and Q&A evasiveness to forward
 * returns; the value here is a disciplined, quoted read, not a vibe.
 */
export function buildEarningsToneAnalysis(ticker: string, transcript: string): string {
  const text = (transcript || "").trim().slice(0, 16000); // cap input for cost; analyze the excerpt
  return `${GROUNDING_RULES}
- Additional rule: analyze ONLY the transcript below. Every judgment MUST be backed by a short DIRECT QUOTE from it (in "quotes"). Use no outside knowledge about ${ticker}. If the transcript doesn't address something, write "not addressed".

You are Scora's earnings-call analyst. Read the ${ticker} transcript excerpt and output exactly:
## Management confidence: N/100
[one line + a supporting quote]
## Q&A evasiveness: Low | Medium | High
[are questions answered directly or deflected? cite a quote]
## Guidance tone: Raised | Maintained | Lowered | Unclear
[cite the guidance language]
## Notable signals
- [each bullet: a claim + its "direct quote"]
## Net read
[2 sentences: does the tone lean constructive or cautious, strictly per the text]

TRANSCRIPT EXCERPT (${ticker}${transcript.length > 16000 ? ", truncated" : ""}):
"""
${text || "(no transcript provided)"}
"""`;
}
