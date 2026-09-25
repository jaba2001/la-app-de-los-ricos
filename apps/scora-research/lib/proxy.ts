import { supabase } from "./supabase";
import { checkGrounding, checkDirection } from "./grounding";
import { track } from "./analytics";
import { setQuota } from "./quotaState";
import { createBatcher } from "./batchQueue";

// Vacío = mismo origen. Desde que el backend vive en esta misma app (app/api/*), las
// llamadas son relativas y no hay que decirle a nadie dónde está: se acabó el CORS, se acabó
// el salto entre dominios, y se acabó tener que reconstruir la imagen cuando cambia una URL.
//
// La variable sigue existiendo por si algún día hay que apuntar a un backend externo — por
// ejemplo para depurar contra producción desde local. Todos los que llaman aquí son código
// de navegador (comprobado), así que una URL relativa siempre resuelve.
const BASE = process.env.NEXT_PUBLIC_PROXY_URL ?? "";

/**
 * Se ha agotado la cuota diaria de IA.
 *
 * Es un Error normal con un `message` YA LEGIBLE, y eso es lo que lo hace útil: las nueve
 * pantallas que llaman a la IA hacen `setError(e.message)`, así que con el mensaje bien
 * puesto aquí todas mejoran a la vez y ninguna hay que tocarla. Si en su lugar se dejara
 * escapar el error genérico, el usuario leería
 * `[proxy 429] /api/anthropic/messages: {"error":"Daily AI limit…}` — el texto correcto
 * envuelto en ruido que parece una avería.
 *
 * Los campos estructurados quedan disponibles para quien quiera pintar algo mejor que una
 * línea de texto (un enlace a /pricing, por ejemplo).
 */
export class QuotaError extends Error {
  readonly limit: number;
  readonly used: number;
  readonly plan: string;
  readonly upgradeUrl: string | null;
  readonly resetsAt: string | null;
  constructor(msg: string, d: { limit?: number; used?: number; plan?: string; upgrade_url?: string | null; resets_at?: string | null }) {
    super(msg);
    this.name = "QuotaError";
    this.limit = d.limit ?? 0;
    this.used = d.used ?? 0;
    this.plan = d.plan ?? "free";
    this.upgradeUrl = d.upgrade_url ?? null;
    this.resetsAt = d.resets_at ?? null;
  }
}

