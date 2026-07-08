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
