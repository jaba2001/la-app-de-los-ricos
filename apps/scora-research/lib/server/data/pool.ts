// La conexión a Cloud SQL.
//
// DOS FORMAS DE CONECTAR, y la que se use depende del entorno:
//
//   · En Cloud Run, Google monta un socket Unix en /cloudsql/<proyecto>:<region>:<instancia>
//     y el tráfico va cifrado por debajo sin que la app haga nada. No hay contraseña en
//     tránsito por la red ni IP que abrir en el cortafuegos. Es la forma recomendada.
//   · En local, TCP o un socket propio, para poder probar contra una base desechable.
//
// El pool es DE MÓDULO a propósito. Cloud Run reutiliza la instancia entre peticiones, así
// que abrir una conexión por petición desperdiciaría el arranque de TLS y agotaría el
// límite de conexiones de Cloud SQL en cuanto hubiera concurrencia.
import { Pool, types } from "pg";
import type { Esquema } from "./query.ts";

// LAS COLUMNAS `date` VUELVEN COMO TEXTO, igual que las servia PostgREST. Por defecto node-pg
// las convierte en un Date a medianoche de la zona LOCAL del proceso: al serializar a JSON sale
// "2026-09-27T00:00:00.000Z" en UTC y "2026-09-26T22:00:00.000Z" en Madrid — otro formato y,
// fuera de UTC, otro dia. Una fecha de calendario no es un instante y no se convierte. El
// registro es global del driver: vale para /api/data, /api/publico y sbFetch (crons).
// AUDIT_REPORT C-3; lo vigila scripts/numeros.test.mjs.
types.setTypeParser(types.builtins.DATE, (v) => v);

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;

  const instancia = process.env.CLOUD_SQL_INSTANCE;   // proyecto:region:instancia
  const comun = {
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "scora",
    // Cloud SQL de la capa más pequeña admite pocas conexiones y Cloud Run puede levantar
    // 10 instancias (el techo del Terraform). 5 por instancia deja margen para los crons.
    max: Number(process.env.PGPOOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    // Sin esto, una base que no responde deja la petición colgada hasta el timeout de Cloud
    // Run (900 s) en vez de fallar en 5 segundos y devolver un error legible.
    connectionTimeoutMillis: 5_000,
    // Los scripts de research (research/db.mjs) usan este mismo pool: sin esto, al terminar se
    // quedaban 30 s colgados esperando a que caducaran las conexiones ociosas.
    allowExitOnIdle: true,
  };

  _pool = new Pool(
    instancia
      ? { ...comun, host: `/cloudsql/${instancia}` }
      : { ...comun, host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT || 5432) }
  );

  // Un error en una conexión ociosa del pool es un evento 'error' sin manejador, y eso en
  // Node tumba el proceso entero. Cloud Run lo reiniciaría, pero con peticiones en vuelo.
  _pool.on("error", (e) => console.error("pool de Postgres:", e.message));
  return _pool;
}

// ── Las columnas reales, cacheadas ───────────────────────────────────────────────────
// query.ts valida cada nombre de columna contra el esquema de verdad: es lo único que no se
// puede parametrizar y por tanto la única vía de inyección.
//
// Se relee cada ESQUEMA_TTL_MS (AUDIT_REPORT M-6). Antes se leía una vez por instancia y para
// siempre: tras una migración que añadía una columna, la app la rechazaba ("Columna no
// permitida") hasta que Cloud Run reciclara la instancia, que puede ser días.
let ESQUEMA_TTL_MS = 10 * 60_000;
let _esquema: Esquema | null = null;
let _leidoEn = 0;
let _leyendo: Promise<Esquema> | null = null;

export async function esquema(): Promise<Esquema> {
  if (_esquema && Date.now() - _leidoEn < ESQUEMA_TTL_MS) return _esquema;
  // Sin esto, N peticiones simultáneas en un arranque en frío lanzarían N consultas iguales.
  if (_leyendo) return _leyendo;
  _leyendo = (async () => {
    try {
      // El ::text no es decorativo: column_name es de tipo information_schema.sql_identifier
      // y el driver no sabe convertir un array de ese tipo — devolvería la cadena "{a,b,c}" y
      // el Set acabaría lleno de letras sueltas, rechazando toda columna.
      const { rows } = await pool().query<{ t: string; cols: string[] }>(
        `select table_name::text as t, array_agg(column_name::text) as cols
           from information_schema.columns
          where table_schema = 'public'
          group by 1`
      );
      _esquema = Object.fromEntries(rows.map((r) => [r.t, new Set(r.cols)]));
      _leidoEn = Date.now();
      return _esquema;
    } catch (e) {
      // Con un esquema anterior se sigue sirviendo: mejor unos minutos con la foto vieja que
      // tumbar /api/data. Sin ninguno, se propaga (503) — pero sin quedarse pegado.
      if (_esquema) return _esquema;
      throw e;
    } finally {
      // SIEMPRE, también si falla. Antes solo se limpiaba en el camino feliz: una primera
      // lectura fallida (la base arrancando) dejaba la promesa rechazada guardada y cada
      // petición posterior fallaba hasta reiniciar la instancia, aunque la base ya hubiera
      // vuelto (AUDIT_REPORT M-6).
      _leyendo = null;
    }
  })();
  return _leyendo;
}

/** Para las pruebas: olvida el esquema cacheado. */
export function _olvidarEsquema() { _esquema = null; _leidoEn = 0; _leyendo = null; }
/** Para las pruebas: cambia la caducidad. */
export function _ttlEsquema(ms: number) { ESQUEMA_TTL_MS = ms; }
