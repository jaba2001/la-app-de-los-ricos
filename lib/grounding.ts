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

export interface NumToken {
  raw: string;
  value: number;
  specific: boolean;
  idx: number;      // match start within the input text
  end: number;      // match end within the input text
  pct: boolean;     // "%" suffix
  scale: number;    // suffix multiplier (K/M/B/T → 1e3/1e6/1e9/1e12, else 1)
}

const SCALE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

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
    out.push({
      raw: (m[0] || "").trim(), value, specific,
      idx: m.index, end: m.index + m[0].length,
      pct: suffix === "%",
      scale: SCALE[suffix] ?? 1,
    });
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

// ── Directional-consistency gate (F2.1) ───────────────────────────────────────────────
// The numeric gate verifies that FIGURES trace to the DATA; this one verifies that the
// RELATIONSHIPS the model states between its own figures are arithmetically true — the
// other classic hallucination shape: real numbers, false claim ("$165 sits above the
// $184.20 price", "$210 is 30% above $184.20" when it's 14%). Deliberately conservative:
// it only judges clean two-operand comparatives (and "X is N% above Y" relative claims)
// inside one sentence, skips negations, durations ("5 years"), years, filing names
// (10-K) and mixed %/non-% comparisons — a missed claim is fine, a false alarm is not.

const GT_WORDS = /\b(above|exceed(?:s|ed|ing)?|top(?:s|ped)?|beat(?:s)?|outpac(?:es|ed|ing)|higher than|greater than|more than|larger than|bigger than|ahead of|richer than|stronger than|faster than|wider than|(?:a )?premium to)\b/i;
// "trailing" is finance-speak (trailing twelve months / trailing P/E), never a
// comparative — only the finite verb forms "trails"/"trailed" count.
const LT_WORDS = /\b(below|beneath|trail(?:s|ed)|behind|lower than|less than|fewer than|smaller than|cheaper than|weaker than|slower than|narrower than|(?:a )?discount to|short of)\b/i;
const NEGATION = /\b(not|no longer|isn'?t|aren'?t|wasn'?t|weren'?t|hardly|barely|never|without)\b/i;
// A number glued to a duration/ordinal/filing word is a count, not a comparable quantity.
const NON_QUANTITY_AFTER = /^\s?-?\s?(years?|yrs?|months?|weeks?|days?|quarters?|K\b|Q\b|x\b|×)/i;

export interface DirectionResult { ok: boolean; violations: string[]; checked: number; }

/**
 * Verify the directional claims an output makes between its OWN numbers. Independent of
 * the DATA block (the numeric gate covers provenance); this catches internally
 * inconsistent statements. Returns human-readable violations.
 */
export function checkDirection(output: string): DirectionResult {
  const violations: string[] = [];
  let checked = 0;
  const sentences = output.split(/(?<=[.!?])\s+|\n+/);

  for (const sentence of sentences) {
    // Drop years, durations ("5 years", "5-year"), and filing names ("10-K") — they are
    // labels/counts, not quantities a comparative can bind to.
    const tokens = extractNumbers(sentence).filter((t) =>
      !isYear(t.value) && !NON_QUANTITY_AFTER.test(sentence.slice(t.end, t.end + 12)));

    for (let i = 0; i + 1 < tokens.length; i++) {
      const t1 = tokens[i], t2 = tokens[i + 1];
      const between = sentence.slice(t1.end, t2.idx);
      if (between.length > 80) continue;              // too far apart to be one claim
      if (NEGATION.test(between)) continue;           // "not above" → out of scope
      const gt = GT_WORDS.test(between), lt = LT_WORDS.test(between);
      if (gt === lt) continue;                        // no comparator, or contradictory
      const dir = gt ? 1 : -1;

      // Relative-distance claim: "<anchor> is <t1>% above/below <t2>" — verify the
      // arithmetic: anchor ≈ t2 × (1 ± t1/100). Needs a non-% anchor earlier in the
      // sentence; without one the claim is unverifiable (skip, don't flag).
      if (t1.pct && !t2.pct) {
        const t0 = tokens.slice(0, i).reverse().find((t) => !t.pct);
        if (!t0) continue;
        const expected = t2.value * t2.scale * (1 + (dir * t1.value) / 100);
        const tol = Math.max(Math.abs(expected) * 0.02, 0.05);
        checked++;
        if (Math.abs(t0.value * t0.scale - expected) > tol) {
          violations.push(`"${t0.raw} … ${t1.raw} ${dir > 0 ? "above" : "below"} ${t2.raw}" is arithmetically inconsistent`);
        }
        continue;
      }

      // Plain comparison — only between like units (% vs % or non-% vs non-%), with
      // suffix scales normalized ($1.2B vs $900M compares 1.2e9 vs 9e8).
      if (t1.pct !== t2.pct) continue;
      const a = t1.value * t1.scale, b = t2.value * t2.scale;
      const tol = Math.max(Math.abs(b) * 0.001, 1e-9);
      checked++;
      if (dir > 0 ? a <= b - tol : a >= b + tol) {
        violations.push(`"${t1.raw} ${dir > 0 ? "above" : "below"} ${t2.raw}" contradicts the values themselves`);
      }
    }
  }
  return { ok: violations.length === 0, violations, checked };
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
