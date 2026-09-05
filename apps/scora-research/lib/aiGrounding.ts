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

/** Grounded per-name thesis — cites only the computed metrics, the ticker's real filing
 *  excerpts (kb_docs), and the live stock-picking regime. */
export function buildStockThesis(s: StockThesisInput, macro: MacroState | null, kb = "", filings = ""): string {
  const pick = stockPickingRegime(macro?.implied_corr ?? null);
  return `${GROUNDING_RULES}${kb ? "\n\n" + kb : ""}${filings ? "\n\n" + filings : ""}

You are Scora's equity analyst. Write a tight thesis (≈150 words) for ${s.ticker} with exactly:
## Bull points
## Bear points
## Verdict
Cite the exact metrics below. ${filings ? `When the filing excerpts are provided, ground at least one bear point in a specific Risk Factor or MD&A statement and cite it, e.g. "(10-K, Risk Factors)". ` : ""}Weight momentum/trajectory more heavily when the stock-picking regime favors selection (low correlation), less when it doesn't. End with: Conviction HIGH/MEDIUM/LOW.

DATA for ${s.ticker} (${s.sector ?? "sector n/a"}):
- Scora score (macro-tilted): ${n(s.icScore, "/100", 0)} · rating: ${s.rating ?? "not available"} · macro tilt: ${s.macroTilt == null ? "not available" : (s.macroTilt >= 0 ? "+" : "") + s.macroTilt + " pts"}
- Sub-scores: value ${n(s.scores?.value, "/25", 0)}, health ${n(s.scores?.health, "/30", 0)}, momentum ${n(s.scores?.momentum, "/25", 0)}, growth ${n(s.scores?.growth, "/20", 0)}
- Trajectory (momentum) rating: ${n(s.trajectory, "/100", 0)} · 12-1m momentum: ${n(s.mom12_1, "%", 0)}
- Valuation: P/E ${n(s.pe, "", 1)} · P/B ${n(s.pb, "", 1)} · P/FCF ${n(s.pfcf, "", 1)}

STOCK-PICKING REGIME (market-wide): implied correlation ${n(macro?.implied_corr, "", 1)} → ${pick.label}. ${pick.detail}`;
}

// ── Due-diligence modules (Phase 6) — the guided workflow ────────────────────────────
// Each module is a focused grounded prompt sharing one DATA block (the component builds it
// once and also hands it to the code gate). The "golden rule" — cite / verify / challenge —
// is exactly GROUNDING_RULES. Qualitative modules (moat, red-flags) lean on the filing
// excerpts; numeric ones cite the DATA. All must obey the anti-hallucination contract.
export type ModuleKind = "redflags" | "moat" | "bullbear" | "macrosens" | "thesisupdate";

export const MODULE_META: Record<ModuleKind, { label: string; blurb: string }> = {
  redflags:     { label: "Red-flag scanner",     blurb: "Accounting, leverage, dilution, concentration, litigation — from the 10-K." },
  moat:         { label: "Moat audit",           blurb: "The 7 sources of durable competitive advantage, each rated." },
  bullbear:     { label: "Bull vs bear",         blurb: "Steelman both sides, then a referee verdict." },
  macrosens:    { label: "Macro sensitivity",    blurb: "Exposure to rates, USD, oil, growth, liquidity in this regime." },
  thesisupdate: { label: "What defines the thesis", blurb: "The metrics that matter now + their upgrade/downgrade triggers." },
};

const MODULE_TASK: Record<ModuleKind, string> = {
  redflags: `Scan ${"{T}"} for RED FLAGS across: accounting quality, liquidity/leverage, share dilution, customer/supplier concentration, litigation/regulatory, governance. List up to 5, most serious first. Each: **Flag** — severity Low/Med/High — a supporting DIRECT QUOTE from the filing (cite "(10-K, section)") or a specific provided metric. If the data/filing does not support a flag, write "none evident in the provided data" — do not invent one.`,
  moat: `Audit ${"{T}"}'s economic moat across the 7 sources: network effects, switching costs, cost advantage, intangibles/brand, efficient scale, data advantage, regulatory/licensing. For EACH: rating None/Narrow/Wide + one line grounded in the Business filing or a provided metric (e.g. ROE, margins). End with ## Overall moat: None/Narrow/Wide and the single strongest pillar.`,
  bullbear: `Pressure-test ${"{T}"}. Output ## Strongest bull (3 points, each tied to a provided number or filing quote) then ## Strongest bear (3 points, each tied to a number or a Risk Factor quote) then ## Referee — which case the DATA currently supports better, and the ONE fact that would flip it.`,
  macrosens: `Decode ${"{T}"}'s MACRO SENSITIVITY for the current regime. Rate exposure −−/−/0/+/++ to each: rates & duration, US dollar, oil/inflation, growth/recession, liquidity. Ground each in the sector and the provided macro figures. End with ## Net regime read: headwind/neutral/tailwind for ${"{T}"} right now, and why.`,
  thesisupdate: `Define what drives ${"{T}"}'s thesis NOW. List the 3 metrics that most determine the outcome from here; for each give its current level (from DATA) and the specific threshold that would be an UPGRADE trigger and a DOWNGRADE trigger. End with the single most important thing to watch next.`,
};

/** Assemble a grounded due-diligence module prompt. `dataBlock` is the shared real-number
 *  context (also passed to the code gate); kb/filings are the retrieved grounding blocks. */
