// ─────────────────────────────────────────────────────────────────────────────
// Persistent knowledge layer (Karpathy-style grounding, idea #25). A small curated KB
// of Scora's OWN validated findings + methodology, each with a source. The AI layer
// retrieves the cards relevant to a context and is told to cite them — so it reasons
// from Scora's research (the backtests, the factor definitions) rather than training-
// data consensus. Retrieval is simple tag-matching (no embeddings needed for a curated
// KB of a few dozen cards); accumulate cards over time and it still works.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "./supabase";
// Las partes PURAS del renderizado viven en ./filingRender para poder testearlas sin
// arrastrar el cliente de Supabase (scripts/retrieval.test.mjs). Se reexportan aquí
// para que los llamadores existentes no cambien.
import { renderDocChunks, DEFAULT_FILING_QUERY, type KbDoc } from "./filingRender";
export { renderDocChunks, DEFAULT_FILING_QUERY };
export type { KbDoc };

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

