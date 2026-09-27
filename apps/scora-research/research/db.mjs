// Dónde escriben los procesos de research: Cloud SQL (AUDIT_REPORT C-5).
//
// Hasta el 27-09 cada script hablaba con la API REST de Supabase con la clave de servicio.
// Ahora usan sbFetch, que acepta las MISMAS rutas de PostgREST (`tabla?on_conflict=…`,
// filtros `eq.`/`is.null`…) y las ejecuta como SQL contra Cloud SQL — por eso el cambio en
// cada script se queda en sustituir `fetch(${SB_URL}/rest/v1/…)` por `sbFetch(…)`.
//
// En GitHub Actions la conexión la abre Cloud SQL Auth Proxy en 127.0.0.1 (ver los
// workflows); en local, cualquier Postgres con PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE.
export { sbFetch } from "../lib/server/data/postgrest.js";

/** ¿Hay base a la que escribir? Sin ella los scripts calculan y guardan el JSON, pero no
 *  publican — que es lo que hacían antes sin SUPABASE_SERVICE_KEY. */
export const hayBase = () => !!(process.env.PGHOST || process.env.CLOUD_SQL_INSTANCE);