export function buildDiligenceModule(kind: ModuleKind, ticker: string, dataBlock: string, kb = "", filings = ""): string {
  const task = MODULE_TASK[kind].replace(/\{T\}/g, ticker);
  return `${GROUNDING_RULES}${kb ? "\n\n" + kb : ""}${filings ? "\n\n" + filings : ""}

You are Scora's analyst running one step of a due-diligence workflow on ${ticker}. Be concrete, grounded, and concise (≤170 words). Cite a provided number or a filing section for every substantive claim.

TASK: ${task}

${dataBlock}`;
}

export interface ResearchReportInput {
  ticker: string;
  company: string | null;
  sector: string | null;
  price: number | null;
  marketCap: number | null;         // $
  wacc: number | null;              // %
  dcfGordon: number | null;         // $/share
  dcfExit: number | null;           // $/share
  hingeGapPct: number | null;       // %
  analystMean: number | null;       // $/share
  roe: number | null;               // decimal
  netMargin: number | null;         // decimal
  revGrowth: number | null;         // % YoY
  pe: number | null;
  evEbitda: number | null;
  netDebtEbitda: number | null;
  scoreTotal: number | null;
  trajectory: number | null;        // 0-100 momentum
}

/**
 * Grounded institutional-style research note (Phase 4). Writes a SWOT + bull/base/bear
 * scenarios from the computed valuation (the terminal-multiple hinge, DuPont, momentum)
 * and the ticker's real 10-K excerpts (kb_docs). Strict grounding: every claim cites a
 * provided number or a filing section; scenarios must reference the DCF hinge explicitly.
 */
export function buildResearchReport(s: ResearchReportInput, kb = "", filings = ""): string {
  return `${GROUNDING_RULES}${kb ? "\n\n" + kb : ""}${filings ? "\n\n" + filings : ""}

You are Scora's senior analyst writing an initiation note on ${s.ticker}${s.company ? ` (${s.company})` : ""}. Be concrete and grounded. Output EXACTLY these sections:
## Thesis
[2 sentences: what this company is and the core investment question, grounded in the data.]
## SWOT
- Strength: …
- Weakness: …
- Opportunity: …
- Threat: … ${filings ? `(ground Weakness/Threat in a specific Risk Factor / MD&A statement and cite "(10-K, section)")` : ""}
## Valuation read
[Interpret the TERMINAL-MULTIPLE HINGE: the DCF is worth $${n(s.dcfGordon, "", 0)} on a Gordon 2.5% perpetuity vs $${n(s.dcfExit, "", 0)} on an exit-at-today's-multiple terminal, a ${n(s.hingeGapPct, "%", 0)} gap. Explain what each assumption implies and which is more defensible for THIS business — do NOT just average them. Reference the analyst mean $${n(s.analystMean, "", 0)} and WACC ${n(s.wacc, "%", 1)}.]
## Scenarios
- Bull: [1 line + rough value]
- Base: [1 line + rough value]
- Bear: [1 line + rough value]
## Verdict
[1-2 sentences + Conviction HIGH/MEDIUM/LOW]

DATA for ${s.ticker} (${s.sector ?? "sector n/a"}):
- Price $${n(s.price, "", 2)} · market cap $${s.marketCap != null ? (s.marketCap / 1e9).toFixed(1) + "B" : "not available"}
- Valuation hinge: DCF-Gordon $${n(s.dcfGordon, "", 0)}, DCF-exit-multiple $${n(s.dcfExit, "", 0)}, gap ${n(s.hingeGapPct, "%", 0)}, WACC ${n(s.wacc, "%", 1)}, analyst mean $${n(s.analystMean, "", 0)}
- Quality: ROE ${s.roe != null ? (s.roe * 100).toFixed(0) + "%" : "not available"}, net margin ${s.netMargin != null ? (s.netMargin * 100).toFixed(0) + "%" : "not available"}, revenue growth ${n(s.revGrowth, "%", 0)} YoY
- Valuation multiples: P/E ${n(s.pe, "", 1)}, EV/EBITDA ${n(s.evEbitda, "", 1)}, net debt/EBITDA ${n(s.netDebtEbitda, "", 1)}
- Scora score ${n(s.scoreTotal, "/100", 0)} · momentum/trajectory ${n(s.trajectory, "/100", 0)}`;
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

export interface NewsHeadline { headline: string; summary?: string; source?: string; datetime?: string }

/**
 * Grounded NEWS relevance filter (P1-5, TradeVision's "filter 10k stories/day" idea, done
 * honestly). The model sorts the supplied headlines into market-moving vs noise and tags
 * sentiment — using ONLY the headlines/summaries given, no outside knowledge, no invented
 * facts or figures. This is the disciplined, cite-the-headline read that a generic AI news
 * feed can't promise.
 */
export function buildNewsRelevance(ticker: string, items: NewsHeadline[]): string {
  const list = items.slice(0, 20).map((it, i) => {
    const when = it.datetime ? ` (${it.datetime})` : "";
    const src = it.source ? ` [${it.source}]` : "";
    const sum = it.summary ? ` — ${it.summary.slice(0, 220)}` : "";
    return `${i + 1}.${src}${when} ${it.headline}${sum}`;
  }).join("\n");
  return `${GROUNDING_RULES}
- Additional rule: use ONLY the headlines/summaries below. Do NOT add facts, figures, prices or events that are not in this list. If nothing is material, say so. Never invent a number.

You are Scora's news analyst for ${ticker}. Classify the items and output exactly:
## Market-moving
- [short headline] — Bullish | Bearish | Neutral · why it matters (≤12 words, grounded in the item)
## Noise
- [short headline] — why it's not decision-relevant (≤10 words)
## Net read
[1-2 sentences: what, on balance, this news flow means for ${ticker}, strictly per the items]

NEWS ITEMS (${ticker}, newest first):
"""
${list || "(no recent news)"}
"""`;
}
