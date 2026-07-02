import { supabase } from "./supabase";

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

/**
 * Generate an AI analysis through ic-proxy's /api/anthropic/messages passthrough.
 * The proxy expects the raw Anthropic Messages API body and returns the raw
 * Anthropic response; this helper wraps the prompt and extracts the text.
 */
export async function aiAnalyze(prompt: string, maxTokens = 1000, tier: keyof typeof AI_MODELS = "fast"): Promise<string> {
  const res = await authedFetch<AnthropicResponse>("/api/anthropic/messages", {
    method: "POST",
    body: JSON.stringify({
      model: AI_MODELS[tier],
      max_tokens: Math.min(4096, maxTokens),
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const text = res.content
    ?.filter(b => b.type === "text" && typeof b.text === "string")
    .map(b => b.text)
    .join("\n");
  if (!text) throw new Error(res.error?.message ?? "Empty AI response");
  return text;
}
