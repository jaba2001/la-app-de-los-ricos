// ─────────────────────────────────────────────────────────────────────────────
// Grounding gate (Phase 7) — the governance mechanism that enforces the anti-hallucination
// contract in CODE, not just in the prompt. Every grounded AI answer is fed only a DATA
// block of real, computed numbers; a well-behaved answer therefore cites only numbers that
// appear in that block (or are trivially derived). checkGrounding extracts the SPECIFIC
// figures the model emitted and flags any that don't trace back to the DATA — the exact
// failure a hallucinating finance model produces. Pure module (no imports) so the red-team
// suite (research/redteam_grounding.mjs) can run it headless. Deliberately tuned for low
// false positives: bare round integers, years, and list counters are treated as qualitative.
// ─────────────────────────────────────────────────────────────────────────────

export interface NumToken { raw: string; value: number; specific: boolean; }

/** Extract numeric tokens from text: $1.2B, 4.34%, 310bp, 1,234, -5.2, 58. */
export function extractNumbers(text: string): NumToken[] {
  const out: NumToken[] = [];
  // optional $ , sign , digits with thousands , decimal , optional unit suffix.
  // `%` takes no \b (it's a non-word char, so `%\b` fails before a space/EOL and
  // integer percents like "25%" would slip through the gate as qualitative).
  const re = /(-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?\s?\d+(?:\.\d+)?)(\s?(?:%|bps?\b|[BMKT]\b))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawNum = m[1], suffix = (m[2] || "").trim();
    const cleaned = rawNum.replace(/[$,\s]/g, "");
    const value = parseFloat(cleaned);
    if (isNaN(value)) continue;
    const hasUnit = !!suffix || /\$/.test(rawNum);
    const hasDecimal = /\./.test(cleaned);
    const magnitude = Math.abs(value);
    // "specific" = a precise claim a model could fabricate: a decimal, a unit ($/%/bp/B…),
    // or a large integer. Bare small round integers (counts, "3 segments") are qualitative.
    const specific = hasDecimal || hasUnit || magnitude >= 100;
    out.push({ raw: (m[0] || "").trim(), value, specific });
  }
  return out;
}

const isYear = (v: number) => Number.isInteger(v) && v >= 1900 && v <= 2100;

/** Does `v` appear among the data values within relative/absolute tolerance? */
function present(v: number, dataVals: number[]): boolean {
  const tol = Math.max(Math.abs(v) * 0.02, 0.05); // 2% or 0.05 absolute
  return dataVals.some((d) => Math.abs(d - v) <= tol);
}

export interface GroundingResult { ok: boolean; violations: number[]; checked: number; }

/**
 * Check an AI output against the DATA block it was grounded on. Returns the SPECIFIC
 * numbers in the output that don't trace back to the data (potential hallucinations).
 * `hasUnit`-only figures are the strictest; qualitative integers are ignored.
 */
export function checkGrounding(output: string, dataBlock: string): GroundingResult {
  const dataVals = extractNumbers(dataBlock).map((t) => t.value);
  // Percent claims are often trivially derived from two data figures ("$210 is 14% above
  // $184.20", "27% gap") — let a %-token also match any pairwise ratio or share of the
  // data values. Only % tokens get this wider net; dollar figures and multiples must
  // appear in the data directly.
  const derivedPcts: number[] = [];
  for (let i = 0; i < dataVals.length; i++) {
    for (let j = 0; j < dataVals.length; j++) {
      if (i === j || dataVals[j] === 0) continue;
      const r = dataVals[i] / dataVals[j];
      derivedPcts.push(Math.abs(r - 1) * 100, Math.abs(r) * 100);
    }
  }
  const outTokens = extractNumbers(output).filter((t) => t.specific && !isYear(t.value));
  const violations: number[] = [];
  const seen = new Set<number>();
  for (const t of outTokens) {
    if (present(t.value, dataVals)) continue;
    if (t.raw.includes("%") && present(Math.abs(t.value), derivedPcts)) continue;
    if (seen.has(t.value)) continue;
    seen.add(t.value);
    violations.push(t.value);
  }
  return { ok: violations.length === 0, violations, checked: outTokens.length };
}

// Educational tool, not advice: flag imperative buy/sell recommendations and false
// certainty. "Bull/bear case", "the DCF implies…" are fine; "you should buy", "guaranteed
// to double" are not.
const ADVICE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\byou should (buy|sell|short|purchase|dump|invest)\b/i, label: "imperative recommendation" },
  { re: /\b(i|we) recommend (buying|selling|shorting|you)\b/i, label: "explicit recommendation" },
  { re: /\bguaranteed?\b/i, label: "false certainty (guarantee)" },
  { re: /\bwill (definitely|certainly|surely) (rise|fall|double|triple|go)\b/i, label: "false certainty (prediction)" },
  { re: /\bcan'?t lose\b|\brisk-?free\b/i, label: "risk-free claim" },
];

/** Detect advice/certainty phrasing that violates the educational-only stance. */
export function checkAdvice(text: string): string[] {
  return ADVICE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}
