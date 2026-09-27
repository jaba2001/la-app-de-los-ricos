// Coste estimado de una llamada al modelo. PURO: lo usan el navegador (analítica) y el
// servidor (el registro de auditoría, lib/server/auditoriaIA.js), así que no puede importar
// nada que arrastre sesión, red o DOM. Estaba dentro de lib/proxy.ts.

/** Token counts for one completion. Null when the backend doesn't report them. */
export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

// USD per 1M tokens, for OBSERVABILITY ONLY — never billing. Anthropic's invoice is the
// source of truth; this exists so "which module is eating the €10/month" is answerable
// without leaving PostHog. Keep in sync with AI_MODELS in lib/proxy.ts if a tier changes.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};

/** Rough USD cost of one completion. Null when tokens or price are unknown. */
export function estimateCostUsd(model: string, usage: AiUsage | null): number | null {
  const p = PRICE_PER_MTOK[model];
  if (!p || !usage || usage.inputTokens == null || usage.outputTokens == null) return null;
  // Cached reads bill at ~0.1x input. Treated as plain input when not reported, which
  // over-estimates slightly — better to over- than under-state a cost figure.
  const cached = usage.cacheReadTokens ?? 0;
  const fresh = Math.max(0, usage.inputTokens - cached);
  const usd = (fresh * p.in + cached * p.in * 0.1 + usage.outputTokens * p.out) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/** Los recuentos de Anthropic (snake_case) a la forma de arriba. */
export function usageDeAnthropic(u: {
  input_tokens?: number; output_tokens?: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
} | null | undefined): AiUsage | null {
  if (!u) return null;
  return {
    inputTokens: u.input_tokens ?? null,
    outputTokens: u.output_tokens ?? null,
    cacheReadTokens: u.cache_read_input_tokens ?? null,
    cacheCreationTokens: u.cache_creation_input_tokens ?? null,
  };
}
