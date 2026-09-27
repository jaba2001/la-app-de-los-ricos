// Borrar una cuenta y TODOS sus datos (RGPD, art. 17 — AUDIT_REPORT A-6).
//
// POR QUÉ HACE FALTA CÓDIGO Y NO BASTA CON BORRAR EL USUARIO. En Supabase, las filas de cada
// usuario colgaban de `auth.users` con claves ajenas en cascada. En Cloud SQL esas claves no
// existen (esa tabla era de Supabase): borrar la cuenta en Identity Platform dejaría sus
// filas huérfanas en 13 tablas, con su correo, su diario de inversiones y sus alertas.
//
// Qué se borra: toda fila con su `user_id` en las tablas privadas, y sus altas en la lista de
// espera también por CORREO (quien se apuntó sin sesión no tiene user_id). Todo en UNA
// transacción: o se borra todo o no se borra nada — un borrado a medias es peor que ninguno,
// porque el usuario cree que ya no hay nada.
//
// Qué NO se hace aquí: borrar la identidad en Identity Platform. Lo hace el navegador con el
// SDK de Firebase justo después (deleteUser), que no necesita credenciales de administrador.
// Si fallara, el usuario queda sin datos y puede reintentarlo: esto es idempotente.

import { PRO_STATUSES } from "./stripe.js";

/** Las tablas con datos de un usuario, y la columna que lo identifica. Deben coincidir con las
 *  privadas de policy.ts más las que el navegador no toca; la prueba lo comprueba. */
export const TABLAS_DE_USUARIO = [
  "ai_audit_log", "alerts_log", "ic_briefs", "push_subscriptions", "sl_alert_prefs",
  "sl_alerts", "sl_analyses", "sl_journal", "sl_score_log", "sl_subscriptions",
  "sl_waitlist", "sl_watchlist", "stock_snapshot",
];

export class SuscripcionActiva extends Error {
  constructor() { super("Cancel your subscription before deleting your account."); this.name = "SuscripcionActiva"; }
}

/**
 * @param {import("pg").Pool} db
 * @param {string} userId  sale del token verificado, nunca de la petición
 * @param {string|null} email  del token; para las altas en la lista de espera sin sesión
 * @returns {Promise<Record<string, number>>} filas borradas por tabla
 */
export async function borrarDatosDeUsuario(db, userId, email) {
  if (!userId) throw new Error("borrarDatosDeUsuario: falta userId");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    // Una suscripción viva sigue cobrando aunque no haya cuenta. Se exige cancelarla antes
    // (desde el portal de Stripe) para no dejar un cobro sin nadie detrás.
    const { rows: subs } = await c.query(
      "select status, current_period_end from sl_subscriptions where user_id = $1", [userId]);
    const viva = subs.some((s) => PRO_STATUSES.has(s.status)
      && !(s.current_period_end && new Date(s.current_period_end) < new Date()));
    if (viva) throw new SuscripcionActiva();

    const borradas = {};
    for (const t of TABLAS_DE_USUARIO) {
      // Nombre de tabla de una lista fija de este fichero, nunca de la petición.
      const r = await c.query(`delete from "${t}" where user_id = $1`, [userId]);
      borradas[t] = r.rowCount ?? 0;
    }
    if (email) {
      const r = await c.query("delete from sl_waitlist where lower(email) = lower($1)", [email]);
      borradas.sl_waitlist += r.rowCount ?? 0;
    }
    await c.query("COMMIT");
    return borradas;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
