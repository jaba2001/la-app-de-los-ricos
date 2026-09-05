// ─────────────────────────────────────────────────────────────────────────────
// Filing passage rendering — the PURE half of the grounding layer.
//
// Split out of knowledge.ts so it can be tested headlessly (scripts/retrieval.test.mjs).
// knowledge.ts imports the Supabase client, which makes it unimportable from a plain node
// test runner; this logic needs no database and shouldn't have been coupled to one.
// knowledge.ts re-exports everything here, so callers are unaffected.
// ─────────────────────────────────────────────────────────────────────────────

export interface KbDoc {
  ticker: string;
  form: string;
  section: string;
  text: string;
  filed_date: string | null;
  fiscal_year: number | null;
}

/**
 * Default retrieval query, used when a caller has nothing more specific.
 *
 * This exists because the previous behaviour — take the first 1 500 chars of each section
 * — meant the model almost always received the boilerplate preamble of Item 1A rather than
 * any actual risk. These are the terms an analyst reads a 10-K FOR, so even the
 * "no context" path returns substance instead of a header.
 */
export const DEFAULT_FILING_QUERY =
  "risk competition customers concentration demand pricing margin supply chain regulation litigation growth revenue";

/**
 * Render filing passages as a grounded block the model must cite.
 *
 * `budgetChars` caps the WHOLE block rather than each passage. Retrieval returns several
 * ~900-char chunks per section, so a per-passage cap would re-introduce exactly the
 * truncation this replaced; what actually needs bounding is the prompt. Passages arrive in
 * relevance order, so trimming from the end drops the least relevant.
 */
export function renderDocChunks(docs: KbDoc[], budgetChars = 9000): string {
  if (!docs.length) return "";
  const t = docs[0].ticker;
  const parts: string[] = [];
  let used = 0;
  for (const d of docs) {
    const fy = d.fiscal_year ? ` FY${d.fiscal_year}` : "";
    const body = (d.text || "").trim();
    if (!body) continue;
    const block = `--- ${d.form}${fy} · ${d.section} ---\n${body}`;
    if (used + block.length > budgetChars) {
      const room = budgetChars - used;
      if (room > 400) parts.push(block.slice(0, room)); // partial passage still beats none
      break;
    }
    parts.push(block);
    used += block.length;
  }
  if (!parts.length) return "";
  return `COMPANY FILINGS — verbatim excerpts from ${t}'s latest SEC 10-K, selected as the passages most relevant to this analysis. Use these for company-specific facts and cite the section in parentheses, e.g. "(10-K, Risk Factors)". Do NOT use any knowledge about ${t} beyond these excerpts and the metrics provided; if a detail isn't here, say it's not in the filing.
${parts.join("\n\n")}`;
}
