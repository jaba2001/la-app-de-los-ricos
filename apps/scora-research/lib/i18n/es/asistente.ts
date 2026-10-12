// El asistente de pantalla: components/ScreenAssistant.tsx, lib/asistente.ts y los mensajes de
// error de app/api/assistant/route.js (llegan en inglés y el panel los traduce al pintarlos).
// «Close» y «Sign in» ya están en comun.ts.
export const ASISTENTE: Record<string, string> = {
  // Botón y cabecera
  "Ask AI about this page": "Preguntar a la IA sobre esta página",
  "Ask about this page": "Pregunta sobre esta página",
  "Page assistant": "Asistente de página",
  "Reads what's on your screen and explains it": "Lee lo que tienes en pantalla y te lo explica",
  "New conversation": "Nueva conversación",
  // Nombre del módulo en /audit (app/audit/page.tsx, MODULE_LABEL)
  "Screen assistant": "Asistente de pantalla",

  // Panel vacío y sugerencias
  "Sign in to ask the assistant about this page.": "Entra para preguntarle al asistente sobre esta página.",
  "Ask anything about what you're looking at: a chart, a table, a metric or the whole page.":
    "Pregunta lo que quieras sobre lo que estás viendo: un gráfico, una tabla, una métrica o la página entera.",
  "Explain this page": "Explícame esta página",
  "What are the key numbers on screen?": "¿Cuáles son las cifras clave de la pantalla?",
  "How do I read this chart?": "¿Cómo se lee este gráfico?",
  "Explain the jargon on screen": "Explícame los términos técnicos de la pantalla",

  // Caja de texto
  "Selected": "Seleccionado",
  "Clear selection": "Quitar la selección",
  "Ask about the selected text…": "Pregunta sobre el texto seleccionado…",
  "Ask about this page…": "Pregunta sobre esta página…",
  "Stop": "Detener",
  "Send": "Enviar",
  "Sends this page's content to the AI. Educational only — not investment advice.":
    "Envía el contenido de esta página a la IA. Solo educativo: no es asesoramiento de inversión.",

  // Conversación
  "on {path}": "en {path}",
  "Reading the page…": "Leyendo la página…",
  "See plans": "Ver planes",
  "The answer was cut short.": "La respuesta se quedó a medias.",
  "Stopped.": "Detenido.",
  // Citas de la página ([[…]] en la respuesta)
  "Show on page": "Ver en la página",
  "not found on this page": "no está en esta página",

  // Errores (lib/asistente.ts y app/api/assistant/route.js)
  "The assistant can't help with this request.": "El asistente no puede ayudar con esta petición.",
  "Your session has expired. Sign in again to use the assistant.": "Tu sesión ha caducado. Vuelve a entrar para usar el asistente.",
  "Too many questions in a short time. Wait a minute and try again.": "Demasiadas preguntas en poco tiempo. Espera un minuto y vuelve a intentarlo.",
  "This page is too large to send to the assistant.": "Esta página es demasiado grande para mandársela al asistente.",
  "The assistant could not answer. Please try again.": "El asistente no ha podido responder. Inténtalo de nuevo.",
  "The answer was cut off. Please try again.": "La respuesta se cortó. Inténtalo de nuevo.",
  "The AI service is busy right now. Try again in a minute.": "El servicio de IA está saturado ahora mismo. Inténtalo dentro de un minuto.",
  "Could not reach the AI service. Check your connection and try again.": "No se pudo contactar con el servicio de IA. Revisa la conexión y vuelve a intentarlo.",
  "The AI service is having trouble. Try again in a minute.": "El servicio de IA tiene problemas. Inténtalo dentro de un minuto.",
};
