import { supabase } from "./supabase";
import { checkGrounding } from "./grounding";

const BASE = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://ic-proxy-psi.vercel.app";

export async function authedFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[proxy ${res.status}] ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Model tiers. Both are in ic-proxy's ALLOWED_MODELS (app/api/anthropic/messages/route.js).
 * Default is Haiku 4.5 to keep the MVP's only paid dependency (Anthropic) at ~€10/month:
 * Haiku is $1/$5 per 1M in/out vs Sonnet's $3/$15 — 3× cheaper. Pass tier:"deep" only
 * for the flagship macro synthesis if you decide the quality is worth the extra spend.
 */
const AI_MODELS = { fast: "claude-haiku-4-5", deep: "claude-sonnet-4-6" } as const;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

// ── Pluggable provider seam (Phase 7 "ralph") ────────────────────────────────────────
// aiAnalyze talks to a Provider, not to Anthropic directly, so the backend is swappable
// behind one interface (Anthropic today; a local/OSS model or a different vendor later)
// without touching any caller. Default = the Anthropic passthrough on ic-proxy.
export interface AiProvider { name: string; complete(model: string, maxTokens: number, prompt: string): Promise<string>; }

// Both providers return Anthropic's { content:[{type:'text',text}] } shape — ic-proxy's
// /api/llm normalizes any free provider (Groq/Gemini) to it — so parsing is shared.
function parseAnthropic(res: AnthropicResponse): string {
  const text = res.content?.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  if (!text) throw new Error(res.error?.message ?? "Empty AI response");
  return text;
}

const anthropicProvider: AiProvider = {
  name: "anthropic",
  async complete(model, maxTokens, prompt) {
    const res = await authedFetch<AnthropicResponse>("/api/anthropic/messages", {
      method: "POST",
      body: JSON.stringify({ model, max_tokens: Math.min(4096, maxTokens), messages: [{ role: "user", content: prompt }] }),
    });
    return parseAnthropic(res);
  },
};

// Free-tier backend (Groq / Gemini) via ic-proxy /api/llm. The server picks the model, so
// the client-side model name is ignored here. Enabled with NEXT_PUBLIC_AI_PROVIDER=free.
const freeLlmProvider: AiProvider = {
  name: "free",
  async complete(_model, maxTokens, prompt) {
    const res = await authedFetch<AnthropicResponse>("/api/llm", {
      method: "POST",
      body: JSON.stringify({ max_tokens: Math.min(4096, maxTokens), messages: [{ role: "user", content: prompt }] }),
    });
    return parseAnthropic(res);
  },
};

// Default provider is swappable by env with zero code changes: set NEXT_PUBLIC_AI_PROVIDER=free
// to run the whole AI layer on a free-tier backend (€0). The code grounding gate keeps a
// weaker free model safe, so this doesn't sacrifice trust.
let activeProvider: AiProvider =
  (process.env.NEXT_PUBLIC_AI_PROVIDER || "").toLowerCase() === "free" ? freeLlmProvider : anthropicProvider;
export function setAiProvider(p: AiProvider) { activeProvider = p; }
export function getAiProvider(): AiProvider { return activeProvider; }

/**
 * Generate an AI analysis via the active provider. The proxy expects the raw Anthropic
 * Messages API body and returns the raw response; the provider extracts the text.
 */
export async function aiAnalyze(prompt: string, maxTokens = 1000, tier: keyof typeof AI_MODELS = "fast"): Promise<string> {
  return activeProvider.complete(AI_MODELS[tier], maxTokens, prompt);
}

// ── Audited generation (Phase 7) — grounding gate + audit trail ──────────────────────
export interface AuditOpts { module: string; ticker?: string; dataBlock?: string; sources?: string[]; maxTokens?: number; tier?: keyof typeof AI_MODELS; }
export interface AuditedResult { text: string; violations: number[]; grounded: boolean; }

/**
 * Like aiAnalyze, but (1) runs the code-level grounding gate over the output vs the DATA
 * block it was grounded on, and (2) writes an immutable row to ai_audit_log (inputs,
 * cited sources, output, model, violations, timestamp). Returns the flagged numbers so the
 * UI can surface "grounded ✓" or "N unverified figures". Logging is best-effort (never
 * blocks the answer). This is the governance layer that makes the AI auditable & vendible.
 */
export async function aiAnalyzeAudited(prompt: string, opts: AuditOpts): Promise<AuditedResult> {
  const model = AI_MODELS[opts.tier ?? "fast"];
  const text = await activeProvider.complete(model, opts.maxTokens ?? 1000, prompt);
  const gate = opts.dataBlock ? checkGrounding(text, opts.dataBlock) : { ok: true, violations: [] as number[], checked: 0 };
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("ai_audit_log").insert({
      user_id: user.id,
      ticker: opts.ticker ?? null,
      module: opts.module,
      model,
      prompt_chars: prompt.length,
      sources: opts.sources ?? null,
      output: text.slice(0, 8000),
      violations: gate.violations,
      grounded: gate.ok,
    });
  } catch { /* audit is best-effort — never block the user's answer */ }
  return { text, violations: gate.violations, grounded: gate.ok };
}
