// ─────────────────────────────────────────────────────────────────────────────
// 10-K SECTION PARSER — extracted from ingest_filings.mjs so it can be regression-tested
// against real filings (research/parser_regression.mjs) instead of only being exercised
// by a live ingest run.
//
// The job: given the plain text of a 10-K, find the three sections an analyst reads —
// Business (Item 1), Risk Factors (Item 1A), MD&A (Item 7) — and return their bodies.
// Hard because the same "Item 1A. Risk Factors" string appears many times in a filing:
// once in the table of contents, once as the real heading, and repeatedly as back-
// references ("see Item 1A. Risk Factors — Risks Related to…"). Only one is the section.
// ─────────────────────────────────────────────────────────────────────────────

/** Chars kept per section. See ingest_filings.mjs for why this is large now. */
export const MAX_SECTION = 60000;

/** HTML → readable text: drop script/style noise, tags → space, decode EDGAR entities. */
export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#8217;|&#x2019;|&rsquo;/gi, "’").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8212;|&mdash;/gi, "—").replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#\d+;|&[a-z]+;/gi, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A "heading" match is a CROSS-REFERENCE ("…see Item 1A. Risk Factors of this Form 10-K",
// "Item 1 Business and Note 15…"), not the real section title, when it's immediately
// followed by citation language. Those must be rejected or they hijack the extraction.
const XREF = /^\s*(of\s+(this|our)\b|in\s+(part|this|note)\b|and\s+note\b|and\s+legal\b|and\s+other\b|,|"|”|;|–|-|section\b|above\b|below\b|for\s+(a|additional|further)\b|of\s+the\s+notes)/i;

// Table-of-contents / navigation markers.
//
// MEASURED 2026-08-10 — this list used to also contain `on form 10-K`,
// `in this annual report` and `of this annual report`, and those three were rejecting the
// GENUINE Risk Factors section of NVDA (114k chars), MU (102k), ANET (189k) and LRCX
// (97k), because a real risk section almost always opens with a sentence like "The
// following risk factors should be considered in addition to the other information
// contained in this Annual Report on Form 10-K". Referring to the report you are inside
// is normal prose, not a navigation marker. What remains below are markers that only a
// TOC entry or a genuine cross-reference produces.
const NAV = /(table of contents|in\s+part\s+i{1,2}\b|financial\s+statements\s+included|notes\s+to\s+(consolidated|the)|item\s*[2-9][a-b]?\b)/i;

/**
 * Pick the REAL section body among every heading occurrence.
 *
 * Selection is EARLIEST-substantial, not longest. Longest is wrong and was a latent bug:
 * back-references that appear AFTER the real section produce LONGER spans, because no
 * terminating "Item 1B/2/3" heading follows them and the body runs to the end of the
 * document. Measured on NVDA: the real section is 114,713 chars at offset 78,678, while a
 * cross-reference at 204,108 yields 156,040. Longest-wins picks the cross-reference and
 * starts mid-sentence. The genuine heading appears once; everything matching later is a
 * reference back to it — so among candidates with a real body, the first one wins.
 */
/**
 * Offset where a section ends: the first terminator heading that is NOT an inline citation.
 *
 * The naive `after.search(/item\s*1a[.\s)]/)` treats any mention of the next item as the
 * end, including one inside a sentence. Measured on CSCO — its Business section says
 * `…see "Item 1A. Risk Factors…"` partway through, which chopped Item 1 from its true
 * extent down to 7,741 chars, ending mid-sentence on the word "see". A real terminator is
 * a heading; a cited one is preceded by see/in/under or an opening quote.
 */
function findEnd(after, endRes) {
  let best = after.length;
  for (const er of endRes) {
    const re = new RegExp(er.source, "gi");
    let m;
    while ((m = re.exec(after)) !== null) {
      const before = after.slice(Math.max(0, m.index - 24), m.index);
      if (/\b(see|in|under|within|refer\s+to|to|and)\s*["“]?\s*$/i.test(before)) continue; // "…see Item 1A"
      if (/["“(]\s*$/.test(before)) continue;                                              // '…"Item 1A'
      // "…included in Part II, Item 8 of this Form 10-K" — the citation form that opens
      // almost every MD&A. Measured: it was cutting AAPL's MD&A to 205 chars, MSFT's to
      // 466 and LRCX's to 445, all of which then failed the 1,200 floor and vanished.
      if (/part\s+i{1,2}\s*,?\s*$/i.test(before)) continue;
      if (m.index < best) best = m.index;
      break; // first genuine terminator for this pattern is the one that counts
    }
  }
  return best;
}

export function bestSection(text, startRe, endRes) {
  const ms = [...text.matchAll(new RegExp(startRe.source, "gi"))];
  if (!ms.length) return null;
  const cands = [];
  for (const m of ms) {
    const s = m.index, headingEnd = s + m[0].length;
    const before = text.slice(Math.max(0, s - 18), s);
    if (/\b(in|see|to|under|within|refer\s+to)\s+$/i.test(before)) continue; // "…discussion in Item 7…" = mid-sentence reference
    const tail = text.slice(headingEnd, headingEnd + 140);
    if (XREF.test(tail)) continue;                 // heading followed by citation language
    if (NAV.test(tail.slice(0, 140))) continue;    // opening references the TOC / another item
    const after = text.slice(headingEnd);
    const e = findEnd(after, endRes);
    cands.push({ s, end: headingEnd + e, len: e });
  }
  // Substantial body first (drops TOC entries, whose bodies are a handful of chars), then
  // earliest position.
  const real = cands.filter((c) => c.len >= 1200).sort((a, b) => a.s - b.s)[0];
  if (!real) return null;
  return text.slice(real.s, real.end).replace(/\s+/g, " ").trim().slice(0, MAX_SECTION);
}

// Some filers (MSFT, INTC…) render section titles with per-letter letter-spacing, so after
// stripping tags a heading reads "RIS K FACTORS" / "B USINESS". Match each keyword
// letter-by-letter with optional whitespace between — still matches contiguous headings.
const sp = (w) => w.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");

// Separator between the item number and its title.
//
// MEASURED 2026-08-10 — this used to be `[.\s)]`, i.e. dot / whitespace / close-paren.
// Real filings also use a colon and an em/en dash, and those two omissions silently cost
// us entire companies: AMAT writes "Item 1A: Risk Factors" (0 matches in the whole
// document) and DELL writes "ITEM 1A — RISK FACTORS" (only the dotted TOC entry matched).
// It breaks Item 1 and Item 7 for the same filers too, not just Item 1A.
//
// The PLAIN HYPHEN is deliberately NOT here, and that is not an oversight. Adding it was
// tried and measured: it makes "Item 7-Management's Discussion…" match, which in AMD's
// filing is a mid-sentence cross-reference, and it also makes "…in Item 8-Financial
// Statements" terminate a section 431 chars in. A hyphen is ordinary punctuation inside
// prose; a colon or an em dash after an item number is not. Widening this class is exactly
// the kind of change that must go through research/parser_regression.mjs first.
const SEP = "[.:\\s)\\u2014\\u2013]+";

// Terminators stay NARROW — `[.\s)]`, the original set — and this asymmetry with SEP is
// deliberate. The start pattern wants to be generous: missing a heading loses the whole
// section. A terminator wants to be strict: it only has to fire once, too early, to
// truncate a section to nothing. Measured on AMD — widening this to match SEP let a
// mid-prose reference ("…read in conjunction with the Consolidated Financial Statements
// in Item 8…") cut MD&A from 21,272 chars to 431, which then failed the 1,200 floor and
// dropped the section entirely.
const END = "[.\\s)]";

export function extractSections(text) {
  const out = {};
  const biz = bestSection(text, new RegExp(`item\\s*1${SEP}${sp("business")}`), [new RegExp(`item\\s*1a${END}`), new RegExp(`item\\s*2${END}`)]);
  const risk = bestSection(text, new RegExp(`item\\s*1a${SEP}${sp("risk")}\\s*${sp("factors")}`), [new RegExp(`item\\s*1b${END}`), new RegExp(`item\\s*2${END}`), new RegExp(`item\\s*3${END}`)]);
  const mda = bestSection(text, new RegExp(`item\\s*7${SEP}${sp("management")}[\\s’'\`]*s\\s+${sp("discussion")}`), [new RegExp(`item\\s*7a${END}`), new RegExp(`item\\s*8${END}`)]);
  if (biz) out["Business"] = biz;
  if (risk) out["Risk Factors"] = risk;
  if (mda) out["MD&A"] = mda;
  return out;
}
