// La única puerta del navegador a la base de datos.
//
// Sustituye a PostgREST de Supabase. Allí el navegador hablaba con la base directamente y la
// RLS lo filtraba; aquí no puede, porque Cloud SQL solo es alcanzable desde el servidor.
// Todo pasa por aquí, y aquí es donde se aplica la política de lib/server/data/policy.ts.
//
// NO PUEDE IR EN EDGE: el driver de Postgres necesita sockets de Node. El resto de rutas de
// datos siguen en edge; esta es la excepción y por eso lo declara explícitamente.
import { requireUser } from "../../../lib/server/auth.js";
import { checkRateLimit } from "../../../lib/server/ratelimit.js";
import { corsHeaders, preflight } from "../../../lib/server/cors.js";
import { construir, RechazoPolitica, type Peticion } from "../../../lib/server/data/query.ts";
import { pool, esquema } from "../../../lib/server/data/pool.ts";

export const runtime = "nodejs";

/** Un lote de consultas en una petición, igual que hace /api/batch con los proveedores:
 *  una pantalla suele pedir tres o cuatro cosas a la vez y no tiene sentido pagar tres
 *  viajes de red y tres comprobaciones de token. */
interface Cuerpo { queries: Peticion[] }

const MAX = 20;

export async function POST(request: Request) {
  const { user, error: authErr } = await requireUser(request);
  if (authErr) return authErr;

  // Cada consulta del lote cuenta: agrupar no puede salir más barato que no agrupar.
  let cuerpo: Cuerpo;
  try { cuerpo = await request.json(); }
  catch { return json(request, { error: "JSON inválido" }, 400); }

  const qs = cuerpo?.queries;
  if (!Array.isArray(qs) || qs.length === 0) return json(request, { error: "queries vacío" }, 400);
  if (qs.length > MAX) return json(request, { error: `Máximo ${MAX} consultas por petición` }, 400);

  const rl = await checkRateLimit("data", user.id, 120, 60, request, { cost: qs.length });
  if (rl) return rl;

  let esq;
  try { esq = await esquema(); }
  catch (e) {
    console.error("no se pudo leer el esquema:", (e as Error).message);
    return json(request, { error: "Base de datos no disponible" }, 503);
  }

  const p = pool();
  const results = [];
  for (const q of qs) {
    try {
      const sql = construir(q, user.id, esq);
      const r = await p.query(sql.text, sql.values as unknown[]);
      // `.single()` y `.maybeSingle()` se resuelven en el cliente a partir de esto: el
      // servidor devuelve siempre filas, que es lo único que sabe.
      results.push({ rows: r.rows, count: r.rowCount ?? r.rows.length });
    } catch (e) {
      if (e instanceof RechazoPolitica) {
        // Un rechazo de política es un 403 y se dice por qué: son errores de programación
        // nuestros (una tabla sin declarar), no ataques que convenga ocultar.
        results.push({ error: e.message, code: "policy" });
        continue;
      }
      // Un error de Postgres SÍ se resume: el mensaje puede llevar nombres de columnas,
      // valores de la fila en conflicto o fragmentos de la consulta.
      const msg = (e as Error).message;
      console.error(`consulta ${q.op} ${q.table}:`, msg);
      results.push({ error: "Error de base de datos", code: "db" });
    }
  }

  return json(request, { results }, 200);
}

function json(request: Request, obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders(request, { "Content-Type": "application/json" }),
  });
}

export async function OPTIONS(request: Request) {
  return preflight(request);
}
