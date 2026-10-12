// Lo común a toda la app: barra, pie, login, cuenta, avisos y botones genéricos.
export const COMUN: Record<string, string> = {
  // Barra de navegación
  "Daily": "Diario",
  "Macro": "Macro",
  "Discovery": "Descubrir",
  "Momentum": "Momentum",
  "Stocks": "Acciones",
  "Watchlist": "Seguimiento",
  "Journal": "Operaciones",
  "Track Record": "Historial",
  "Evidence": "Evidencia",
  "Audit": "Auditoría",
  "Account": "Cuenta",
  "Sign out": "Cerrar sesión",
  "Open menu": "Abrir menú",
  "Close menu": "Cerrar menú",
  "Search ticker or company…": "Buscar ticker o empresa…",
  "Language": "Idioma",
  "Scora Research": "Scora Research",

  // Pie
  "Scora Research is an educational tool for informational purposes only and is <s1>not investment advice</s1>. Scores, valuations, backtests and AI commentary are estimates that may be wrong or out of date; verify independently before making any decision. Past performance does not predict future results. Data from FRED, Finnhub, FMP, SEC EDGAR and other public sources.":
    "Scora Research es una herramienta educativa, solo informativa, y <s1>no es asesoramiento de inversión</s1>. Las puntuaciones, valoraciones, backtests y comentarios de la IA son estimaciones que pueden estar equivocadas o desactualizadas; compruébalo por tu cuenta antes de tomar cualquier decisión. La rentabilidad pasada no predice la futura. Datos de FRED, Finnhub, FMP, SEC EDGAR y otras fuentes públicas.",

  // Consentimiento de analítica
  "Analytics consent": "Consentimiento de analítica",
  "We'd like to use product analytics (PostHog, EU servers) to see which features get used. It stores a cookie and an ID on your device. Nothing is sent unless you accept, and the app works the same either way.":
    "Nos gustaría usar analítica de producto (PostHog, servidores en la UE) para ver qué funciones se usan. Guarda una cookie y un identificador en tu dispositivo. No se envía nada si no aceptas, y la app funciona igual en ambos casos.",
  "Decline": "Rechazar",
  "Accept": "Aceptar",
  "Analytics preferences": "Preferencias de analítica",

  // Bienvenida
  "Welcome to Scora 👋": "Bienvenido a Scora 👋",
  "Read it top-down: the <s1>regime</s1> here sets everything. In three steps —": "Léelo de arriba abajo: el <s1>régimen</s1> de aquí lo condiciona todo. En tres pasos:",
  "Check the <s1>risk-on gauge</s1> & the top-down↔bottom-up loop in the Regime Radar (Portfolio tab).":
    "Mira el <s1>indicador de apetito por riesgo</s1> y el bucle de arriba abajo ↔ de abajo arriba en el Radar de régimen (pestaña Portfolio).",
  "Search any ticker up top — stocks, bonds, metals, ETFs all get the right analysis.":
    "Busca cualquier ticker arriba: acciones, bonos, metales y ETFs reciben cada uno el análisis que les corresponde.",
  "See the": "Consulta la",
  "evidence": "evidencia",
  "and the": "y el",
  "AI audit trail": "registro de auditoría de la IA",
  "— everything is measured, not asserted.": "— todo está medido, no afirmado.",
  "Got it": "Entendido",

  // Alertas push y de régimen
  "Failed": "Ha fallado",
  "🔔 Regime alerts on": "🔔 Alertas de régimen activadas",
  "🔕 Enable regime alerts": "🔕 Activar alertas de régimen",
  "Get notified on breadth divergences & risk-off shifts.": "Recibe un aviso con las divergencias de amplitud y los giros hacia la aversión al riesgo.",
  "Dismiss": "Descartar",

  // Cupo de IA
  "· Upgrade": "· Mejorar plan",
  "No AI analyses left until 00:00 UTC{x}": "No te quedan análisis de IA hasta las 00:00 UTC{x}",
  "— Pro raises the limit": "— Pro amplía el límite",
  "{a} of {b} AI analyses left today (resets at 00:00 UTC)": "Te quedan {a} de {b} análisis de IA hoy (se reinicia a las 00:00 UTC)",

  // Login
  "Macro + Stock intelligence platform": "Plataforma de inteligencia macro y de acciones",
  "Email": "Correo electrónico",
  "your@email.com": "tu@correo.com",
  "Sending…": "Enviando…",
  "Send magic link": "Enviar enlace de acceso",
  "Check your email": "Revisa tu correo",
  "We sent a magic link to <s1>{x}</s1>": "Hemos enviado un enlace de acceso a <s1>{x}</s1>",
  "Use a different email": "Usar otro correo",
  "No password needed — secure magic link authentication": "Sin contraseña: acceso seguro con enlace mágico",

  // Vuelta del enlace de acceso
  "This link is invalid or has already been used.": "Este enlace no es válido o ya se ha usado.",
  "Your email is needed to finish signing in.": "Hace falta tu correo para terminar de entrar.",
  "Signed in — redirecting…": "Dentro — redirigiendo…",
  "Couldn't finish signing in: {x}": "No se pudo terminar de entrar: {x}",
  "Confirm your email to finish signing in": "Confirma tu correo para terminar de entrar",
  "Verifying your link…": "Comprobando tu enlace…",

  // Errores de página
  "Page Error": "Error en la página",
  "Try again": "Reintentar",
  "Error Details": "Detalles del error",
  "Stack Trace": "Traza",
  "Digest: {x}": "Resumen: {x}",

  // Cuenta
  "Your account": "Tu cuenta",
  "Signed in as <s1>{x}</s1>": "Has entrado como <s1>{x}</s1>",
  "Delete account": "Borrar la cuenta",
  "This permanently deletes your login and everything linked to it: watchlist, journal, alerts and their preferences, saved analyses and snapshots, push subscriptions, your AI history and your waitlist sign-up. It can't be undone.":
    "Esto borra para siempre tu acceso y todo lo vinculado a él: lista de seguimiento, diario de operaciones, alertas y sus preferencias, análisis y fotos guardados, suscripciones push, tu historial de IA y tu alta en la lista de espera. No se puede deshacer.",
  "Type <s1>{x}</s1> to confirm": "Escribe <s1>{x}</s1> para confirmar",
  "Deleting…": "Borrando…",
  "Delete my account": "Borrar mi cuenta",
  "Account deleted": "Cuenta borrada",
  "Your account and all its data have been deleted.": "Tu cuenta y todos sus datos se han borrado.",
  "You have an active subscription. Cancel it from Billing on the Pricing page first, then delete your account.":
    "Tienes una suscripción activa. Cancélala primero desde Facturación en la página de precios y después borra tu cuenta.",
  "We couldn't delete your data. Nothing was deleted — please try again.": "No pudimos borrar tus datos. No se ha borrado nada; inténtalo de nuevo.",
  "Your data has been deleted. To remove the login itself, sign in again and repeat this step (it's a security check).":
    "Tus datos se han borrado. Para eliminar también el acceso, vuelve a entrar y repite este paso (es una comprobación de seguridad).",
  "Your data has been deleted, but the login could not be removed. Sign in again and repeat this step.":
    "Tus datos se han borrado, pero no se pudo eliminar el acceso. Vuelve a entrar y repite este paso.",

  // Avisos de datos (components/ui/DataError)
  "Couldn't load this data. It's not empty — the request failed. Try reloading.": "No se pudieron cargar estos datos. No es que estén vacíos: la petición falló. Prueba a recargar.",
  "Couldn't save that change. Nothing was changed — please try again.": "No se pudo guardar el cambio. No se ha modificado nada; inténtalo de nuevo.",
};
