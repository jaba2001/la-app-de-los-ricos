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
import { Pool } from "pg";
import type { Esquema } from "./query.ts";

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
// puede parametrizar y por tanto la única vía de inyección. Se lee una vez por instancia.
let _esquema: Esquema | null = null;
let _leyendo: Promise<Esquema> | null = null;

export async function esquema(): Promise<Esquema> {
  if (_esquema) return _esquema;
  // Sin esto, N peticiones simultáneas en un arranque en frío lanzarían N consultas iguales.
  if (_leyendo) return _leyendo;
  _leyendo = (async () => {
    // El ::text no es decorativo: column_name es de tipo information_schema.sql_identifier y
    // el driver no sabe convertir un array de ese tipo — devolvería la cadena "{a,b,c}" y el
    // Set acabaría lleno de letras sueltas, rechazando toda columna.
    const { rows } = await pool().query<{ t: string; cols: string[] }>(
      `select table_name::text as t, array_agg(column_name::text) as cols
         from information_schema.columns
        where table_schema = 'public'
        group by 1`
    );
    _esquema = Object.fromEntries(rows.map((r) => [r.t, new Set(r.cols)]));
    _leyendo = null;
    return _esquema;
  })();
  return _leyendo;
}

/** Para las pruebas: olvida el esquema cacheado. */
export function _olvidarEsquema() { _esquema = null; _leyendo = null; }
