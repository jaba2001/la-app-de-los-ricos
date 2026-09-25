// Qué puede hacer el navegador con cada tabla.
//
// ESTO SUSTITUYE A LA RLS DE SUPABASE, y es la pieza de la que depende que un usuario no vea
// los datos de otro. Allí, Postgres recibía el JWT de cada persona y `auth.uid()` filtraba
// solo. En Cloud SQL la app se conecta con UNA identidad de servicio, así que la base de
// datos no puede distinguir usuarios: si nadie añade el filtro, las consultas devuelven las
// filas de todo el mundo, sin error y sin aviso.
//
// De las 56 consultas que el navegador hacía contra Supabase, 17 NO filtraban por usuario —
// funcionaban porque la RLS lo hacía por ellas. Arreglarlas una a una era el camino
// peligroso: olvidar una no se nota. Así que el filtro no se escribe en la consulta; se
// declara AQUÍ, por tabla, y el servidor lo aplica siempre.
//
// TODO ES DENEGAR POR DEFECTO: una tabla que no esté en esta lista no es consultable desde
// el navegador, y una operación que no esté en `ops` se rechaza. Añadir una tabla nueva
// obliga a decidir explícitamente si es privada.

export type Op = "select" | "insert" | "upsert" | "update" | "delete";

export interface TablePolicy {
  /** `user`: cada fila pertenece a alguien y SIEMPRE se filtra por él.
   *  `shared`: datos iguales para todos (macro, rankings, base de conocimiento). */
  scope: "user" | "shared";
  /** Operaciones permitidas desde el navegador. Lo que no está, se rechaza. */
  ops: Op[];
  /** Columna dueña. Solo en las privadas. */
  userColumn?: string;
}

/**
 * La clasificación NO se deduce en tiempo de ejecución de si la tabla tiene una columna
 * `user_id`: está escrita a mano. La diferencia importa — si se dedujera, renombrar o perder
 * esa columna en una migración convertiría una tabla privada en compartida en silencio, que
 * es exactamente el fallo que esta capa existe para impedir.
 */
export const POLICY: Record<string, TablePolicy> = {
  // ── PRIVADAS: 13 tablas. El servidor añade el filtro de usuario siempre ──────────────
  ai_audit_log:       { scope: "user", userColumn: "user_id", ops: ["select", "insert"] },
  alerts_log:         { scope: "user", userColumn: "user_id", ops: ["insert"] },
  ic_briefs:          { scope: "user", userColumn: "user_id", ops: ["insert"] },
  push_subscriptions: { scope: "user", userColumn: "user_id", ops: ["select", "upsert", "delete"] },
  sl_alert_prefs:     { scope: "user", userColumn: "user_id", ops: ["select", "upsert"] },
  sl_alerts:          { scope: "user", userColumn: "user_id", ops: ["select", "insert", "update", "delete"] },
  sl_analyses:        { scope: "user", userColumn: "user_id", ops: ["select", "upsert"] },
  sl_journal:         { scope: "user", userColumn: "user_id", ops: ["select", "insert", "update", "delete"] },
  sl_score_log:       { scope: "user", userColumn: "user_id", ops: ["upsert"] },
  sl_subscriptions:   { scope: "user", userColumn: "user_id", ops: ["select"] },
  sl_waitlist:        { scope: "user", userColumn: "user_id", ops: ["insert"] },
  sl_watchlist:       { scope: "user", userColumn: "user_id", ops: ["select", "insert", "delete"] },
  stock_snapshot:     { scope: "user", userColumn: "user_id", ops: ["select", "upsert"] },

  // ── COMPARTIDAS: iguales para todos. Solo lectura desde el navegador ─────────────────
  // Las escribe el servidor (crons) o CI, nunca el cliente: por eso ninguna lleva `insert`.
  kb_cards:               { scope: "shared", ops: ["select"] },
  kb_chunks:              { scope: "shared", ops: ["select"] },
  kb_docs:                { scope: "shared", ops: ["select"] },
  macro_state:            { scope: "shared", ops: ["select"] },
  macro_state_history:    { scope: "shared", ops: ["select"] },
  sl_briefings:           { scope: "shared", ops: ["select"] },
  sl_cohort:              { scope: "shared", ops: ["select"] },
  sl_daily_close:         { scope: "shared", ops: ["select"] },
  sl_discovery:           { scope: "shared", ops: ["select"] },
  sl_paper_fund_track:    { scope: "shared", ops: ["select"] },
  sl_picks_position:      { scope: "shared", ops: ["select"] },
  sl_picks_run:           { scope: "shared", ops: ["select"] },
  sl_track_summary:       { scope: "shared", ops: ["select"] },
  smart_money_top_buyers: { scope: "shared", ops: ["select"] },

  // Vista: una fila por (usuario, ticker). Hereda el filtro de sl_analyses, pero se declara
  // igual — una vista sin política no sería consultable, que es el defecto correcto.
  sl_analyses_latest: { scope: "user", userColumn: "user_id", ops: ["select"] },
};

/**
 * Tablas del esquema que NO son accesibles desde el navegador, y por qué. No hace falta para
 * que el código funcione —cualquier tabla ausente de POLICY ya está denegada— pero deja
 * constancia de que la ausencia es una decisión y no un olvido.
 */
export const NO_EXPUESTAS: Record<string, string> = {
  sl_stripe_events: "eventos de facturación: los escribe el webhook de Stripe, nadie más",
  sl_paper_fund:    "lo gestiona el cron de rebalanceo; el cliente solo lee su track",
  sl_revisions:     "artefacto de research, lo escribe CI",
  push_alert_state: "estado interno del cron de alertas",
};

/**
 * Funciones de Postgres invocables desde el navegador, con sus parametros permitidos.
 *
 * Lista aparte y tambien de denegar por defecto. Una funcion es codigo que corre DENTRO de
 * la base con los permisos del que la creo: dejar invocar cualquiera seria mas peligroso que
 * dejar consultar cualquier tabla.
 *
 * `scoped` diria que la funcion recibe el usuario; search_kb_chunks no lo necesita porque
 * kb_chunks es contenido compartido (informes publicos de la SEC).
 */
export const FUNCIONES: Record<string, { params: string[]; scoped: boolean }> = {
  search_kb_chunks: { params: ["p_ticker", "p_query", "p_per_section"], scoped: false },
};

export function funcionPermitida(nombre: string) {
  return Object.prototype.hasOwnProperty.call(FUNCIONES, nombre) ? FUNCIONES[nombre] : null;
}

export function policyFor(table: string): TablePolicy | null {
  return Object.prototype.hasOwnProperty.call(POLICY, table) ? POLICY[table] : null;
}
