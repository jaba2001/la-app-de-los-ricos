// El guía de Scora (el asistente de pantalla): components/ScreenAssistant.tsx, lib/asistente.ts y los mensajes de
// error de app/api/assistant/route.js (llegan en inglés y el panel los traduce al pintarlos).
// «Close» y «Sign in» ya están en comun.ts.
export const ASISTENTE: Record<string, string> = {
  // Botón y cabecera
  "Ask AI about this page": "Preguntar a la IA sobre esta página",
  "Ask about this page": "Pregunta sobre esta página",
  "Page assistant": "Asistente de página",
  "Helps you understand what you're looking at": "Te ayuda a entender lo que estás viendo",
  "Resize the assistant": "Cambiar el tamaño del asistente",
  "New conversation": "Nueva conversación",
  // Nombre del módulo en /audit (app/audit/page.tsx, MODULE_LABEL)
  "Screen assistant": "Asistente de pantalla",

  // Panel vacío
  "Sign in to ask the assistant about this page.": "Entra para preguntarle al asistente sobre esta página.",
  "I'm here to help you understand this page: what each concept means, how to read the charts and why it matters.":
    "Estoy aquí para ayudarte a entender esta página: qué significa cada concepto, cómo leer los gráficos y por qué importa.",

  // Preguntas para empezar, por sección (SUGERENCIAS en ScreenAssistant.tsx)
  "What am I looking at?": "¿Qué estoy viendo?",
  "Explain the key concepts on this page": "Explícame los conceptos clave de esta página",
  "How should I read this page?": "¿Cómo debo leer esta página?",
  "Explain this page in simple terms": "Explícame esta página con palabras sencillas",
  "What is a macro regime?": "¿Qué es un régimen macro?",
  "What do these indicators tell me?": "¿Qué me dicen estos indicadores?",
  "How should I read this company's page?": "¿Cómo leo la ficha de esta empresa?",
  "How is fair value estimated here?": "¿Cómo se estima aquí el valor razonable?",
  "Explain the key metrics on this page": "Explícame las métricas clave de esta página",
  "How do I research a stock in Scora?": "¿Cómo se analiza una acción en Scora?",
  "What does the screener measure?": "¿Qué mide el filtro de acciones?",
  "What is momentum?": "¿Qué es el momentum?",
  "How is this ranking built?": "¿Cómo se construye esta clasificación?",
  "What is a Sharpe ratio?": "¿Qué es el ratio de Sharpe?",
  "What does drawdown mean?": "¿Qué significa «drawdown» (caída máxima)?",
  "What is concentration risk?": "¿Qué es el riesgo de concentración?",
  "How do I read my exposure?": "¿Cómo leo mi exposición?",
  "How do I know these results are honest?": "¿Cómo sé que estos resultados son honestos?",
  "What is the daily report for?": "¿Para qué sirve el informe diario?",
  "How does Scora check its AI?": "¿Cómo comprueba Scora su IA?",
  "What does 'grounded' mean?": "¿Qué significa «grounded» (respaldado por datos)?",

  // Caja de texto
  "Selected": "Seleccionado",
  "Clear selection": "Quitar la selección",
  "Ask about the selected text…": "Pregunta sobre el texto seleccionado…",
  "Ask about anything on this page…": "Pregunta lo que quieras de esta página…",
  "Stop": "Detener",
  "Send": "Enviar",
  "Sends this page's content to the AI to explain it. Educational only — not investment advice.":
    "Envía el contenido de esta página a la IA para explicártela. Solo educativo: no es asesoramiento de inversión.",

  // Conversación
  "on {path}": "en {path}",
  "Thinking…": "Pensando…",
  "See plans": "Ver planes",
  "The answer was cut short.": "La respuesta se quedó a medias.",
  "Stopped.": "Detenido.",

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
