// ─────────────────────────────────────────────────────────────────────────────
// Persistent knowledge layer (Karpathy-style grounding, idea #25). A small curated KB
// of Scora's OWN validated findings + methodology, each with a source. The AI layer
// retrieves the cards relevant to a context and is told to cite them — so it reasons
// from Scora's research (the backtests, the factor definitions) rather than training-
// data consensus. Retrieval is simple tag-matching (no embeddings needed for a curated
// KB of a few dozen cards); accumulate cards over time and it still works.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "./supabase";

export interface KbCard { id: string; topic: string; claim: string; source: string; tags: string[]; weight: number; }

/** Fetch the whole (small) knowledge base once. */
export async function fetchKbCards(): Promise<KbCard[]> {
  const { data } = await supabase.from("kb_cards").select("id,topic,claim,source,tags,weight");
  return (data as KbCard[]) ?? [];
}

/** Select cards sharing ≥1 tag with `tags`, best (highest weight) first, capped at `n`. */
export function selectCards(cards: KbCard[], tags: string[], n = 6): KbCard[] {
  const want = new Set(tags);
  return cards
    .filter((c) => c.tags.some((t) => want.has(t)))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}

/** Render selected cards as a grounded KNOWLEDGE BASE block for a prompt. */
export function renderKb(cards: KbCard[]): string {
  if (!cards.length) return "";
  const lines = cards.map((c) => `- [${c.topic}] ${c.claim} (source: ${c.source})`).join("\n");
  return `KNOWLEDGE BASE — Scora's own VALIDATED findings. Ground your reasoning in these and cite the relevant source in parentheses when you use one. Do not contradict them or substitute outside consensus:
${lines}`;
}

// ── Company filings (Phase 3) — verbatim 10-K excerpts, retrieved per ticker ──────
// kb_docs holds Business / Risk Factors / MD&A sections pulled from SEC EDGAR (free) by
// research/ingest_filings.mjs. The stock thesis retrieves the ticker's chunks and cites
// them, so bull/bear points can be grounded in the actual filing, not model memory.
export interface KbDoc { ticker: string; form: string; section: string; text: string; filed_date: string | null; fiscal_year: number | null; }

/**
 * Default retrieval query, used when a caller has nothing more specific.
 *
 * This exists because the previous behaviour — take the first 1 500 chars of each section
 * — meant the model almost always received the boilerplate preamble of Item 1A rather than
 * any actual risk. These are the terms an analyst reads a 10-K FOR, so even the
 * "no context" path now returns substance instead of a header.
 */
export const DEFAULT_FILING_QUERY =
  "risk competition customers concentration demand pricing margin supply chain regulation litigation growth revenue";

/**
 * Retrieve the filing passages relevant to `query` for this ticker.
 *
 * Prefers kb_chunks (whole sections, split for retrieval, ranked by Postgres full-text
 * search via the search_kb_chunks RPC) and falls back to the older kb_docs table when the
 * migration hasn't been applied or the ticker hasn't been re-ingested yet — so this is
 * safe to ship ahead of both.
 *
 * Signature is backwards compatible: `fetchDocChunks(ticker)` and
 * `fetchDocChunks(ticker, ["Risk Factors"])` behave as before.
 */
export async function fetchDocChunks(
  ticker: string,
  sections?: string[],
  opts?: { query?: string; perSection?: number },
): Promise<KbDoc[]> {
  const t = ticker.toUpperCase();
  const rank: Record<string, number> = { "Risk Factors": 0, "MD&A": 1, "Business": 2 };

  try {
    const { data, error } = await supabase.rpc("search_kb_chunks", {
      p_ticker: t,
      p_query: opts?.query ?? DEFAULT_FILING_QUERY,
      p_per_section: opts?.perSection ?? 3,
    });
    if (!error && Array.isArray(data) && data.length) {
      let chunks = data as KbDoc[];
      if (sections?.length) { const want = new Set(sections); chunks = chunks.filter((d) => want.has(d.section)); }
      if (chunks.length) return chunks;
    }
  } catch {
    /* RPC missing or unreachable → fall through to kb_docs */
  }

  const { data } = await supabase
    .from("kb_docs")
    .select("ticker,form,section,text,filed_date,fiscal_year")
    .eq("ticker", t);
  let docs = (data as KbDoc[]) ?? [];
  if (sections?.length) { const want = new Set(sections); docs = docs.filter((d) => want.has(d.section)); }
  // Deterministic order: Risk Factors first (most useful for bear points), then MD&A, then Business.
  return docs.sort((a, b) => (rank[a.section] ?? 9) - (rank[b.section] ?? 9));
}

/**
 * Render filing passages as a grounded block the model must cite.
 *
 * `budgetChars` caps the WHOLE block rather than each passage. Retrieval now returns
 * several ~900-char chunks per section, so a per-passage cap would re-introduce exactly
 * the truncation this replaced; what actually needs bounding is the prompt.
 * Passages arrive in relevance order, so trimming from the end drops the least relevant.
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
