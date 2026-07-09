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

/** Fetch this ticker's filing section chunks (optionally limited to certain sections). */
export async function fetchDocChunks(ticker: string, sections?: string[]): Promise<KbDoc[]> {
  const { data } = await supabase
    .from("kb_docs")
    .select("ticker,form,section,text,filed_date,fiscal_year")
    .eq("ticker", ticker.toUpperCase());
  let docs = (data as KbDoc[]) ?? [];
  if (sections?.length) { const want = new Set(sections); docs = docs.filter((d) => want.has(d.section)); }
  // Deterministic order: Risk Factors first (most useful for bear points), then MD&A, then Business.
  const rank: Record<string, number> = { "Risk Factors": 0, "MD&A": 1, "Business": 2 };
  return docs.sort((a, b) => (rank[a.section] ?? 9) - (rank[b.section] ?? 9));
}

/** Render filing chunks as a grounded block the model must cite (e.g. "(10-K FY2025, Risk Factors)"). */
export function renderDocChunks(docs: KbDoc[], perSectionChars = 1500): string {
  if (!docs.length) return "";
  const t = docs[0].ticker;
  const blocks = docs.map((d) => {
    const fy = d.fiscal_year ? ` FY${d.fiscal_year}` : "";
    return `--- ${d.form}${fy} · ${d.section} ---\n${(d.text || "").slice(0, perSectionChars).trim()}`;
  }).join("\n\n");
  return `COMPANY FILINGS — verbatim excerpts from ${t}'s latest SEC 10-K. Use these for company-specific facts and cite the section in parentheses, e.g. "(10-K, Risk Factors)". Do NOT use any knowledge about ${t} beyond these excerpts and the metrics provided; if a detail isn't here, say it's not in the filing.
${blocks}`;
}
