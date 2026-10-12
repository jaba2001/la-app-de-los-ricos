// La llamada del asistente de pantalla a /api/assistant (ver app/api/assistant/route.js).
//
// No pasa por authedFetch (lib/proxy.ts) porque la respuesta llega en STREAMING y aquella lee
// el cuerpo entero con res.json(). Lo demás es igual: el token se pide en cada llamada, las
// cabeceras de cuota alimentan QuotaPill y el 429 de la cuota diaria es un QuotaError.
import { tokenActual } from "./auth";
import { setQuota } from "./quotaState";
import { QuotaError } from "./proxy";
import { trocearNdjson } from "./ndjson";
import type { Captura } from "./pantalla";
import type { Idioma } from "./i18n/traducir";

export interface Turno { role: "user" | "assistant"; content: string }
export interface Cierre { grounded: boolean; violations: (number | string)[]; logged: boolean; truncated: boolean }
type Evento =
  | { type: "text"; text: string }
  | ({ type: "done" } & Cierre)
  | { type: "refusal" }
  | { type: "error"; message: string };

/** El modelo (y su respaldo) declinaron la pregunta. Lo que se hubiera recibido es parcial. */
export class RechazoError extends Error {
  constructor() { super("The assistant can't help with this request."); this.name = "RechazoError"; }
}

/** Un mensaje legible para cada rechazo HTTP; el cuerpo del servidor, si trae `error`, manda. */
async function errorDeRespuesta(res: Response): Promise<Error> {
  let cuerpo: { error?: unknown; plan?: unknown; limit?: number; used?: number; upgrade_url?: string | null; resets_at?: string | null } | null = null;
  try { cuerpo = await res.json(); } catch { /* sin cuerpo JSON */ }
  if (res.status === 429 && cuerpo && typeof cuerpo.error === "string" && typeof cuerpo.plan === "string") {
    setQuota({ limit: cuerpo.limit ?? 0, remaining: 0, plan: cuerpo.plan });
    return new QuotaError(cuerpo.error, cuerpo as ConstructorParameters<typeof QuotaError>[1]);
  }
  if (res.status === 401) return new Error("Your session has expired. Sign in again to use the assistant.");
  if (res.status === 429) return new Error("Too many questions in a short time. Wait a minute and try again.");
  if (res.status === 413) return new Error("This page is too large to send to the assistant.");
  return new Error("The assistant could not answer. Please try again.");
}

/**
 * Hace una pregunta sobre la pantalla. `alTexto` recibe la respuesta ACUMULADA cada vez que
 * llega un trozo. Devuelve el cierre (grounding incluido) o lanza un Error con mensaje legible.
 */
export async function preguntarAsistente(opts: {
  mensajes: Turno[];
  captura: Captura;
  idioma: Idioma;
  signal: AbortSignal;
  alTexto: (acumulado: string) => void;
}): Promise<Cierre> {
  const token = await tokenActual();
  if (!token) throw new Error("Sign in to ask the assistant about this page.");

  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: opts.mensajes, page: opts.captura, idioma: opts.idioma }),
    signal: opts.signal,
  });

  const qLimit = res.headers.get("X-Scora-Quota-Limit");
  if (qLimit) {
    setQuota({
      limit: Number(qLimit),
      remaining: Number(res.headers.get("X-Scora-Quota-Remaining") ?? 0),
      plan: res.headers.get("X-Scora-Plan") ?? "free",
    });
  }
  if (!res.ok || !res.body) throw await errorDeRespuesta(res);

  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = "", texto = "";
  for (;;) {
    const { value, done } = await lector.read();
    buffer += decodificador.decode(value, { stream: !done });
    const { eventos, resto } = trocearNdjson<Evento>(done ? buffer + "\n" : buffer);
    buffer = resto;
    for (const ev of eventos) {
      if (ev.type === "text") { texto += ev.text; opts.alTexto(texto); }
      else if (ev.type === "done") return ev;
      else if (ev.type === "refusal") throw new RechazoError();
      else if (ev.type === "error") throw new Error(ev.message);
    }
    if (done) break;
  }
  // El flujo se cortó sin evento final (red caída, servidor reiniciado a media respuesta).
  throw new Error("The answer was cut off. Please try again.");
}
