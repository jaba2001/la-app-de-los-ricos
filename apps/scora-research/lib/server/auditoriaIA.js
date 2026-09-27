// El registro de auditoría de la IA, escrito por el SERVIDOR (AUDIT_REPORT A-4).
//
// POR QUÉ AQUÍ Y NO EN EL NAVEGADOR. Hasta el 27-09 lo escribía lib/proxy.ts desde el cliente,
// después de recibir la respuesta: bastaba con cerrar la pestaña, bloquear la petición o
// mandar otra fila para que el registro no existiera o dijera otra cosa. Y es la pieza que
// /audit y la landing presentan como garantía («cada respuesta de la IA queda registrada»).
//
// Aquí la fila la pone el servidor con lo que él mismo ha visto: el usuario sale del token, el
// modelo y el texto salen de la respuesta de Anthropic, y el filtro de grounding corre sobre
// ese texto. El navegador ya no puede insertar en ai_audit_log (policy.ts).
//
// Lo único que sigue viniendo del cliente son los metadatos: módulo, ticker, fuentes citadas y
// el bloque de datos contra el que se comprueba el grounding. Se validan en forma y tamaño.
import { checkGrounding, checkDirection } from "../grounding.ts";
import { estimateCostUsd, usageDeAnthropic } from "../costeIA.ts";
import { sbFetch } from "./data/postgrest.js";

const TEXTO_CORTO = /^[\w.\-:/ ]{1,64}$/;

/**
 * Lee `scora_audit` del cuerpo de la petición.
 * @returns null si no viene (llamada sin auditar), { error } si viene mal, o los metadatos.
 */
export function leerMetaAuditoria(meta) {
  if (meta == null) return null;
  if (typeof meta !== "object" || Array.isArray(meta)) return { error: "scora_audit must be an object" };
  if (typeof meta.module !== "string" || !TEXTO_CORTO.test(meta.module)) return { error: "scora_audit.module invalid" };
  if (meta.ticker != null && (typeof meta.ticker !== "string" || !/^[A-Z0-9.\-]{1,15}$/.test(meta.ticker))) {
    return { error: "scora_audit.ticker invalid" };
  }
  if (meta.sources != null && (!Array.isArray(meta.sources) || meta.sources.length > 20
      || !meta.sources.every((s) => typeof s === "string" && s.length <= 120))) {
    return { error: "scora_audit.sources invalid" };
  }
  if (meta.dataBlock != null && typeof meta.dataBlock !== "string") return { error: "scora_audit.dataBlock invalid" };
  return {
    module: meta.module,
    ticker: meta.ticker ?? null,
    sources: meta.sources ?? null,
    // Casi siempre el bloque de datos ES el prompt: se marca en vez de mandarlo dos veces,
    // que duplicaría el cuerpo contra el tope de 50 KB.
    dataBlockEsPrompt: meta.dataBlockEsPrompt === true,
    dataBlock: meta.dataBlock ?? null,
  };
}

/** El mismo filtro que antes corría en el navegador (lib/grounding.ts), sobre el mismo texto. */
export function evaluarGrounding(texto, dataBlock) {
  const gate = dataBlock ? checkGrounding(texto, dataBlock) : { ok: true, violations: [] };
  // Direccional: cifras reales colocadas en una afirmación falsa. No depende del bloque.
  const dir = checkDirection(texto);
  return {
    grounded: gate.ok && dir.ok,
    // Para la interfaz: números sin respaldo y descripciones de las afirmaciones incoherentes.
    violaciones: [...gate.violations, ...dir.violations],
    // Para la base: `violations` es numeric[]. El cliente mezclaba ahí los textos de las
    // violaciones direccionales, el insert fallaba, el reintento también y la fila se perdía
    // en silencio justo cuando la respuesta tenía un problema. Aquí van solo los números; que
    // hubo una violación direccional queda en `grounded = false`.
    numericas: gate.violations,
  };
}

/**
 * Recibe la respuesta del proveedor TAL CUAL (texto JSON con la forma de Anthropic), registra
 * la auditoría si la petición la pedía, y devuelve el texto a mandar al navegador con
 * `scora_audit: { grounded, violations, registrado }` añadido. Lo usan las dos rutas de IA.
 * Si no hay metadatos, la respuesta no fue bien o no trae texto, se devuelve sin tocar.
 */
export async function anotarRespuesta({ textoRespuesta, ok, userId, model, messages, meta }) {
  if (!ok || !meta) return textoRespuesta;
  let cuerpo;
  try { cuerpo = JSON.parse(textoRespuesta); } catch { return textoRespuesta; }
  const texto = (cuerpo?.content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  if (!texto) return textoRespuesta;
  const prompt = (messages ?? []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
  cuerpo.scora_audit = await registrarAuditoria({ userId, model, prompt, texto, usageRaw: cuerpo.usage, meta });
  return JSON.stringify(cuerpo);
}

/**
 * Evalúa y escribe la fila. Nunca lanza: un fallo del registro se anota en el log y se
 * devuelve `registrado: false`, pero no le quita la respuesta al usuario.
 */
export async function registrarAuditoria({ userId, model, prompt, texto, usageRaw, meta }) {
  const dataBlock = meta.dataBlockEsPrompt ? prompt : meta.dataBlock;
  const ev = evaluarGrounding(texto, dataBlock);
  const usage = usageDeAnthropic(usageRaw);
  const fila = {
    user_id: userId,
    ticker: meta.ticker,
    module: meta.module,
    model,
    prompt_chars: prompt.length,
    sources: meta.sources,
    output: texto.slice(0, 8000),
    violations: ev.numericas,
    grounded: ev.grounded,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    cache_read_tokens: usage?.cacheReadTokens ?? null,
    est_cost_usd: estimateCostUsd(model, usage),
  };
  let registrado = false;
  try {
    const r = await sbFetch("ai_audit_log", { method: "POST", body: JSON.stringify(fila) });
    registrado = r.ok;
    if (!r.ok) console.error(`auditoriaIA: no se pudo registrar (${r.status}) ${meta.module}`);
  } catch (e) {
    console.error("auditoriaIA:", e?.message || e);
  }
  return { grounded: ev.grounded, violations: ev.violaciones, registrado };
}