async function singleFetch<T = unknown>(
  path: string,
  options?: RequestInit,
  timeoutMs = 30_000
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  // A hung upstream must not hold the caller hostage — analyze() fires ~30 of these in
  // parallel and one stalled endpoint used to block the whole run. Callers can pass
  // their own signal (options.signal wins) or a custom timeoutMs (LLM calls use 60s).
  const signal = options?.signal
    ?? (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined);
  const res = await fetch(`${BASE}${path}`, { ...options, headers, signal });

  // Las rutas de IA devuelven el estado de la cuota en cabeceras, tanto si van bien como si
  // rechazan. Leerlas aquí es lo que permite avisar ANTES de chocarse con el límite; el
  // resto de rutas no las mandan y esto no hace nada.
  const qLimit = res.headers.get("X-Scora-Quota-Limit");
  if (qLimit) {
    setQuota({
      limit: Number(qLimit),
      remaining: Number(res.headers.get("X-Scora-Quota-Remaining") ?? 0),
      plan: res.headers.get("X-Scora-Plan") ?? "free",
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    if (res.status === 429) {
      // Puede ser la cuota diaria o el limitador por minuto: ambos son 429 y solo el
      // primero trae `plan`. Se distingue por ese campo, no por el texto del mensaje.
      let body: { error?: unknown; plan?: unknown; limit?: number; used?: number; upgrade_url?: string | null; resets_at?: string | null } | null = null;
      try { body = JSON.parse(text); } catch { /* cuerpo no-JSON: cae al error genérico */ }
      if (body && typeof body.error === "string" && typeof body.plan === "string") {
        setQuota({ limit: body.limit ?? 0, remaining: 0, plan: body.plan });
        throw new QuotaError(body.error, body as ConstructorParameters<typeof QuotaError>[1]);
      }
    }
    throw new Error(`[proxy ${res.status}] ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Micro-agrupación de peticiones ───────────────────────────────────────────────────
//
// EL PROBLEMA QUE RESUELVE: abrir un ticker hace 33 llamadas a `authedFetch`, todas en el
// mismo tick (un `Promise.allSettled` con 30 entradas). Cada una era una petición HTTP con
// su propia autenticación y su propio rate-limit en el proxy: ~99 viajes de red internos
// para una sola acción del usuario. Y como el cubo de FMP es de 40/min y un ticker gasta
// 20, el techo real eran DOS análisis por minuto.
//
// CÓMO: las llamadas GET a rutas de datos no salen al instante; se encolan y se mandan
// juntas a /api/batch en el siguiente turno del bucle de eventos. Todo lo que se pida en el
// mismo tick viaja en una petición. El servidor cobra el rate-limit por el número real de
// sub-llamadas, así que esto ahorra viajes, no cuota.
//
// POR QUÉ NO HAY QUE TOCAR NINGÚN LLAMANTE: la firma y el comportamiento de `authedFetch`
// no cambian —mismo valor devuelto, mismos errores, mismo `Promise.allSettled` alrededor—.
// La agrupación es un detalle de transporte.
//
// SI EL LOTE FALLA, se reintenta cada petición por su vía individual. Eso es lo que permite
// desplegar este cliente ANTES que el proxy: contra un proxy sin /api/batch, el primer lote
// da 404, cae al camino de siempre y el usuario no nota nada.

/** Rutas que /api/batch sabe despachar. Debe coincidir con `route()` del endpoint. */
const BATCHABLE = /^\/api\/(fmp|finnhub|congress|edgar|simfin|finviz|short-interest)(\/|\?|$)/;

interface BatchEnvelope { results: { id: string; status: number; body: string }[] }

const batcher = createBatcher(
  {
    send: (requests) =>
      singleFetch<BatchEnvelope>("/api/batch", { method: "POST", body: JSON.stringify({ requests }) }, 60_000),
    single: (path) => singleFetch(path),
  },
  {
    maxBatch: 40, // el servidor rechaza más de 40 (MAX_SUB en app/api/batch/route.js)
    onFallback: (e) => {
      if (process.env.NODE_ENV !== "production") console.warn("[batch] degradado a peticiones sueltas:", e);
    },
  }
);

/**
 * Petición autenticada al proxy.
 *
 * Los GET a rutas de datos se agrupan con los del mismo tick en una sola llamada a
 * /api/batch (ver arriba). Todo lo demás —POST, cabeceras propias, `signal` propio,
 * rutas de IA— sale por su cuenta, sin cambios.
 */
export function authedFetch<T = unknown>(
  path: string,
  options?: RequestInit,
  timeoutMs = 30_000
): Promise<T> {
  const method = (options?.method ?? "GET").toUpperCase();
  const agrupable =
    // Interruptor de emergencia sin desplegar código.
    process.env.NEXT_PUBLIC_BATCH_DISABLED !== "1" &&
    method === "GET" &&
    !options?.body &&
    !options?.signal &&      // un abort propio no se puede honrar dentro de un lote
    !options?.headers &&     // cabeceras a medida ⇒ la petición es especial, va sola
    BATCHABLE.test(path);

  if (!agrupable) return singleFetch<T>(path, options, timeoutMs);
  return batcher.enqueue<T>(path);
}

/**
 * Model tiers. Both are in ALLOWED_MODELS del backend (app/api/anthropic/messages/route.js).
 * Default is Haiku 4.5 to keep the MVP's only paid dependency (Anthropic) at ~€10/month:
 * Haiku is $1/$5 per 1M in/out vs Sonnet's $3/$15 — 3× cheaper. Pass tier:"deep" only
 * for the flagship macro synthesis if you decide the quality is worth the extra spend.
 */
const AI_MODELS = { fast: "claude-haiku-4-5", deep: "claude-sonnet-4-6" } as const;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
  // Anthropic returns token counts on every response. We used to throw them away; they
  // are the only direct measure of what the app actually costs to run.
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Token counts for one completion. Null when the backend doesn't report them. */
export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}
export interface AiCompletion { text: string; usage: AiUsage | null; }

// ── Pluggable provider seam (Phase 7 "ralph") ────────────────────────────────────────
// aiAnalyze talks to a Provider, not to Anthropic directly, so the backend is swappable
// behind one interface (Anthropic today; a local/OSS model or a different vendor later)
// without touching any caller. Default = el paso a Anthropic de app/api/anthropic.
export interface AiProvider { name: string; complete(model: string, maxTokens: number, prompt: string): Promise<AiCompletion>; }

// Both providers return Anthropic's { content:[{type:'text',text}] } shape — el backend
// /api/llm normalizes any free provider (Groq/Gemini) to it — so parsing is shared.
function parseAnthropic(res: AnthropicResponse): AiCompletion {
  const text = res.content?.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  if (!text) throw new Error(res.error?.message ?? "Empty AI response");
  const u = res.usage;
  const usage: AiUsage | null = u
    ? {
        inputTokens: u.input_tokens ?? null,
        outputTokens: u.output_tokens ?? null,
        cacheReadTokens: u.cache_read_input_tokens ?? null,
        cacheCreationTokens: u.cache_creation_input_tokens ?? null,
      }
    : null;
  return { text, usage };
}

const anthropicProvider: AiProvider = {
  name: "anthropic",
  async complete(model, maxTokens, prompt) {
    const res = await authedFetch<AnthropicResponse>("/api/anthropic/messages", {
      method: "POST",
      body: JSON.stringify({ model, max_tokens: Math.min(4096, maxTokens), messages: [{ role: "user", content: prompt }] }),
    }, 60_000);
    return parseAnthropic(res);
  },
};

// Free-tier backend (Groq / Gemini) via /api/llm. The server picks the model, so
// the client-side model name is ignored here. Enabled with NEXT_PUBLIC_AI_PROVIDER=free.
const freeLlmProvider: AiProvider = {
  name: "free",
  async complete(_model, maxTokens, prompt) {
    const res = await authedFetch<AnthropicResponse>("/api/llm", {
      method: "POST",
      body: JSON.stringify({ max_tokens: Math.min(4096, maxTokens), messages: [{ role: "user", content: prompt }] }),
    }, 60_000);
    return parseAnthropic(res);
  },
};

// ── Cost telemetry ───────────────────────────────────────────────────────────────────
// USD per 1M tokens, for OBSERVABILITY ONLY — never billing. Anthropic's invoice is the
// source of truth; this exists so "which module is eating the €10/month" is answerable
// without leaving PostHog. Keep in sync with AI_MODELS above if a tier changes.
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
  // Signature unchanged on purpose: every existing caller keeps working. Usage is only
  // needed by the audited path below, which calls the provider directly.
  const { text } = await activeProvider.complete(AI_MODELS[tier], maxTokens, prompt);
  return text;
}

// ── Audited generation (Phase 7) — grounding gate + audit trail ──────────────────────
export interface AuditOpts { module: string; ticker?: string; dataBlock?: string; sources?: string[]; maxTokens?: number; tier?: keyof typeof AI_MODELS; }
// violations mixes the numeric gate's flagged figures (numbers) with the directional
// gate's inconsistent-claim descriptions (strings); consumers render length/join.
export interface AuditedResult { text: string; violations: (number | string)[]; grounded: boolean; }

/**
 * Like aiAnalyze, but (1) runs the code-level grounding gate over the output vs the DATA
 * block it was grounded on, and (2) writes an immutable row to ai_audit_log (inputs,
 * cited sources, output, model, violations, timestamp). Returns the flagged numbers so the
 * UI can surface "grounded ✓" or "N unverified figures". Logging is best-effort (never
 * blocks the answer). This is the governance layer that makes the AI auditable & vendible.
 */
export async function aiAnalyzeAudited(prompt: string, opts: AuditOpts): Promise<AuditedResult> {
  const model = AI_MODELS[opts.tier ?? "fast"];
  const { text, usage } = await activeProvider.complete(model, opts.maxTokens ?? 1000, prompt);
  const costUsd = estimateCostUsd(model, usage);
  const gate = opts.dataBlock ? checkGrounding(text, opts.dataBlock) : { ok: true, violations: [] as number[], checked: 0 };
  // Directional gate (F2.1): real numbers arranged into a false claim ("$165 sits above
  // the $184.20 price") — independent of the DATA block, always applicable.
  const dir = checkDirection(text);
  const violations: (number | string)[] = [...gate.violations, ...dir.violations];
  const grounded = gate.ok && dir.ok;
  // Product analytics. This event maps 1:1 to an Anthropic call, so it's the metric
  // that answers "is the free tier's 1-deep-dive/day sustainable?". Carrying
  // `grounded` + violation COUNT (never the text) also turns ai_audit_log — which is
  // per-row and only inspectable by hand — into a live quality dashboard: if the
  // non-grounded rate jumps after a prompt change, it's visible the same day.
  track("analysis_run", {
    module: opts.module,
    ticker: opts.ticker ?? null,
    tier: opts.tier ?? "fast",
    model,
    provider: activeProvider.name,
    grounded,
    violations: violations.length,
    prompt_chars: prompt.length,
    // The actual cost of this call. `analysis_run` summed over est_cost_usd is the
    // monthly Anthropic bill, broken down by module and by user.
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    cache_read_tokens: usage?.cacheReadTokens ?? null,
    est_cost_usd: costUsd,
  });
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const base = {
        user_id: user.id,
        ticker: opts.ticker ?? null,
        module: opts.module,
        model,
        prompt_chars: prompt.length,
        sources: opts.sources ?? null,
        output: text.slice(0, 8000),
        violations,
        grounded,
      };
      const withUsage = {
        ...base,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cache_read_tokens: usage?.cacheReadTokens ?? null,
        est_cost_usd: costUsd,
      };
      // Write the usage columns when they exist, and fall back to the original shape when
      // they don't. Without this, deploying the code before applying
      // sql/2026-07-29_ai_audit_log_usage.sql would make every insert fail on an unknown
      // column — and since audit writes are deliberately swallowed below, the audit trail
      // (the moat) would go silently empty. Order matters: never lose the row.
      const { error } = await supabase.from("ai_audit_log").insert(withUsage);
      if (error) await supabase.from("ai_audit_log").insert(base);
    }
  } catch { /* audit is best-effort — never block the user's answer */ }
  return { text, violations, grounded };
}
