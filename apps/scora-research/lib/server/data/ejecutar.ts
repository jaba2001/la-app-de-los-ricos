// Ejecuta UNA consulta del navegador y le da la forma que espera lib/dataQuery.ts.
//
// Estaba dentro de app/api/data/route.ts. Se saca para que una prueba pueda recorrer el
// mismo camino que la ruta —política, SQL, conversión de tipos, recuento— contra Postgres
// real, sin arrancar Next. Un route.ts no puede exportar funciones propias.
import type { Pool } from "pg";
import { construir, construirConteo, type Peticion, type Esquema } from "./query.ts";
import { filasConNumeros } from "./numeros.js";

export interface Resultado { rows: unknown[]; count?: number }

export async function ejecutarConsulta(db: Pool, q: Peticion, userId: string, esq: Esquema): Promise<Resultado> {
  // `head` sin `count` no significa nada; con `count`, se ahorra traer filas que se tiran.
  const soloConteo = q.op === "select" && !q.rpc && q.count === true && q.head === true;

  let rows: unknown[] = [];
  if (!soloConteo) {
    const sql = construir(q, userId, esq);
    const r = await db.query(sql.text, sql.values as unknown[]);
    // `.single()` y `.maybeSingle()` se resuelven en el cliente a partir de esto: el
    // servidor devuelve siempre filas, que es lo único que sabe.
    rows = filasConNumeros(r);
  }

  if (q.op === "select" && !q.rpc && q.count === true) {
    const c = construirConteo(q, userId, esq);
    const rc = await db.query(c.text, c.values as unknown[]);
    return { rows, count: Number(rc.rows[0]?.n ?? 0) };
  }
  return { rows };
}
