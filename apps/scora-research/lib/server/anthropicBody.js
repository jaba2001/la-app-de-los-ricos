// Qué se reenvía a Anthropic desde /api/anthropic/messages.
//
// POR QUÉ EXISTE (AUDIT_REPORT A-7): la ruta validaba `model`, `max_tokens` y que `messages`
// fuera un array, y luego reenviaba el cuerpo del cliente ENTERO con nuestra clave. Cualquier
// usuario con sesión podía añadir `system`, `tools`, `stop_sequences` o lo que la API admita,
// y usar la ruta como un Claude de propósito general pagado por Scora. La cuota diaria acota
// cuántas veces, pero no para qué.
//
// El cliente (lib/proxy.ts) solo manda `model`, `max_tokens` y un mensaje de usuario con
// texto. Eso es exactamente lo que pasa; todo lo demás se descarta. Fuera de app/ porque un
// route.js de Next no puede exportar funciones propias, y esto tiene que poder probarse.

const ROLES = new Set(['user', 'assistant']);
const MAX_MENSAJES = 20;

/**
 * @returns {{ body: object } | { error: string }} el cuerpo que se puede reenviar, o el motivo
 *   del rechazo. `model` y `max_tokens` ya vienen validados por la ruta.
 */
export function cuerpoParaAnthropic(entrada) {
  const msgs = entrada?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return { error: 'messages array required' };
  if (msgs.length > MAX_MENSAJES) return { error: `At most ${MAX_MENSAJES} messages` };
  for (const m of msgs) {
    // Solo texto: un bloque de imagen o de documento es otra superficie de coste y la app no
    // la usa.
    if (!m || !ROLES.has(m.role) || typeof m.content !== 'string' || !m.content.trim()) {
      return { error: 'Each message must be {role: "user"|"assistant", content: non-empty string}' };
    }
  }
  return {
    body: {
      model: entrada.model,
      max_tokens: entrada.max_tokens,
      messages: msgs.map((m) => ({ role: m.role, content: m.content })),
    },
  };
}
